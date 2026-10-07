import {
  FactProposalSchema,
  PEACE_AT,
  TRUCE_AT,
  WorldDeltaSchema,
  agreementsBetween,
  aptitude,
  computeOpinion,
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
import { appetiteOf, dispositionOf, leastOdds, natureInWords, peaceReluctance, tilt, type Disposition } from "./disposition";
import { plainName, writeLetter } from "./letter-craft";
import { favouredNeighbour } from "./quirks";
import { perceivedRatio } from "./perceive";
import { STEP_DAYS, letterVerdict } from "./letter-verdict";

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
    const rolled = comes(candidate.score, at, candidate.polityId, candidate.neighbour.polityId, candidate.act);
    // A power writes before it fights, unless its ruler is not a man who does (`roadToWar`).
    const road = candidate.act === "declare_war" ? roadToWar(world, candidate, rolled) : ({ step: "war" } as const);
    if (road.step === "letter") {
      if (!moved.has(candidate.polityId) && !moved.has(candidate.neighbour.polityId)) {
        decisions.push(road.decision);
        moved.add(candidate.polityId);
      }
      continue;
    }
    if (road.step === "wait") continue;
    if (wars < NEW_WARS_PER_MONTH && rolled) {
      decisions.push(openTheWar(world, candidate.polityId, candidate.ruler, candidate.neighbour, candidate.act === "revolt" ? "revolt" : "declare_war", candidate.why, nameOf));
      moved.add(candidate.polityId);
      moved.add(candidate.neighbour.polityId);
      wars += 1;
      continue;
    }
    // A raid is short of war, and who sends one is as personal as who declares one: the greedy and the cruel raid for the taking,
    // the vengeful raid to hurt, the honourable do not raid a power they have sworn peace with, and an impulsive man raids oftener.
    const d = dispositionOf(candidate.ruler, day);
    const raidScore = candidate.score + (d.greed - 0.5) * 14 + (d.cruelty - 0.5) * 10 + (d.grudge - 0.5) * 8 - (candidate.neighbour.relation === "peace" ? d.honour * 16 : 0);
    const raidEvery = RAID_EVERY_DAYS * (1 + (d.steadiness - 0.5) * 0.7);
    const raidedLately = world.statecraft.log.some((entry) => entry.act === "raid" && entry.polityId === candidate.polityId && entry.targetPolityId === candidate.neighbour.polityId && day - entry.day < raidEvery);
    if (candidate.act === "declare_war" && candidate.neighbour.bordering && !raidedLately && comes(raidScore, RAID_AT, candidate.polityId, candidate.neighbour.polityId, "raid")) {
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
export interface MoveCandidate { readonly perceived: number; readonly casus: { readonly matter: string; readonly ask: string }; readonly polityId: string; readonly ruler: Character; readonly reading: PowerReading; readonly neighbour: NeighbourReading; readonly act: "declare_war" | "revolt"; readonly score: number; readonly why: string[] }

/**
 * Every war and rising each power could start this month, scored. The rules
 * act on the best of them by chance (`decideStatecraft`); a ruler in the
 * cast is shown his own best few instead, and decides (`rulerOptions`).
 */
export function bigMoveCandidates(
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
    const d = dispositionOf(ruler, day);
    const traits = new Set(ruler.traits);
    const outlookRisk = world.polityOutlooks.find((outlook) => outlook.polityId === reading.polityId)?.riskTolerance ?? ruler.mind.riskTolerance;
    // What the whole of him inclines to; the named traits only nudge it, since the mind already holds what they name.
    const appetite = appetiteOf(d) + (outlookRisk - 50) / 4
      + (traits.has("ambitious") ? 4 : 0) + (traits.has("bold") ? 3 : 0) - (traits.has("cautious") ? 5 : 0) - (traits.has("content") ? 6 : 0)
      + (traits.has("wrathful") ? 3 : 0) - (traits.has("cowardly") ? 8 : 0);
    // Each war already on his hands weighs on him as his nerve lets it.
    const busy = reading.wars.length * (55 - 30 * d.nerve) + (day - lastWarEnded(reading.polityId) < REST_AFTER_WAR_DAYS ? 15 * tilt(d.fear, 0.5) : 0);
    const broke = (world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === reading.polityId)?.balance ?? 0) < 0;
    const nature = natureInWords(d);
    // Reasons are weighed by the part of him that answers to them, so two rulers on the same board score the same neighbour differently.
    const swing = 7 * (1.6 - d.steadiness);

    for (const neighbour of reading.neighbours) {
      if (neighbour.relation === "war" || neighbour.relation === "ally" || neighbour.relation === "protects_us" || neighbour.relation === "we_protect" || neighbour.relation === "truce" || neighbour.relation === "follows_us") continue;
      const why: string[] = [];
      // What the quarrel is about, for the letters that go before a war: the strongest reason wins.
      let perceived = neighbour.ratio;
      let casus = { matter: `the quarrel between ${plainName(reading.name)} and ${plainName(neighbour.name)}`, ask: "that you give us satisfaction" };
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
      if (fear >= 25) { casus = { matter: `${possessive(plainName(neighbour.name))} growing power`, ask: "that you stand your armies down and give us surety" }; score += Math.round((fear / 3) * tilt(d.fear, 0.9)); why.push(d.fear >= 0.6 ? `dread of ${possessive(neighbour.name)} growing power` : `fear of ${possessive(neighbour.name)} growing power`); }
      // An old hatred is a reason to a man who keeps his grudges and hardly one to a man who lets them go.
      if (neighbour.trust <= -60) { casus = { matter: `${possessive(plainName(neighbour.name))} old ill-will toward us`, ask: "that you make amends" }; score += Math.round(25 * tilt(d.grudge, 0.8)); why.push(d.grudge >= 0.6 ? `he has never forgiven ${neighbour.name}` : `an old enmity with ${neighbour.name}`); }
      else if (neighbour.trust <= -30) { score += Math.round(12 * tilt(d.grudge, 0.8)); why.push(`bad blood with ${neighbour.name}`); }
      // A claim is a matter of right to the honourable and of opportunity to the greedy; ground taken from us is a debt of honour and of grudge.
      if (neighbour.claimed.length > 0) { casus = { matter: `the ground ${plainName(neighbour.name)} holds that is ours by right`, ask: "that you restore it" }; score += Math.round(20 * (0.4 + d.honour * 0.6 + d.greed * 0.5)); why.push(`${neighbour.name} holds ground it claims`); }
      if (neighbour.grievances.some((grievance) => grievance.includes("taken from us"))) { casus = { matter: `the ground ${plainName(neighbour.name)} holds that was taken from us`, ask: "that you give the ground back" }; score += Math.round(25 * (0.4 + d.honour * 0.5 + d.grudge * 0.6)); why.push(`${neighbour.name} holds ground taken from it`); }
      // A neighbour with its hands full is a chance to the greedy and a risk to the fearful.
      score += Math.min(30, Math.round(10 * neighbour.distractions.length * (0.4 + d.greed * 1.1 - d.fear * 0.2)));
      if (neighbour.distractions.length > 0) why.push(`${neighbour.name}: ${neighbour.distractions.join("; ")}`);
      if (input.appetiteAgainstPlayer !== undefined && neighbour.polityId === playerPolity) score += input.appetiteAgainstPlayer;
      // What he thinks of the man who rules them, as a man, and the one neighbour he has never forgiven or is fond of (quirks.ts).
      const theirRuler = rulerOf(neighbour.polityId);
      const regard = theirRuler === undefined ? 0 : computeOpinion(ruler, theirRuler.id);
      if (regard <= -40) score += 10; else if (regard >= 40) score -= 12;
      if (favouredNeighbour(ruler, reading.neighbours.map((n) => n.polityId), "grudge_bearer") === neighbour.polityId) score += 12;
      if (favouredNeighbour(ruler, reading.neighbours.map((n) => n.polityId), "loyal_friend") === neighbour.polityId) score -= 14;

      if (neighbour.relation === "leads_us") {
        // A people bound by foedus does not make war; it rises. Only when the
        // leader is busy, its armies are far, and the people want out.
        if (neighbour.trust > -30) continue;
        const leaderBusy = neighbour.theirWars.length > 0 && neighbour.theirMenNear === 0;
        if (!leaderBusy) continue;
        score += 15 + (neighbour.trust <= -50 ? 10 : 0) - 10;
        why.push(`${possessive(neighbour.name)} armies are away at war`);
        candidates.push({ casus, perceived, polityId: reading.polityId, ruler, reading, neighbour, act: "revolt", score: score + roll(input.gameId, day, reading.polityId, neighbour.polityId, "revolt")(15) * (swing / 7) - swing, why });
        continue;
      }
      // The odds. A power that cannot win does not start it, whatever it
      // feels -- unless the age leans that way and it has friends to count on:
      // Athens rose against Macedon in 268 because Sparta and Egypt stood
      // behind it, not because Athens alone could win.
      const friends = world.polityAgreements.some((agreement) => agreement.status === "active" && agreement.kind === "alliance" && (agreement.polityId === reading.polityId || agreement.otherPolityId === reading.polityId));
      // What he believes of their strength, which is not what it is (`perceive.ts`).
      const ratio = perceivedRatio(world, ruler, neighbour);
      perceived = ratio;
      if (ratio < (leaning !== undefined && friends ? 0.15 : leastOdds(d))) continue;
      score += ratio >= 2 ? 30 : ratio >= 1.5 ? 20 : ratio >= 1.2 ? 10 : -10;
      why.push(ratio < leastOdds(d)
        ? `${neighbour.name} is far the stronger, and it counts on its friends`
        : `its strength against ${possessive(neighbour.name)} is ${ratio >= 2 ? "more than double" : ratio >= 1.5 ? "half again" : ratio >= 1.2 ? "a little better" : "about even"}`);
      // Breaking a treaty is a thing a faithless ruler does more easily.
      // Breaking a sworn peace costs the honest dear and the faithless almost nothing.
      if (neighbour.relation === "peace") score -= intendsToBreak(world, ruler, neighbour.polityId) ? 0 : Math.round(traits.has("deceitful") || traits.has("treacherous") ? 4 : 6 + 28 * d.honour);
      if (!neighbour.bordering && leaning === undefined) score -= 15;
      // A steady ruler moves on his reasons; an impulsive one on his mood too.
      const jitter = roll(input.gameId, day, reading.polityId, neighbour.polityId, "war")(15) * (swing / 7) - swing;
      if (nature.length > 0) why.push(`${ruler.name} is ${nature.slice(0, 2).join(" and ")}`);
      candidates.push({ casus, perceived, polityId: reading.polityId, ruler, reading, neighbour, act: "declare_war", score: score + jitter, why });
    }
  }

  return candidates;
}

/** How long a letter on the road to war is given before the next, from the sender's own patience. */
const patienceDays = (d: Disposition): number => STEP_DAYS + STEP_DAYS * Math.round(d.steadiness * d.honour * 2);
/** A quarrel that was answered well is let alone for this long. */
const QUARREL_SETTLED_DAYS = 240;

type Road = { readonly step: "war" } | { readonly step: "wait" } | { readonly step: "letter"; readonly decision: StatecraftDecision };

/**
 * The road to a war: complaint, demand, ultimatum, war.
 *
 * Powers used to open a war with a bare declaration and nothing said. Now a
 * ruler who is the sort to give warning writes first -- a complaint of the
 * wrong, a demand for its redress with a term, an ultimatum that says it is
 * war if refused -- and the war opens by the ultimatum's own threat when it is
 * refused or goes unanswered (`tick.ts`, `carryOutTheThreat`). Each letter is
 * worded by the writer's own mind (`letter-craft.ts`) and the rule only
 * decides when the next is sent: a patient, honest man waits two months
 * between rungs; a hot-tempered one starts at the ultimatum; a bold, proud one
 * leaves out the complaint. A man of no honour, and one who will strike on a
 * whim, gives no warning at all -- but the world sees what he did.
 */
export function roadToWar(world: WorldState, candidate: MoveCandidate, rolled: boolean): Road {
  const { ruler, neighbour, polityId } = candidate;
  const day = world.instant.day;
  const d = dispositionOf(ruler, day);
  const warns = d.honour >= 0.3 && stableHash([ruler.id, neighbour.polityId, "warns"]) % 100 < 35 + 60 * d.honour;
  if (!warns) return { step: "war" };
  const sent = world.diplomacy
    .filter((message) => message.fromPolityId === polityId && message.toPolityId === neighbour.polityId && message.fromCharacterId === ruler.id && day - message.sentAtStep <= 400
      && (message.kind === "protest" || message.kind === "warning" || message.kind === "ultimatum"))
    .sort((a, b) => b.sentAtStep - a.sentAtStep);
  const last = sent[0];
  const gap = patienceDays(d);
  const ready = (message: DiplomaticMessage): boolean => day - (message.answeredAtStep ?? message.sentAtStep) >= gap;
  if (last !== undefined) {
    if (last.status === "awaiting_reply") return { step: "wait" };
    // Answered well, and the quarrel is let alone a while; answered ill, and the next rung is climbed.
    if (last.answer === "accepted") return day - (last.answeredAtStep ?? day) < QUARREL_SETTLED_DAYS ? { step: "wait" } : startOfRoad(candidate, d, rolled, day);
    if (last.kind === "ultimatum") return { step: "wait" };
    // The score must still be near what began it, or the quarrel has gone cold.
    if (candidate.score < WAR_AT - 12 || !ready(last)) return { step: "wait" };
    return climb(candidate, d, last.kind === "protest" ? "demand" : "ultimatum", day);
  }
  return startOfRoad(candidate, d, rolled, day);
}

function startOfRoad(candidate: MoveCandidate, d: Disposition, rolled: boolean, day: number): Road {
  if (!rolled) return { step: "wait" };
  // The hot-tempered begin with the ultimatum, the bold and proud with the demand, the rest with a complaint.
  const first: "complaint" | "demand" | "ultimatum" = d.steadiness <= 0.25 && d.nerve >= 0.6 ? "ultimatum" : d.nerve * d.pride >= 0.45 ? "demand" : "complaint";
  return climb(candidate, d, first, day);
}

function climb(candidate: MoveCandidate, d: Disposition, rung: "complaint" | "demand" | "ultimatum", day: number): Road {
  const { ruler, neighbour, polityId, reading, casus } = candidate;
  const us = reading.name;
  const them = neighbour.name;
  const days = rung === "ultimatum" ? 30 : rung === "demand" ? 40 : 45;
  // The weaker hand cannot afford to threaten, and says so in its tone.
  const weak = candidate.perceived < 0.8;
  const letter = writeLetter(ruler, day, rung === "complaint" ? "complaint" : rung === "demand" ? "demand" : "ultimatum",
    { us, them, matter: casus.matter, ask: casus.ask, days }, rung === "complaint" ? `${us} complains to ${them}` : rung === "demand" ? `${us} demands satisfaction of ${them}` : `${us} to ${them}: an ultimatum`, weak);
  const kind = rung === "complaint" ? "protest" : rung === "demand" ? "warning" : "ultimatum";
  return {
    step: "letter",
    decision: {
      polityId, actorCharacterId: ruler.id, act: "letter", targetPolityId: neighbour.polityId,
      why: `wrote to ${them} (${rung}): ${casus.matter}`.slice(0, 400),
      deltas: [delta({
        op: "diplomatic_message_send", localId: `${kind}_${polityId}_${neighbour.polityId}`.slice(0, 60), kind,
        fromPolityId: polityId, fromCharacterRef: ruler.id, toPolityId: neighbour.polityId, toCharacterRef: null,
        subject: letter.subject, terms: letter.body, replyWithinDays: days, inReplyToRef: null, visibility: "polity",
        ...(rung === "ultimatum" ? { onRefusal: "war" } : {}),
        reason: `${casus.matter}`.slice(0, 240),
      })],
      facts: [],
    },
  };
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
  // The frightened and the bold call out more of what they have than the easy-going do.
  const call = dispositionOf(ruler, world.instant.day);
  const men = Math.min(LEVY_CAP, Math.round(reading.levy * (0.6 + 0.3 * call.fear + 0.3 * call.nerve + 0.2 * (call.steadiness - 0.5))));
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
  const temper = commandersTemper(world.characters.find((character) => character.id === commander));
  const oddsFor = (provinceId: string): number => (ownGround(provinceId) ? DEFEND_ODDS : ATTACK_ODDS) * temper.wants;
  if (facing.length > 0) {
    const theirs = menAt(force.locationId);
    if (men >= oddsFor(force.locationId) * theirs) {
      return decide("attack", facing[0]!.polityId, `${roughMen(men)} against ${roughMen(theirs)}: the odds are ours`, [delta({ op: "force_engage", forceRef: force.id, targetForceRef: facing[0]!.id, posture: "offer_battle", tactic: null, reason: `${force.name} offers battle: the odds are good.` })]);
    }
    if (theirs >= RETREAT_ODDS * temper.flees * men) {
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
    if (menAt(provinceId) * ATTACK_ODDS * temper.wants > men) continue;
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
      const seeker = dispositionOf(ruler, world.instant.day);
      const score = 30 + Math.min(20, -threat.trust / 3) + (threat.relation === "war" ? 15 : 0) + Math.round(20 * (seeker.fear - 0.5) + 14 * (seeker.sociability - 0.5));
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
 * What a ruler will say to a letter, by rule, and in his own voice.
 *
 * Every power the model is not playing answers its letters here, and what it
 * answers is the answerer's own: a proud man will not talk of peace while he is
 * not beaten, a frightened one gives way to an ultimatum from a stronger
 * neighbour, a plain one says no plainly, a cautious one takes his time, and a
 * man whose word is worth nothing may say yes and mean otherwise
 * (`intendsToBreak`). The words are written from what moved him
 * (`letter-craft.ts`), in a tone the writer's mind picks.
 */
export function answerByRule(world: WorldState, message: DiplomaticMessage, input: StatecraftInput, rulerOf: (polityId: string) => Character | undefined): StatecraftDecision | null {
  if (message.status !== "awaiting_reply" || !isDelivered(message, world.instant.day) || message.heldAnswer !== undefined) return null;
  if (input.excludedPolityIds.has(message.toPolityId) || message.fromCharacterId === input.playerCharacterId) return null;
  // Letters between powers are the rules' and are basic; a letter to the player's circle is the model's (`letter-voice.ts`, `cognition.ts`).
  const playerPolity = input.playerCharacterId === null ? null : world.characters.find((character) => character.id === input.playerCharacterId)?.polityId ?? null;
  if (playerPolity !== null && (message.toPolityId === playerPolity || message.fromPolityId === playerPolity)) return null;
  if (message.toCharacterId === input.playerCharacterId && input.playerCharacterId !== null) return null;
  const answerer = message.toCharacterId === null ? rulerOf(message.toPolityId) : world.characters.find((character) => character.id === message.toCharacterId && character.alive);
  if (answerer === undefined || input.playedByModel.has(answerer.id)) return null;
  const verdict = letterVerdict(world, message, answerer);
  if (verdict === null) return null;
  const day = world.instant.day;
  const nameOf = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;

  // A man does not always answer the day it comes: the cautious and the frightened take counsel first,
  // so long as that does not run out the term the sender gave.
  const arrived = message.deliveredOnDay ?? message.sentAtStep;
  const fitsTheTerm = message.replyDueByStep === null || arrived + verdict.slowness + STEP_DAYS <= message.replyDueByStep;
  if (verdict.slowness > 0 && fitsTheTerm && day < arrived + verdict.slowness) return null;

  const letter = writeLetter(answerer, day, verdict.intent, { us: nameOf(message.toPolityId), them: nameOf(message.fromPolityId), reason: verdict.reason, ...verdict.extra }, "{us} answers {them}", verdict.weak);
  // A man of no honour may say yes and mean no: nothing here, and nothing in the world, shows it (`intendsToBreak`).
  return {
    polityId: message.toPolityId, actorCharacterId: answerer.id, act: "answer_letter", targetPolityId: message.fromPolityId,
    why: `${answer} "${message.subject}": ${verdict.why}`.slice(0, 400),
    deltas: [delta({ op: "diplomatic_message_answer", messageRef: message.id, answer, answerText: letter.body, agreementKind: null, ...(verdict.counter === undefined ? {} : { counterTrade: verdict.counter }), reason: letter.body.slice(0, 240) })],
    facts: [],
  // An offer of trade he would take on other terms, or one written to somebody who does not decide it, is answered "countered":
  // the first sends his terms back as an offer of his own, the second only says who does decide (`trade-verdict.ts`).
  const answer = verdict.counter !== undefined || verdict.redirect !== undefined ? "countered" : verdict.accepted ? "accepted" : "refused";
  };
}


/**
 * Whether this man said yes to a letter and never meant to keep it.
 *
 * Nothing records it: it is the same hash of the man and the letter every time
 * it is asked, so the world acts on it later and the player is never shown it.
 * Only a man of weak honesty can, and the weaker, the likelier.
 */
export function intendsToBreak(world: WorldState, ruler: Character, otherPolityId: string): boolean {
  const honesty = ruler.mind.temperament.honesty;
  if (honesty > 40) return false;
  const open = world.polityAgreements.find((agreement) => agreement.status === "active" && (agreement.kind === "peace" || agreement.kind === "truce" || agreement.kind === "alliance")
    && ((agreement.polityId === ruler.polityId && agreement.otherPolityId === otherPolityId) || (agreement.otherPolityId === ruler.polityId && agreement.polityId === otherPolityId))
    && agreement.sourceMessageId !== null);
  if (open === undefined || open.sourceMessageId === null) return false;
  const message = world.diplomacy.find((candidate) => candidate.id === open.sourceMessageId);
  if (message === undefined || message.toCharacterId !== ruler.id && message.toPolityId !== ruler.polityId) return false;
  return stableHash([ruler.id, open.sourceMessageId, "false-faith"]) % 100 < (40 - honesty) * 1.5;
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
    const today = world.instant.day;
    const reluctA = rulerA === undefined ? 0 : peaceReluctance(dispositionOf(rulerA, today));
    const reluctB = rulerB === undefined ? 0 : peaceReluctance(dispositionOf(rulerB, today));
    const proudest = Math.max(rulerA === undefined ? 0.5 : dispositionOf(rulerA, today).pride, rulerB === undefined ? 0.5 : dispositionOf(rulerB, today).pride);
    const tiredA = warWeariness(world, a, b).score;
    const tiredB = warWeariness(world, b, a).score;
    const claimsHeld = (claimant: string, holder: string): boolean => {
      const claims = (world.map.claimRecords ?? []).filter((claim) => claim.status === "active" && claim.claimantPolityId === claimant && claim.locationKind === "province");
      return claims.length > 0 && claims.some((claim) => world.map.provinces.find((province) => province.id === claim.locationId)?.lostBy?.polityId === holder)
        && !claims.some((claim) => world.map.provinces.find((province) => province.id === claim.locationId)?.controllerPolityId === holder);
    };
    const satisfied = days >= 180 && (claimsHeld(war.polityId, war.otherPolityId));
    const spent = tiredA >= PEACE_AT + reluctA && tiredB >= PEACE_AT + reluctB;
    // A war a year old with one side clearly ahead ends on what it holds; one
    // eighteen months old that has gone nowhere ends as things stand.
    const ahead = days >= AHEAD_PEACE_DAYS && Math.max(standingA.score, standingB.score) >= AHEAD_SCORE;
    // Two proud men let a war go nowhere for longer than two sensible ones.
    const stale = days >= STALEMATE_DAYS * (1 + (proudest - 0.5) * 0.8);
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

/**
 * What the man at the head of an army makes of the odds. A seasoned general
 * (high martial) will take a fight a plain one would refuse, because he knows
 * what his men can do; a poor one wants far more men before he offers battle.
 * Boldness shifts both ends: a bold man wants lower odds and holds when he
 * should fall back, a cautious one wants more and leaves sooner. So a reckless
 * beginner walks into fights he should not take, and a cautious incompetent
 * lets chances go by -- neither is the veteran who takes the right ones.
 * Absent or unskilled commanders read as middling.
 */
export function commandersTemper(commander: Character | undefined): { readonly wants: number; readonly flees: number } {
  if (commander === undefined) return { wants: 1, flees: 1 };
  const skill = (commander.skills.martial + aptitude(commander, "strategist")) / 2;
  const bold = commander.mind.temperament.boldness;
  const wants = (1 + (50 - skill) / 100) * (1 - (bold - 50) / 200);
  const flees = 1 + (bold - 50) / 100;
  return { wants: Math.max(0.6, Math.min(1.5, wants)), flees: Math.max(0.6, Math.min(1.5, flees)) };
}
