import type { WorldState } from "../world/world-state";
import type { Province } from "../world/map";
import type { ProvinceLevel, ProvinceMaterial } from "../material-state";
import { liveProvinceIds } from "./live-provinces";

// Background material society (docs/14 Phase 2).
//
//   Population and productive capacity
//           v
//   Food, wealth, taxes, manpower, and supply
//           v
//   Army readiness, campaigns, positions, battles, and sieges
//           v
//   Casualties, damage, displacement, unrest, and reputation
//           v
//   Character motives, politics, authority, and Chronicle history
//
// Every function here is pure and deterministic: same input, same output,
// so a replay matches exactly. Detailed updates (recruitment, taxation, war
// damage) are applied by whatever caused them -- a levy (`sim/levies.ts`), a
// battle, a sack, an army foraging (`sim/campaign.ts`) -- to the one province
// affected; `applyCoarseRecoveryTick` is the cheap,
// bounded pass every *other* province gets once per turn instead.

/**
 * Who lives in a province, counted from its towns.
 *
 * A settlement's size counted its townsfolk, about 400 a unit, and nobody
 * else: Latium held 40 000 people and Etruria 36 000, so every levy of the
 * first war found "no more men of age to give" within two months, where
 * Polybius's lists of 225 give Rome and its allies some 700 000 men of
 * military age. Nine in ten of those men lived on the land. A town's unit is
 * now its townsfolk and the country that feeds them -- ten times the town --
 * which puts Roman Italy near the three million free people the census
 * figures imply, and Rome's own ground near a million.
 */
const TOWNSFOLK_PER_SETTLEMENT_SIZE = 400;
const COUNTRY_FOLK_PER_TOWNSMAN = 9;
const POPULATION_PER_SETTLEMENT_SIZE = TOWNSFOLK_PER_SETTLEMENT_SIZE * (1 + COUNTRY_FOLK_PER_TOWNSMAN);
/**
 * Of the people, the men a power can call up at once without emptying the
 * fields: a third of those of military age, who were about a quarter of the
 * people. Rome at its utmost, after Cannae, had about that under arms.
 */
const MANPOWER_FRACTION_OF_POPULATION = 0.08;
/**
 * Of the people, those who come of age for the call-up in a year: a pool bled
 * dry fills again over six or seven years, as Rome's did after Cannae. It
 * refilled in months, at a twentieth of a percent of the people a day.
 */
const MEN_OF_AGE_PER_YEAR = 0.012;
/**
 * What a head pays in a month, before the rate and the reach of the power that
 * taxes it. It was half a coin when a province counted only its townsfolk; the
 * country people counted since pay a tenth of that each, so what the land
 * yields is what it was.
 */
const TAX_CAPACITY_PER_POPULATION = 0.5 / (1 + COUNTRY_FOLK_PER_TOWNSMAN);
const BASELINE_PRODUCTIVE_CAPACITY_BPS = 10_000;
const BASELINE_FOOD_SECURITY_BPS = 8_000;
const BASELINE_STABILITY_BPS = 7_000;
function clampBps(value: number): number {
  return Math.max(0, Math.min(10_000, Math.round(value)));
}

/**
 * The country people of a province the map drew no town in, by its ground and
 * its size.
 *
 * Population was counted from towns alone, and 738 of the world's 780
 * provinces -- every one far from the war -- were drawn without any. They
 * held nobody: no bread for an army, no man for a levy, no coin for a tax.
 * These are villages and farms, a thinner people than a town's hinterland:
 * a few people to the square kilometre, as the Iron Age north carried.
 *
 * It is a density, not a head count per province: cut the map into five times
 * as many provinces and the world holds the same people. The figures are the
 * old per-province counts (80 000 on a coastal plain, 40 000 in the hills,
 * 50 000 elsewhere) spread over the 7 000 km2 a province then covered, and a
 * province drawn without an area is taken to be that size, so a map that does
 * not state areas counts exactly as it did.
 */
export const REFERENCE_PROVINCE_AREA_KM2 = 7_000;
export const COUNTRYSIDE_PER_KM2: Readonly<Record<string, number>> = {
  "coastal-plain": 80_000 / REFERENCE_PROVINCE_AREA_KM2,
  "hills-uplands": 40_000 / REFERENCE_PROVINCE_AREA_KM2,
};
const COUNTRYSIDE_PER_KM2_OTHERWISE = 50_000 / REFERENCE_PROVINCE_AREA_KM2;

/** How many people live in a province: its towns, or its countryside where it has none. */
export function peopleOf(province: Pick<Province, "settlements" | "terrainId" | "areaKm2">): number {
  if (province.settlements.length === 0) {
    const density = COUNTRYSIDE_PER_KM2[province.terrainId] ?? COUNTRYSIDE_PER_KM2_OTHERWISE;
    return Math.round(density * (province.areaKm2 ?? REFERENCE_PROVINCE_AREA_KM2));
  }
  return Math.max(0, province.settlements.reduce((total, settlement) => total + settlement.size * POPULATION_PER_SETTLEMENT_SIZE, 0));
}

/** A province with no authored material state gets one derived from its settlements, or its countryside. */
export function deriveDefaultProvinceMaterial(province: Province, atStep: number): ProvinceMaterial {
  const population = peopleOf(province);
  return {
    provinceId: province.id,
    population,
    availableManpower: Math.floor(population * MANPOWER_FRACTION_OF_POPULATION),
    productiveCapacityBps: BASELINE_PRODUCTIVE_CAPACITY_BPS,
    foodSecurityBps: BASELINE_FOOD_SECURITY_BPS,
    stabilityBps: BASELINE_STABILITY_BPS,
    taxCapacity: Math.floor(population * TAX_CAPACITY_PER_POPULATION),
    displacedPopulation: 0,
    warDamageBps: 0,
    lastMaterialUpdateStep: atStep,
  };
}

/**
 * What a province's people can pay in a month, as the calendar reckons it
 * (`sim/economy.ts`): a twentieth of a coin a head, as much of it as they can make, and
 * none of what war has burned. A fresh province reckons to exactly what it was
 * derived with.
 */
export function reckonTaxCapacity(material: Pick<ProvinceMaterial, "population" | "productiveCapacityBps" | "warDamageBps">): number {
  return Math.max(0, Math.floor(material.population * TAX_CAPACITY_PER_POPULATION * (material.productiveCapacityBps / 10_000) * (1 - material.warDamageBps / 10_000)));
}

/**
 * What a province can yield in a month, whether or not its material row has
 * been written yet. Rows are backfilled lazily, so an opening world has none,
 * and anything reading `taxCapacity` straight off the rows saw zero everywhere
 * until the first tick. Null for a province that does not exist.
 */
export function provinceTaxCapacity(world: WorldState, provinceId: string): number | null {
  const row = world.material.provinceMaterial.find((material) => material.provinceId === provinceId);
  if (row !== undefined) return row.taxCapacity;
  const province = world.map.provinces.find((candidate) => candidate.id === provinceId);
  return province === undefined ? null : deriveDefaultProvinceMaterial(province, world.elapsedStep).taxCapacity;
}

/** One of a province's levels, in basis points, from its material row or the default a province without one would have. Null for no such province. */
export function provinceLevel(world: WorldState, provinceId: string, level: ProvinceLevel): number | null {
  const row = world.material.provinceMaterial.find((material) => material.provinceId === provinceId)
    ?? (() => {
      const province = world.map.provinces.find((candidate) => candidate.id === provinceId);
      return province === undefined ? undefined : deriveDefaultProvinceMaterial(province, world.elapsedStep);
    })();
  if (row === undefined) return null;
  switch (level) {
    case "stability": return row.stabilityBps;
    case "food_security": return row.foodSecurityBps;
    case "productive_capacity": return row.productiveCapacityBps;
    case "war_damage": return row.warDamageBps;
  }
}

export function findProvinceMaterial(world: WorldState, provinceId: string): ProvinceMaterial | undefined {
  return world.material.provinceMaterial.find((material) => material.provinceId === provinceId);
}

/**
 * Idempotently backfill a `ProvinceMaterial` row for every province that
 * doesn't have one yet -- the migration story for both a pre-Phase-2
 * snapshot (every province is missing one) and a newly created province.
 */
export function ensureProvinceMaterial(world: WorldState, atStep: number): WorldState {
  const known = new Set(world.material.provinceMaterial.map((material) => material.provinceId));
  const missing = world.map.provinces.filter((province) => !known.has(province.id));
  // A save written before the countryside was counted holds its townless
  // provinces at nobody. One untouched since -- no war, no refugees, no man
  // raised -- is filled in once; any province something has happened in keeps
  // what happened to it.
  const townless = new Map(world.map.provinces.filter((province) => province.settlements.length === 0).map((province) => [province.id, province]));
  const uncounted = (row: ProvinceMaterial): boolean => row.population === 0 && row.availableManpower === 0
    && row.warDamageBps === 0 && row.displacedPopulation === 0 && townless.has(row.provinceId);
  const refill = world.material.provinceMaterial.some(uncounted);
  if (missing.length === 0 && !refill) return world;
  return {
    ...world,
    material: {
      ...world.material,
      provinceMaterial: [
        ...(refill
          ? world.material.provinceMaterial.map((row) => (uncounted(row) ? { ...deriveDefaultProvinceMaterial(townless.get(row.provinceId)!, row.lastMaterialUpdateStep), stabilityBps: row.stabilityBps, foodSecurityBps: row.foodSecurityBps } : row))
          : world.material.provinceMaterial),
        ...missing.map((province) => deriveDefaultProvinceMaterial(province, atStep)),
      ],
    },
  };
}

/**
 * Ground nothing is happening in, whose people eat, pay and serve but make no
 * history of their own: no harvest news, no famine news, no rising, no civil
 * war. The Chronicle is Rome's and Carthage's, not the Aargau's.
 *
 * Whether a place is quiet is read from the world each time
 * (`liveProvinceIds`): a town, an army, a siege, a person or a war in the
 * province, or any of them within reach, makes it live.
 */
export function isQuietGround(world: WorldState, provinceId: string): boolean {
  return !liveProvinceIds(world).has(provinceId);
}

/** Recruitment draws down available manpower and briefly dents productive capacity. */
export function applyRecruitmentToMaterial(material: ProvinceMaterial, recruits: number, atStep: number): ProvinceMaterial {
  const actual = Math.max(0, Math.min(recruits, material.availableManpower));
  const capacityHitBps = material.population > 0
    ? clampBps((actual / material.population) * 10_000 * 2)
    : 0;
  return {
    ...material,
    availableManpower: material.availableManpower - actual,
    productiveCapacityBps: clampBps(material.productiveCapacityBps - Math.min(2_000, capacityHitBps)),
    lastMaterialUpdateStep: atStep,
  };
}

export interface WarDamageInput {
  /** 0-10 000: how severe this event was for the province (a raid is lower than a sack). */
  readonly severityBps: number;
}

/** Battle, siege, raid, occupation, or disease striking one province. */
export function applyWarDamage(material: ProvinceMaterial, input: WarDamageInput, atStep: number): ProvinceMaterial {
  const severity = clampBps(input.severityBps) / 10_000;
  const populationLoss = Math.floor(material.population * severity * 0.05);
  const displaced = Math.floor(material.population * severity * 0.08);
  return {
    ...material,
    population: Math.max(0, material.population - populationLoss),
    displacedPopulation: material.displacedPopulation + displaced,
    foodSecurityBps: clampBps(material.foodSecurityBps - severity * 4_000),
    stabilityBps: clampBps(material.stabilityBps - severity * 3_000),
    productiveCapacityBps: clampBps(material.productiveCapacityBps - severity * 3_000),
    warDamageBps: clampBps(material.warDamageBps + severity * 5_000),
    lastMaterialUpdateStep: atStep,
  };
}

/** Below this, a province is genuinely food-insecure rather than merely below full baseline. */
const FOOD_SHORTAGE_THRESHOLD_BPS = 4_000;

/**
 * A province still short of food keeps generating unrest and a slow trickle
 * of displacement even once nothing new is striking it -- famine and
 * shortage are their own, ongoing pressure, not something only a fresh
 * attack causes (docs/14 Phase 6: "famine, shortage ... can create
 * migration, unrest ... consequences"). Bounded the same way recovery is:
 * a per-call cap regardless of how long the shortage has run. Returns just
 * the two deltas, evaluated against the pre-recovery food level, so the
 * caller can apply them on top of this same tick's recovery without one
 * effect silently cancelling the other out.
 */
function foodShortagePressure(material: ProvinceMaterial, stepsIdle: number): { stabilityErosionBps: number; newlyDisplaced: number } {
  if (material.foodSecurityBps >= FOOD_SHORTAGE_THRESHOLD_BPS) return { stabilityErosionBps: 0, newlyDisplaced: 0 };
  const severity = (FOOD_SHORTAGE_THRESHOLD_BPS - material.foodSecurityBps) / FOOD_SHORTAGE_THRESHOLD_BPS;
  return {
    stabilityErosionBps: Math.round(Math.min(300, stepsIdle * 30) * severity),
    newlyDisplaced: Math.floor(material.population * severity * 0.005),
  };
}

/**
 * Where a province settles back to, where something standing there has moved
 * it: a temple makes a calmer place, a granary a better-fed one, a tyrant's
 * law a sullen one. Shifts in basis points from the ordinary baseline; the
 * manpower figure multiplies the share of people who can be called up.
 */
export interface ProvinceTargets {
  readonly stabilityShiftBps?: number;
  readonly foodSecurityShiftBps?: number;
  readonly productiveCapacityShiftBps?: number;
  readonly manpowerShift?: number;
  /**
   * How fast order and food come back to the ordinary level, as a multiple
   * of the usual rate: good courts settle quarrels before they become
   * unrest, and a good grain office feeds a city back (`world/departments.ts`).
   */
  readonly stabilityRecoveryScale?: number;
  readonly foodRecoveryScale?: number;
}

/**
 * One step toward a level. Without a standing effect, as it always was: only
 * upward, toward the baseline, so a province lifted above it by events stays
 * lifted. With one, both ways, because the thing standing there is what the
 * province now settles to -- a law that lowers order must pull it down.
 */
function toward(value: number, baseline: number, shift: number | undefined, recoveryBps: number): number {
  if (shift === undefined || shift === 0) return value + Math.min(recoveryBps, baseline - value > 0 ? recoveryBps : 0);
  const target = clampBps(baseline + shift);
  if (value < target) return value + Math.min(recoveryBps, target - value);
  return value - Math.min(recoveryBps, value - target);
}

/** The bounded, cheap update every province NOT otherwise affected this turn gets. */
export function applyCoarseRecoveryTick(material: ProvinceMaterial, atStep: number, targets?: ProvinceTargets): ProvinceMaterial {
  const stepsIdle = Math.max(0, atStep - material.lastMaterialUpdateStep);
  if (stepsIdle === 0) return material;
  // Bounded per call regardless of how long a province went unattended --
  // recovery is gradual, never an instant full heal after a long absence.
  const recoveryBps = Math.min(500, stepsIdle * 50);
  const baselinePopulation = Math.max(material.population, 1);
  const resettlement = Math.min(material.displacedPopulation, Math.floor(baselinePopulation * 0.01) + stepsIdle);
  const shortage = foodShortagePressure(material, stepsIdle);
  const manpowerShare = MANPOWER_FRACTION_OF_POPULATION * Math.max(0, 1 + (targets?.manpowerShift ?? 0));
  return {
    ...material,
    displacedPopulation: material.displacedPopulation - resettlement + shortage.newlyDisplaced,
    foodSecurityBps: clampBps(toward(material.foodSecurityBps, BASELINE_FOOD_SECURITY_BPS, targets?.foodSecurityShiftBps, Math.round(recoveryBps * (targets?.foodRecoveryScale ?? 1)))),
    stabilityBps: clampBps(toward(material.stabilityBps, BASELINE_STABILITY_BPS, targets?.stabilityShiftBps, Math.round(recoveryBps * (targets?.stabilityRecoveryScale ?? 1))) - shortage.stabilityErosionBps),
    productiveCapacityBps: clampBps(toward(material.productiveCapacityBps, BASELINE_PRODUCTIVE_CAPACITY_BPS, targets?.productiveCapacityShiftBps, recoveryBps)),
    warDamageBps: clampBps(material.warDamageBps - recoveryBps),
    // Men come of age as the people grow (`MEN_OF_AGE_PER_YEAR`), so a
    // province bled by a levy fills its rolls again over years, not months --
    // and a larger one faster than a small one.
    availableManpower: Math.min(
      Math.floor(material.population * manpowerShare),
      material.availableManpower + Math.max(Math.floor(recoveryBps / 10), Math.floor((material.population * MEN_OF_AGE_PER_YEAR * Math.min(stepsIdle, 30)) / 365)),
    ),
    lastMaterialUpdateStep: atStep,
  };
}

/**
 * One per-turn pass: backfill any missing province, then apply the cheap
 * coarse recovery tick to every province NOT in `affectedProvinceIds` this
 * turn. Provinces that were affected (recruitment, taxation, battle, siege)
 * are updated at the point that caused the effect instead, so this never
 * double-applies a change.
 */
export function advanceProvinceMaterial(
  world: WorldState,
  atStep: number,
  affectedProvinceIds: ReadonlySet<string>,
  targets: ReadonlyMap<string, ProvinceTargets> = new Map(),
): WorldState {
  const backfilled = ensureProvinceMaterial(world, atStep);
  return {
    ...backfilled,
    material: {
      ...backfilled.material,
      provinceMaterial: backfilled.material.provinceMaterial.map((material) =>
        affectedProvinceIds.has(material.provinceId) ? material : applyCoarseRecoveryTick(material, atStep, targets.get(material.provinceId)),
      ),
    },
  };
}
