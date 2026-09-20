import {
  LOOSE_COHESION_BPS,
  agreementsBetween,
  openStorylines,
  stableChoice,
  stableHash,
  type Fact,
  type ScenarioHistoricalPressure,
  type WorldState,
} from "@chronica/shared";
import { findPolityGaps } from "./population";

/**
 * The narrator: the world making trouble where nobody is looking (VISION §5,
 * §20, §32 "A world that moves on its own").
 *
 * The world elsewhere already moves through people -- `routeAmbientActors`
 * asks a rotating cast what they are doing about their own business. But
 * nothing ever *started* anything: no plague fell on a quiet province, no
 * governor began skimming, no pretender appeared. The scenario's six authored
 * pressures were the whole of the drama anyone could have that the player had
 * not caused.
 *
 * This decides, deterministically and for free, that something stirs -- what
 * kind of thing, where, how badly, and whether in secret -- and hands the
 * orchestrator a brief. The orchestrator decides what it actually is, in the
 * call it was already making: the same pattern as `population.ts`, and for the
 * same reason. Code owns *that* and *where*; the model owns *what*.
 *
 * It is a dramatic director, and honest about it: it reads the ruler's comfort
 * and makes more and worse trouble for a comfortable reign than for one that
 * is collapsing. The model is never told this. It sees a scale, never a
 * motive, so the Chronicle can never expose a contrivance -- none of this is a
 * fact.
 *
 * Every choice here is `stableHash` over the game and the seed's ordinal. A
 * replay from the same world seeds the same thing in the same place.
 */

export type SeedKind = "person_problem" | "world_event" | "new_actor";
export type SeedSeverity = "minor" | "serious" | "grave";

export interface TensionReading {
  /** 0 = a reign in collapse, 1 = nothing troubles it. */
  readonly comfort: number;
  readonly treasury: number;
  readonly arrears: number;
  readonly legitimacy: number;
  readonly order: number;
  readonly war: number;
  readonly openThreads: number;
  /** In words, for the seed's `why`. */
  readonly summary: string;
}

export interface NarratorSeed {
  /** The handle the orchestrator writes into `storyline_open`, so the engine can tell the seed was taken up. */
  readonly key: string;
  readonly kind: SeedKind;
  readonly archetype: string;
  readonly severity: SeedSeverity;
  readonly secret: boolean;
  /** An incident that runs its course rather than one that grows into a thread. */
  readonly oneShot: boolean;
  readonly target: {
    readonly provinceId: string | null;
    readonly provinceName: string | null;
    readonly polityId: string | null;
    readonly polityName: string | null;
    readonly characterId: string | null;
    readonly characterName: string | null;
    /** The other party, where the trouble is between two powers rather than in one. */
    readonly otherPolityId: string | null;
    readonly otherPolityName: string | null;
  };
  readonly inPlayerRealm: boolean;
  /** Offered once before and not taken up. */
  readonly repeated: boolean;
  /** The scenario pressure this came from, when it came from one. Spent once offered. */
  readonly pressureId: string | null;
  /** Why now, in words the prompt can use. */
  readonly why: string;
  /** What must happen and which deltas say so, filled with ids. */
  readonly brief: string;
}

export interface NarratorInput {
  readonly world: WorldState;
  readonly gameId: string;
  readonly ownPolityId: string | null;
  readonly playerCharacterId: string | null;
  /** The whole recent record, not the player's view: the narrator is code, and may know everything. */
  readonly facts: readonly Fact[];
  /**
   * What the period tends toward. Offered only when the world still looks like
   * the condition each one names, and each only once -- history is something
   * this world can fall into, never something it is on rails toward.
   */
  readonly pressures?: readonly ScenarioHistoricalPressure[] | undefined;
  /**
   * How far this burst may carry the world.
   *
   * The narrator is asked once, at the top of a burst, and the burst is the
   * thing that moves time -- so sizing the batch on the silence *behind* it
   * meant a season got the stirrings of the moment it began. A live run made
   * this plain: one order covered ninety days and the world did nothing at
   * all in them, because the previous order had stirred it that same morning.
   */
  readonly spanDays?: number | undefined;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;
const DISTRESS_BPS = 4_000;
const QUIET_WINDOW_DAYS = 60;

/**
 * Whether this seed lands in the ruler's own realm. Rolled outright rather
 * than scored: a bonus for home outscored every quiet province abroad and the
 * comfortable never heard of trouble anywhere else. Trouble still comes home
 * more often when things are easy.
 */
function landsAtHome(comfort: number, gameId: string, seedCount: number): boolean {
  const twelfths = Math.round(lerp(3, 7, comfort));
  return stableChoice([gameId, "narrator", "home", seedCount], 12) < twelfths;
}
/** Past this many open threads the world stops starting new ones; past half of it, only incidents that run their course. */
const THREAD_CEILING = 12;

/**
 * How comfortable the ruler is, from what the world actually holds.
 *
 * Read from `WorldState` alone, never from the fact window, which can scroll.
 */
export function readTension(world: WorldState, ownPolityId: string | null): TensionReading {
  const ownCharacterIds = new Set(world.characters.filter((character) => character.polityId === ownPolityId).map((character) => character.id));
  const ownAccountIds = new Set(
    world.material.accounts
      .filter((account) => (account.owner.kind === "polity" && account.owner.id === ownPolityId) || ownCharacterIds.has(account.owner.id))
      .map((account) => account.id),
  );
  const perDay = (amount: number, cadence: number): number => (cadence <= 0 ? 0 : amount / cadence);

  const ownObligations = world.material.obligations.filter((obligation) => obligation.active && ownAccountIds.has(obligation.payerAccountId));
  const monthlyExpenditure = ownObligations.reduce((sum, obligation) => sum + perDay(obligation.amount, obligation.cadenceSteps) * 30, 0);
  const treasuryBalance = world.material.accounts
    .filter((account) => account.owner.kind === "polity" && account.owner.id === ownPolityId)
    .reduce((sum, account) => sum + account.balance, 0);
  const runwayMonths = monthlyExpenditure <= 0 ? 6 : treasuryBalance / monthlyExpenditure;
  const treasury = clamp01(runwayMonths / 6);

  const missed = ownObligations.filter((obligation) => obligation.missedPeriods > 0).length
    + world.material.loans.filter((loan) => loan.status === "defaulted" && ownAccountIds.has(loan.borrowerAccountId)).length;
  const arrears = 1 - clamp01(missed / 2);

  const standing = world.material.polityLegitimacy.find((entry) => entry.polityId === ownPolityId);
  const legitimacy = standing === undefined ? 0.6 : (standing.legitimacyBps * 0.7 + standing.institutionalConfidenceBps * 0.3) / 10_000;

  const ownProvinceIds = new Set(world.map.provinces.filter((province) => province.controllerPolityId === ownPolityId).map((province) => province.id));
  const ownMaterial = world.material.provinceMaterial.filter((material) => ownProvinceIds.has(material.provinceId));
  const distressed = ownMaterial.filter((material) => material.stabilityBps < DISTRESS_BPS || material.foodSecurityBps < DISTRESS_BPS).length;
  const order = ownMaterial.length === 0 ? 1 : 1 - distressed / ownMaterial.length;

  const atWar = ownPolityId !== null && world.conflicts.wars.some((war) => war.polityAId === ownPolityId || war.polityBId === ownPolityId);
  const ownForces = world.material.forces.filter((force) => force.polityId === ownPolityId);
  const averageMorale = ownForces.length === 0 ? 10_000 : ownForces.reduce((sum, force) => sum + force.moraleBps, 0) / ownForces.length;
  const badly = averageMorale < 4_000 || ownForces.some((force) => force.provisionStatus === "critical");
  const war = !atWar ? 1 : badly ? 0.15 : 0.35;

  const comfort = clamp01(0.25 * treasury + 0.15 * arrears + 0.2 * legitimacy + 0.2 * order + 0.2 * war);
  const openThreads = openStorylines(world.storylines).length;

  const parts = [
    runwayMonths >= 6 ? "the treasury is full" : runwayMonths >= 2 ? "the treasury holds for now" : "the treasury is nearly empty",
    missed > 0 ? "debts are going unpaid" : null,
    legitimacy < 0.4 ? "the government's standing is low" : null,
    distressed > 0 ? `${distressed} of its provinces are in distress` : "the provinces are quiet",
    atWar ? (badly ? "the war goes badly" : "there is a war on") : "no war is being fought",
  ].filter((part): part is string => part !== null);

  return { comfort, treasury, arrears, legitimacy, order, war, openThreads, summary: parts.join(", ") };
}

// ── Archetypes ───────────────────────────────────────────────────────────────

interface Archetype {
  readonly kind: SeedKind;
  readonly name: string;
  readonly weight: number;
  readonly oneShot: boolean;
  /** Chance in twelfths that this is kept from the world. */
  readonly secretTwelfths: number;
  /** Needs a second power, and is not offered at all when the map has none to offer. */
  readonly needsAdversary?: boolean;
  /** Another enemy. A country already fighting one gets fewer of these; it gets no fewer harvests. */
  readonly rival?: boolean;
  readonly brief: (target: NarratorSeed["target"], severity: SeedSeverity) => string;
}

const magnitude = (severity: SeedSeverity, minor: string, serious: string, grave: string): string =>
  severity === "minor" ? minor : severity === "serious" ? serious : grave;

const person = (target: NarratorSeed["target"]): string => `${target.characterName} [${target.characterId}]`;
const place = (target: NarratorSeed["target"]): string => `${target.provinceName} [${target.provinceId}]`;
const power = (target: NarratorSeed["target"]): string => `${target.polityName} [${target.polityId}]`;
const other = (target: NarratorSeed["target"]): string => `${target.otherPolityName} [${target.otherPolityId}]`;

const PERSON_PROBLEM_TAIL =
  'Decide what it actually is. Put it on them with "character_pressure_set" and, where they now mean to do something about it, "character_intent_set"; record what has already happened as a fact naming them.';

const ARCHETYPES: readonly Archetype[] = [
  { kind: "person_problem", name: "debt", weight: 8, oneShot: true, secretTwelfths: 6,
    brief: (t, s) => `A debt has come due for ${person(t)}: ${magnitude(s, "an awkward sum", "more than they can raise this season", "enough to ruin them")}. ${PERSON_PROBLEM_TAIL}` },
  { kind: "person_problem", name: "conspiracy", weight: 8, oneShot: false, secretTwelfths: 12,
    brief: (t, s) => `${person(t)} has begun something against ${magnitude(s, "a rival", "a superior", "the government they serve")}, and means to keep it hidden. Decide what. Plant what drives them -- "character_intent_set" (private), a "character_pressure_set" or a "belief_set" -- and record what they have already done as a private fact known to them alone. Do not carry out their acts for them: the money they take and the men they move, they take and move themselves, later.` },
  { kind: "person_problem", name: "rivalry", weight: 7, oneShot: false, secretTwelfths: 0,
    brief: (t, s) => `A rivalry has broken open around ${person(t)}: ${magnitude(s, "a slight in public", "a contest for the same office or command", "an enemy who means to destroy them")}. Name the other party from PEOPLE or create them. ${PERSON_PROBLEM_TAIL}` },
  { kind: "person_problem", name: "opportunity", weight: 7, oneShot: false, secretTwelfths: 6,
    brief: (t, s) => `${person(t)} is suddenly placed to gain something: ${magnitude(s, "a small advantage", "an office, a command or a fortune within reach", "a chance at real power")}. ${PERSON_PROBLEM_TAIL}` },
  { kind: "person_problem", name: "illness", weight: 5, oneShot: true, secretTwelfths: 0,
    brief: (t, s) => `${person(t)} has fallen ill: ${magnitude(s, "a fever that will pass", "a sickness that keeps them from their duties", "an illness they may not survive")}. ${PERSON_PROBLEM_TAIL}` },
  { kind: "person_problem", name: "family_obligation", weight: 5, oneShot: true, secretTwelfths: 0,
    brief: (t, s) => `A family matter has landed on ${person(t)}: ${magnitude(s, "a marriage to arrange", "a kinsman in disgrace or in debt", "a death that leaves them head of the house")}. ${PERSON_PROBLEM_TAIL}` },

  { kind: "world_event", name: "plague", weight: 10, oneShot: false, secretTwelfths: 0,
    brief: (t, s) => `Sickness has come to ${place(t)}, held by ${power(t)}: ${magnitude(s, "an outbreak (food security -800, stability -500, a few hundred dead)", "an epidemic (food security -1800, stability -1200, one in twenty dead)", "a plague (food security -3000, stability -2000, one in eight dead)")}. Change the province now with "province_material_shift"; record it as a public fact naming the province and its power; open its thread on the province alone (a thread's participants are people, and a sickness has none yet); and since it will run for weeks, schedule its next turn with a scheduled event citing that fact, so it can be carried on when it falls due.` },
  { kind: "world_event", name: "grain_fleet_lost", weight: 8, oneShot: true, secretTwelfths: 0,
    brief: (t, s) => `A storm off ${place(t)} has taken ${magnitude(s, "a few grain ships", "the season's grain convoy", "the grain fleet and the ships that guarded it")}. Move what it changes now -- "province_material_shift" on the province that was fed by it, "income_source_upsert" to cut a route that no longer arrives, "money_transfer" for cargo lost -- and record it as a public fact.` },
  { kind: "world_event", name: "revolt", weight: 8, oneShot: false, secretTwelfths: 0,
    brief: (t, s) => `${place(t)} has risen against ${power(t)}: ${magnitude(s, "riots in the towns", "an armed rising with a leader", "open rebellion holding the countryside")}. ${
      s === "minor"
        // Riots are not a country. A rising only becomes a power when it holds
        // ground, and a rising that holds ground must hold it as itself: filed
        // under the government being rebelled against, it had nobody to fight.
        ? `Create the leader with "character_create" under the province's own people, shift the province with "province_material_shift", and record the rising as a public fact naming the province and its power.`
        : `They hold ground, so they are a power: create them with "polity_create", breaking from ${power(t)} and taking ${place(t)}, and give them their leader with "character_create" under the new power and a "force_create" if they are armed. The war with ${power(t)} opens itself. Record the rising as a public fact naming the province and both powers.`
    }` },
  { kind: "world_event", name: "omen", weight: 6, oneShot: true, secretTwelfths: 0,
    brief: (t, s) => `An omen has been seen at ${place(t)}: ${magnitude(s, "a sign the priests argue over", "a portent the whole city has heard of", "a prodigy that has the people in the temples")}. Decide what was seen and how it is read. Record it as a public fact; move whoever reads it with "belief_set", and the province's temper with "province_material_shift" if the city is shaken.` },

  { kind: "new_actor", name: "pirate_band", weight: 8, oneShot: false, secretTwelfths: 0, rival: true,
    brief: (t, s) => `A pirate squadron has appeared off ${place(t)}: ${magnitude(s, "a few hulls preying on coasters", "a fleet strong enough to close the strait", "a pirate king with a harbour of his own")}. ${
      s === "grave"
        ? `A pirate king with a harbour is a power: create them with "polity_create" taking ${place(t)} from ${power(t)}, with their captain under it.`
        : `Create their captain with "character_create" and their ships with "force_create" under ${power(t)} -- raiders who hold no ground are not a country.`
    } Record their arrival as a public fact, and give them a "character_intent_set". Their arrival is news; their existence is not, and gets no fact of its own.` },
  { kind: "new_actor", name: "pretender", weight: 6, oneShot: false, secretTwelfths: 7, rival: true,
    brief: (t, s) => `A claimant has appeared in ${place(t)}: ${magnitude(s, "an exile with a grievance and a few followers", "a pretender with money behind him", "a rival for the rule of the whole power")}. Create them with "character_create" under ${power(t)} -- a claimant wants the power that exists, not a new one, so do not found a country for them -- record their appearance as a fact, and plant what they mean to do with "character_intent_set". Their arrival is news; their existence is not.` },
  // Nothing in this table has ever started a war, and it showed: a world ran
  // for years with exactly one war in it, between two British tribes, because
  // the only way one could open was a rebellion seceding. Conquest, battles and
  // the whole battle-account machinery were built and unreachable.
  { kind: "world_event", name: "war", weight: 9, oneShot: false, secretTwelfths: 0, needsAdversary: true,
    brief: (t, s) => `${power(t)} and ${other(t)} have come to the point over ${place(t)}: ${magnitude(s, "a border incident neither government ordered", "a cargo seized, a garrison turned back, and no apology offered", "a claim on the ground itself that neither will drop")}. Decide what the quarrel actually is, who struck first and who refused to give way. Open it with "agreement_open" of kind "war" between ${power(t)} and ${other(t)}, record the breaking as a public fact naming both powers and the province, and give whoever pushed for it a "character_intent_set". Do not fight it here: opening it is the whole of this.` },

  // ── What a month is mostly made of ─────────────────────────────────────
  //
  // Everything above is trouble, and a record of nothing but trouble reads
  // like a crisis rather than a place. These are the ordinary business of a
  // province: cheap, one-shot, no thread, and half of them good news.
  { kind: "world_event", name: "harvest", weight: 7, oneShot: true, secretTwelfths: 0,
    brief: (t, s) => `The year has turned in ${place(t)}: ${magnitude(s, "a fair harvest and a quiet market", "a harvest better than anyone expected (food security +1200, stability +400)", "a glut -- granaries full, grain cheap, and the men who bought early ruined (food security +2500, stability +600)")}. Move it with "province_material_shift" and record it as a public fact naming the province. Nobody need do anything about it.` },
  { kind: "world_event", name: "games", weight: 6, oneShot: true, secretTwelfths: 0,
    brief: (t, s) => `${place(t)} is holding ${magnitude(s, "its usual festival", "games somebody paid a great deal for", "a spectacle the whole province has come in for")}. Decide who paid and what they got for it: a public fact naming the province, a "legitimacy_shift" or a "social_events" entry for whoever's name is on it, and a "province_material_shift" if the city is the better for it. Somebody's standing is bought here, cheaply or dearly.` },
  { kind: "world_event", name: "building", weight: 6, oneShot: true, secretTwelfths: 0,
    brief: (t, s) => `Work has finished in ${place(t)}: ${magnitude(s, "a cistern, a granary, a length of road", "a temple or a harbour mole", "a work the province will be known for")}. Decide what it is and whose name is on it. Record it as a public fact naming the province, move the province with "province_material_shift", and put the credit somewhere with "social_events" or a "legitimacy_shift".` },
  { kind: "world_event", name: "market", weight: 6, oneShot: true, secretTwelfths: 0,
    brief: (t, s) => `The price of something has moved in ${place(t)}: ${magnitude(s, "grain up a little and the bakers complaining", "silver or grain moving enough that fortunes turn on it", "a shortage the magistrates cannot talk their way out of")}. Decide what and why. Record it as a public fact naming the province, and move what it actually changes -- "income_source_upsert" for a trade that now pays differently, "province_material_shift" for a city going hungry, "money_transfer" for somebody who saw it coming.` },
  { kind: "world_event", name: "strangers", weight: 5, oneShot: true, secretTwelfths: 0,
    brief: (t, s) => `Strangers have come to ${place(t)}: ${magnitude(s, "a caravan from further off than usual", "a party of exiles asking to be let in", "a people on the move, with their carts and their herds")}. Decide who they are and how they are received. A public fact naming the province; "belief_set" for what the province makes of them; "province_material_shift" if they are fed or turned away.` },

  { kind: "new_actor", name: "cult", weight: 6, oneShot: false, secretTwelfths: 7,
    brief: (t, s) => `A prophet is drawing crowds in ${place(t)}: ${magnitude(s, "a preacher the magistrates are watching", "a movement with followers in every town", "a faith that answers to nobody but its leader")}. Create the leader with "character_create" under ${power(t)} and the movement with "generic_entity_create" (kind "faction"), record the stir as a fact, and plant what they mean to do with "character_intent_set".` },
];


/**
 * Which of the period's pressures the world still looks like.
 *
 * Every stated condition has to hold. This is the whole of the "favour history
 * where the circumstances exist" rule: nothing here makes an event happen, it
 * only makes one *available*. A mercenary mutiny is reachable while Carthage
 * exists and is not at war; if the war never ends, or Carthage does not
 * survive, the pressure simply expires unused and the age goes differently.
 */
export function livePressures(world: WorldState, pressures: readonly ScenarioHistoricalPressure[]): ScenarioHistoricalPressure[] {
  const spent = new Set(world.narrator.spentPressureIds);
  const exists = (polityId: string): boolean => world.map.polities.some((polity) => polity.id === polityId);
  const atWar = (a: string, b: string): boolean =>
    agreementsBetween(world.polityAgreements, a, b).some((agreement) => agreement.kind === "war" && agreement.status === "active");

  return pressures.filter((pressure) => {
    if (spent.has(pressure.id)) return false;
    const when = pressure.when;
    // A pressure that follows another waits for it. This is what makes a
    // crisis a sequence: Messana asks for a protector, and only once it has
    // asked is "and the other great power will not have it" a thing the age
    // can reach for.
    if (!when.afterPressureIds.every((id) => spent.has(id))) return false;
    if (world.instant.day < when.notBeforeDay) return false;
    if (when.notAfterDay !== null && world.instant.day > when.notAfterDay) return false;
    if (!when.politiesExist.every(exists)) return false;
    if (!when.atWar.every((pair) => atWar(pair.polityId, pair.otherPolityId))) return false;
    if (when.atPeace.some((pair) => atWar(pair.polityId, pair.otherPolityId))) return false;
    return when.polityHolds.every((claim) =>
      claim.provinceIds.every((provinceId) =>
        world.map.provinces.some((province) => province.id === provinceId && province.controllerPolityId === claim.polityId)));
  });
}

// ── The decision ─────────────────────────────────────────────────────────────

/**
 * Days since the last seed before another may be offered. Comfortable reigns
 * wait less.
 *
 * Was 45 down to 18. At that cadence a burst of ninety days carried one or two
 * stirrings, and the record of a season came back as the ruler's own business
 * and almost nothing else -- a world that moves on its own has to move often
 * enough to be noticed doing it.
 */
function cadenceDays(comfort: number, gameId: string, seedCount: number): number {
  return Math.round(lerp(28, 11, comfort)) + (stableHash([gameId, "narrator", "cadence", seedCount]) % 8);
}

function chooseSeverity(comfort: number, gameId: string, seedCount: number): SeedSeverity {
  const table: readonly SeedSeverity[] =
    comfort >= 0.75 ? ["grave", "grave", "serious", "serious", "minor"]
      : comfort >= 0.4 ? ["serious", "serious", "minor"]
        : ["minor", "minor", "serious"];
  return table[stableChoice([gameId, "narrator", "severity", seedCount], table.length)]!;
}

function chooseArchetype(input: NarratorInput, tension: TensionReading, seedCount: number): Archetype | null {
  const atWar = input.ownPolityId !== null && input.world.conflicts.wars.some((war) => war.polityAId === input.ownPolityId || war.polityBId === input.ownPolityId);
  // Past half the ceiling only incidents that run their course; past the
  // ceiling itself, still those. A world following twelve threads is a busy
  // world, not a world where the harvest stops coming in.
  const eligible = ARCHETYPES.filter((archetype) => tension.openThreads < THREAD_CEILING / 2 || archetype.oneShot);
  if (eligible.length === 0) return null;
  const weighted = eligible.map((archetype) => {
    let weight = archetype.weight;
    // Things befall the comfortable; a country at war has enough new enemies.
    //
    // Only new *enemies*, though. This used to halve every `new_actor` and
    // give world events their bonus only to a comfortable reign -- and war
    // drives comfort down, so the moment a war started the table collapsed
    // onto people's private troubles and the record became one man's defence,
    // filed four times running. A country at war is still a country where the
    // harvest comes in, a preacher draws a crowd and a price moves.
    if (archetype.kind === "world_event" && tension.comfort >= 0.75) weight += 3;
    if (archetype.rival === true && atWar) weight = Math.max(1, Math.round(weight / 2));
    // And a war is not a reason to start a second one in the same place.
    if (archetype.needsAdversary === true && atWar) weight = Math.max(1, Math.round(weight / 2));
    return { archetype, weight };
  });
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = stableHash([input.gameId, "narrator", "archetype", seedCount]) % total;
  for (const entry of weighted) {
    if (roll < entry.weight) return entry.archetype;
    roll -= entry.weight;
  }
  return weighted[weighted.length - 1]!.archetype;
}

/** Everything named by the record in the last two months: the busy part of the map. */
function recentlyNamed(facts: readonly Fact[], today: number): Set<string> {
  const named = new Set<string>();
  for (const fact of facts) {
    if (today - fact.atStep > QUIET_WINDOW_DAYS) continue;
    for (const entity of fact.affectedEntities) named.add(entity.id);
  }
  return named;
}

function chooseProvince(input: NarratorInput, tension: TensionReading, seedCount: number, requireController: boolean): WorldState["map"]["provinces"][number] | null {
  const { world } = input;
  const home = landsAtHome(tension.comfort, input.gameId, seedCount);
  const busy = recentlyNamed(input.facts, world.instant.day);
  const garrisoned = new Set(world.material.forces.map((force) => force.locationId));
  const atWar = new Set(world.conflicts.wars.flatMap((war) => [war.polityAId, war.polityBId]));
  // Countries the orchestrator is being asked to people this very call get
  // their leader under rule 6; a stranger arriving at the same moment would be
  // two people invented for one country in one answer.
  const filling = requireController
    ? new Set(findPolityGaps({ world, ownPolityId: input.ownPolityId, facts: input.facts, limit: 2 }).map((gap) => gap.polityId))
    : new Set<string>();

  const cohesionOf = new Map(world.map.polities.map((polity) => [polity.id, polity.cohesionBps]));

  const candidates = world.map.provinces
    .filter((province) => (!requireController || province.controllerPolityId !== null) && !(province.controllerPolityId !== null && filling.has(province.controllerPolityId)))
    .filter((province) => (province.controllerPolityId === input.ownPolityId) === home);
  const scored = (candidates.length === 0 ? world.map.provinces : candidates)
    .map((province) => {
      let score = 0;
      if (!busy.has(province.id) && (province.controllerPolityId === null || !busy.has(province.controllerPolityId))) score += 3;
      if (!garrisoned.has(province.id)) score += 1;
      if (province.controllerPolityId !== null && atWar.has(province.controllerPolityId)) score -= 3;
      // Trouble finds the ground nobody is holding down. A province of a power
      // whose centre does not speak for it is where a rising, a warlord or a
      // prophet has the least standing in its way.
      const cohesion = province.controllerPolityId === null ? 0 : cohesionOf.get(province.controllerPolityId) ?? 10_000;
      if (cohesion < LOOSE_COHESION_BPS) score += 2;
      return { province, score };
    })
    .sort((a, b) => b.score - a.score || a.province.id.localeCompare(b.province.id));
  if (scored.length === 0) return null;
  const top = scored.filter((entry) => entry.score === scored[0]!.score);
  return top[stableChoice([input.gameId, "narrator", "province", seedCount], top.length)]!.province;
}

/**
 * The power on the other side of a border, for trouble that takes two.
 *
 * Adjacency, because a war needs somewhere the two of them can actually reach
 * each other, and the map already stores every crossing as an edge. Powers
 * already at war with this one are skipped -- a second war between the same two
 * is the same war -- and so is a power that holds nothing, which is a power
 * that has already lost.
 */
function chooseAdversary(
  input: NarratorInput,
  provinceId: string,
  polityId: string,
  seedCount: number,
): WorldState["map"]["polities"][number] | null {
  const { world } = input;
  const controllerOf = new Map(world.map.provinces.map((province) => [province.id, province.controllerPolityId]));
  const alreadyFighting = new Set(
    world.conflicts.wars
      .filter((war) => war.polityAId === polityId || war.polityBId === polityId)
      .map((war) => (war.polityAId === polityId ? war.polityBId : war.polityAId)),
  );

  const neighbours = new Set<string>();
  for (const edge of world.map.edges) {
    const side = edge.from === provinceId ? edge.to : edge.to === provinceId ? edge.from : null;
    if (side === null) continue;
    const controller = controllerOf.get(side) ?? null;
    if (controller === null || controller === polityId || alreadyFighting.has(controller)) continue;
    neighbours.add(controller);
  }
  // Nothing across this particular border: take any power that borders the
  // power itself, so an inland province does not make a war impossible.
  if (neighbours.size === 0) {
    const ownProvinceIds = new Set(world.map.provinces.filter((province) => province.controllerPolityId === polityId).map((province) => province.id));
    for (const edge of world.map.edges) {
      const outward = ownProvinceIds.has(edge.from) ? edge.to : ownProvinceIds.has(edge.to) ? edge.from : null;
      if (outward === null) continue;
      const controller = controllerOf.get(outward) ?? null;
      if (controller === null || controller === polityId || alreadyFighting.has(controller)) continue;
      neighbours.add(controller);
    }
  }
  if (neighbours.size === 0) return null;

  const candidates = [...neighbours].sort();
  const picked = candidates[stableChoice([input.gameId, "narrator", "adversary", seedCount], candidates.length)]!;
  return world.map.polities.find((polity) => polity.id === picked) ?? null;
}

function chooseCharacter(input: NarratorInput, tension: TensionReading, seedCount: number, archetype: Archetype): WorldState["characters"][number] | null {
  const { world } = input;
  const home = landsAtHome(tension.comfort, input.gameId, seedCount);
  const commanders = new Set(world.material.forces.map((force) => force.commanderCharacterId));
  const inThreads = new Set(openStorylines(world.storylines).flatMap((storyline) => storyline.participantIds));
  const eligible = world.characters
    .filter((character) => character.alive && character.id !== input.playerCharacterId)
    .filter((character) => character.officeId !== null || commanders.has(character.id) || inThreads.has(character.id));
  const side = eligible.filter((character) => (character.polityId === input.ownPolityId) === home);
  const scored = (side.length === 0 ? eligible : side)
    .map((character) => {
      let score = 0;
      const pressures = world.characterPressures.filter((pressure) => pressure.characterId === character.id && pressure.status === "active").length;
      if (pressures >= 3) score -= 2;
      // A plotter is someone with the temperament for it and the means.
      if (archetype.name === "conspiracy") {
        const mind = character.mind;
        if (mind.temperament.honesty <= 35 || mind.drives.status >= 60 || mind.drives.wealth >= 60) score += 2;
        if (mind.riskTolerance >= 50) score += 1;
      }
      return { character, score };
    })
    .sort((a, b) => b.score - a.score || a.character.id.localeCompare(b.character.id));
  if (scored.length === 0) return null;
  const top = scored.filter((entry) => entry.score === scored[0]!.score);
  return top[stableChoice([input.gameId, "narrator", "character", seedCount], top.length)]!.character;
}

/**
 * Whether something stirs this burst, and what.
 *
 * Null most of the time: the cadence has not run, the world is following too
 * many threads already, or nothing on the map fits. Called once per burst,
 * before the orchestrator, which is what caps it at one seed per order.
 */
export function decideNarratorSeed(input: NarratorInput): NarratorSeed | null {
  const tension = readTension(input.world, input.ownPolityId);
  if (!cadenceHasRun(input, tension)) return null;
  const ledger = input.world.narrator;
  return seedAt(input, tension, ledger.seedCount, !ledger.consumed && ledger.lastSeedKey !== null, new Set());
}

/**
 * Everything that stirs this burst, not merely the one thing.
 *
 * A burst covers a season, and for a long time it carried exactly one seed --
 * so a record of three months came back with two entries, both of them the
 * player's own business, and the world it was supposed to be set in did
 * nothing at all. The count is the span since the world last stirred, at
 * roughly one stirring per ten days: three in an ordinary month, more after a
 * long silence, never more than a handful, because a prompt carrying nine
 * briefs gets none of them done properly.
 *
 * Distinct ordinals, so each is a different archetype in a different place;
 * the cadence gate is asked once, for the batch.
 */
export function decideNarratorSeeds(input: NarratorInput): NarratorSeed[] {
  const tension = readTension(input.world, input.ownPolityId);
  if (!cadenceHasRun(input, tension)) return [];
  const ledger = input.world.narrator;

  // The season ahead, or the silence behind, whichever is longer.
  const since = ledger.lastSeedDay === null ? SEED_EVERY_DAYS * MIN_SEEDS_PER_BURST : input.world.instant.day - ledger.lastSeedDay;
  const horizon = Math.max(since, input.spanDays ?? 0);
  const wanted = Math.max(MIN_SEEDS_PER_BURST, Math.min(MAX_SEEDS_PER_BURST, Math.round(horizon / SEED_EVERY_DAYS)));

  const seeds: NarratorSeed[] = [];
  const keys = new Set<string>();
  const taken = new Set<string>();
  for (let index = 0; index < wanted; index += 1) {
    // Only the first carries the repeat: a batch of six re-offered whole
    // because one of them went unread would be the same month twice.
    const repeated = index === 0 && !ledger.consumed && ledger.lastSeedKey !== null;
    const seed = seedAt(input, tension, ledger.seedCount + index, repeated, taken);
    if (seed === null) continue;
    if (keys.has(seed.key)) continue;
    keys.add(seed.key);
    // The ledger is not written until the whole batch has been offered, so
    // without this the same pressure is reachable twice in one season -- and a
    // chain whose second link waits on the first would be handed both at once.
    if (seed.pressureId !== null) taken.add(seed.pressureId);
    seeds.push(seed);
  }
  return seeds;
}

/** One stirring per this many days: three in a month. */
const SEED_EVERY_DAYS = 10;
const MIN_SEEDS_PER_BURST = 3;
const MAX_SEEDS_PER_BURST = 6;

/**
 * Whether the world is due to stir at all.
 *
 * The thread ceiling no longer silences it outright: past the ceiling only
 * incidents that run their course are eligible (`chooseArchetype`), and a
 * world already following twelve threads is still a world where the harvest
 * comes in and the price of grain moves.
 */
function cadenceHasRun(input: NarratorInput, tension: TensionReading): boolean {
  const { world } = input;
  const ledger = world.narrator;
  // A seed offered and not taken up is offered once more, then dropped. Same
  // ordinal, so the same key: the orchestrator is being asked the same thing.
  if (!ledger.consumed && ledger.lastSeedKey !== null) return true;
  const gap = cadenceDays(tension.comfort, input.gameId, ledger.seedCount);
  // A fresh world waits half a cadence before its first stirring: the
  // opening orders are the ruler's, not the world's.
  const since = ledger.lastSeedDay === null ? world.instant.day + Math.floor(gap / 2) : world.instant.day - ledger.lastSeedDay;
  // Plus the season this burst is about to cover. `lastSeedDay` records the
  // far end of what the last batch covered, so this asks the only question
  // that matters: does the world run past the end of its last stirrings
  // before this order is done?
  return since + (input.spanDays ?? 0) >= gap;
}

/** The seed at one ordinal. Every choice in it hashes on that ordinal and nothing else. */
function seedAt(input: NarratorInput, tension: TensionReading, seedCount: number, repeated: boolean, alreadyTaken: ReadonlySet<string>): NarratorSeed | null {
  const { world } = input;

  // What the age is pulling toward, where the world still looks like it. These
  // compete with the ordinary archetypes on the same weights rather than
  // pre-empting them: a pressure is a heavier-than-usual candidate, never a
  // scheduled event, so a reign can run its whole course and meet none of them.
  const live = livePressures(world, input.pressures ?? []).filter((pressure) => !alreadyTaken.has(pressure.id));
  const liveWeight = live.reduce((sum, pressure) => sum + pressure.weight, 0);
  if (liveWeight > 0 && stableChoice([input.gameId, "narrator", "pressure", seedCount], liveWeight + ORDINARY_TROUBLE_WEIGHT) < liveWeight) {
    let roll = stableHash([input.gameId, "narrator", "which-pressure", seedCount]) % liveWeight;
    const chosen = live.find((pressure) => (roll -= pressure.weight) < 0) ?? live[live.length - 1]!;
    const seed = seedFromPressure(world, chosen, input, seedCount);
    if (seed !== null) return seed;
  }

  const archetype = chooseArchetype(input, tension, seedCount);
  if (archetype === null) return null;
  const severity = chooseSeverity(tension.comfort, input.gameId, seedCount);
  const secret = archetype.secretTwelfths > 0 && stableChoice([input.gameId, "narrator", "secret", seedCount], 12) < archetype.secretTwelfths;

  const provinceName = (id: string | null): string | null => (id === null ? null : world.map.provinces.find((province) => province.id === id)?.name ?? id);
  const polityName = (id: string | null): string | null => (id === null ? null : world.map.polities.find((polity) => polity.id === id)?.name ?? id);

  let target: NarratorSeed["target"];
  if (archetype.kind === "person_problem") {
    const character = chooseCharacter(input, tension, seedCount, archetype);
    if (character === null) return null;
    const controller = world.map.provinces.find((province) => province.id === character.locationProvinceId)?.controllerPolityId ?? character.polityId;
    target = {
      provinceId: character.locationProvinceId, provinceName: provinceName(character.locationProvinceId),
      polityId: character.polityId, polityName: polityName(character.polityId ?? controller),
      characterId: character.id, characterName: character.name,
      otherPolityId: null, otherPolityName: null,
    };
  } else {
    const province = chooseProvince(input, tension, seedCount, archetype.kind === "new_actor" || archetype.needsAdversary === true);
    if (province === null) return null;
    // Trouble that takes two is not offered at all where the map has only one
    // to offer: an island power with no reachable neighbour cannot go to war
    // with anybody, and a brief naming "null" would be carried out anyway.
    const adversary = archetype.needsAdversary !== true || province.controllerPolityId === null
      ? null
      : chooseAdversary(input, province.id, province.controllerPolityId, seedCount);
    if (archetype.needsAdversary === true && adversary === null) return null;
    target = {
      provinceId: province.id, provinceName: province.name,
      polityId: province.controllerPolityId, polityName: polityName(province.controllerPolityId),
      characterId: null, characterName: null,
      otherPolityId: adversary?.id ?? null, otherPolityName: adversary?.name ?? null,
    };
  }

  const key = `seed-${stableHash([input.gameId, "narrator", seedCount]).toString(36)}`;
  const inPlayerRealm = target.polityId !== null && target.polityId === input.ownPolityId;
  return {
    key,
    kind: archetype.kind,
    archetype: archetype.name,
    severity,
    secret,
    oneShot: archetype.oneShot,
    target,
    inPlayerRealm,
    repeated,
    why: `The world has been quiet ${inPlayerRealm ? "at home" : "there"} for a while: ${tension.summary}.`,
    brief: archetype.brief(target, severity),
    pressureId: null,
  };
}

/**
 * How heavily the ordinary run of trouble pulls against the age's own.
 *
 * Set so that a scenario with a couple of live pressures reaches for one
 * perhaps a third of the time: often enough that the period has a grain,
 * rarely enough that most of what happens is still nobody's plan.
 */
const ORDINARY_TROUBLE_WEIGHT = 40;

/** A seed carrying the age's own shape, targeted where the pressure says. */
function seedFromPressure(world: WorldState, pressure: ScenarioHistoricalPressure, input: NarratorInput, seedCount: number): NarratorSeed | null {
  const province = pressure.target.provinceId === null ? undefined : world.map.provinces.find((candidate) => candidate.id === pressure.target.provinceId);
  const polityId = pressure.target.polityId ?? province?.controllerPolityId ?? null;
  const polity = polityId === null ? undefined : world.map.polities.find((candidate) => candidate.id === polityId);
  const other = pressure.target.otherPolityId === null ? undefined : world.map.polities.find((candidate) => candidate.id === pressure.target.otherPolityId);
  if (pressure.kind !== "person_problem" && province === undefined && polity === undefined) return null;

  return {
    key: `seed-${stableHash([input.gameId, "narrator", seedCount]).toString(36)}`,
    kind: pressure.kind,
    archetype: pressure.id,
    severity: pressure.severity,
    secret: pressure.secret,
    oneShot: pressure.oneShot,
    target: {
      provinceId: province?.id ?? null,
      provinceName: province?.name ?? null,
      polityId: polity?.id ?? null,
      polityName: polity?.name ?? null,
      characterId: null,
      characterName: null,
      otherPolityId: other?.id ?? null,
      otherPolityName: other?.name ?? null,
    },
    inPlayerRealm: polityId !== null && polityId === input.ownPolityId,
    repeated: false,
    why: `The age has been pulling this way: ${pressure.label}.`,
    brief: pressure.brief,
    pressureId: pressure.id,
  };
}

/** The ledger, once a seed has been put to the orchestrator. */
export function recordSeedOffered(world: WorldState, seed: NarratorSeed): WorldState {
  return {
    ...world,
    narrator: {
      ...world.narrator,
      lastSeedDay: world.instant.day,
      lastSeedKey: seed.key,
      consumed: false,
      // Spent on being offered, not on being taken up. A pressure the world
      // declined to act on is one the age pulled toward and did not get;
      // offering it again until it lands is what makes a rail.
      spentPressureIds: seed.pressureId === null
        ? world.narrator.spentPressureIds
        : [...world.narrator.spentPressureIds, seed.pressureId].slice(-200),
    },
  };
}

/**
 * The ledger, once a whole burst's worth of stirrings has been put to the
 * orchestrator.
 *
 * Unlike the single-seed path this never leaves a seed pending. The repeat --
 * offer it once more, then drop it -- existed because one seed a month was
 * precious and losing it to a distracted answer cost the world its only
 * movement. With three to six a month an ignored one is simply replaced by
 * next month's, and re-offering a batch of six because one of them went
 * unread would be the same season narrated twice.
 */
export function recordSeedsOffered(world: WorldState, seeds: readonly NarratorSeed[], throughDay?: number): WorldState {
  if (seeds.length === 0) return world;
  const spent = seeds.map((seed) => seed.pressureId).filter((id): id is string => id !== null);
  return {
    ...world,
    narrator: {
      ...world.narrator,
      // The day this batch *covers to*, not the day it was decided. A batch
      // sized for a season is that season's stirrings, and the next burst
      // measures its silence from the far end of it -- otherwise an order
      // answered the same afternoon would stir the same months again.
      lastSeedDay: Math.max(world.instant.day, throughDay ?? world.instant.day),
      lastSeedKey: seeds[0]!.key,
      seedCount: world.narrator.seedCount + seeds.length,
      consumed: true,
      // Spent on being offered, not on being taken up. A pressure the world
      // declined to act on is one the age pulled toward and did not get;
      // offering it again until it lands is what makes a rail.
      spentPressureIds: [...world.narrator.spentPressureIds, ...spent].slice(-200),
    },
  };
}

/**
 * Whether the orchestrator took the seed up: a thread opened under its key,
 * or -- for an incident that runs its course -- a fact naming its target.
 */
export function seedWasTaken(world: WorldState, facts: readonly Fact[], seed: NarratorSeed): boolean {
  if (world.storylines.some((storyline) => storyline.seedKey === seed.key)) return true;
  const targetIds = new Set([seed.target.characterId, seed.target.provinceId].filter((id): id is string => id !== null));
  return facts.some((fact) => fact.affectedEntities.some((entity) => targetIds.has(entity.id)));
}

/**
 * The ledger, once the orchestrator has answered. A seed taken up is done; one
 * ignored twice is dropped so the world can move on to the next.
 */
export function recordSeedOutcome(world: WorldState, seed: NarratorSeed, taken: boolean): WorldState {
  const ledger = world.narrator;
  if (taken) return { ...world, narrator: { ...ledger, consumed: true, seedCount: ledger.seedCount + 1 } };
  if (seed.repeated) return { ...world, narrator: { ...ledger, consumed: true, seedCount: ledger.seedCount + 1 } };
  return world;
}

/** The people a seed's thread put in play this burst -- who should be asked what they do about it now. */
export function seedParticipants(world: WorldState, seed: NarratorSeed): string[] {
  const opened = world.storylines.find((storyline) => storyline.seedKey === seed.key);
  if (opened !== undefined) return [...opened.participantIds];
  return seed.target.characterId === null ? [] : [seed.target.characterId];
}
