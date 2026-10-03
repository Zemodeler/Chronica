import {
  StructureSchema,
  aptitude,
  atWar,
  boundedId,
  engagementOf,
  isNavalForce,
  paperWeightedStrength,
  retreatRoute,
  sameConfederation,
  siegeWalls,
  skillShare,
  stableHash,
  warfareWith,
  type Engagement,
  type ManoeuvreKind,
  type TurningPointKind,
  type FactProposalDraft,
  type Force,
  type ScenarioWarfareRules,
  type WorldState,
} from "@chronica/shared";
import { resolveEngagement, type BattleAccount } from "./battle";
import { remember } from "./grievances";
import type { IdFactory } from "./ports";

/**
 * Fights that last (docs/plans/battles-that-last.md, phase 1).
 *
 * The user's rule: **armies do not fight until an order says so; once they do,
 * they fight until one side is beaten.** So:
 *
 * - Enemy armies on the same ground only *face* each other. That is news, and
 *   it is recorded, but nobody is hurt (`noteWhoFaces`).
 * - An order to attack (`force_engage`) opens an engagement (`openEngagement`),
 *   and its first day is fought at once.
 * - Every day after, until it is decided, the tick fights a round
 *   (`fightEngagements`). The attacker offers battle; the side attacked accepts
 *   or refuses. Refused, the day is skirmishing: light troops, water, foragers,
 *   a few dead. Accepted, it is a pitched battle, fought whole by the resolver;
 *   one that ends with neither line broken goes on the next day.
 * - It ends when one side is driven from the field, has left it, falls back
 *   outnumbered three to one, or -- the attacking side -- is put on hold.
 *
 * Who accepts battle is decided here by rule until the commanders themselves
 * are asked at the moments that matter (phase 3): a general with an army to
 * feed and a road behind him refuses a fight he expects to lose, and a rash one
 * takes it.
 */

/** Days of skirmishing between one line in the record and the next. */
const SKIRMISH_TOLD_EVERY = 7;
/** A side weaker than this share of the other falls back rather than stand, with no order needed. */
const WITHDRAWS_BELOW = 1 / 3;
/** At most this many rounds are walked in one tick; a long jump is rare, and an engagement that long is a siege. */
const MAX_ROUNDS_PER_TICK = 60;
/** A day of skirmishing costs each side, at most, this share of its men: a few dozen from a legion. */
const SKIRMISH_RATE = 0.008;
/** What a day of standing to arms and skirmishing adds to fatigue, in basis points. */
const SKIRMISH_FATIGUE_BPS = 250;
/** Below this caution a commander takes a battle he is offered; above it he weighs it. */
const RASH_BELOW = 35;
/** A defender this much stronger than his attacker comes out to fight. */
const CONFIDENT_ABOVE = 1.1;
/**
 * What a day of refusing battle costs the refusers' morale, in basis points,
 * before their general's authority: the men think he is afraid. Fabius was
 * called the Delayer as an insult.
 */
const REFUSAL_MORALE_BPS = 150;
/** Below this morale a refusing army can refuse no longer: it falls back, or fights. */
const REFUSAL_BREAKS_BELOW = 4_000;
/** Where engagement facts start numbering, apart from the crossings' and sieges' fights of the same tick. */
const FACT_INDEX = 900;
/** Standing face to face is news the day it begins, and again after this many days. */
const FACING_REMINDER_DAYS = 7;
/** What a camp's ditch and rampart are worth to the men behind it, the day it is stormed. */
const CAMP_RAMPART_BPS = 1_500;
/** A side whose morale falls below this in a day of battle is wavering, and its commander must decide. */
const WAVERING_BELOW = 4_500;
/** Days of bread a camp taken from the enemy feeds its takers: his stores and baggage. */
const TAKEN_STORES_DAYS = 12;

const fitOf = (force: Force): number => force.personnel.reduce((sum, group) => sum + group.fit, 0);
const sideOf = (force: Force): string => (force.outlaw === true ? `outlaw:${force.id}` : force.polityId);

export function hostile(world: WorldState, a: Force, b: Force): boolean {
  if (sideOf(a) === sideOf(b)) return false;
  if (a.outlaw === true || b.outlaw === true) return true;
  return atWar(world.polityAgreements, a.polityId, b.polityId);
}

const friendly = (world: WorldState, a: Force, b: Force): boolean => sideOf(a) === sideOf(b)
  || (a.outlaw !== true && b.outlaw !== true && sameConfederation(world.polityAgreements, a.polityId, b.polityId));

const provinceName = (world: WorldState, id: string): string => world.map.provinces.find((province) => province.id === id)?.name ?? id;
const names = (forces: readonly Force[]): string => {
  const list = forces.map((force) => force.name);
  return list.length <= 1 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
};

/** Whether an army is on the road: caught on the march, it cannot keep to a camp it has not made. */
const onTheMarch = (world: WorldState, force: Force): boolean => world.projects.some((project) =>
  (project.status === "in_progress" || project.status === "funded")
  && project.completionOutcome?.kind === "force_move" && project.completionOutcome.forceId === force.id);

export interface OpenEngagementInput {
  readonly attacker: Force;
  readonly defender: Force;
  readonly attackerAllies: readonly Force[];
  readonly defenderAllies: readonly Force[];
  /** "offer_battle" seeks a battle; any other posture only harasses. */
  readonly posture: string;
  readonly atStep: number;
  readonly id: string;
  /** A way to force the issue, or get away (`force_engage.manoeuvre`). */
  readonly manoeuvre?: ManoeuvreKind | undefined;
}

/**
 * An order to attack: a new engagement, or more men for one already begun.
 *
 * An army of the side already attacking joins it; an army of the side
 * attacked, ordered to attack in turn, turns the fight into one it seeks too.
 * Two armies that were only facing each other begin in earnest.
 */
export function openEngagement(world: WorldState, input: OpenEngagementInput): { readonly world: WorldState; readonly engagement: Engagement } {
  const attackers = [input.attacker, ...input.attackerAllies];
  const defenders = [input.defender, ...input.defenderAllies];
  const seeking = input.posture === "offer_battle" ? "battle" as const : "harass" as const;
  const existing = engagementOf(world.engagements, input.defender.id) ?? engagementOf(world.engagements, input.attacker.id);
  let engagement: Engagement;
  if (existing !== undefined && existing.provinceId === input.attacker.locationId) {
    const onAttackingSide = existing.attackerForceIds.includes(input.defender.id) ? false : true;
    const add = (ids: readonly string[], more: readonly Force[]): string[] => [...new Set([...ids, ...more.map((force) => force.id)])].slice(0, 16);
    // The side attacked going over to the attack -- storming the besieger's
    // camp, a night raid on it -- makes it the attacker: the sides change round.
    const turnsTheTables = !onAttackingSide && input.manoeuvre !== undefined && input.manoeuvre !== "withdraw_by_night";
    engagement = onAttackingSide
      ? { ...existing, attackerForceIds: add(existing.attackerForceIds, attackers), defenderForceIds: add(existing.defenderForceIds, defenders), seeking: seeking === "battle" ? "battle" : existing.seeking }
      : turnsTheTables
        ? { ...existing, attackerForceIds: add(existing.defenderForceIds, attackers), defenderForceIds: existing.attackerForceIds, seeking: "battle", playerStance: null }
        // The side attacked now attacks: the fight is sought from both ends.
        : { ...existing, seeking: "battle" };
    if (input.manoeuvre !== undefined) {
      const side = input.manoeuvre === "withdraw_by_night" && !onAttackingSide ? "defender" as const : "attacker" as const;
      engagement = { ...engagement, manoeuvre: { kind: input.manoeuvre, side, byForceId: input.attacker.id } };
    }
  } else {
    engagement = {
      id: input.id,
      provinceId: input.attacker.locationId,
      attackerForceIds: attackers.map((force) => force.id).slice(0, 16),
      defenderForceIds: defenders.map((force) => force.id).slice(0, 16),
      openedByForceId: input.attacker.id,
      openedAtStep: input.atStep,
      // Yesterday, so today's round is the first.
      lastRoundStep: Math.max(0, input.atStep - 1),
      seeking,
      rounds: 0,
      pitchedRounds: 0,
      status: "open",
      awaiting: null,
      manoeuvre: input.manoeuvre === undefined ? null : { kind: input.manoeuvre, side: "attacker", byForceId: input.attacker.id },
      playerStance: null,
      asked: [],
      seenForceIds: [...attackers, ...defenders].map((force) => force.id).slice(0, 32),
      winner: null,
      endedBy: null,
      endedAtStep: null,
    };
  }
  // Facing each other is over for these armies: they are fighting.
  const fightingNow = new Set([...engagement.attackerForceIds, ...engagement.defenderForceIds]);
  const others = world.engagements.filter((candidate) => candidate.id !== engagement.id
    && !(candidate.status === "facing" && [...candidate.attackerForceIds, ...candidate.defenderForceIds].some((id) => fightingNow.has(id))));
  return { world: { ...world, engagements: [...others, engagement] }, engagement };
}

export interface RoundResult {
  readonly world: WorldState;
  readonly facts: FactProposalDraft[];
  readonly battles: BattleAccount[];
}

export interface FightInput {
  readonly world: WorldState;
  readonly warfare: ScenarioWarfareRules;
  readonly ids: IdFactory;
  readonly playerCharacterId?: string | null | undefined;
}

/** Every open engagement fought, a round for each day since its last, up to today. */
export function fightEngagements(input: FightInput & { readonly toDay: number }): RoundResult {
  let world = input.world;
  const facts: FactProposalDraft[] = [];
  const battles: BattleAccount[] = [];
  for (const opened of input.world.engagements.filter((engagement) => engagement.status === "open")) {
    for (let day = opened.lastRoundStep + 1, walked = 0; day <= input.toDay && walked < MAX_ROUNDS_PER_TICK; day += 1, walked += 1) {
      const current = world.engagements.find((engagement) => engagement.id === opened.id);
      // Waiting on the player's word: the fight stands still until he gives it.
      if (current === undefined || current.status !== "open" || current.awaiting !== null) break;
      const round = fightRound({ ...input, world }, current.id, day, FACT_INDEX + facts.length);
      world = round.world;
      facts.push(...round.facts);
      battles.push(...round.battles);
    }
  }
  // What was decided a month ago is history, and the Chronicle has it.
  const recent = world.engagements.filter((engagement) => engagement.status !== "ended" || (engagement.endedAtStep ?? 0) > input.toDay - 30);
  if (recent.length !== world.engagements.length) world = { ...world, engagements: recent };
  return { world, facts, battles };
}

/**
 * One day of an engagement.
 *
 * Exported so an order to attack fights its first day the moment it is given:
 * the burst that carries the order should carry the first news of the fight.
 */
export function fightRound(input: FightInput, engagementId: string, day: number, factIndex: number): RoundResult {
  let world = input.world;
  const engagement = world.engagements.find((candidate) => candidate.id === engagementId);
  if (engagement === undefined || engagement.status !== "open") return { world, facts: [], battles: [] };
  const rules = warfareWith(world, input.warfare);
  const where = provinceName(world, engagement.provinceId);
  const facts: FactProposalDraft[] = [];
  const battles: BattleAccount[] = [];
  const byId = (id: string): Force | undefined => world.material.forces.find((force) => force.id === id);
  const onTheField = (force: Force | undefined): force is Force => force !== undefined
    && force.locationId === engagement.provinceId && fitOf(force) > 0 && !isNavalForce(force, rules);

  // Who is still here. The side attacked is attacked whole: its friends on the
  // same ground stand with it, ordered or not. The attackers are only those
  // ordered in, less any put on hold -- they have stopped attacking.
  const leadDefender = engagement.defenderForceIds.map(byId).find(onTheField);
  const attackersNow = engagement.attackerForceIds.map(byId).filter(onTheField);
  const defenders = leadDefender === undefined ? [] : world.material.forces.filter((force) => onTheField(force)
    && !attackersNow.some((attacker) => attacker.id === force.id)
    && (engagement.defenderForceIds.includes(force.id) || (friendly(world, force, leadDefender) && attackersNow.some((attacker) => hostile(world, force, attacker)))));
  const attacking = attackersNow.filter((force) => force.hold !== true);

  const end = (endedBy: Engagement["endedBy"], winner: Engagement["winner"]): WorldState => ({
    ...world,
    engagements: world.engagements.map((candidate) => (candidate.id === engagement.id
      ? { ...candidate, status: "ended" as const, endedBy, winner, endedAtStep: day, lastRoundStep: day }
      : candidate)),
  });
  const fact = (localId: string, kind: string, summary: string, forces: readonly Force[], significance: number): FactProposalDraft => ({
    localId: `${localId}_${engagement.id}_${day}`.slice(0, 60),
    kind,
    summary: summary.slice(0, 600),
    affectedRefs: [{ kind: "province", id: engagement.provinceId }, ...forces.slice(0, 6).map((force) => ({ kind: "force" as const, id: force.id }))],
    visibility: "public",
    discoveryState: "public",
    knowableInDays: 0,
    significance,
  });

  // Nobody left on one side: it is over.
  if (attackersNow.length === 0 || defenders.length === 0) {
    const stayed = attackersNow.length > 0 ? "attacker" as const : defenders.length > 0 ? "defender" as const : null;
    return { world: end("left_the_field", stayed), facts, battles };
  }
  // (a) The attacking side on hold: the fight goes out of it, and nobody won.
  if (attacking.length === 0) {
    facts.push(fact("broken_off", "engagement_broken_off", `${names(attackersNow)} broke off the fight with ${names(defenders)} at ${where}, under orders to hold.`, [...attackersNow, ...defenders], 55));
    return { world: end("broken_off", null), facts, battles };
  }

  const weight = (side: readonly Force[]): number => side.reduce((sum, force) => sum + paperWeightedStrength(force, rules), 0);
  const attackWeight = weight(attacking);
  const defendWeight = weight(defenders);

  // ── The moments that are put to somebody ─────────────────────────────
  //
  // The player's side stops and waits for his word; an NPC commander is told,
  // by name, so the world's attention brings him to decide it -- and if he
  // does not, the rule the engine plays by stands.
  const player = input.playerCharacterId ?? null;
  const his = (force: Force): boolean => player !== null && (force.commanderCharacterId === player || force.controllerCharacterId === player);
  const playerSide = defenders.some(his) ? "defender" as const : attackersNow.some(his) ? "attacker" as const : null;
  const mineNow = playerSide === "defender" ? defenders : playerSide === "attacker" ? attackersNow : [];
  const theirsNow = playerSide === "defender" ? attacking : playerSide === "attacker" ? defenders : [];
  const seen = new Set(engagement.seenForceIds);
  const record = (changes: Partial<Engagement>): void => {
    world = { ...world, engagements: world.engagements.map((candidate) => (candidate.id === engagement.id ? { ...candidate, ...changes } : candidate)) };
  };
  const ask = (kind: TurningPointKind, key: string, summary: string): RoundResult => {
    record({
      awaiting: { kind, side: playerSide!, askedAtStep: day },
      asked: [...engagement.asked, key].slice(-40),
      seenForceIds: [...new Set([...engagement.seenForceIds, ...attackersNow.map((force) => force.id), ...defenders.map((force) => force.id)])].slice(-32),
    });
    const polityId = mineNow[0]?.polityId;
    facts.push({
      ...fact("turning_point", "engagement_turning_point", summary, [...mineNow, ...theirsNow], 60),
      ...(polityId === undefined ? {} : { visibility: "polity" as const, discoveryState: "polity" as const }),
    });
    return { world, facts, battles };
  };
  if (playerSide !== null) {
    const newcomers = theirsNow.filter((force) => !seen.has(force.id));
    const key = `reinforced@${newcomers.map((force) => force.id).join(",")}`.slice(0, 60);
    if (newcomers.length > 0 && !engagement.asked.includes(key)) {
      return ask("reinforced", key, `${names(newcomers)} ${newcomers.length === 1 ? "has" : "have"} come onto the field at ${where} against ${names(mineNow)}.`);
    }
    if (mineNow.some((force) => force.provisionStatus !== "provisioned") && !engagement.asked.includes("hungry")) {
      return ask("hungry", "hungry", `${names(mineNow)} ${mineNow.length === 1 ? "has" : "have"} eaten the bread ${mineNow.length === 1 ? "it" : "they"} carried, facing ${names(theirsNow)} at ${where}.`);
    }
  }
  if (playerSide === null || seen.size < attackersNow.length + defenders.length) {
    record({ seenForceIds: [...new Set([...engagement.seenForceIds, ...attackersNow.map((force) => force.id), ...defenders.map((force) => force.id)])].slice(-32) });
  }

  // Outnumbered three to one, a commander does not wait to be destroyed.
  const weakSide = attackWeight < defendWeight * WITHDRAWS_BELOW ? attacking : defendWeight < attackWeight * WITHDRAWS_BELOW ? defenders : null;
  if (weakSide !== null) {
    const strongSide = weakSide === attacking ? defenders : attacking;
    const to = retreatRoute(world, weakSide[0]!, engagement.provinceId, new Set(strongSide.map((force) => force.polityId)));
    if (to !== null) {
      const going = new Set(weakSide.map((force) => force.id));
      world = {
        ...world,
        material: {
          ...world.material,
          forces: world.material.forces.map((force) => (going.has(force.id)
            ? { ...force, locationId: to, positionId: null, fatigueBps: Math.min(10_000, force.fatigueBps + 1_000) }
            : force)),
        },
      };
      facts.push(fact("withdrew", "force_withdrew", `${names(weakSide)}, outnumbered three to one, would not stand against ${names(strongSide)} at ${where}, and fell back into ${provinceName(world, to)}.`, [...weakSide, ...strongSide], 55));
      world = end("withdrew", weakSide === attacking ? "defender" : "attacker");
      const taken = takeTheCamp(world, strongSide, weakSide, engagement.provinceId, day);
      facts.push(...taken.facts.map((drafted) => ({ ...drafted, localId: `${drafted.localId}_${engagement.id}`.slice(0, 60) })));
      return { world: taken.world, facts, battles };
    }
  }

  // ── A manoeuvre ordered for today ────────────────────────────────────
  const current = world.engagements.find((candidate) => candidate.id === engagement.id) ?? engagement;
  const manoeuvre = current.manoeuvre;
  const spend = (): void => {
    // Provoking goes on until another order; everything else is tried once.
    if (manoeuvre !== null && manoeuvre.kind !== "provoke") record({ manoeuvre: null });
  };
  const leader = (side: readonly Force[]) => world.characters.find((character) => character.id === side[0]?.commanderCharacterId);
  const roll = (salt: string): number => (stableHash([engagement.id, salt, day]) % 10_000) / 10_000;
  const mind = (side: readonly Force[], trait: "caution" | "discipline"): number => leader(side)?.mind.temperament[trait] ?? 50;
  const generalship = (side: readonly Force[]): number => { const man = leader(side); return man === undefined ? 0 : skillShare(aptitude(man, "strategist"), 0.3); };
  let forcePitched = false;
  let tacticOverride: { factor: "surprise"; magnitude: "meaningful"; rationale: string } | null = null;
  let stormed = false;
  let unsettle = 0;

  if (manoeuvre?.kind === "withdraw_by_night") {
    spend();
    const going = manoeuvre.side === "attacker" ? attackersNow : defenders;
    const staying = manoeuvre.side === "attacker" ? defenders : attacking;
    const to = retreatRoute(world, going[0]!, engagement.provinceId, new Set(staying.map((force) => force.polityId)));
    if (to !== null) {
      // A vigilant enemy with horse catches the tail of the column.
      const horse = horseShare(staying, rules);
      const caught = roll("pursuit") < (mind(staying, "caution") / 100) * 0.5 + horse * 0.4 ? 0.03 + horse * 0.05 : 0;
      const leaving = new Set(going.map((force) => force.id));
      world = { ...world, material: { ...world.material, forces: world.material.forces.map((force) => (leaving.has(force.id)
        ? losses({ ...force, locationId: to, positionId: null, fatigueBps: Math.min(10_000, force.fatigueBps + 800) }, caught, day, engagement.id)
        : force)) } };
      facts.push(fact("night_withdrawal", "force_withdrew", caught > 0
        ? `${names(going)} tried to slip away from ${where} by night, but ${names(staying)} caught the rear of the column, and ${names(going)} reached ${provinceName(world, to)} with losses.`
        : `${names(going)} left ${going.length === 1 ? "its" : "their"} fires burning at ${where} and slipped away by night into ${provinceName(world, to)}; ${names(staying)} found the camp empty at dawn.`,
      [...going, ...staying], 60));
      world = end("withdrew", manoeuvre.side === "attacker" ? "defender" : "attacker");
      return { world, facts, battles };
    }
  } else if (manoeuvre?.kind === "storm_camp") {
    spend();
    forcePitched = true;
    stormed = !defenders.some((force) => onTheMarch(world, force));
    facts.push(fact("camp_stormed", "camp_stormed", stormed
      ? `${names(attacking)} went at the rampart of ${names(defenders)}'s camp at ${where}, to take by storm the battle it would not give.`
      : `${names(attacking)} fell on ${names(defenders)} at ${where} before ${defenders.length === 1 ? "it" : "they"} could make a camp.`,
    [...attacking, ...defenders], 60));
  } else if (manoeuvre?.kind === "night_attack") {
    spend();
    // Surprise is won by the attacker's generalship and lost by a watchful,
    // well-ordered camp: Utica burned; many a night column lost its way.
    const chance = Math.max(0.1, Math.min(0.8, 0.25 + generalship(attacking) + 0.35 * (1 - mind(defenders, "caution") / 100) * (1 - mind(defenders, "discipline") / 100)));
    if (roll("night") < chance) {
      forcePitched = true;
      unsettle = 1_500;
      tacticOverride = { factor: "surprise", magnitude: "meaningful", rationale: "A night attack on the camp, falling on men asleep." };
      facts.push(fact("night_attack", "night_attack", `${names(attacking)} fell on ${names(defenders)}'s camp at ${where} in the night, and caught ${defenders.length === 1 ? "it" : "them"} unready.`, [...attacking, ...defenders], 70));
    } else {
      const failed = new Set(attacking.map((force) => force.id));
      world = { ...world, material: { ...world.material, forces: world.material.forces.map((force) => (failed.has(force.id)
        ? { ...losses(force, 0.03, day, engagement.id), moraleBps: Math.max(0, force.moraleBps - 600), cohesionBps: Math.max(0, force.cohesionBps - 500) }
        : force)) } };
      facts.push(fact("night_attack", "night_attack", `${names(attacking)}'s night attack on ${names(defenders)} at ${where} miscarried: the columns lost their way in the dark, the camp was awake, and they were driven off with loss.`, [...attacking, ...defenders], 65));
      record({ rounds: current.rounds + 1, lastRoundStep: day });
      return { world, facts, battles };
    }
  } else if (manoeuvre?.kind === "lure") {
    spend();
    // A feigned retreat, a detachment offered as bait: a rash man takes it.
    const chance = Math.max(0.05, Math.min(0.85, 0.6 * (1 - mind(defenders, "caution") / 100) + generalship(attacking)));
    if (roll("lure") < chance) {
      forcePitched = true;
      tacticOverride = { factor: "surprise", magnitude: "meaningful", rationale: "The enemy drawn out of his camp by a feigned retreat into ground prepared for him." };
      facts.push(fact("lured", "engagement_turning_point", `${names(defenders)} took the bait at ${where}: drawn out of camp after what looked like a retreat by ${names(attacking)}, ${defenders.length === 1 ? "it" : "they"} came onto ground chosen for ${defenders.length === 1 ? "it" : "them"}.`, [...attacking, ...defenders], 65));
    } else {
      facts.push(fact("lure_refused", "skirmish", `${names(attacking)} feigned a retreat at ${where} to draw ${names(defenders)} out, but ${names(defenders)} would not be drawn.`, [...attacking, ...defenders], 45));
    }
  } else if (manoeuvre?.kind === "provoke") {
    // Burning the country in sight of the camp: every day of it costs the man
    // who will not come out his people's regard, and his soldiers' heart.
    world = ravage(world, engagement.provinceId, defenders, leader(defenders)?.id ?? null);
    if (!current.asked.includes("provoked")) {
      record({ asked: [...current.asked, "provoked"].slice(-40) });
      facts.push(fact("provoked", "skirmish", `${names(attacking)} burned the farms around ${where} in plain sight of ${names(defenders)}'s camp, daring ${defenders.length === 1 ? "it" : "them"} to come out.`, [...attacking, ...defenders], 55));
    }
  }

  // Battle offered, and taken or refused. A camp can be kept only so long as
  // the men will keep it: refused day after day, they lose heart, and a side
  // that can refuse no longer falls back if it has a road, or comes out.
  const offered = engagement.seeking === "battle";
  const refusable = canRefuse(world, defenders);
  if (offered && playerSide === "defender" && refusable && engagement.playerStance === null && !engagement.asked.includes("battle_offered")) {
    return ask("battle_offered", "battle_offered", `${names(attacking)} ${attacking.length === 1 ? "is" : "are"} drawn up in battle order before ${names(defenders)}'s camp at ${where}, offering battle.`);
  }
  // The commander of an army battle is offered to is asked, by the news of it,
  // the first time: the model plays him, and may bring him out or keep him in.
  if (offered && playerSide !== "defender" && refusable && !engagement.asked.includes("npc:offered")) {
    const commander = world.characters.find((character) => character.id === defenders[0]!.commanderCharacterId);
    if (commander !== undefined) {
      record({ asked: [...(world.engagements.find((candidate) => candidate.id === engagement.id)?.asked ?? engagement.asked), "npc:offered"].slice(-40) });
      facts.push({
        ...fact("offered", "engagement_turning_point", `${names(attacking)} offered battle to ${names(defenders)} at ${where}. ${commander.name} must choose whether to come out and fight or keep to the camp.`, [...defenders, ...attacking], 55),
        affectedRefs: [{ kind: "character", id: commander.id }, { kind: "province", id: engagement.provinceId }, ...[...defenders, ...attacking].slice(0, 5).map((force) => ({ kind: "force" as const, id: force.id }))],
      });
    }
  }
  const wouldRefuse = offered && (playerSide === "defender" && refusable && engagement.playerStance !== null
    ? engagement.playerStance === "refuse"
    : !acceptsBattle(world, defenders, attackWeight, defendWeight));
  const disheartened = wouldRefuse && defenders.reduce((sum, force) => sum + force.moraleBps, 0) / defenders.length < REFUSAL_BREAKS_BELOW;
  if (disheartened) {
    const to = retreatRoute(world, defenders[0]!, engagement.provinceId, new Set(attacking.map((force) => force.polityId)));
    if (to !== null) {
      const going = new Set(defenders.map((force) => force.id));
      world = { ...world, material: { ...world.material, forces: world.material.forces.map((force) => (going.has(force.id) ? { ...force, locationId: to, positionId: null, fatigueBps: Math.min(10_000, force.fatigueBps + 1_000) } : force)) } };
      facts.push(fact("gave_up_the_camp", "force_withdrew", `${names(defenders)}, disheartened after refusing battle day after day, left ${defenders.length === 1 ? "its" : "their"} camp at ${where} by night and fell back into ${provinceName(world, to)}, leaving the field to ${names(attacking)}.`, [...defenders, ...attacking], 60));
      world = end("withdrew", "attacker");
      const taken = takeTheCamp(world, attacking, defenders, engagement.provinceId, day);
      facts.push(...taken.facts.map((drafted) => ({ ...drafted, localId: `${drafted.localId}_${engagement.id}`.slice(0, 60) })));
      return { world: taken.world, facts, battles };
    }
  }
  const pitched = forcePitched || (offered && (!wouldRefuse || disheartened));
  const atDay: WorldState = { ...world, elapsedStep: day, instant: { ...world.instant, day } };

  if (pitched) {
    // A camp stormed is fought over its rampart, for this one day; a camp
    // surprised in the night is fought by men not yet in their ranks.
    // Storming a city under siege is fought over its walls, not a camp's ditch.
    const besiegedCity = world.sieges.find((siege) => siege.status === "active" && siege.provinceId === engagement.provinceId
      && siege.defenderPolityId === defenders[0]!.polityId && attacking.some((force) => force.polityId === siege.besiegerPolityId));
    const rampart = stormed ? StructureSchema.parse({
      id: `rampart-${engagement.id}`.slice(0, 120), kind: "wall", name: besiegedCity === undefined ? "the camp's rampart" : "the city walls", provinceId: engagement.provinceId,
      ownerPolityId: defenders[0]!.polityId,
      defensiveEffectsBps: besiegedCity === undefined ? CAMP_RAMPART_BPS : Math.max(CAMP_RAMPART_BPS, Math.min(4_000, Math.round((siegeWalls(world, besiegedCity) - 1) * 1_500))),
      builtAtStep: day,
    }) : null;
    const shaken = new Set(unsettle > 0 ? defenders.map((force) => force.id) : []);
    const field: WorldState = {
      ...atDay,
      structures: rampart === null ? atDay.structures : [...atDay.structures, rampart],
      material: unsettle === 0 ? atDay.material : { ...atDay.material, forces: atDay.material.forces.map((force) => (shaken.has(force.id) ? { ...force, cohesionBps: Math.max(0, force.cohesionBps - unsettle) } : force)) },
    };
    const engaged = resolveEngagement({
      world: field,
      attacker: attacking[0]!,
      attackerAllies: attacking.slice(1),
      defender: defenders[0]!,
      defenderAllies: defenders.slice(1),
      posture: "offer_battle",
      tactic: tacticOverride ?? attacking[0]!.battlePlan ?? null,
      ...(tacticOverride === null ? {} : { engineTactic: true }),
      defenderTactic: defenders[0]!.battlePlan ?? null,
      warfare: rules,
      battleId: input.ids.next("battle"),
      seed: `${engagement.id}:battle:${day}`,
      playerCharacterId: input.playerCharacterId ?? null,
    }, factIndex);
    world = {
      ...engaged.world,
      elapsedStep: world.elapsedStep,
      instant: world.instant,
      structures: rampart === null ? engaged.world.structures : engaged.world.structures.filter((structure) => structure.id !== rampart.id),
    };
    facts.push(...engaged.facts);
    if (engaged.account !== undefined) battles.push(engaged.account);
  } else {
    world = skirmish(world, attacking, defenders, engagement, day, rules);
    if (wouldRefuse) world = refusalCosts(world, defenders);
    const first = engagement.rounds === 0;
    const refused = engagement.seeking === "battle";
    // Told the first day and then once a week: a day like the last is not news,
    // and twenty-one of them in a turn buried everything else in it.
    if (first || engagement.rounds % SKIRMISH_TOLD_EVERY === 0) {
      const lasting = first ? "" : ` So it has gone for ${engagement.rounds + 1} days.`;
      facts.push(fact("skirmish", "skirmish", refused
        ? `${names(attacking)} offered battle at ${where}; ${names(defenders)} kept to ${defenders.length === 1 ? "its" : "their"} camp, and the day went in skirmishing over water and forage.${lasting}`
        : `${names(attacking)} harried ${names(defenders)} at ${where}, cutting up foragers and outposts without bringing on a battle.${lasting}`,
      [...attacking, ...defenders], first ? 55 : 25));
    }
  }

  // Decided, if either side has been driven from the field.
  const stillAttacking = attacking.map((force) => byIdIn(world, force.id)).filter((force): force is Force => force !== undefined && force.locationId === engagement.provinceId && fitOf(force) > 0);
  const stillDefending = defenders.map((force) => byIdIn(world, force.id)).filter((force): force is Force => force !== undefined && force.locationId === engagement.provinceId && fitOf(force) > 0);
  // The attackers still here, those who fought today and those standing by on hold.
  const heldBack = attackersNow.filter((force) => force.hold === true).map((force) => byIdIn(world, force.id)).filter((force): force is Force => force !== undefined && force.locationId === engagement.provinceId);
  // From the record as today left it: what was asked and seen is kept.
  const counted: Engagement = {
    ...(world.engagements.find((candidate) => candidate.id === engagement.id) ?? engagement),
    attackerForceIds: stillAttacking.length + heldBack.length > 0 ? [...stillAttacking, ...heldBack].map((force) => force.id).slice(0, 16) : engagement.attackerForceIds,
    defenderForceIds: stillDefending.length > 0 ? stillDefending.map((force) => force.id).slice(0, 16) : engagement.defenderForceIds,
    rounds: engagement.rounds + 1,
    pitchedRounds: engagement.pitchedRounds + (pitched ? 1 : 0),
    lastRoundStep: day,
  };
  world = { ...world, engagements: world.engagements.map((candidate) => (candidate.id === engagement.id ? counted : candidate)) };
  if (stillAttacking.length === 0 || stillDefending.length === 0) {
    const winner = stillAttacking.length === 0 ? (stillDefending.length === 0 ? null : "defender" as const) : "attacker" as const;
    world = end("decided", winner);
    // A garrison driven off its walls leaves the city open: the siege it held
    // out against is over at the next pressing.
    if (winner === "attacker") {
      world = { ...world, sieges: world.sieges.map((siege) => (siege.status === "active" && siege.provinceId === engagement.provinceId
        && defenders.some((force) => force.polityId === siege.defenderPolityId) && stillAttacking.some((force) => force.polityId === siege.besiegerPolityId)
        ? { ...siege, pressureBps: 10_000 } : siege)) };
    }
    if (winner !== null) {
      const taken = takeTheCamp(world, winner === "attacker" ? stillAttacking : stillDefending, winner === "attacker" ? defenders : attacking, engagement.provinceId, day);
      world = taken.world;
      facts.push(...taken.facts.map((drafted) => ({ ...drafted, localId: `${drafted.localId}_${engagement.id}`.slice(0, 60) })));
    }
  }

  // ── Standing by while one's own side fights ─────────────────────────
  //
  // Joining takes an order, but an army of the attacking side that stood on
  // the same ground and did nothing is remembered for it: its colleague does
  // not forgive it, and its commander's standing pays -- three times over if
  // the day was lost. The player is asked instead, while it can still matter.
  if (pitched && attacking.length > 0) {
    const inIt = new Set([...attacking, ...attackersNow, ...defenders].map((force) => force.id));
    const idle = world.material.forces.filter((force) => force.locationId === engagement.provinceId && fitOf(force) > 0 && !isNavalForce(force, rules)
      && !inIt.has(force.id) && force.hold !== true && friendly(world, force, attacking[0]!) && defenders.some((enemy) => hostile(world, force, enemy)));
    const lost = world.engagements.find((candidate) => candidate.id === engagement.id)?.winner === "defender";
    for (const bystander of idle) {
      const key = `idle:${bystander.id}`.slice(0, 60);
      const now = world.engagements.find((candidate) => candidate.id === engagement.id)!;
      if (now.asked.includes(key)) continue;
      if (his(bystander) && now.status === "open" && now.awaiting === null) {
        world = { ...world, engagements: world.engagements.map((candidate) => (candidate.id === engagement.id
          ? { ...candidate, awaiting: { kind: "ally_fighting" as const, side: "attacker" as const, askedAtStep: day }, asked: [...candidate.asked, key].slice(-40) }
          : candidate)) };
        facts.push({ ...fact("ally_fighting", "engagement_turning_point", `${names(attacking)} ${attacking.length === 1 ? "is" : "are"} fighting ${names(defenders)} at ${where}, and ${bystander.name} stands by on the same ground.`, [bystander, ...attacking, ...defenders], 60), visibility: "polity", discoveryState: "polity" });
        continue;
      }
      world = { ...world, engagements: world.engagements.map((candidate) => (candidate.id === engagement.id ? { ...candidate, asked: [...candidate.asked, key].slice(-40) } : candidate)) };
      world = stoodIdle(world, bystander, attacking[0]!, lost, day, engagement.id);
      facts.push({
        ...fact(`idle_${bystander.id}`, "stood_idle", `${bystander.name} stood by at ${where} while ${names(attacking)} fought ${names(defenders)}, and did not come in.`, [bystander, ...attacking], 55),
        affectedRefs: [{ kind: "character", id: bystander.commanderCharacterId }, { kind: "character", id: attacking[0]!.commanderCharacterId }, { kind: "province", id: engagement.provinceId }, { kind: "force", id: bystander.id }, { kind: "force", id: attacking[0]!.id }],
        visibility: "polity",
        discoveryState: "polity",
      });
    }
  }

  // After a day of battle, the moments it left: a line whose heart is going,
  // and a commander lost. Put to the player; told to the NPC who must decide.
  const stillOpen = world.engagements.find((candidate) => candidate.id === engagement.id)?.status === "open";
  if (pitched && stillOpen) {
    const lostMen = new Set(facts.filter((drafted) => drafted.kind === "character_death" || drafted.kind === "commander_captured")
      .flatMap((drafted) => (drafted.affectedRefs ?? []).filter((ref) => ref.kind === "character").map((ref) => ref.id)));
    const sides: readonly (readonly [Force[], "attacker" | "defender"])[] = [[stillAttacking, "attacker"], [stillDefending, "defender"]];
    for (const [side, name] of sides) {
      if (side.length === 0) continue;
      const morale = side.reduce((sum, force) => sum + force.moraleBps, 0) / side.length;
      const commanderLost = side.some((force) => lostMen.has(force.commanderCharacterId)) || [...attacking, ...defenders].some((force) => side.some((mine) => mine.id === force.id) && lostMen.has(force.commanderCharacterId));
      const wavering = morale < WAVERING_BELOW;
      if (!wavering && !commanderLost) continue;
      const kind: TurningPointKind = commanderLost ? "commander_lost" : "wavering";
      const key = `${kind}@${day}`;
      const current = world.engagements.find((candidate) => candidate.id === engagement.id)!;
      if (current.asked.includes(key) || current.awaiting !== null) continue;
      const others = name === "attacker" ? stillDefending : stillAttacking;
      const summary = commanderLost
        ? `${names(side)} lost ${side.length === 1 ? "its" : "their"} commander in the day's fighting at ${where}, and the fight against ${names(others)} is not over.`
        : `${names(side)} came out of the day's fighting at ${where} with ${side.length === 1 ? "its" : "their"} spirit failing, and ${names(others)} still before ${side.length === 1 ? "it" : "them"}.`;
      if (playerSide === name) {
        world = { ...world, engagements: world.engagements.map((candidate) => (candidate.id === engagement.id
          ? { ...candidate, awaiting: { kind, side: name, askedAtStep: day }, asked: [...candidate.asked, key].slice(-40) }
          : candidate)) };
        facts.push({ ...fact(`turn_${kind}`, "engagement_turning_point", summary, [...side, ...others], 60), visibility: "polity", discoveryState: "polity" });
      } else {
        const commander = world.characters.find((character) => character.id === side[0]!.commanderCharacterId);
        world = { ...world, engagements: world.engagements.map((candidate) => (candidate.id === engagement.id ? { ...candidate, asked: [...candidate.asked, key].slice(-40) } : candidate)) };
        facts.push({
          ...fact(`turn_${kind}`, "engagement_turning_point", summary, [...side, ...others], 55),
          ...(commander === undefined ? {} : { affectedRefs: [{ kind: "character" as const, id: commander.id }, { kind: "province" as const, id: engagement.provinceId }, ...[...side, ...others].slice(0, 5).map((force) => ({ kind: "force" as const, id: force.id }))] }),
        });
      }
    }
  }
  return { world, facts, battles };
}

const byIdIn = (world: WorldState, id: string): Force | undefined => world.material.forces.find((force) => force.id === id);

/**
 * Whether the side attacked comes out to fight.
 *
 * It can refuse only from a camp it can keep: an army on the march has none,
 * and one whose food has run out cannot stay in it. Able to refuse, a side on
 * hold always does; a rash commander takes the battle, a confident one takes
 * it when he is the stronger, and anyone else keeps to his lines.
 */
/** Whether a side can keep to its camp at all: fed enough to stay, and not caught on the road. */
export const canRefuse = (world: WorldState, defenders: readonly Force[]): boolean =>
  defenders.every((force) => force.provisionStatus !== "critical" && !onTheMarch(world, force));

export function acceptsBattle(world: WorldState, defenders: readonly Force[], attackWeight: number, defendWeight: number): boolean {
  if (!canRefuse(world, defenders)) return true;
  if (defenders.some((force) => force.hold === true)) return false;
  const commander = world.characters.find((character) => character.id === defenders[0]!.commanderCharacterId);
  const caution = commander?.mind.temperament.caution ?? 50;
  if (caution < RASH_BELOW) return true;
  return defendWeight > attackWeight * CONFIDENT_ABOVE;
}

/**
 * The field won, and the camp with it.
 *
 * A beaten army leaves behind what it could not carry: Hannibal fed his men
 * for weeks on what he took at Cannae and Geronium. The winners are fed for
 * `TAKEN_STORES_DAYS` more, and any depot the losers' power kept on that
 * ground is the winners' power's now.
 */
function takeTheCamp(world: WorldState, winners: readonly Force[], losers: readonly Force[], provinceId: string, day: number): { readonly world: WorldState; readonly facts: FactProposalDraft[] } {
  if (winners.length === 0 || losers.length === 0) return { world, facts: [] };
  const fed = new Set(winners.map((force) => force.id));
  const loserPowers = new Set(losers.map((force) => force.polityId));
  const takerPower = winners[0]!.polityId;
  const depots = world.structures.filter((structure) => structure.provinceId === provinceId && structure.supplyRadius > 0 && structure.ownerPolityId !== null && loserPowers.has(structure.ownerPolityId));
  const next: WorldState = {
    ...world,
    material: {
      ...world.material,
      forces: world.material.forces.map((force) => (fed.has(force.id)
        ? { ...force, provisionedThroughStep: Math.max(force.provisionedThroughStep, day) + TAKEN_STORES_DAYS, provisionStatus: "provisioned" as const }
        : force)),
    },
    structures: depots.length === 0 ? world.structures : world.structures.map((structure) => (depots.includes(structure) ? { ...structure, ownerPolityId: takerPower } : structure)),
  };
  const where = provinceName(world, provinceId);
  return {
    world: next,
    facts: [{
      localId: "camp_taken",
      kind: "camp_taken",
      summary: `${names(winners)} took the camp ${names(losers)} left at ${where}, and fed on its stores${depots.length === 0 ? "" : `; the depot there is ${names(winners)}'s now`}.`.slice(0, 600),
      affectedRefs: [{ kind: "province", id: provinceId }, ...[...winners, ...losers].slice(0, 6).map((force) => ({ kind: "force" as const, id: force.id }))],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      significance: 45,
    }],
  };
}

/** Of a side's men, the share that are horse: what catches a column on the road. */
function horseShare(side: readonly Force[], rules: ScenarioWarfareRules): number {
  const all = side.reduce((sum, force) => sum + fitOf(force), 0);
  if (all === 0) return 0;
  const horse = side.reduce((sum, force) => sum + force.personnel
    .filter((group) => (rules.troopCategories.find((category) => category.id === group.categoryId)?.mobilityBps ?? 0) >= 8_000)
    .reduce((men, group) => men + group.fit, 0), 0);
  return horse / all;
}

/** A share of a force's men lost, written into its history against the fight. */
function losses(force: Force, share: number, day: number, cause: string): Force {
  if (share <= 0) return force;
  const events: Force["history"] = [];
  const personnel = force.personnel.map((group) => {
    const lost = Math.floor(group.fit * share);
    if (lost <= 0) return group;
    events.push({ id: boundedId(force.id, group.categoryId, "loss", day), atStep: day, kind: "battle_death", categoryId: group.categoryId, count: lost, causeId: cause });
    return { ...group, fit: group.fit - lost };
  });
  return { ...force, personnel, history: [...force.history, ...events].slice(-64) };
}

/**
 * The country burned in sight of a camp that will not come out: the land
 * loses its food and its peace, the men in the camp their heart twice over,
 * and the commander who sits and watches his people's regard.
 */
function ravage(world: WorldState, provinceId: string, watchers: readonly Force[], commanderId: string | null): WorldState {
  const burned: WorldState = {
    ...world,
    material: {
      ...world.material,
      provinceMaterial: world.material.provinceMaterial.map((row) => (row.provinceId !== provinceId ? row : {
        ...row,
        foodSecurityBps: Math.max(0, row.foodSecurityBps - 300),
        stabilityBps: Math.max(0, row.stabilityBps - 200),
        warDamageBps: Math.min(10_000, row.warDamageBps + 300),
      })),
    },
    characters: commanderId === null ? world.characters : world.characters.map((character) => (character.id === commanderId
      ? { ...character, prestigeBps: Math.max(0, character.prestigeBps - PROVOKED_STANDING_BPS) }
      : character)),
  };
  return refusalCosts(burned, watchers);
}

/**
 * The cost of standing by: the colleague left to fight alone holds it against
 * the man who did, and the idle commander's standing falls -- further if the
 * battle was lost.
 */
export function stoodIdle(world: WorldState, bystander: Force, fighting: Force, lost: boolean, day: number, engagementId: string): WorldState {
  const idleMan = bystander.commanderCharacterId;
  const leftAlone = fighting.commanderCharacterId;
  const shamed: WorldState = {
    ...world,
    characters: world.characters.map((character) => (character.id === idleMan
      ? { ...character, prestigeBps: Math.max(0, character.prestigeBps - (lost ? IDLE_STANDING_BPS * 3 : IDLE_STANDING_BPS)) }
      : character)),
  };
  if (idleMan === leftAlone) return shamed;
  return remember(shamed, [{
    subjectCharacterId: leftAlone, targetCharacterId: idleMan, label: "He stood by and watched while I fought.",
    score: lost ? -20 : -10, dimensions: { trust: lost ? -50 : -30 }, decayPerYearBps: 1_000,
  }], day, `${engagementId}:idle:${bystander.id}`);
}

/** What standing by while one's own side fights costs a commander's standing. */
const IDLE_STANDING_BPS = 150;

/** What a day of watching his country burned from his camp costs a commander's standing. */
const PROVOKED_STANDING_BPS = 40;

/** The morale a day of refusing battle costs, less as the general is more a man his soldiers fear. */
function refusalCosts(world: WorldState, refusers: readonly Force[]): WorldState {
  const ids = new Set(refusers.map((force) => force.id));
  return {
    ...world,
    material: {
      ...world.material,
      forces: world.material.forces.map((force) => {
        if (!ids.has(force.id)) return force;
        const commander = world.characters.find((character) => character.id === force.commanderCharacterId);
        const held = commander === undefined ? 1 : 1 - skillShare(aptitude(commander, "authority"), 0.5);
        return { ...force, moraleBps: Math.max(0, force.moraleBps - Math.round(REFUSAL_MORALE_BPS * held)) };
      }),
    },
  };
}

/**
 * A day of it short of battle: a few men lost on each side, more by whoever
 * the day went against, and everyone more tired.
 */
function skirmish(world: WorldState, attackers: readonly Force[], defenders: readonly Force[], engagement: Engagement, day: number, rules: ScenarioWarfareRules): WorldState {
  const weight = (side: readonly Force[]): number => side.reduce((sum, force) => sum + paperWeightedStrength(force, rules), 0);
  const total = Math.max(1, weight(attackers) + weight(defenders));
  const rateFor = new Map<string, number>([
    ...attackers.map((force) => [force.id, SKIRMISH_RATE * (weight(defenders) / total)] as const),
    ...defenders.map((force) => [force.id, SKIRMISH_RATE * (weight(attackers) / total)] as const),
  ]);
  return {
    ...world,
    material: {
      ...world.material,
      forces: world.material.forces.map((force) => {
        const rate = rateFor.get(force.id);
        if (rate === undefined) return force;
        const events: Force["history"] = [];
        const personnel = force.personnel.map((group) => {
          const lost = Math.floor(group.fit * rate);
          if (lost <= 0) return group;
          events.push({ id: boundedId(force.id, group.categoryId, "skirmish", day), atStep: day, kind: "battle_death", categoryId: group.categoryId, count: lost, causeId: engagement.id });
          return { ...group, fit: group.fit - lost };
        });
        return {
          ...force,
          personnel,
          fatigueBps: Math.min(10_000, force.fatigueBps + SKIRMISH_FATIGUE_BPS),
          history: [...force.history, ...events].slice(-64),
        };
      }),
    },
  };
}

/**
 * Enemy armies standing on the same ground, and not yet fighting.
 *
 * Remembered as a "facing" record from the first day, so the world knows how
 * long they have stood there, and news that day and a week on: the commanders
 * are put the question -- give battle, or keep to the camp -- by the attention
 * the world already pays to what it hears. Nobody is hurt by it. A record
 * whose armies have parted, or begun to fight, is let go.
 */
export function noteWhoFaces(world: WorldState, toDay: number, warfare: ScenarioWarfareRules, ids: IdFactory): { readonly world: WorldState; readonly facts: FactProposalDraft[] } {
  const rules = warfareWith(world, warfare);
  const facts: FactProposalDraft[] = [];
  const fighting = new Set(world.engagements.filter((engagement) => engagement.status === "open")
    .flatMap((engagement) => [...engagement.attackerForceIds, ...engagement.defenderForceIds]));
  const facing = world.engagements.filter((engagement) => engagement.status === "facing");
  const kept: Engagement[] = [];
  const provinces = [...new Set(world.material.forces.map((force) => force.locationId))].sort();
  for (const provinceId of provinces) {
    const here = world.material.forces.filter((force) => force.locationId === provinceId && fitOf(force) > 0 && !isNavalForce(force, rules) && !fighting.has(force.id))
      .sort((a, b) => a.id.localeCompare(b.id));
    for (let i = 0; i < here.length; i += 1) {
      for (let j = i + 1; j < here.length; j += 1) {
        const [a, b] = [here[i]!, here[j]!];
        if (!hostile(world, a, b)) continue;
        const known = facing.find((record) => record.provinceId === provinceId && record.attackerForceIds[0] === a.id && record.defenderForceIds[0] === b.id);
        const record: Engagement = known ?? {
          id: ids.next("facing"), provinceId, attackerForceIds: [a.id], defenderForceIds: [b.id], openedByForceId: a.id,
          openedAtStep: toDay, lastRoundStep: toDay, seeking: "harass", rounds: 0, pitchedRounds: 0, status: "facing",
          awaiting: null, manoeuvre: null, playerStance: null, asked: [], seenForceIds: [a.id, b.id], winner: null, endedBy: null, endedAtStep: null,
        };
        kept.push(record);
        const days = toDay - record.openedAtStep;
        if (known !== undefined && days !== FACING_REMINDER_DAYS) continue;
        facts.push({
          localId: `facing_${record.id}_${toDay}`.slice(0, 60),
          kind: "armies_facing",
          summary: days === 0
            ? `${a.name} and ${b.name}, whose powers are at war, stand facing each other in ${provinceName(world, provinceId)}. Neither has been ordered to attack.`
            : `${a.name} and ${b.name} have faced each other in ${provinceName(world, provinceId)} for ${days} days without either being ordered to attack.`,
          affectedRefs: [{ kind: "province", id: provinceId }, { kind: "force", id: a.id }, { kind: "force", id: b.id }],
          visibility: "public",
          discoveryState: "public",
          knowableInDays: 0,
          significance: days === 0 ? 50 : 40,
        });
      }
    }
  }
  const changed = kept.length !== facing.length || kept.some((record) => !facing.includes(record));
  if (!changed) return { world, facts };
  return { world: { ...world, engagements: [...world.engagements.filter((engagement) => engagement.status !== "facing"), ...kept] }, facts };
}
