import {
  FactProposalSchema,
  PEACE_AT,
  TRUCE_AT,
  WorldDeltaSchema,
  agreementsBetween,
  enemiesOf,
  fitStrengthOf,
  isDelivered,
  isNavalForce,
  kmFromAny,
  readDepartments,
  stableHash,
  warStanding,
  warWeariness,
  warsOf,
  type Character,
  type DiplomaticMessage,
  type FactProposal,
  type ScenarioHistoricalPressure,
  type ScenarioWarfareRules,
  type StatecraftAct,
  type StatecraftEntry,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";
import { readBoard, roughMen, type NeighbourReading, type PowerReading } from "./board";
import { pressureHolds } from "./narrator";
import { SIEGE_NEEDED_AT } from "./occupation";
import { alarmOf } from "./pushback";

/**
 * The world AI: every power's big moves, by rule (docs/plans/a-living-world.md §2).
 *
 * Two hand runs found that a power moved only when the model was asked about
 * it and chose to, and the model, asked "what do you do?", answered "nothing"
 * four times in five. In three years no war opened that the player had not
 * started. The user's decision: powers decide by rule, near and far, and the
 * model gives them voice.
 *
 * Once a month each power reads its board (`board.ts`) and weighs what it
 * could do -- go to war, rise against the power it follows, raid across a
 * border, make an alliance against a common threat, raise its levy -- by what
 * it would gain, its odds, and its ruler's nature, with the age's leaning
 * (`pressureHolds`) as a pull and never a schedule. At most one big move a
 * power, and only a few new wars in the whole world a month. Its armies at war
 * are moved by rule too: on to an enemy they can beat, into undefended ground,
 * against a city, or back from a stronger host. And letters to a power the
 * model is not playing are answered by rule, so a peace offer is not refused
 * by silence.
 *
 * Nothing here applies anything. It returns acts -- ordinary deltas and the
 * facts that say them -- that the burst applies as the world's own business,
 * so every rule of marching, war and treaty the applier enforces holds for a
 * rule-made act exactly as for a written one, and the facts it writes are
 * news the people who would answer them hear.
 *
 * Deterministic: every roll hashes the game, the day and the power.
 */

/**
 * A war becomes possible at this score; a raid below it, from `RAID_AT`. A
 * score is a chance a month, not a trigger -- a twelfth for every five points
 * over the bar, up to `MOST_TWELFTHS` -- so a power with good reasons goes to
 * war in a season or two rather than on the first morning, and two powers with
 * the same reasons do not go on the same day.
 */
export const WAR_AT = 60;
export const RAID_AT = 45;
const MOST_TWELFTHS = 6;
/** The opening weeks are the player's: nobody's own war starts before this day. */
const QUIET_OPENING_DAYS = 45;
/** A follower rises against the power it follows at this. */
export const REVOLT_AT = 65;
/** Two powers ally against a common threat at this. */
export const ALLIANCE_AT = 45;
/** No more than this many new wars open anywhere in a month. */
export const NEW_WARS_PER_MONTH = 3;
/** A levy is called out to this many men at most, whatever the pool. */
const LEVY_CAP = 20_000;
/** And not for fewer than this: a few hundred men is no army. */
const LEVY_FLOOR = 800;
/** How far an army looks for something to do, and how far it marches to take back its own. */
const CAMPAIGN_KM = 500;
const DEFENCE_KM = 1_000;
/** Beaten odds an army will take battle at, and odds it falls back from. */
const ATTACK_ODDS = 1.3;
/** And on its own ground, where an invader is to be driven off. */
const DEFEND_ODDS = 0.9;
const RETREAT_ODDS = 1.6;
/** A power that ended a war this recently does not start another. */
const REST_AFTER_WAR_DAYS = 365;
/** A war this old, with one side this far ahead, ends on what it holds; one this old ends regardless. */
const AHEAD_PEACE_DAYS = 365;
const AHEAD_SCORE = 25;
const STALEMATE_DAYS = 540;
/** A raid on the same neighbour waits a season after the last. */
const RAID_EVERY_DAYS = 120;

export interface StatecraftInput {
  readonly world: WorldState;
  readonly gameId: string;
  /** Powers the rules never act for: the player's own, and any power the player rules. */
  readonly excludedPolityIds: ReadonlySet<string>;
  /** People the model is playing now: their armies and their letters are theirs, not the rules'. */
  readonly playedByModel: ReadonlySet<string>;
  readonly playerCharacterId: string | null;
  /** Powers near the player, whose letters the model still answers; null is nobody near. */
  readonly nearPlayer: ReadonlySet<string> | null;
  readonly pressures: readonly ScenarioHistoricalPressure[];
  /** The scenario's troop kinds, so a fleet is known for one. */
  readonly warfare?: ScenarioWarfareRules | undefined;
  /** Raises or lowers every power's appetite against the player's (difficulty, §5). Zero by default. */
  readonly appetiteAgainstPlayer?: number | undefined;
}

export interface StatecraftDecision {
  readonly polityId: string;
  readonly actorCharacterId: string;
  readonly act: StatecraftAct;
  readonly targetPolityId: string | null;
  readonly why: string;
  readonly deltas: readonly WorldDelta[];
  readonly facts: readonly FactProposal[];
}

const delta = (raw: Record<string, unknown>): WorldDelta => WorldDeltaSchema.parse(raw);
/** "Epirus's" read wrong in every raid: a name that ends in s takes the apostrophe alone. */
const possessive = (name: string): string => (name.endsWith("s") ? `${name}'` : `${name}'s`);
const fact = (raw: Record<string, unknown>): FactProposal => FactProposalSchema.parse(raw);

/** A roll from 0 to `span` - 1, the same every replay of the same month. */
const roll = (gameId: string, day: number, ...keys: string[]): ((span: number) => number) =>
  (span) => (span <= 0 ? 0 : stableHash([gameId, "statecraft", String(Math.floor(day / 30)), ...keys]) % span);

export function decideStatecraft(input: StatecraftInput): StatecraftDecision[] {
  const { world } = input;
  const board = readBoard(world);
  const rulers = readDepartments(world);
  const day = world.instant.day;
  const decisions: StatecraftDecision[] = [];
  const nameOf = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;
  const playerPolity = input.playerCharacterId === null ? null : world.characters.find((character) => character.id === input.playerCharacterId)?.polityId ?? null;

  const rulerOf = (polityId: string): Character | undefined => rulers.rulers(polityId).find((ruler) => ruler.alive && ruler.id !== input.playerCharacterId);
  const actsFor = (polityId: string): boolean => !input.excludedPolityIds.has(polityId) && rulerOf(polityId) !== undefined;

  // ── 1. Letters to powers the model is not playing ──────────────────────
  for (const message of world.diplomacy) {
    const answer = answerByRule(world, message, input, rulerOf);
    if (answer !== null) decisions.push(answer);
  }

  // ── 2. Big moves: war, revolt, raid, alliance ──────────────────────────
  const candidates = bigMoveCandidates(input, board, rulerOf, actsFor, playerPolity);
  candidates.sort((a, b) => b.score - a.score || a.polityId.localeCompare(b.polityId));
  const moved = new Set<string>();
  let wars = 0;
  const comes = (score: number, bar: number, ...keys: string[]): boolean =>
    score >= bar && roll(input.gameId, day, ...keys, "comes")(12) < Math.min(MOST_TWELFTHS, 1 + Math.floor((score - bar) / 5));
  for (const candidate of candidates) {
    if (day < QUIET_OPENING_DAYS) break;
    if (moved.has(candidate.polityId) || moved.has(candidate.neighbour.polityId)) continue;
    const at = candidate.act === "revolt" ? REVOLT_AT : WAR_AT;
    if (wars < NEW_WARS_PER_MONTH && comes(candidate.score, at, candidate.polityId, candidate.neighbour.polityId, candidate.act)) {
      decisions.push(openTheWar(world, candidate.polityId, candidate.ruler, candidate.neighbour, candidate.act === "revolt" ? "revolt" : "declare_war", candidate.why, nameOf));
      moved.add(candidate.polityId);
      moved.add(candidate.neighbour.polityId);
      wars += 1;
      continue;
    }
    const raidedLately = world.statecraft.log.some((entry) => entry.act === "raid" && entry.polityId === candidate.polityId && entry.targetPolityId === candidate.neighbour.polityId && day - entry.day < RAID_EVERY_DAYS);
    if (candidate.act === "declare_war" && candidate.neighbour.bordering && !raidedLately && comes(candidate.score, RAID_AT, candidate.polityId, candidate.neighbour.polityId, "raid")) {
      const raid = raidAcross(world, candidate.polityId, candidate.ruler, candidate.neighbour, candidate.why, input.playedByModel);
      if (raid !== null) {
        decisions.push(raid);
        moved.add(candidate.polityId);
      }
    }
  }

  // Wars that have done what they were for, or exhausted both sides, end.
  decisions.push(...peacesByRule(world, input, rulerOf, moved));

  // Alliances against a common threat, for powers that did not just go to war.
  decisions.push(...allianceAgainstThreats(world, board, input, rulerOf, moved));

  // ── 3. Armies at war ───────────────────────────────────────────────────
  // Not for a power making peace this month: its armies' orders would be
  // worked out against a war that is ending.
  const makingPeace = new Set(decisions.filter((decision) => decision.act === "make_peace").flatMap((decision) => [decision.polityId, decision.targetPolityId ?? ""]));
  const marching = new Set(world.projects
    .filter((project) => project.status === "in_progress" && project.completionOutcome?.kind === "force_move")
    .flatMap((project) => [project.completionOutcome?.forceId, ...(project.completionOutcome?.fleetIds ?? [])].filter((id): id is string => typeof id === "string")));
  // Fighting is an open engagement; two armies merely facing each other are
  // exactly the ones that must decide whether to give battle.
  const fighting = new Set((world.engagements ?? []).filter((engagement) => engagement.status === "open").flatMap((engagement) => [...engagement.attackerForceIds, ...engagement.defenderForceIds]));
  const besieging = new Set(world.sieges.filter((siege) => siege.status === "active").map((siege) => siege.forceId));
  for (const reading of board.values()) {
    if (!actsFor(reading.polityId) || reading.wars.length === 0 || makingPeace.has(reading.polityId)) continue;
    const enemies = new Set(enemiesOf(world.polityAgreements, reading.polityId).filter((enemy) => !makingPeace.has(enemy)));
    const ruler = rulerOf(reading.polityId)!;
    // A power at war with no army in the field calls out its levy -- its own
    // war, or one come to its own ground. A people bound by foedus waits to
    // be called to its leader's war rather than raising for it unasked.
    const own = new Set(world.map.provinces.filter((province) => province.controllerPolityId === reading.polityId).map((province) => province.id));
    const threatened = world.material.forces.some((force) => enemies.has(force.polityId) && own.has(force.locationId));
    if (reading.fielded < LEVY_FLOOR && (reading.leaderId === null || threatened) && !decisions.some((decision) => decision.polityId === reading.polityId && decision.act === "raise_levy")) {
      const levy = raiseLevy(world, reading, ruler, [...enemies].map(nameOf).join(" and "));
      if (levy !== null) decisions.push(levy);
    }
    for (const force of world.material.forces) {
      // Fleets keep the sea by their own rules; this is the land war.
      if (force.polityId !== reading.polityId || force.outlaw === true || fitStrengthOf(force) <= 0 || isNavalForce(force, input.warfare)) continue;
      if (force.commanderCharacterId === input.playerCharacterId || input.playedByModel.has(force.commanderCharacterId) || input.playedByModel.has(force.controllerCharacterId ?? "")) continue;
      if (marching.has(force.id) || fighting.has(force.id) || besieging.has(force.id) || force.hold === true) continue;
      const order = conductOfWar(world, force, enemies, reading.polityId, nameOf, input.warfare);
      if (order !== null) decisions.push(order);
    }
  }
  return decisions;
}

/** A big move a power could make this month, with how strong its case is and why. */
export interface MoveCandidate { readonly polityId: string; readonly ruler: Character; readonly reading: PowerReading; readonly neighbour: NeighbourReading; readonly act: "declare_war" | "revolt"; readonly score: number; readonly why: string[] }

/**
 * Every war and rising each power could start this month, scored. The rules
 * act on the best of them by chance (`decideStatecraft`); a ruler in the
 * cast is shown his own best few instead, and decides (`rulerOptions`).
 */
function bigMoveCandidates(
  input: StatecraftInput,
  board: ReturnType<typeof readBoard>,
  rulerOf: (polityId: string) => Character | undefined,
  actsFor: (polityId: string) => boolean,
  playerPolity: string | null,
): MoveCandidate[] {
  const { world } = input;
  const day = world.instant.day;
  const lastWarEnded = (polityId: string): number => Math.max(-Infinity, ...world.polityAgreements
    .filter((agreement) => agreement.kind === "war" && agreement.status === "ended" && (agreement.polityId === polityId || agreement.otherPolityId === polityId))
    .map((agreement) => agreement.endedAtStep ?? -Infinity));
  const leanings = input.pressures.filter((pressure) => pressure.target.polityId !== null && pressure.target.otherPolityId != null && pressureHolds(world, pressure));
  const leaningOf = (from: string, toward: string): ScenarioHistoricalPressure | undefined =>
    leanings.find((pressure) => pressure.target.polityId === from && pressure.target.otherPolityId === toward);

  const candidates: MoveCandidate[] = [];
  for (const reading of board.values()) {
    if (!actsFor(reading.polityId)) continue;
    const ruler = rulerOf(reading.polityId)!;
    const temperament = ruler.mind.temperament;
    const traits = new Set(ruler.traits);
    const outlookRisk = world.polityOutlooks.find((outlook) => outlook.polityId === reading.polityId)?.riskTolerance ?? ruler.mind.riskTolerance;
    const appetite = (temperament.boldness - 50) / 2 + (outlookRisk - 50) / 3
      + (traits.has("ambitious") ? 8 : 0) + (traits.has("bold") ? 6 : 0) - (traits.has("cautious") ? 10 : 0) - (traits.has("content") ? 8 : 0)
      + (traits.has("wrathful") ? 6 : 0) + (traits.has("cruel") ? 3 : 0) - (traits.has("cowardly") ? 12 : 0);
    const busy = reading.wars.length * 35 + (day - lastWarEnded(reading.polityId) < REST_AFTER_WAR_DAYS ? 15 : 0);
    const broke = (world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === reading.polityId)?.balance ?? 0) < 0;

    for (const neighbour of reading.neighbours) {
      if (neighbour.relation === "war" || neighbour.relation === "ally" || neighbour.relation === "protects_us" || neighbour.relation === "we_protect" || neighbour.relation === "truce" || neighbour.relation === "follows_us") continue;
      const why: string[] = [];
      let score = appetite - busy - (broke ? 10 : 0);
      const leaning = leaningOf(reading.polityId, neighbour.polityId);
      if (leaning !== undefined) {
        // Doubled: the age's lean is the strongest reason a power has, and it
        // is still only a reason -- the odds and the moment must allow it.
        score += 2 * leaning.weight;
        why.push(leaning.label.charAt(0).toLowerCase() + leaning.label.slice(1));
      }
      // Fear of a power that grows too fast is a reason to strike while it can still be beaten (`pushback.ts`).
      const fear = alarmOf(world, reading.polityId, neighbour.polityId);
      if (fear >= 25) { score += Math.round(fear / 3); why.push(`fear of ${possessive(neighbour.name)} growing power`); }
      if (neighbour.trust <= -60) { score += 25; why.push(`an old enmity with ${neighbour.name}`); }
      else if (neighbour.trust <= -30) { score += 12; why.push(`bad blood with ${neighbour.name}`); }
      if (neighbour.claimed.length > 0) { score += 20; why.push(`${neighbour.name} holds ground it claims`); }
      if (neighbour.grievances.some((grievance) => grievance.includes("taken from us"))) { score += 25; why.push(`${neighbour.name} holds ground taken from it`); }
      score += Math.min(25, 10 * neighbour.distractions.length);
      if (neighbour.distractions.length > 0) why.push(`${neighbour.name}: ${neighbour.distractions.join("; ")}`);
      if (input.appetiteAgainstPlayer !== undefined && neighbour.polityId === playerPolity) score += input.appetiteAgainstPlayer;

      if (neighbour.relation === "leads_us") {
        // A people bound by foedus does not make war; it rises. Only when the
        // leader is busy, its armies are far, and the people want out.
        if (neighbour.trust > -30) continue;
        const leaderBusy = neighbour.theirWars.length > 0 && neighbour.theirMenNear === 0;
        if (!leaderBusy) continue;
        score += 15 + (neighbour.trust <= -50 ? 10 : 0) - 10;
        why.push(`${possessive(neighbour.name)} armies are away at war`);
        candidates.push({ polityId: reading.polityId, ruler, reading, neighbour, act: "revolt", score: score + roll(input.gameId, day, reading.polityId, neighbour.polityId, "revolt")(15) - 7, why });
        continue;
      }
      // The odds. A power that cannot win does not start it, whatever it
      // feels -- unless the age leans that way and it has friends to count on:
      // Athens rose against Macedon in 268 because Sparta and Egypt stood
      // behind it, not because Athens alone could win.
      const friends = world.polityAgreements.some((agreement) => agreement.status === "active" && agreement.kind === "alliance" && (agreement.polityId === reading.polityId || agreement.otherPolityId === reading.polityId));
      if (neighbour.ratio < (leaning !== undefined && friends ? 0.15 : 0.8)) continue;
      score += neighbour.ratio >= 2 ? 30 : neighbour.ratio >= 1.5 ? 20 : neighbour.ratio >= 1.2 ? 10 : -10;
      why.push(neighbour.ratio < 0.8
        ? `${neighbour.name} is far the stronger, and it counts on its friends`
        : `its strength against ${possessive(neighbour.name)} is ${neighbour.ratio >= 2 ? "more than double" : neighbour.ratio >= 1.5 ? "half again" : neighbour.ratio >= 1.2 ? "a little better" : "about even"}`);
      // Breaking a treaty is a thing a faithless ruler does more easily.
      if (neighbour.relation === "peace") score -= traits.has("deceitful") || traits.has("treacherous") ? 5 : 20;
      if (!neighbour.bordering && leaning === undefined) score -= 15;
      const jitter = roll(input.gameId, day, reading.polityId, neighbour.polityId, "war")(15) - 7;
      candidates.push({ polityId: reading.polityId, ruler, reading, neighbour, act: "declare_war", score: score + jitter, why });
    }
  }

  return candidates;
}

/** The war, opened: a declaration, its fact, and the ruler's levy if he has no army. */
function openTheWar(world: WorldState, polityId: string, ruler: Character, neighbour: NeighbourReading, act: "declare_war" | "revolt", why: readonly string[], nameOf: (id: string) => string): StatecraftDecision {
  const us = nameOf(polityId);
  const reasons = why.slice(0, 4).join("; ");
  const terms = act === "revolt"
    ? `${us} throws off the foedus with ${neighbour.name} and takes up arms.`
    : `${us} is at war with ${neighbour.name}.`;
  const deltas: WorldDelta[] = [delta({
    op: "agreement_open", localId: `war_${polityId}_${neighbour.polityId}`.slice(0, 60), kind: "war",
    polityId, otherPolityId: neighbour.polityId, terms, forDays: null, sourceMessageRef: null, visibility: "public",
    reason: `${ruler.name} chose war: ${reasons}`.slice(0, 240),
  })];
  return {
    polityId, actorCharacterId: ruler.id, act, targetPolityId: neighbour.polityId,
    why: reasons.slice(0, 400) || "the odds were good",
    deltas,
    facts: [fact({
      localId: `why_war_${polityId}_${neighbour.polityId}`.slice(0, 60),
      kind: act === "revolt" ? "revolt" : "war_cause",
      summary: (act === "revolt"
        ? `${us} rose against ${neighbour.name} under ${ruler.name}: ${reasons}.`
        : `${ruler.name} took ${us} to war with ${neighbour.name}: ${reasons}.`).slice(0, 400),
      affectedRefs: [{ kind: "polity", id: polityId }, { kind: "polity", id: neighbour.polityId }, { kind: "character", id: ruler.id }],
      visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 80,
    })],
  };
}

/** Men across the border to burn and take, short of war: an army already on the far side raids; one near it crosses. */
function raidAcross(world: WorldState, polityId: string, ruler: Character, neighbour: NeighbourReading, why: readonly string[], played: ReadonlySet<string>): StatecraftDecision | null {
  const theirGround = new Set(neighbour.theirBorder);
  const ours = world.material.forces.filter((force) => force.polityId === polityId && force.outlaw !== true && fitStrengthOf(force) > 0 && !played.has(force.commanderCharacterId));
  const inside = ours.find((force) => theirGround.has(force.locationId) || world.map.provinces.find((province) => province.id === force.locationId)?.controllerPolityId === neighbour.polityId);
  if (inside !== undefined) {
    return {
      polityId, actorCharacterId: inside.commanderCharacterId, act: "raid", targetPolityId: neighbour.polityId,
      why: `raiding ${possessive(neighbour.name)} ground: ${why.slice(0, 3).join("; ")}`.slice(0, 400),
      deltas: [delta({ op: "force_raid", forceRef: inside.id, provinceId: inside.locationId, toAccountRef: null, reason: `A raid on ${possessive(neighbour.name)} ground, short of war.` })],
      facts: [],
    };
  }
  // Nearest army to their border crosses it, to raid next month -- on foot,
  // to a province of theirs it can walk to: a raid is not a sea crossing.
  if (neighbour.ourMenNear === 0 || neighbour.theirBorder.length === 0) return null;
  const byLand = { passable: (edge: { readonly crossing: string }) => edge.crossing !== "sea_lane" && edge.crossing !== "strait" };
  let choice: { force: (typeof ours)[number]; target: string; km: number } | null = null;
  for (const force of ours) {
    const reach = kmFromAny(world, [force.locationId], { budgetKm: 300, ...byLand });
    for (const target of neighbour.theirBorder) {
      const km = reach.get(target);
      if (km !== undefined && (choice === null || km < choice.km)) choice = { force, target, km };
    }
  }
  if (choice === null) return null;
  const { force: nearest, target } = choice;
  return {
    polityId, actorCharacterId: nearest.commanderCharacterId, act: "march", targetPolityId: neighbour.polityId,
    why: `crossing into ${possessive(neighbour.name)} ground to raid it: ${why.slice(0, 3).join("; ")}`.slice(0, 400),
    deltas: [delta({ op: "force_modify", forceRef: nearest.id, locationId: target, reason: `Across the border into ${possessive(neighbour.name)} ground, to raid.` })],
    facts: [],
  };
}

/** The levy of a power at war, called out under its ruler at its capital. */
function raiseLevy(world: WorldState, reading: PowerReading, ruler: Character, against: string): StatecraftDecision | null {
  const men = Math.min(LEVY_CAP, reading.levy);
  if (men < LEVY_FLOOR) return null;
  const capital = world.map.polities.find((polity) => polity.id === reading.polityId)?.capitalSettlementId ?? null;
  const at = (capital === null ? undefined : world.map.provinces.find((province) => province.settlements.some((settlement) => settlement.id === capital))?.id)
    ?? world.map.provinces.find((province) => province.controllerPolityId === reading.polityId)?.id;
  if (at === undefined) return null;
  return {
    polityId: reading.polityId, actorCharacterId: ruler.id, act: "raise_levy", targetPolityId: null,
    why: `at war with ${against} and no army in the field`.slice(0, 400),
    deltas: [delta({
      op: "force_create", localId: `levy_${reading.polityId}`.slice(0, 60), name: `Levy of ${reading.name}`.slice(0, 120), polityId: reading.polityId,
      commanderCharacterRef: ruler.id, controllerCharacterRef: ruler.id, locationId: at, authorizedStrength: men, payObligationRef: null,
      reason: `${reading.name} calls out its men for the war with ${against}.`.slice(0, 240),
    })],
    facts: [],
  };
}

/**
 * What an army at war does this month: fight an enemy it can beat where it
 * stands, fall back from one it cannot, lay siege to the enemy city it stands
 * before, or march on the best thing within reach -- an enemy army it
 * outnumbers, undefended ground, a city -- nearest first.
 */
function conductOfWar(world: WorldState, force: WorldState["material"]["forces"][number], enemies: ReadonlySet<string>, polityId: string, nameOf: (id: string) => string, warfare: ScenarioWarfareRules | undefined): StatecraftDecision | null {
  const men = fitStrengthOf(force);
  const commander = force.commanderCharacterId;
  const here = world.map.provinces.find((province) => province.id === force.locationId);
  if (here === undefined) return null;
  // Armies only: a fleet off the coast is not an army to give battle to.
  const enemyForces = world.material.forces.filter((other) => enemies.has(other.polityId) && other.outlaw !== true && fitStrengthOf(other) > 0 && !isNavalForce(other, warfare));
  // By land: an army without ships does not plan a march across the sea.
  const byLand = { passable: (edge: { readonly crossing: string }) => edge.crossing !== "sea_lane" && edge.crossing !== "strait" };
  const menAt = (provinceId: string): number => enemyForces.filter((other) => other.locationId === provinceId).reduce((sum, other) => sum + fitStrengthOf(other), 0);
  const decide = (act: StatecraftAct, target: string | null, why: string, deltas: WorldDelta[]): StatecraftDecision =>
    ({ polityId, actorCharacterId: commander, act, targetPolityId: target, why: why.slice(0, 400), deltas, facts: [] });

  // Enemies here.
  const facing = enemyForces.filter((other) => other.locationId === force.locationId).sort((a, b) => fitStrengthOf(b) - fitStrengthOf(a));
  // On our own ground we fight at even odds: an invader is driven off, not watched.
  const ownGround = (provinceId: string): boolean => {
    const province = world.map.provinces.find((candidate) => candidate.id === provinceId);
    return province !== undefined && (province.ownerPolityId ?? province.controllerPolityId) === polityId;
  };
  const oddsFor = (provinceId: string): number => (ownGround(provinceId) ? DEFEND_ODDS : ATTACK_ODDS);
  if (facing.length > 0) {
    const theirs = menAt(force.locationId);
    if (men >= oddsFor(force.locationId) * theirs) {
      return decide("attack", facing[0]!.polityId, `${roughMen(men)} against ${roughMen(theirs)}: the odds are ours`, [delta({ op: "force_engage", forceRef: force.id, targetForceRef: facing[0]!.id, posture: "offer_battle", tactic: null, reason: `${force.name} offers battle: the odds are good.` })]);
    }
    if (theirs >= RETREAT_ODDS * men) {
      const home = nearestOwn(world, force.locationId, polityId, byLand);
      if (home !== null) return decide("fall_back", facing[0]!.polityId, `${roughMen(theirs)} against our ${roughMen(men)}: too many`, [delta({ op: "force_modify", forceRef: force.id, locationId: home, reason: `${force.name} falls back before a stronger army.` })]);
    }
    return null;
  }

  // Standing before an enemy city with walls: invest it. Open country, and a
  // town with none, is occupied by standing in it (`occupation.ts`).
  if (here.controllerPolityId !== null && enemies.has(here.controllerPolityId) && here.settlements.some((settlement) => settlement.fortificationLevel >= SIEGE_NEEDED_AT && (settlement.controllerPolityId === null || enemies.has(settlement.controllerPolityId)))) {
    const already = world.sieges.some((siege) => siege.status === "active" && siege.provinceId === here.id);
    if (!already) return decide("besiege", here.controllerPolityId, `before ${here.name}, held by ${nameOf(here.controllerPolityId)}, with no army to stop us`, [delta({ op: "siege_lay", localId: `siege_${force.id}`.slice(0, 60), forceRef: force.id, settlementId: null, reason: `${force.name} lays siege.` })]);
    return null;
  }

  // Something worth marching on.
  const reach = new Map(kmFromAny(world, [force.locationId], { budgetKm: CAMPAIGN_KM, ...byLand }));
  let best: { provinceId: string; score: number; why: string; target: string } | null = null;
  for (const other of enemyForces) {
    const km = reach.get(other.locationId);
    if (km === undefined || km === 0) continue;
    const theirs = menAt(other.locationId);
    if (men < oddsFor(other.locationId) * theirs) continue;
    const score = (ownGround(other.locationId) ? 90 : 60) - km / 10;
    if (best === null || score > best.score) best = { provinceId: other.locationId, score, why: `${other.name} is ${Math.round(km)} km off with ${roughMen(theirs)}, and we have ${roughMen(men)}`, target: other.polityId };
  }
  // Our own ground the enemy holds is worth marching further for, and first.
  const homeReach = kmFromAny(world, [force.locationId], { budgetKm: DEFENCE_KM, ...byLand });
  for (const [provinceId, km] of homeReach) {
    if (km === 0 || reach.has(provinceId)) continue;
    const province = world.map.provinces.find((candidate) => candidate.id === provinceId);
    if (province?.ownerPolityId === polityId && province.controllerPolityId !== null && enemies.has(province.controllerPolityId)) reach.set(provinceId, km);
  }
  for (const [provinceId, km] of reach) {
    if (km === 0) continue;
    const province = world.map.provinces.find((candidate) => candidate.id === provinceId);
    if (province === undefined || province.controllerPolityId === null || !enemies.has(province.controllerPolityId)) continue;
    if (menAt(provinceId) * ATTACK_ODDS > men) continue;
    const capital = world.map.polities.find((polity) => polity.id === province.controllerPolityId)?.capitalSettlementId ?? null;
    const ours = province.ownerPolityId === polityId;
    const worth = (province.settlements.length > 0 ? 20 : 5) + (province.settlements.some((settlement) => settlement.id === capital) ? 30 : 0) + (ours ? 40 : 0);
    const score = worth - km / 10;
    if (best === null || score > best.score) best = { provinceId, score, why: `${province.name}${ours ? ", our own ground," : ""} held by ${nameOf(province.controllerPolityId)}, is ${Math.round(km)} km off and ${menAt(provinceId) === 0 ? "undefended" : "lightly held"}`, target: province.controllerPolityId };
  }
  if (best === null) return null;
  return decide("march", best.target, best.why, [delta({ op: "force_modify", forceRef: force.id, locationId: best.provinceId, reason: `${force.name} marches: ${best.why}.`.slice(0, 240) })]);
}

/** The nearest province of our own, to fall back on. */
function nearestOwn(world: WorldState, from: string, polityId: string, byLand: { readonly passable: (edge: { readonly crossing: string }) => boolean }): string | null {
  const reach = kmFromAny(world, [from], { budgetKm: 600, ...byLand });
  let best: { id: string; km: number } | null = null;
  for (const [id, km] of reach) {
    if (km === 0) continue;
    if (world.map.provinces.find((province) => province.id === id)?.controllerPolityId !== polityId) continue;
    if (best === null || km < best.km) best = { id, km };
  }
  return best?.id ?? null;
}

/**
 * Two powers that fear the same stronger neighbour make common cause: each
 * must distrust it, neither may distrust the other, and together they must
 * come near it. One alliance a power at a time.
 */
function allianceAgainstThreats(
  world: WorldState,
  board: ReturnType<typeof readBoard>,
  input: StatecraftInput,
  rulerOf: (polityId: string) => Character | undefined,
  moved: Set<string>,
): StatecraftDecision[] {
  const decisions: StatecraftDecision[] = [];
  const allied = (polityId: string): boolean => world.polityAgreements.some((agreement) => agreement.status === "active" && agreement.kind === "alliance" && (agreement.polityId === polityId || agreement.otherPolityId === polityId));
  const trust = (from: string, toward: string): number => world.polityStances.find((stance) => stance.polityId === from && stance.towardPolityId === toward)?.trustScore ?? 0;
  // A threat is a stronger power it hates, or is at war with, or whose army
  // stands on its border: dislike alone of a distant king is not a reason to
  // send an embassy.
  const threatsOf = (reading: PowerReading): NeighbourReading[] => reading.neighbours.filter((neighbour) =>
    neighbour.ratio < 0.8 && neighbour.relation !== "leads_us" && neighbour.relation !== "follows_us"
    && (neighbour.relation === "war" || neighbour.trust <= -45 || (neighbour.trust <= -30 && neighbour.theirMenNear > 0)));
  for (const reading of board.values()) {
    if (moved.has(reading.polityId) || input.excludedPolityIds.has(reading.polityId) || reading.leaderId !== null || allied(reading.polityId)) continue;
    const ruler = rulerOf(reading.polityId);
    if (ruler === undefined) continue;
    for (const threat of threatsOf(reading)) {
      const partner = [...board.values()].filter((other) => other.polityId !== reading.polityId && !moved.has(other.polityId) && !input.excludedPolityIds.has(other.polityId)
        && other.leaderId === null && !allied(other.polityId) && rulerOf(other.polityId) !== undefined
        && trust(reading.polityId, other.polityId) >= 0 && trust(other.polityId, reading.polityId) >= 0
        && agreementsBetween(world.polityAgreements, reading.polityId, other.polityId).every((agreement) => agreement.kind !== "war")
        && threatsOf(other).some((theirs) => theirs.polityId === threat.polityId))
        // The friendliest first: Athens looks to Sparta before Epirus.
        .sort((x, y) => (trust(reading.polityId, y.polityId) + trust(y.polityId, reading.polityId)) - (trust(reading.polityId, x.polityId) + trust(x.polityId, reading.polityId)) || x.polityId.localeCompare(y.polityId))[0];
      if (partner === undefined) continue;
      const score = 30 + Math.min(20, -threat.trust / 3) + (threat.relation === "war" ? 15 : 0);
      // A chance a month, like a war: an embassy takes a season to agree.
      if (score < ALLIANCE_AT || roll(input.gameId, world.instant.day, reading.polityId, partner.polityId, "ally")(12) >= Math.min(3, Math.floor((score - ALLIANCE_AT) / 5))) continue;
      const why = `${threat.name} is stronger than either, and both distrust it`;
      decisions.push({
        polityId: reading.polityId, actorCharacterId: ruler.id, act: "alliance", targetPolityId: partner.polityId, why,
        deltas: [delta({
          op: "agreement_open", localId: `alliance_${reading.polityId}_${partner.polityId}`.slice(0, 60), kind: "alliance",
          polityId: reading.polityId, otherPolityId: partner.polityId, terms: `${reading.name} and ${partner.name} stand together against ${threat.name}.`.slice(0, 600),
          forDays: null, sourceMessageRef: null, visibility: "public", reason: why.slice(0, 240),
        })],
        facts: [fact({
          localId: `ally_${reading.polityId}_${partner.polityId}`.slice(0, 60), kind: "alliance_made",
          summary: `${reading.name} and ${partner.name} made an alliance against ${threat.name}.`.slice(0, 400),
          affectedRefs: [{ kind: "polity", id: reading.polityId }, { kind: "polity", id: partner.polityId }, { kind: "polity", id: threat.polityId }],
          visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 60,
        })],
      });
      moved.add(reading.polityId);
      moved.add(partner.polityId);
      break;
    }
  }
  return decisions;
}

/**
 * A letter to a power the model is not playing, answered the way that power's
 * situation answers it: peace when it is tired of the war or losing it, an
 * alliance with a friend who fears the same enemy, help for a friend it trusts
 * and is not at war itself. Anything else is left for its people to answer.
 */
function answerByRule(world: WorldState, message: DiplomaticMessage, input: StatecraftInput, rulerOf: (polityId: string) => Character | undefined): StatecraftDecision | null {
  if (message.status !== "awaiting_reply" || !isDelivered(message, world.instant.day)) return null;
  if (input.excludedPolityIds.has(message.toPolityId) || message.fromCharacterId === input.playerCharacterId) return null;
  if (input.nearPlayer !== null && (input.nearPlayer.has(message.toPolityId) || input.nearPlayer.has(message.fromPolityId))) return null;
  const answerer = message.toCharacterId === null ? rulerOf(message.toPolityId) : world.characters.find((character) => character.id === message.toCharacterId && character.alive);
  if (answerer === undefined || input.playedByModel.has(answerer.id)) return null;
  const trust = world.polityStances.find((stance) => stance.polityId === message.toPolityId && stance.towardPolityId === message.fromPolityId)?.trustScore ?? 0;
  const proposes = new Set(message.proposes ?? []);
  if (message.kind === "peace_talks") {
    // Talking costs nothing a tired or losing power, or one six months into its war, will not give.
    const tired = warWeariness(world, message.toPolityId, message.fromPolityId).score;
    const losing = warStanding(world, message.toPolityId, message.fromPolityId).score <= -20;
    const long = world.polityAgreements.some((agreement) => agreement.status === "active" && agreement.kind === "war" && [agreement.polityId, agreement.otherPolityId].includes(message.toPolityId) && [agreement.polityId, agreement.otherPolityId].includes(message.fromPolityId) && world.instant.day - agreement.sinceStep >= 180);
    const accepted = losing || long || tired >= TRUCE_AT - 10;
    const words = accepted ? "Our envoys will come to the table." : "There is nothing yet to talk about.";
    return {
      polityId: message.toPolityId, actorCharacterId: answerer.id, act: "answer_letter", targetPolityId: message.fromPolityId,
      why: `${accepted ? "agreed to talk" : "would not talk"}: "${message.subject}"`.slice(0, 400),
      deltas: [delta({ op: "diplomatic_message_answer", messageRef: message.id, answer: accepted ? "accepted" : "refused", answerText: words, agreementKind: null, reason: words })],
      facts: [],
    };
  }
  const aboutPeace = message.kind === "peace_offer" || proposes.has("peace") || proposes.has("truce");
  let accepted: boolean | null = null;
  let words = "";
  if (aboutPeace) {
    const tired = warWeariness(world, message.toPolityId, message.fromPolityId).score;
    const losing = warStanding(world, message.toPolityId, message.fromPolityId).score <= -30;
    accepted = losing || tired >= (proposes.has("truce") && !proposes.has("peace") ? TRUCE_AT : PEACE_AT - 10);
    words = accepted ? "The war has cost enough. We accept." : "We are not beaten, and the war goes on.";
  } else if (proposes.has("alliance")) {
    const sharedEnemy = warsOf(world.polityAgreements, message.toPolityId).some((enemy) => warsOf(world.polityAgreements, message.fromPolityId).includes(enemy));
    accepted = trust >= 20 || (trust >= 0 && sharedEnemy);
    words = accepted ? "We will stand with you." : "We have no quarrel that makes us yours.";
  } else if (message.kind === "military_aid_request") {
    accepted = trust >= 40 && warsOf(world.polityAgreements, message.toPolityId).length === 0;
    words = accepted ? "Our men will come." : "We cannot spare men for your war.";
  }
  if (accepted === null) return null;
  return {
    polityId: message.toPolityId, actorCharacterId: answerer.id, act: "answer_letter", targetPolityId: message.fromPolityId,
    why: `${accepted ? "accepted" : "refused"} "${message.subject}"`.slice(0, 400),
    deltas: [delta({ op: "diplomatic_message_answer", messageRef: message.id, answer: accepted ? "accepted" : "refused", answerText: words, agreementKind: null, reason: words })],
    facts: [],
  };
}

/**
 * A war ends by rule when one side has won it, both are spent, or the side
 * that started it holds everything it claimed. The winner dictates: a beaten
 * power of a few provinces gives itself up; a larger one makes peace on what
 * the war left each side holding. Neither side's war may be the player's, and
 * a war either side is still fighting with the model is left to the model.
 */
function peacesByRule(world: WorldState, input: StatecraftInput, rulerOf: (polityId: string) => Character | undefined, moved: Set<string>): StatecraftDecision[] {
  const decisions: StatecraftDecision[] = [];
  const nameOf = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;
  const ground = (polityId: string): number => world.map.provinces.filter((province) => province.controllerPolityId === polityId).length;
  for (const war of world.polityAgreements) {
    if (war.status !== "active" || war.kind !== "war") continue;
    const [a, b] = [war.polityId, war.otherPolityId];
    if (input.excludedPolityIds.has(a) || input.excludedPolityIds.has(b) || moved.has(a) || moved.has(b)) continue;
    const rulerA = rulerOf(a);
    const rulerB = rulerOf(b);
    if (rulerA === undefined && rulerB === undefined) continue;
    const days = world.instant.day - war.sinceStep;
    if (days < 60) continue;
    const standingA = warStanding(world, a, b);
    const standingB = warStanding(world, b, a);
    const winner = standingA.dictates ? a : standingB.dictates ? b : null;
    // Whoever the model is playing makes his own peace -- unless he has lost
    // and the winner is the rules': a dictated peace needs no consent. A side
    // with nobody to speak for it does not keep a war alive.
    const played = (ruler: Character | undefined): boolean => ruler !== undefined && input.playedByModel.has(ruler.id);
    const winnerRuler = winner === a ? rulerA : winner === b ? rulerB : undefined;
    if (winner !== null ? played(winnerRuler) || winnerRuler === undefined : played(rulerA) || played(rulerB)) continue;
    const tiredA = warWeariness(world, a, b).score;
    const tiredB = warWeariness(world, b, a).score;
    const claimsHeld = (claimant: string, holder: string): boolean => {
      const claims = (world.map.claimRecords ?? []).filter((claim) => claim.status === "active" && claim.claimantPolityId === claimant && claim.locationKind === "province");
      return claims.length > 0 && claims.some((claim) => world.map.provinces.find((province) => province.id === claim.locationId)?.lostBy?.polityId === holder)
        && !claims.some((claim) => world.map.provinces.find((province) => province.id === claim.locationId)?.controllerPolityId === holder);
    };
    const satisfied = days >= 180 && (claimsHeld(war.polityId, war.otherPolityId));
    const spent = tiredA >= PEACE_AT && tiredB >= PEACE_AT;
    // A war a year old with one side clearly ahead ends on what it holds; one
    // eighteen months old that has gone nowhere ends as things stand.
    const ahead = days >= AHEAD_PEACE_DAYS && Math.max(standingA.score, standingB.score) >= AHEAD_SCORE;
    const stale = days >= STALEMATE_DAYS;
    if (winner === null && !spent && !satisfied && !ahead && !stale) continue;
    const victor = winner ?? (satisfied ? war.polityId : standingA.score >= standingB.score ? a : b);
    const loser = victor === a ? b : a;
    const speaker = (victor === a ? rulerA : rulerB) ?? (victor === a ? rulerB : rulerA);
    if (speaker === undefined) continue;
    const surrender = winner !== null && (victor === a ? standingA : standingB).totalDefeat && ground(loser) <= 3;
    const why = winner !== null
      ? `${nameOf(loser)} is beaten`
      : satisfied ? `${nameOf(victor)} holds the ground it went to war for`
        : spent ? "both sides are spent"
          : ahead ? `${nameOf(victor)} has the better of a long war`
            : "the war has gone nowhere for a year and a half";
    const terms = surrender
      ? `${nameOf(loser)} gives itself up to ${nameOf(victor)}.`
      : `Peace between ${nameOf(victor)} and ${nameOf(loser)}, each keeping the ground it holds.`;
    decisions.push({
      polityId: victor, actorCharacterId: speaker.id, act: "make_peace", targetPolityId: loser, why,
      deltas: [delta({
        op: "agreement_open", localId: `peace_${victor}_${loser}`.slice(0, 60), kind: "peace",
        polityId: victor, otherPolityId: loser, terms,
        ...(surrender ? { clauses: [{ kind: "submission", polityId: loser, toPolityId: victor }] } : {}),
        forDays: null, sourceMessageRef: null, visibility: "public", reason: `${why}.`.slice(0, 240),
      })],
      facts: [fact({
        localId: `why_peace_${victor}_${loser}`.slice(0, 60), kind: "peace_made",
        summary: `${nameOf(victor)} and ${nameOf(loser)} made peace after ${Math.round(days / 30)} months of war: ${why}. ${terms}`.slice(0, 400),
        affectedRefs: [{ kind: "polity", id: victor }, { kind: "polity", id: loser }, { kind: "character", id: speaker.id }],
        visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 75,
      })],
    });
    moved.add(a);
    moved.add(b);
  }
  return decisions;
}

/** What a decision is written down as. */
export function ledgerEntry(decision: StatecraftDecision, day: number): StatecraftEntry {
  return { day, polityId: decision.polityId, actorCharacterId: decision.actorCharacterId, act: decision.act, targetPolityId: decision.targetPolityId, why: decision.why };
}

/**
 * What the rules would weigh for a ruler the model is playing (plan §4, "the
 * rule proposes, the model disposes"): his power's best few wars or risings,
 * with how strong the case is and why, and what his armies at war would do.
 * Asked "what do you do?" with nothing in front of him, a king answered
 * "nothing" four times in five; shown his choices, he chooses.
 */
export function rulerOptions(input: StatecraftInput, characterId: string, max = 3): string[] {
  const { world } = input;
  const board = readBoard(world);
  const rulers = readDepartments(world);
  const polityId = world.characters.find((character) => character.id === characterId)?.polityId ?? null;
  if (polityId === null || !rulers.rulers(polityId).some((ruler) => ruler.id === characterId)) return [];
  const nameOf = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;
  const rulerOf = (id: string): Character | undefined => rulers.rulers(id).find((ruler) => ruler.alive);
  const playerPolity = input.playerCharacterId === null ? null : world.characters.find((character) => character.id === input.playerCharacterId)?.polityId ?? null;
  const strength = (score: number, bar: number): string => (score >= bar + 15 ? "a strong case" : score >= bar ? "a fair case" : score >= bar - 15 ? "a thin case" : "a poor case");
  const options = bigMoveCandidates(input, board, rulerOf, (id) => id === polityId, playerPolity)
    .filter((candidate) => candidate.polityId === polityId)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((candidate) => `${candidate.act === "revolt" ? `rise against ${candidate.neighbour.name}` : `go to war with ${candidate.neighbour.name}`} -- ${strength(candidate.score, candidate.act === "revolt" ? REVOLT_AT : WAR_AT)}: ${candidate.why.slice(0, 3).join("; ")}`);
  const reading = board.get(polityId);
  // Each war he is in, and how it stands: where peace could be had.
  for (const enemy of reading?.wars ?? []) {
    const standing = warStanding(world, polityId, enemy);
    options.push(`${standing.dictates ? "dictate peace to" : standing.score >= 25 ? "offer peace on what you hold to" : standing.score <= -25 ? "ask for peace from" : "seek talks with"} ${nameOf(enemy)} -- the war stands at ${standing.score}: ${standing.parts.slice(0, 3).join("; ") || "even"}`);
  }
  if (reading !== undefined && reading.wars.length > 0) {
    const enemies = new Set(enemiesOf(world.polityAgreements, polityId));
    for (const force of world.material.forces.filter((candidate) => candidate.polityId === polityId && fitStrengthOf(candidate) > 0 && !isNavalForce(candidate, input.warfare)).slice(0, 2)) {
      const order = conductOfWar(world, force, enemies, polityId, nameOf, input.warfare);
      if (order !== null) options.push(`${force.name}: ${order.act === "march" ? "march" : order.act === "attack" ? "give battle" : order.act === "besiege" ? "lay siege" : "fall back"} -- ${order.why}`);
    }
  }
  return options.map((line) => line.slice(0, 300));
}
