import type { WorldState } from "../world/world-state";
import type { Province } from "../world/map";
import type { ProvinceMaterial } from "../material-state";

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

export interface TaxationDrawResult {
  readonly material: ProvinceMaterial;
  readonly collected: number;
}

/**
 * Taxation and requisition both draw against `taxCapacity`, scaled down by
 * how stable the province currently is -- an unstable province simply
 * cannot yield what its capacity alone would suggest -- and the draw itself
 * costs some stability, more so the larger a bite it takes.
 */
export function applyTaxationDraw(material: ProvinceMaterial, requestedAmount: number, atStep: number): TaxationDrawResult {
  const stabilityFactor = material.stabilityBps / 10_000;
  const available = Math.floor(material.taxCapacity * stabilityFactor);
  const collected = Math.max(0, Math.min(requestedAmount, available));
  const unrestBps = available > 0 ? clampBps((collected / available) * 1_500) : 0;
  return {
    material: {
      ...material,
      stabilityBps: clampBps(material.stabilityBps - unrestBps),
      lastMaterialUpdateStep: atStep,
    },
    collected,
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

/** The bounded, cheap update every province NOT otherwise affected this turn gets. */
export function applyCoarseRecoveryTick(material: ProvinceMaterial, atStep: number): ProvinceMaterial {
  const stepsIdle = Math.max(0, atStep - material.lastMaterialUpdateStep);
  if (stepsIdle === 0) return material;
  // Bounded per call regardless of how long a province went unattended --
  // recovery is gradual, never an instant full heal after a long absence.
  const recoveryBps = Math.min(500, stepsIdle * 50);
  const baselinePopulation = Math.max(material.population, 1);
  const resettlement = Math.min(material.displacedPopulation, Math.floor(baselinePopulation * 0.01) + stepsIdle);
  const shortage = foodShortagePressure(material, stepsIdle);
  return {
    ...material,
    displacedPopulation: material.displacedPopulation - resettlement + shortage.newlyDisplaced,
    foodSecurityBps: clampBps(material.foodSecurityBps + Math.min(recoveryBps, BASELINE_FOOD_SECURITY_BPS - material.foodSecurityBps > 0 ? recoveryBps : 0)),
    stabilityBps: clampBps(material.stabilityBps + Math.min(recoveryBps, BASELINE_STABILITY_BPS - material.stabilityBps > 0 ? recoveryBps : 0) - shortage.stabilityErosionBps),
    productiveCapacityBps: clampBps(material.productiveCapacityBps + Math.min(recoveryBps, BASELINE_PRODUCTIVE_CAPACITY_BPS - material.productiveCapacityBps > 0 ? recoveryBps : 0)),
    warDamageBps: clampBps(material.warDamageBps - recoveryBps),
    availableManpower: Math.min(
      Math.floor(material.population * MANPOWER_FRACTION_OF_POPULATION),
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
): WorldState {
  const backfilled = ensureProvinceMaterial(world, atStep);
  return {
    ...backfilled,
    material: {
      ...backfilled.material,
      provinceMaterial: backfilled.material.provinceMaterial.map((material) =>
        affectedProvinceIds.has(material.provinceId) ? material : applyCoarseRecoveryTick(material, atStep),
      ),
    },
  };
}
