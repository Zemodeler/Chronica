import {
  openStorylines,
  stableChoice,
  stableHash,
  type Fact,
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
  };
  readonly inPlayerRealm: boolean;
  /** Offered once before and not taken up. */
  readonly repeated: boolean;
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
  readonly brief: (target: NarratorSeed["target"], severity: SeedSeverity) => string;
}

const magnitude = (severity: SeedSeverity, minor: string, serious: string, grave: string): string =>
  severity === "minor" ? minor : severity === "serious" ? serious : grave;

const person = (target: NarratorSeed["target"]): string => `${target.characterName} [${target.characterId}]`;
const place = (target: NarratorSeed["target"]): string => `${target.provinceName} [${target.provinceId}]`;
const power = (target: NarratorSeed["target"]): string => `${target.polityName} [${target.polityId}]`;

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

  { kind: "new_actor", name: "pirate_band", weight: 8, oneShot: false, secretTwelfths: 0,
    brief: (t, s) => `A pirate squadron has appeared off ${place(t)}: ${magnitude(s, "a few hulls preying on coasters", "a fleet strong enough to close the strait", "a pirate king with a harbour of his own")}. ${
      s === "grave"
        ? `A pirate king with a harbour is a power: create them with "polity_create" taking ${place(t)} from ${power(t)}, with their captain under it.`
        : `Create their captain with "character_create" and their ships with "force_create" under ${power(t)} -- raiders who hold no ground are not a country.`
    } Record their arrival as a public fact, and give them a "character_intent_set". Their arrival is news; their existence is not, and gets no fact of its own.` },
  { kind: "new_actor", name: "pretender", weight: 6, oneShot: false, secretTwelfths: 7,
    brief: (t, s) => `A claimant has appeared in ${place(t)}: ${magnitude(s, "an exile with a grievance and a few followers", "a pretender with money behind him", "a rival for the rule of the whole power")}. Create them with "character_create" under ${power(t)} -- a claimant wants the power that exists, not a new one, so do not found a country for them -- record their appearance as a fact, and plant what they mean to do with "character_intent_set". Their arrival is news; their existence is not.` },
  { kind: "new_actor", name: "cult", weight: 6, oneShot: false, secretTwelfths: 7,
    brief: (t, s) => `A prophet is drawing crowds in ${place(t)}: ${magnitude(s, "a preacher the magistrates are watching", "a movement with followers in every town", "a faith that answers to nobody but its leader")}. Create the leader with "character_create" under ${power(t)} and the movement with "generic_entity_create" (kind "faction"), record the stir as a fact, and plant what they mean to do with "character_intent_set".` },
];

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
  const eligible = ARCHETYPES.filter((archetype) => tension.openThreads < THREAD_CEILING / 2 || archetype.oneShot);
  if (eligible.length === 0) return null;
  const weighted = eligible.map((archetype) => {
    let weight = archetype.weight;
    // Things befall the comfortable; a country at war has enough new enemies.
    if (archetype.kind === "world_event" && tension.comfort >= 0.75) weight += 3;
    if (archetype.kind === "new_actor" && atWar) weight = Math.max(1, Math.round(weight / 2));
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

  const candidates = world.map.provinces
    .filter((province) => (!requireController || province.controllerPolityId !== null) && !(province.controllerPolityId !== null && filling.has(province.controllerPolityId)))
    .filter((province) => (province.controllerPolityId === input.ownPolityId) === home);
  const scored = (candidates.length === 0 ? world.map.provinces : candidates)
    .map((province) => {
      let score = 0;
      if (!busy.has(province.id) && (province.controllerPolityId === null || !busy.has(province.controllerPolityId))) score += 3;
      if (!garrisoned.has(province.id)) score += 1;
      if (province.controllerPolityId !== null && atWar.has(province.controllerPolityId)) score -= 3;
      return { province, score };
    })
    .sort((a, b) => b.score - a.score || a.province.id.localeCompare(b.province.id));
  if (scored.length === 0) return null;
  const top = scored.filter((entry) => entry.score === scored[0]!.score);
  return top[stableChoice([input.gameId, "narrator", "province", seedCount], top.length)]!.province;
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
  const { world } = input;
  const ledger = world.narrator;
  const tension = readTension(world, input.ownPolityId);
  if (tension.openThreads >= THREAD_CEILING) return null;

  // A seed offered and not taken up is offered once more, then dropped. Same
  // ordinal, so the same key: the orchestrator is being asked the same thing.
  const repeated = !ledger.consumed && ledger.lastSeedKey !== null;
  if (!repeated) {
    const gap = cadenceDays(tension.comfort, input.gameId, ledger.seedCount);
    // A fresh world waits half a cadence before its first stirring: the
    // opening orders are the ruler's, not the world's.
    const since = ledger.lastSeedDay === null ? world.instant.day + Math.floor(gap / 2) : world.instant.day - ledger.lastSeedDay;
    if (since < gap) return null;
  }

  const seedCount = ledger.seedCount;
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
    };
  } else {
    const province = chooseProvince(input, tension, seedCount, archetype.kind === "new_actor");
    if (province === null) return null;
    target = {
      provinceId: province.id, provinceName: province.name,
      polityId: province.controllerPolityId, polityName: polityName(province.controllerPolityId),
      characterId: null, characterName: null,
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
  };
}

/** The ledger, once a seed has been put to the orchestrator. */
export function recordSeedOffered(world: WorldState, seed: NarratorSeed): WorldState {
  return { ...world, narrator: { ...world.narrator, lastSeedDay: world.instant.day, lastSeedKey: seed.key, consumed: false } };
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
