import {
  LOOSE_COHESION_BPS,
  agreementsBetween,
  deriveRelationDimension,
  familyLinksOf,
  isNavalForce,
  openStorylines,
  stableChoice,
  stableHash,
  type Fact,
  type FactProposalDraft,
  type WorldDelta,
  type ScenarioHistoricalPressure,
  type ScenarioWarfareRules,
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
    /**
     * The army or fleet this befalls, where it befalls one.
     *
     * Trouble could land on a province, a power or a person and on nothing
     * else, so nothing the world did of its own accord could ever touch an
     * army -- and `chooseProvince` scores ground *without* a garrison higher,
     * so it actively steered around them. Disease, storms and hunger have
     * always killed more soldiers than fighting has, and none of it could
     * happen here.
     */
    readonly forceId: string | null;
    readonly forceName: string | null;
    /** What the force is: an army or a fleet, so a brief can say which. */
    readonly forceIsNaval: boolean;
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
  /**
   * The scenario's rules of war, which are what say a fleet from an army.
   * Left out, nothing is naval and a storm at sea is never offered.
   */
  readonly warfare?: ScenarioWarfareRules | undefined;
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
  const ownForces = world.material.forces.filter((force) => force.polityId === ownPolityId && force.outlaw !== true);
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
  /** Befalls an army or a fleet, and is not offered when there is none to befall. */
  readonly needsForce?: boolean;
  /**
   * Happens off a coast, and is not offered inland. A live run sank a grain
   * fleet "off Hunedoara", in the Carpathians: the storm could land on any
   * province, and the terrain could not tell -- the map calls most of Europe
   * a coastal plain. The sea crossings and the ports can.
   */
  readonly needsCoast?: boolean;
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
const host = (target: NarratorSeed["target"]): string => `${target.forceName} [${target.forceId}]`;

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
  { kind: "world_event", name: "grain_fleet_lost", weight: 8, oneShot: true, secretTwelfths: 0, needsCoast: true,
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

  // ── The rest of what a reign is made of ────────────────────────────────
  //
  // Widening the deck, so a long reign does not learn its shape. These ask for
  // nothing the engine could not already do; they ask for it about things the
  // table had no entry for -- the law, the roads, the gods, a frontier, and
  // somebody's good name.
  { kind: "person_problem", name: "accusation", weight: 7, oneShot: false, secretTwelfths: 0,
    brief: (t, s) => `${person(t)} stands accused: ${magnitude(s, "a rumour that will not quite die", "a charge somebody means to press", "an accusation that will have to be answered before a court or a council")}. Decide what of, and whether it is true -- if it is, the act itself is a private fact known to them. ${s === "minor" ? "" : 'Open it with "political_procedure_open" where there is a body to hear it, and let people take sides with "political_support_set". '}${PERSON_PROBLEM_TAIL}` },
  { kind: "person_problem", name: "inheritance", weight: 5, oneShot: true, secretTwelfths: 0,
    brief: (t, s) => `Property has come to ${person(t)}: ${magnitude(s, "a modest legacy", "an estate worth having, and a cousin who disputes it", "a fortune, and everybody who ever knew the dead man at the door")}. Move the money with "money_transfer" into their own purse, name the other claimant from PEOPLE or create them, and let it change what they can afford to do. ${PERSON_PROBLEM_TAIL}` },
  { kind: "world_event", name: "border_raid", weight: 8, oneShot: false, secretTwelfths: 0, needsAdversary: true,
    brief: (t, s) => `Raiders out of ${other(t)} have come over the border into ${place(t)}: ${magnitude(s, "cattle driven off and a farm burned", "a season's harvest taken and villages emptied", "a raid in force, with the countryside stripped and people carried off")}. This is not a war and does not open one: no government ordered it, and ${power(t)} must decide whether to treat it as an act of ${other(t)} or as brigandage. Move the province with "province_material_shift", record it as a public fact naming both powers and the province, and put it on whoever holds that frontier with "character_pressure_set".` },
  { kind: "world_event", name: "fire", weight: 6, oneShot: true, secretTwelfths: 0,
    brief: (t, s) => `Fire has taken part of ${place(t)}: ${magnitude(s, "a street of workshops", "a quarter of the city, granaries with it", "the heart of the place, and the records in it")}. Decide what burned and whether anybody is blamed for it. Move the province with "province_material_shift", record it as a public fact naming the province, and where a public building goes up again make it a project with "project_create".` },
  { kind: "world_event", name: "sacrilege", weight: 5, oneShot: false, secretTwelfths: 0,
    brief: (t, s) => `Something has gone wrong with the rites at ${place(t)}: ${magnitude(s, "an offering refused or a festival botched", "a temple robbed, or a priest accused of selling the office", "a sacrilege the whole province believes will be answered for")}. Decide what was done and who is held responsible. A public fact naming the province; "belief_set" on those who take it hard; a "legitimacy_shift" against whoever is blamed, and a "political_procedure_open" where a priesthood must rule on it.` },
  { kind: "world_event", name: "road_or_pass", weight: 5, oneShot: true, secretTwelfths: 0,
    brief: (t, s) => `The way through ${place(t)} has changed: ${magnitude(s, "a bridge down and a ford in use instead", "a pass shut by weather or by men, and the traffic going round", "the route closed for the season, and everything that moved on it stopped")}. Decide what closed it. Record it as a public fact naming the province, cut what no longer arrives with "income_source_upsert", and move the province that went without with "province_material_shift".` },
  { kind: "new_actor", name: "envoy", weight: 6, oneShot: false, secretTwelfths: 0, needsAdversary: true,
    brief: (t, s) => `${other(t)} has sent to ${power(t)} over ${place(t)}: ${magnitude(s, "a herald with a complaint", "an embassy with terms", "an ultimatum, and a date by which it expects an answer")}. Create the envoy with "character_create" under ${other(t)} if nobody suitable exists, and send the letter itself with "diplomatic_message_send" -- what is actually being proposed goes in "terms", and how long they will wait in the days. Do not answer it: the answer belongs to whoever receives it. Record the arrival as a public fact naming both powers.` },

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
  // The harvest is not drawn: it comes in every year in its month, rolled by the engine (`economy.ts`).
  { kind: "world_event", name: "games", weight: 6, oneShot: true, secretTwelfths: 0,
    brief: (t, s) => `${place(t)} is holding ${magnitude(s, "its usual festival", "games somebody paid a great deal for", "a spectacle the whole province has come in for")}. Decide who paid and what they got for it: a public fact naming the province, a "legitimacy_shift" or a "social_events" entry for whoever's name is on it, and a "province_material_shift" if the city is the better for it. Somebody's standing is bought here, cheaply or dearly.` },
  { kind: "world_event", name: "building", weight: 6, oneShot: true, secretTwelfths: 0,
    brief: (t, s) => `Work has finished in ${place(t)}: ${magnitude(s, "a cistern, a granary, a length of road", "a temple or a harbour mole", "a work the province will be known for")}. Decide what it is and whose name is on it. Record it as a public fact naming the province, move the province with "province_material_shift", and put the credit somewhere with "social_events" or a "legitimacy_shift".` },
  { kind: "world_event", name: "market", weight: 6, oneShot: true, secretTwelfths: 0,
    brief: (t, s) => `The price of something has moved in ${place(t)}: ${magnitude(s, "grain up a little and the bakers complaining", "silver or grain moving enough that fortunes turn on it", "a shortage the magistrates cannot talk their way out of")}. Decide what and why. Record it as a public fact naming the province, and move what it actually changes -- "income_source_upsert" for a trade that now pays differently, "province_material_shift" for a city going hungry, "money_transfer" for somebody who saw it coming.` },
  { kind: "world_event", name: "strangers", weight: 5, oneShot: true, secretTwelfths: 0,
    brief: (t, s) => `Strangers have come to ${place(t)}: ${magnitude(s, "a caravan from further off than usual", "a party of exiles asking to be let in", "a people on the move, with their carts and their herds")}. Decide who they are and how they are received. A public fact naming the province; "belief_set" for what the province makes of them; "province_material_shift" if they are fed or turned away.` },

  // ── What happens to armies ─────────────────────────────────────────────
  //
  // None of this could happen before: trouble had no way to name a force, and
  // the ground-picker preferred provinces with no garrison in them. Hunger,
  // camp fever and storms at sea are the engine's now (`campaign.ts`,
  // `crossings.ts`): arithmetic on the season and the ground, not a story the
  // model is asked to tell. What is left here asks somebody to decide.
  { kind: "world_event", name: "mutiny", weight: 6, oneShot: false, secretTwelfths: 0, needsForce: true,
    brief: (t, s) => `${host(t)} at ${place(t)} has turned on its own discipline: ${magnitude(s, "an officer defied in front of the men", "companies refusing to march until they are paid", "the camp in open mutiny, with a ringleader")}. Decide what they want -- their arrears are the usual answer, and PAY tells you whether they are owed. Lower their morale with "force_modify"; ${s === "grave" ? `create the ringleader with "character_create" and give him a "character_intent_set", and take the men who walk away with "force_attrition" (cause "desertion").` : `put it on their commander with "character_pressure_set".`} Record it as a fact naming the force and its commander.` },

  { kind: "new_actor", name: "cult", weight: 6, oneShot: false, secretTwelfths: 7,
    brief: (t, s) => `A prophet is drawing crowds in ${place(t)}: ${magnitude(s, "a preacher the magistrates are watching", "a movement with followers in every town", "a faith that answers to nobody but its leader")}. Create the leader with "character_create" under ${power(t)} and the movement with "generic_entity_create" (kind "faction"), record the stir as a fact, and plant what they mean to do with "character_intent_set".` },
];


/** The forces of these powers with men standing in the province: who has actually arrived. */
function standingIn(world: WorldState, polityIds: readonly string[], provinceId: string): WorldState["material"]["forces"][number][] {
  return world.material.forces.filter((force) => polityIds.includes(force.polityId)
    && force.locationId === provinceId
    && force.personnel.some((category) => category.fit > 0));
}

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
    if (!when.forcesPresent.every((presence) => standingIn(world, presence.polityIds, presence.provinceId).length > 0)) return false;
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

function chooseProvince(input: NarratorInput, tension: TensionReading, seedCount: number, requireController: boolean, requireCoast = false): WorldState["map"]["provinces"][number] | null {
  const { world } = input;
  const coastal = requireCoast ? coastalProvinceIds(world) : null;
  const home = landsAtHome(tension.comfort, input.gameId, seedCount);
  const busy = recentlyNamed(input.facts, world.instant.day);
  const garrisoned = new Set(world.material.forces.map((force) => force.locationId));
  const atWar = new Set(world.conflicts.wars.flatMap((war) => [war.polityAId, war.polityBId]));
  // Countries the orchestrator is being asked to people this very call get
  // their leader under the principle that countries are full of people; a stranger arriving at the same moment would be
  // two people invented for one country in one answer.
  const filling = requireController
    ? new Set(findPolityGaps({ world, ownPolityId: input.ownPolityId, facts: input.facts, limit: 2 }).map((gap) => gap.polityId))
    : new Set<string>();

  const cohesionOf = new Map(world.map.polities.map((polity) => [polity.id, polity.cohesionBps]));

  const possible = coastal === null ? world.map.provinces : world.map.provinces.filter((province) => coastal.has(province.id));
  // Nowhere a storm could reach is nowhere it happens.
  if (possible.length === 0) return null;
  const candidates = possible
    .filter((province) => (!requireController || province.controllerPolityId !== null) && !(province.controllerPolityId !== null && filling.has(province.controllerPolityId)))
    .filter((province) => (province.controllerPolityId === input.ownPolityId) === home);
  const scored = (candidates.length === 0 ? possible : candidates)
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

/** Whether this force fights at sea, by the scenario's own reckoning. */
const isNaval = (force: WorldState["material"]["forces"][number], input: NarratorInput): boolean =>
  isNavalForce(force, input.warfare);

/**
 * The army or fleet something happens to.
 *
 * Trouble prefers the force least able to shrug it off -- far from home, badly
 * fed, already unpaid, already unhappy -- because that is where sickness and
 * hunger actually take hold, and because it is where the player has something
 * to decide. The exact opposite of `chooseProvince`, which steers around
 * garrisons: this is looking for them.
 */
function chooseForce(
  input: NarratorInput,
  tension: TensionReading,
  seedCount: number,
): WorldState["material"]["forces"][number] | null {
  const { world } = input;
  const busy = recentlyNamed(input.facts, world.instant.day);
  const home = landsAtHome(tension.comfort, input.gameId, seedCount);

  const eligible = world.material.forces
    .filter((force) => force.personnel.reduce((sum, category) => sum + category.fit, 0) > 0);
  if (eligible.length === 0) return null;

  const side = eligible.filter((force) => (force.polityId === input.ownPolityId) === home);
  const scored = (side.length === 0 ? eligible : side)
    .map((force) => {
      let score = 0;
      if (force.provisionStatus === "critical") score += 3;
      else if (force.provisionStatus === "shortage") score += 2;
      if (force.payArrearsPeriods > 0) score += 2;
      if (force.moraleBps < 5_000) score += 2;
      // Away from its own country is where a camp gets into trouble and stays
      // in it: nobody nearby is obliged to feed it.
      const province = world.map.provinces.find((candidate) => candidate.id === force.locationId);
      if (province !== undefined && province.controllerPolityId !== force.polityId) score += 2;
      // And not the thing everybody is already talking about.
      if (!busy.has(force.id)) score += 1;
      return { force, score };
    })
    .sort((a, b) => b.score - a.score || a.force.id.localeCompare(b.force.id));

  const top = scored.filter((entry) => entry.score === scored[0]!.score);
  return top[stableChoice([input.gameId, "narrator", "force", seedCount], top.length)]!.force;
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
  // The player's own troubles, beside the country's: measured on him, and
  // landing on him and the people around him. Taken out of the same count, so
  // a season is no busier than it was.
  const personal = input.playerCharacterId === null ? [] : personalSeeds(input, ledger.seedCount + wanted, Math.max(1, Math.round(wanted / 3)));
  for (let index = 0; index < wanted - personal.length; index += 1) {
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
  return [...seeds, ...personal];
}

// ── The player's own life ────────────────────────────────────────────────────

/**
 * How comfortable the player is, as a person.
 *
 * The country's comfort is not his. A private citizen of a rich republic was
 * handed trouble sized to its treasury, and none of it ever named him: the
 * narrator never targeted the player at all. This reads what is his -- his
 * purse and its debts, his health, his standing, the people who hate him --
 * and, like the country's reading, makes more and worse trouble for a man
 * whose life is going well.
 */
export function readPersonalTension(world: WorldState, playerCharacterId: string): TensionReading {
  const player = world.characters.find((character) => character.id === playerCharacterId);
  const purse = world.material.accounts.find((account) => account.id === player?.personalAccountId);
  const obligations = world.material.obligations.filter((obligation) => obligation.active && obligation.payerAccountId === purse?.id);
  const monthly = obligations.reduce((sum, obligation) => sum + (obligation.cadenceSteps <= 0 ? 0 : obligation.amount / obligation.cadenceSteps) * 30, 0);
  const balance = purse?.balance ?? 0;
  const runwayMonths = monthly <= 0 ? (balance > 0 ? 6 : 0) : balance / monthly;
  const treasury = clamp01(runwayMonths / 6);
  const missed = obligations.filter((obligation) => obligation.missedPeriods > 0).length
    + world.material.loans.filter((loan) => loan.borrowerAccountId === purse?.id && loan.status === "defaulted").length;
  const arrears = 1 - clamp01(missed / 2);
  const legitimacy = (player?.prestigeBps ?? 3_000) / 10_000;
  const order = (player?.healthBps ?? 10_000) / 10_000;
  const enemies = world.characters.filter((character) => character.alive && character.id !== playerCharacterId
    && deriveRelationDimension(character, playerCharacterId, "trust") + deriveRelationDimension(character, playerCharacterId, "affection") <= -40).length;
  const war = 1 - clamp01(enemies / 3);
  const comfort = clamp01(0.25 * treasury + 0.15 * arrears + 0.2 * legitimacy + 0.2 * order + 0.2 * war);
  const name = player?.name ?? "he";
  const parts = [
    runwayMonths >= 6 ? `${name}'s purse is full` : runwayMonths >= 2 ? `${name}'s purse holds for now` : `${name}'s purse is nearly empty`,
    missed > 0 ? "his debts are going unpaid" : null,
    order < 0.5 ? "his health is poor" : null,
    enemies > 0 ? `${enemies} ${enemies === 1 ? "man hates" : "men hate"} him` : "nobody wishes him harm",
  ].filter((part): part is string => part !== null);
  return { comfort, treasury, arrears, legitimacy, order, war, openThreads: openStorylines(world.storylines).length, summary: parts.join(", ") };
}

/**
 * The people around a man: his family, those who feel strongly about him
 * either way, and the men under his command. Trouble that lands near him is
 * trouble he has to answer.
 */
function circleOf(world: WorldState, playerCharacterId: string): string[] {
  const circle = new Set<string>();
  for (const link of familyLinksOf(world, playerCharacterId, world.elapsedStep)) circle.add(link.counterpartCharacterId);
  for (const character of world.characters) {
    if (!character.alive || character.id === playerCharacterId) continue;
    const felt = Math.abs(deriveRelationDimension(character, playerCharacterId, "trust")) + Math.abs(deriveRelationDimension(character, playerCharacterId, "affection"));
    if (felt >= 20) circle.add(character.id);
  }
  for (const force of world.material.forces) {
    if (force.commanderCharacterId !== playerCharacterId && force.controllerCharacterId !== playerCharacterId) continue;
    for (const member of force.memberCharacterIds) circle.add(member);
  }
  return [...circle].filter((id) => world.characters.some((character) => character.id === id && character.alive)).sort();
}

/** What can befall a man and his house. The country's plagues and wars are the country's; these are his. */
const PERSONAL_ARCHETYPES = new Set(["debt", "rivalry", "opportunity", "illness", "family_obligation", "accusation", "inheritance", "conspiracy"]);
/** And what can befall the ground he lives off. */
const ESTATE_ARCHETYPES = new Set(["fire", "market"]);

function personalSeeds(input: NarratorInput, firstOrdinal: number, count: number): NarratorSeed[] {
  const { world } = input;
  const playerId = input.playerCharacterId!;
  const player = world.characters.find((character) => character.id === playerId && character.alive);
  if (player === undefined) return [];
  const tension = readPersonalTension(world, playerId);
  const circle = circleOf(world, playerId);
  const ownGround = [...new Set([
    player.locationProvinceId,
    ...world.material.holdings.filter((holding) => holding.legalHolderCharacterId === playerId).map((holding) => holding.territoryId),
  ])].filter((id) => world.map.provinces.some((province) => province.id === id));
  const provinceName = (id: string | null): string | null => (id === null ? null : world.map.provinces.find((province) => province.id === id)?.name ?? id);
  const polityName = (id: string | null): string | null => (id === null ? null : world.map.polities.find((polity) => polity.id === id)?.name ?? id);
  const archetypes = ARCHETYPES.filter((archetype) => PERSONAL_ARCHETYPES.has(archetype.name) || ESTATE_ARCHETYPES.has(archetype.name));
  const total = archetypes.reduce((sum, archetype) => sum + archetype.weight, 0);

  const seeds: NarratorSeed[] = [];
  for (let index = 0; index < count; index += 1) {
    const ordinal = firstOrdinal + index;
    let roll = stableHash([input.gameId, "narrator", "personal", ordinal]) % total;
    const archetype = archetypes.find((candidate) => (roll -= candidate.weight) < 0) ?? archetypes[archetypes.length - 1]!;
    if (seeds.some((seed) => seed.archetype === archetype.name)) continue;
    const severity = chooseSeverity(tension.comfort, input.gameId, ordinal);
    const secret = archetype.secretTwelfths > 0 && stableChoice([input.gameId, "narrator", "personal-secret", ordinal], 12) < archetype.secretTwelfths;
    let target: NarratorSeed["target"];
    let about: string;
    if (ESTATE_ARCHETYPES.has(archetype.name)) {
      const provinceId = ownGround[stableChoice([input.gameId, "narrator", "personal-ground", ordinal], Math.max(1, ownGround.length))] ?? null;
      if (provinceId === null) continue;
      const controller = world.map.provinces.find((province) => province.id === provinceId)?.controllerPolityId ?? null;
      target = {
        provinceId, provinceName: provinceName(provinceId), polityId: controller, polityName: polityName(controller),
        characterId: playerId, characterName: player.name, otherPolityId: null, otherPolityName: null, forceId: null, forceName: null, forceIsNaval: false,
      };
      about = `It touches ${player.name} [${playerId}] and what he lives off there.`;
    } else {
      // Most of it lands on him; some on the people he would have to answer for.
      const onHim = circle.length === 0 || stableChoice([input.gameId, "narrator", "personal-who", ordinal], 5) < 3;
      const whoId = onHim ? playerId : circle[stableChoice([input.gameId, "narrator", "personal-circle", ordinal], circle.length)]!;
      const who = world.characters.find((character) => character.id === whoId)!;
      target = {
        provinceId: who.locationProvinceId, provinceName: provinceName(who.locationProvinceId), polityId: who.polityId, polityName: polityName(who.polityId),
        characterId: who.id, characterName: who.name, otherPolityId: null, otherPolityName: null, forceId: null, forceName: null, forceIsNaval: false,
      };
      about = onHim ? "" : `${who.name} is close to ${player.name} [${playerId}], and it will reach him.`;
    }
    // A conspiracy in his circle is aimed at him, not at the government.
    const brief = archetype.name === "conspiracy" && target.characterId !== playerId
      ? `${target.characterName} [${target.characterId}] has begun something against ${player.name} [${playerId}], and means to keep it hidden. Decide what. Plant what drives them with "character_intent_set" (private), a "character_pressure_set" or a "belief_set", and record what they have already done as a private fact known to them alone. Do not carry out their acts for them.`
      : archetype.brief(target, severity);
    seeds.push({
      key: `seed-p-${stableHash([input.gameId, "narrator", "personal", ordinal]).toString(36)}`,
      kind: archetype.kind,
      archetype: archetype.name,
      severity,
      secret: archetype.name === "conspiracy" ? true : secret,
      oneShot: archetype.oneShot,
      target,
      inPlayerRealm: target.polityId !== null && target.polityId === input.ownPolityId,
      repeated: false,
      why: `Life has been going ${tension.comfort >= 0.6 ? "well" : "hard"} for ${player.name}: ${tension.summary}.`,
      brief: about === "" ? brief : `${brief} ${about}`,
      pressureId: null,
    });
  }
  return seeds;
}

/**
 * One stirring per this many days: two in a month.
 *
 * It was three, and each is several deltas, a fact and a thread in the
 * orchestrator's answer -- written out at the price of output tokens, on
 * every order, beside whatever the player asked for. Two still makes a month
 * in which the world does something of its own; the four the engine can carry
 * out itself (`engineWork`) cost the orchestrator nothing at all.
 */
const SEED_EVERY_DAYS = 15;
const MIN_SEEDS_PER_BURST = 2;
const MAX_SEEDS_PER_BURST = 4;

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

  const noForce = { forceId: null, forceName: null, forceIsNaval: false };

  let target: NarratorSeed["target"];
  if (archetype.needsForce === true) {
    const force = chooseForce(input, tension, seedCount);
    // An army for it to happen to, or it does not happen. A brief naming
    // "null" would be carried out anyway, on nobody.
    if (force === null) return null;
    target = {
      provinceId: force.locationId, provinceName: provinceName(force.locationId),
      polityId: force.polityId, polityName: polityName(force.polityId),
      characterId: force.commanderCharacterId, characterName: world.characters.find((character) => character.id === force.commanderCharacterId)?.name ?? null,
      otherPolityId: null, otherPolityName: null,
      forceId: force.id, forceName: force.name, forceIsNaval: isNaval(force, input),
    };
  } else if (archetype.kind === "person_problem") {
    const character = chooseCharacter(input, tension, seedCount, archetype);
    if (character === null) return null;
    const controller = world.map.provinces.find((province) => province.id === character.locationProvinceId)?.controllerPolityId ?? character.polityId;
    target = {
      provinceId: character.locationProvinceId, provinceName: provinceName(character.locationProvinceId),
      polityId: character.polityId, polityName: polityName(character.polityId ?? controller),
      characterId: character.id, characterName: character.name,
      otherPolityId: null, otherPolityName: null,
      ...noForce,
    };
  } else {
    const province = chooseProvince(input, tension, seedCount, archetype.kind === "new_actor" || archetype.needsAdversary === true, archetype.needsCoast === true);
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
      ...noForce,
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
  // Whose men are standing where the pressure waited for them: the power that
  // moved, which the brief is told rather than left to guess.
  const arrived = pressure.when.forcesPresent.flatMap((presence) => standingIn(world, presence.polityIds, presence.provinceId));
  const mover = arrived[0]?.polityId ?? null;
  const named = [pressure.target.polityId, pressure.target.otherPolityId];
  const polityId = mover ?? pressure.target.polityId ?? province?.controllerPolityId ?? null;
  const otherId = mover !== null && named.includes(mover) ? named.find((id) => id !== null && id !== mover) ?? null : pressure.target.otherPolityId;
  const polity = polityId === null ? undefined : world.map.polities.find((candidate) => candidate.id === polityId);
  const other = otherId === null ? undefined : world.map.polities.find((candidate) => candidate.id === otherId);
  const nameOf = (id: string): string => world.map.polities.find((candidate) => candidate.id === id)?.name ?? id;
  const standing = arrived.length === 0 ? "" : ` Who has actually crossed, which is not yours to choose: ${arrived.map((force) => `${force.name} of ${nameOf(force.polityId)}`).join(", ")}.`;
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
      // A scenario pressure names ground and powers, never a particular army.
      forceId: null,
      forceName: null,
      forceIsNaval: false,
    },
    inPlayerRealm: polityId !== null && polityId === input.ownPolityId,
    repeated: false,
    why: `The age has been pulling this way: ${pressure.label}.`,
    brief: `${pressure.brief}${standing}`,
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

/**
 * The stirrings that are arithmetic and a line of news, done by the engine.
 *
 * A storm that sinks the grain convoy, a street of workshops burned, a pass
 * shut for the season, a good harvest: the brief already named the numbers,
 * and the orchestrator's whole part was to copy them into a
 * "province_material_shift" and write one public sentence -- some hundreds of
 * output tokens on every order, and now and then the wrong province or the
 * wrong sign. Nothing in these asks for a decision. So the engine moves the
 * province and records the news itself, at the top of the burst, and the
 * orchestrator is never shown them. The ones that do ask for a decision --
 * who paid for the games, what the omen means, who is blamed -- stay the
 * model's.
 */
interface EngineWork {
  readonly food?: readonly [number, number, number];
  readonly stability?: readonly [number, number, number];
  readonly productive?: readonly [number, number, number];
  readonly news: (place: string, severity: SeedSeverity, winter: boolean) => string;
  readonly significance: readonly [number, number, number];
}

const ENGINE_WORK: Readonly<Record<string, EngineWork>> = {
  grain_fleet_lost: {
    food: [-400, -900, -1500], stability: [-100, -300, -600], significance: [20, 35, 50],
    news: (place, s) => magnitude(s, `A storm off ${place} took a few grain ships.`, `A storm off ${place} took the season's grain convoy.`, `A storm off ${place} took the grain fleet and the ships that guarded it.`),
  },
  fire: {
    stability: [-200, -500, -900], productive: [-300, -800, -1500], significance: [20, 35, 55],
    news: (place, s) => magnitude(s, `Fire took a street of workshops in ${place}.`, `Fire took a quarter of ${place}, and its granaries with it.`, `Fire took the heart of ${place}, and the records kept there.`),
  },
  road_or_pass: {
    food: [-150, -400, -800], stability: [-100, -250, -500], significance: [15, 25, 40],
    // Closed "for the season" only in the season that closes roads: the same
    // news in July was a road shutting for a winter that was five months off.
    news: (place, s, winter) => magnitude(s, `A bridge came down in ${place}, and traffic went by the ford instead.`, `The pass through ${place} was shut, and the traffic went round.`, winter
      ? `The way through ${place} closed for the season, and everything that moved on it stopped.`
      : `A landslip closed the way through ${place}, and everything that moved on it stopped.`),
  },
};

const bySeverity = (values: readonly [number, number, number] | undefined, severity: SeedSeverity): number | undefined =>
  values === undefined ? undefined : values[severity === "minor" ? 0 : severity === "serious" ? 1 : 2];

/**
 * What the engine does for this seed itself, or null when it is the model's to
 * carry out. Its deltas are the world's own acts; its fact is public news.
 */
export function engineWork(seed: NarratorSeed, winter = false): { readonly deltas: readonly WorldDelta[]; readonly fact: FactProposalDraft } | null {
  const work = ENGINE_WORK[seed.archetype];
  const provinceId = seed.target.provinceId;
  if (work === undefined || provinceId === null || seed.secret) return null;
  const food = bySeverity(work.food, seed.severity);
  const stability = bySeverity(work.stability, seed.severity);
  const productive = bySeverity(work.productive, seed.severity);
  const place = seed.target.provinceName ?? provinceId;
  const news = work.news(place, seed.severity, winter);
  return {
    deltas: [{
      op: "province_material_shift",
      provinceId,
      ...(food === undefined ? {} : { foodSecurityBpsDelta: food }),
      ...(stability === undefined ? {} : { stabilityBpsDelta: stability }),
      ...(productive === undefined ? {} : { productiveCapacityBpsDelta: productive }),
      reason: news,
    }],
    fact: {
      localId: `stirring_${seed.key.replace(/[^a-z0-9_-]/g, "_")}`,
      kind: seed.archetype,
      summary: news,
      affectedRefs: [
        { kind: "province", id: provinceId },
        ...(seed.target.polityId === null ? [] : [{ kind: "polity" as const, id: seed.target.polityId }]),
      ],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      significance: bySeverity(work.significance, seed.severity) ?? 20,
    },
  };
}

/** Provinces on the sea: a sea lane or strait out of them, or a port in them. */
export function coastalProvinceIds(world: WorldState): Set<string> {
  const coastal = new Set<string>();
  for (const edge of world.map.edges) {
    if (edge.crossing !== "sea_lane" && edge.crossing !== "strait") continue;
    coastal.add(edge.from);
    coastal.add(edge.to);
  }
  for (const province of world.map.provinces) {
    if (province.settlements.some((settlement) => settlement.kind === "port")) coastal.add(province.id);
  }
  return coastal;
}
