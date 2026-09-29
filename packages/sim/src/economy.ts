import {
  astronomicalYearOf,
  calendarDateOf,
  calendarYearOf,
  dayOfCalendarDate,
  economyOf,
  polityGrainPriceBps,
  reckonTaxCapacity,
  stableHash,
  type FactProposalDraft,
  type ProvinceMaterial,
  type ProvinceTargets,
  type ScenarioClock,
  type WorldState,
  isQuietGround,
} from "@chronica/shared";

/**
 * The land, reckoned by the calendar (VISION §6, §7).
 *
 * A province's people were counted once, from the size of its towns, and never
 * again: nobody was born, nobody starved, a famine below the hunger line killed
 * no one, the displaced were a number that shrank, and a province's taxes were
 * fixed at half a coin a head whatever had been burned. The harvest was a card
 * the narrator might draw, so a year could pass with none at all.
 *
 * Now, once a month, each province's people grow or fall with how fed and how
 * orderly it is and how much war has taken; the hungry die; people who have
 * fled their homes go to the nearest quiet, fed country, and its taxes are
 * reckoned from the people it has left and what they can make. Once a year, in
 * the harvest month, the harvest comes in -- rolled, so there are droughts and
 * gluts -- and that is what the province eats until the next one.
 *
 * Bounded and simple on purpose: rates of a few in a thousand a month, one
 * roll a province a year, no market. Grain's price is read off food security
 * (`grainPriceBps`) rather than traded.
 */

/** The month the grain comes in, around the Mediterranean the scenario is set on. */
export const HARVEST_MONTH = 7;
/** Days in the reckoning's month. */
const REVIEW_DAYS = 30;
/** At most a year of months reckoned in one pass, as the tick bounds its own periods. */
const MAX_MONTHS = 12;

/** Of every ten thousand people, a month: born more than die, in a fed and orderly country. */
const GROWTH_PER_10K_FED = 4;
const GROWTH_PER_10K_HUNGRY = 1;
/** Flight and killing where order has broken down. */
const LOSS_PER_10K_DISORDER = 8;
/** At full war damage, what the fighting takes a month. */
const LOSS_PER_10K_WAR = 40;
/** Below this, people die of hunger -- up to one in a hundred a month at nothing to eat. */
const FAMINE_BPS = 4_000;
const FAMINE_DEATH_SHARE = 0.01;
/** Of those who have fled, the share a month who go on to settle elsewhere. */
const MIGRATION_SHARE = 0.15;
/** A country the displaced will go to: quiet and fed. */
const REFUGE_BPS = 6_000;

/**
 * Food security a harvest leaves, by how the year fell. A fair year fills the
 * granaries to the ordinary level; a drought leaves a province going hungry by
 * winter. Scaled by what the province can make and what war has left of it.
 */
// Cut on the mean of two rolls (the year's weather and the province's luck),
// which gathers toward the middle: about one year in sixteen a drought, one
// in seven poor, half fair, one in seven good and one in sixteen a glut.
const HARVESTS = [
  { upTo: 17, kind: "drought", foodBps: 2_500 },
  { upTo: 32, kind: "poor", foodBps: 5_500 },
  { upTo: 68, kind: "fair", foodBps: 8_000 },
  { upTo: 83, kind: "good", foodBps: 9_000 },
  { upTo: 101, kind: "bumper", foodBps: 10_000 },
] as const;
type HarvestKind = (typeof HARVESTS)[number]["kind"];

/**
 * Between harvests a province is fed from its granaries, not from the sky. The
 * recovery pass pulled food security back to the ordinary level at a few
 * hundred a month, which made a drought a season's inconvenience; where the
 * harvest decides what there is, it comes back at a quarter of that.
 */
export const FOOD_RECOVERY_BETWEEN_HARVESTS = 0.25;

export interface LandInput {
  readonly world: WorldState;
  readonly toDay: number;
  /** Absent, there is no calendar to find the harvest month by, and no harvest. */
  readonly clock?: ScenarioClock | undefined;
}

export interface LandResult {
  readonly world: WorldState;
  readonly facts: FactProposalDraft[];
  /** How many months were reckoned: what misery is counted in (`unrest.ts`). */
  readonly months: number;
}

const clampBps = (value: number): number => Math.max(0, Math.min(10_000, Math.round(value)));
const provinceName = (world: WorldState, id: string): string => world.map.provinces.find((province) => province.id === id)?.name ?? id;
const polityName = (world: WorldState, id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;
const listed = (names: readonly string[]): string => (names.length <= 1 ? names[0] ?? "" : `${names.slice(0, -1).join(", ")} and ${names.at(-1)!}`);

/** Where the harvest decides food, food comes back slowly between harvests. */
export function betweenHarvests(targets: Map<string, ProvinceTargets>, world: WorldState, clock: ScenarioClock | undefined): Map<string, ProvinceTargets> {
  if (clock === undefined || economyOf(world).lastHarvestYear === null) return targets;
  const next = new Map(targets);
  for (const province of world.map.provinces) {
    const current = next.get(province.id) ?? {};
    next.set(province.id, { ...current, foodRecoveryScale: (current.foodRecoveryScale ?? 1) * FOOD_RECOVERY_BETWEEN_HARVESTS });
  }
  return next;
}

/** One month of a province's people: born, starved, fled or killed. Returns the row and how many starved. */
function monthOfPeople(row: ProvinceMaterial): { row: ProvinceMaterial; starved: number } {
  const growth = (row.foodSecurityBps >= 6_000 ? GROWTH_PER_10K_FED : row.foodSecurityBps >= FAMINE_BPS ? GROWTH_PER_10K_HUNGRY : 0)
    - (row.stabilityBps < 3_000 ? LOSS_PER_10K_DISORDER : 0)
    - Math.round((row.warDamageBps / 10_000) * LOSS_PER_10K_WAR);
  const starved = row.foodSecurityBps < FAMINE_BPS
    ? Math.floor(row.population * ((FAMINE_BPS - row.foodSecurityBps) / FAMINE_BPS) * FAMINE_DEATH_SHARE)
    : 0;
  const population = Math.max(0, row.population + Math.round((row.population * growth) / 10_000) - starved);
  return { row: { ...row, population, displacedPopulation: Math.min(row.displacedPopulation, population) }, starved };
}

export function reviewTheLand(input: LandInput): LandResult {
  const { toDay } = input;
  let world = input.world;
  if (world.material.provinceMaterial.length === 0) return { world, facts: [], months: 0 };
  const facts: FactProposalDraft[] = [];
  const memory = economyOf(world);

  // ── The months ─────────────────────────────────────────────────────────
  const last = memory.lastReviewStep;
  const months = last === null ? 0 : Math.min(MAX_MONTHS, Math.floor((toDay - last) / REVIEW_DAYS));
  let lastReviewStep = last === null ? toDay : last + months * REVIEW_DAYS;
  // A long absence is reckoned as a year at most; the rest is forgiven.
  if (last !== null && toDay - lastReviewStep >= REVIEW_DAYS) lastReviewStep = toDay;

  if (months > 0) {
    const rows = new Map(world.material.provinceMaterial.map((row) => [row.provinceId, row]));
    const starvedIn = new Map<string, number>();
    const settledIn = new Map<string, { count: number; from: Set<string> }>();
    const neighbours = new Map<string, string[]>();
    for (const edge of world.map.edges) {
      neighbours.set(edge.from, [...(neighbours.get(edge.from) ?? []), edge.to]);
      neighbours.set(edge.to, [...(neighbours.get(edge.to) ?? []), edge.from]);
    }
    const ids = [...rows.keys()].sort();
    for (let month = 0; month < months; month += 1) {
      for (const id of ids) {
        const lived = monthOfPeople(rows.get(id)!);
        rows.set(id, lived.row);
        if (lived.starved > 0) starvedIn.set(id, (starvedIn.get(id) ?? 0) + lived.starved);
      }
      // People who fled go on to the quietest fed country next to them. The
      // rest wait, and the recovery pass brings some of them home.
      for (const id of ids) {
        const row = rows.get(id)!;
        const leaving = Math.floor(row.displacedPopulation * MIGRATION_SHARE);
        if (leaving <= 0) continue;
        const refuge = (neighbours.get(id) ?? [])
          .map((other) => rows.get(other))
          .filter((other): other is ProvinceMaterial => other !== undefined && other.stabilityBps >= REFUGE_BPS && other.foodSecurityBps >= REFUGE_BPS)
          .sort((a, b) => (b.stabilityBps + b.foodSecurityBps) - (a.stabilityBps + a.foodSecurityBps) || a.provinceId.localeCompare(b.provinceId))[0];
        if (refuge === undefined) continue;
        rows.set(id, { ...row, population: row.population - leaving, displacedPopulation: row.displacedPopulation - leaving });
        rows.set(refuge.provinceId, { ...refuge, population: refuge.population + leaving });
        const tally = settledIn.get(refuge.provinceId) ?? { count: 0, from: new Set<string>() };
        tally.count += leaving;
        tally.from.add(id);
        settledIn.set(refuge.provinceId, tally);
      }
    }
    world = {
      ...world,
      material: {
        ...world.material,
        provinceMaterial: world.material.provinceMaterial.map((row) => {
          const next = rows.get(row.provinceId)!;
          // What it can pay is what its people can make, from what war has left.
          return { ...next, taxCapacity: reckonTaxCapacity(next) };
        }),
      },
    };

    // A famine is history; a steady trickle of deaths in a lean month is not.
    const quiet = new Set(world.map.provinces.filter(isQuietGround).map((province) => province.id));
    const famines = [...starvedIn.entries()].filter(([provinceId, dead]) => dead >= 200 && !quiet.has(provinceId)).sort((a, b) => b[1] - a[1]).slice(0, 6);
    for (const [provinceId, dead] of famines) {
      const holder = world.map.provinces.find((province) => province.id === provinceId)?.controllerPolityId ?? null;
      facts.push({
        localId: `famine_${provinceId}_${toDay}`.slice(0, 60),
        kind: "famine",
        summary: `Famine in ${provinceName(world, provinceId)}${holder === null ? "" : `, held by ${polityName(world, holder)}`}: some ${dead} people have died of hunger.`,
        affectedRefs: [{ kind: "province", id: provinceId }, ...(holder === null ? [] : [{ kind: "polity" as const, id: holder }])],
        visibility: "public",
        discoveryState: "public",
        knowableInDays: 0,
        significance: Math.min(75, 50 + Math.round(dead / 500)),
      });
    }
    const arrivals = [...settledIn.entries()].filter(([provinceId, tally]) => tally.count >= 500 && !quiet.has(provinceId)).sort((a, b) => b[1].count - a[1].count).slice(0, 4);
    for (const [provinceId, tally] of arrivals) {
      facts.push({
        localId: `migrants_${provinceId}_${toDay}`.slice(0, 60),
        kind: "migration",
        summary: `Some ${tally.count} people who had fled ${listed([...tally.from].sort().map((id) => provinceName(world, id)).slice(0, 3))} have settled in ${provinceName(world, provinceId)}.`,
        affectedRefs: [{ kind: "province", id: provinceId }, ...[...tally.from].sort().slice(0, 3).map((id) => ({ kind: "province" as const, id }))],
        visibility: "public",
        discoveryState: "public",
        knowableInDays: 0,
        significance: 30,
      });
    }
  }

  // ── The harvest ────────────────────────────────────────────────────────
  let lastHarvestYear = memory.lastHarvestYear;
  if (input.clock !== undefined) {
    const today = calendarDateOf({ day: toDay, minute: 0 }, input.clock);
    const year = astronomicalYearOf(today);
    const harvestDay = (astronomical: number): number => dayOfCalendarDate({ ...calendarYearOf(astronomical), month: HARVEST_MONTH, day: 1 }, input.clock!);
    const latest = harvestDay(year) <= toDay ? year : year - 1;
    if (lastHarvestYear === null) {
      // The world began with this year's grain already in, or already growing.
      lastHarvestYear = latest;
    } else if (latest > lastHarvestYear) {
      const brought = bringInTheHarvest(world, latest);
      world = brought.world;
      facts.push(...brought.facts);
      lastHarvestYear = latest;
    }
  }

  return { world: { ...world, economy: { ...memory, lastReviewStep, lastHarvestYear } }, facts, months };
}

/** How one province's year fell: the year's weather and the province's own luck, both rolled. */
export function harvestIn(provinceId: string, year: number): HarvestKind {
  const weather = stableHash(["harvest", year]) % 100;
  const luck = stableHash(["harvest", year, provinceId]) % 100;
  const score = Math.round((weather + luck) / 2);
  return HARVESTS.find((band) => score < band.upTo)?.kind ?? "fair";
}

function bringInTheHarvest(world: WorldState, year: number): Omit<LandResult, "months"> {
  const byKind = new Map<HarvestKind, number>(HARVESTS.map((band) => [band.kind, band.foodBps]));
  const failed = new Map<string, string[]>();
  const glutted = new Map<string, string[]>();
  const controllerOf = new Map(world.map.provinces.map((province) => [province.id, province.controllerPolityId]));
  // The far edge's harvest feeds its people like any other, and is nobody's news.
  const quiet = new Set(world.map.provinces.filter(isQuietGround).map((province) => province.id));
  const provinceMaterial = world.material.provinceMaterial.map((row) => {
    const kind = harvestIn(row.provinceId, year);
    const sown = (row.productiveCapacityBps / 10_000) * (1 - row.warDamageBps / 20_000);
    const holder = quiet.has(row.provinceId) ? null : controllerOf.get(row.provinceId) ?? null;
    if (holder !== null && kind === "drought") failed.set(holder, [...(failed.get(holder) ?? []), row.provinceId]);
    if (holder !== null && kind === "bumper") glutted.set(holder, [...(glutted.get(holder) ?? []), row.provinceId]);
    return { ...row, foodSecurityBps: clampBps(byKind.get(kind)! * sown) };
  });
  const next: WorldState = { ...world, material: { ...world.material, provinceMaterial } };
  const facts: FactProposalDraft[] = [];
  // One line a power, not one a province: a drought is news in a country, and
  // 779 harvests are not 779 entries.
  // Where the most people will go hungry first: a drought over a dozen
  // hill-tribes' valleys is less news than one over Latium.
  const people = new Map(provinceMaterial.map((material) => [material.provinceId, material.population]));
  const hungry = (ids: readonly string[]): number => ids.reduce((sum, id) => sum + (people.get(id) ?? 0), 0);
  for (const [polityId, provinceIds] of [...failed.entries()].sort((a, b) => hungry(b[1]) - hungry(a[1]) || a[0].localeCompare(b[0])).slice(0, 8)) {
    const price = polityGrainPriceBps(next, polityId);
    facts.push({
      localId: `harvest_failed_${polityId}_${year}`.slice(0, 60),
      kind: "harvest_failed",
      summary: `The harvest failed in ${listed(provinceIds.slice(0, 4).map((id) => provinceName(next, id)))}${provinceIds.length > 4 ? ` and ${provinceIds.length - 4} more of ${polityName(next, polityId)}'s provinces` : ""}: drought, and hunger to come before the next one.${price >= 15_000 ? ` Grain in ${polityName(next, polityId)} sells at ${(price / 10_000).toFixed(1)} times its ordinary price.` : ""}`.slice(0, 600),
      affectedRefs: [{ kind: "polity", id: polityId }, ...provinceIds.slice(0, 4).map((id) => ({ kind: "province" as const, id }))],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      significance: Math.min(70, 50 + provinceIds.length * 2),
    });
  }
  for (const [polityId, provinceIds] of [...glutted.entries()].sort((a, b) => hungry(b[1]) - hungry(a[1]) || a[0].localeCompare(b[0])).slice(0, 4)) {
    facts.push({
      localId: `harvest_${polityId}_${year}`.slice(0, 60),
      kind: "harvest",
      summary: `${listed(provinceIds.slice(0, 4).map((id) => provinceName(next, id)))}${provinceIds.length > 4 ? ` and ${provinceIds.length - 4} more of ${polityName(next, polityId)}'s provinces` : ""} brought in a glut: the granaries full, and grain cheap.`.slice(0, 600),
      affectedRefs: [{ kind: "polity", id: polityId }, ...provinceIds.slice(0, 4).map((id) => ({ kind: "province" as const, id }))],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      significance: 25,
    });
  }
  return { world: next, facts };
}
