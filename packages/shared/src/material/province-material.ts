import type { WorldState } from "../world/world-state";
import type { Province } from "../world/map";
import type { ProvinceLevel, ProvinceMaterial } from "../material-state";

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
// damage) are applied by the workflow or pipeline step that caused them, to
// the one province affected; `applyCoarseRecoveryTick` is the cheap,
// bounded pass every *other* province gets once per turn instead.

/** A settlement's coarse "size" scales to population at roughly a market town per unit. */
const POPULATION_PER_SETTLEMENT_SIZE = 400;
const MANPOWER_FRACTION_OF_POPULATION = 0.08;
const TAX_CAPACITY_PER_POPULATION = 0.5;
const BASELINE_PRODUCTIVE_CAPACITY_BPS = 10_000;
const BASELINE_FOOD_SECURITY_BPS = 8_000;
const BASELINE_STABILITY_BPS = 7_000;

function clampBps(value: number): number {
  return Math.max(0, Math.min(10_000, Math.round(value)));
}

/** A province with no authored material state gets one derived from its settlements. */
export function deriveDefaultProvinceMaterial(province: Province, atStep: number): ProvinceMaterial {
  const population = Math.max(
    0,
    province.settlements.reduce((total, settlement) => total + settlement.size * POPULATION_PER_SETTLEMENT_SIZE, 0),
  );
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
  if (missing.length === 0) return world;
  return {
    ...world,
    material: {
      ...world.material,
      provinceMaterial: [
        ...world.material.provinceMaterial,
        ...missing.map((province) => deriveDefaultProvinceMaterial(province, atStep)),
      ],
    },
  };
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
    foodSecurityBps: clampBps(toward(material.foodSecurityBps, BASELINE_FOOD_SECURITY_BPS, targets?.foodSecurityShiftBps, recoveryBps)),
    stabilityBps: clampBps(toward(material.stabilityBps, BASELINE_STABILITY_BPS, targets?.stabilityShiftBps, recoveryBps) - shortage.stabilityErosionBps),
    productiveCapacityBps: clampBps(toward(material.productiveCapacityBps, BASELINE_PRODUCTIVE_CAPACITY_BPS, targets?.productiveCapacityShiftBps, recoveryBps)),
    warDamageBps: clampBps(material.warDamageBps - recoveryBps),
    availableManpower: Math.min(
      Math.floor(material.population * manpowerShare),
      material.availableManpower + Math.floor(recoveryBps / 10),
    ),
    lastMaterialUpdateStep: atStep,
  };
}

/** Coarse, deterministic severity per kind of military event, pending Phase 3's real battle engine. */
const WAR_EVENT_SEVERITY_BPS: Record<string, number> = {
  start_battle: 1_200,
  start_siege: 1_000,
  end_siege_captured: 4_000,
  blockade_port: 500,
};

export interface ExecutedInvocationLike {
  readonly actionId: string;
  readonly parameters: Record<string, unknown>;
}

/**
 * Apply coarse war damage for this turn's executed military workflows, to
 * exactly the provinces they affected. A real deterministic battle/siege
 * engine (docs/14 Phase 3) will replace these fixed severities with ones
 * derived from the actual engagement; until then, an event still happening
 * is preferable to material state that never reacts to war at all.
 */
export function applyWarDamageForExecutedWorkflows(
  world: WorldState,
  executed: readonly ExecutedInvocationLike[],
  atStep: number,
): { world: WorldState; affectedProvinceIds: Set<string> } {
  const affected = new Set<string>();
  let provinceMaterial = world.material.provinceMaterial;

  const provinceIdForForce = (forceId: unknown): string | undefined =>
    typeof forceId === "string" ? world.material.forces.find((f) => f.id === forceId)?.locationId : undefined;
  const provinceIdForSettlement = (settlementId: unknown): string | undefined =>
    typeof settlementId === "string"
      ? world.map.provinces.find((p) => p.settlements.some((s) => s.id === settlementId))?.id
      : undefined;

  const strike = (provinceId: string | undefined, severityBps: number) => {
    if (!provinceId) return;
    const material = provinceMaterial.find((m) => m.provinceId === provinceId);
    if (!material) return;
    affected.add(provinceId);
    provinceMaterial = provinceMaterial.map((m) =>
      m.provinceId === provinceId ? applyWarDamage(m, { severityBps }, atStep) : m,
    );
  };

  for (const invocation of executed) {
    if (invocation.actionId === "start_battle") {
      strike(provinceIdForForce(invocation.parameters["attackingForceId"]), WAR_EVENT_SEVERITY_BPS["start_battle"]!);
    } else if (invocation.actionId === "start_siege") {
      strike(provinceIdForSettlement(invocation.parameters["settlementId"]), WAR_EVENT_SEVERITY_BPS["start_siege"]!);
    } else if (invocation.actionId === "end_siege" && invocation.parameters["successfulCapture"] === true) {
      strike(provinceIdForSettlement(invocation.parameters["settlementId"]), WAR_EVENT_SEVERITY_BPS["end_siege_captured"]!);
    } else if (invocation.actionId === "blockade_port") {
      strike(provinceIdForSettlement(invocation.parameters["settlementId"]), WAR_EVENT_SEVERITY_BPS["blockade_port"]!);
    } else if (invocation.actionId === "recruit_from_province") {
      const provinceId = invocation.parameters["provinceId"];
      if (typeof provinceId === "string") affected.add(provinceId);
    } else if (invocation.actionId === "collect_emergency_taxation") {
      const provinceId = invocation.parameters["provinceId"];
      if (typeof provinceId === "string") affected.add(provinceId);
    }
  }

  return {
    world: { ...world, material: { ...world.material, provinceMaterial } },
    affectedProvinceIds: affected,
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
