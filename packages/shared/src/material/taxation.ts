import type { WorldState } from "../world/world-state";
import type { Province, ProvinceEdge } from "../world/map";
import type { IncomeSource, ProvinceMaterial, TaxRegime } from "../material-state";
import { MANPOWER_FRACTION_OF_POPULATION, deriveDefaultProvinceMaterial } from "./province-material";
import { ownerOf, ownsAndHolds } from "../world/occupation";
import { adjacentTo } from "../world/movement";
import { tradeIntensities } from "../world/markets";
import { readDepartments } from "../world/departments";
import { skillShare } from "../characters/aptitude";
import { DEFAULT_TAX_RATE_BPS, MEN_PER_YEAR_SHARE, REGIME_LEAK_SCALE, policyPressureBps, regimeFactor, taxPolicyIndex, type TaxPolicy } from "./tax-policy";

/**
 * What a government's own lands can be made to pay.
 *
 * A tax was a number the model wrote and the tick collected, in full, forever.
 * Ordering it doubled doubled the revenue; ordering it tenfold did too, and an
 * unstable province paid exactly what a calm one did. Each province carried a
 * `taxCapacity` and a stability that were printed for the model to read and
 * bounded nothing, and the one function that would have tied them together --
 * a draw scaled by order, costing order -- had no caller.
 *
 * So a power's domestic revenue is now weighed against what its provinces can
 * bear, every month:
 *
 *  - **What can be borne** is a share of every held province's tax capacity,
 *    scaled by how orderly the province is. Disorder pays less.
 *  - **What is asked** is every domestic revenue -- taxes, land rents, the
 *    dues of subject peoples, and the harbour dues and tolls on trade -- paid
 *    into that power's own treasury. Trade was left out as no levy on anybody's
 *    land, with war and blockade to bound it, and so a treasury could be given
 *    a trade income of any size: a harbour's dues are as much a share of what
 *    the country produces as a tithe is, and ride the same ceiling.
 *  - **More than can be borne is not collected.** Every such source is paid in
 *    the same proportion, so the collectors bring in what there is.
 *  - **Pressing hard costs order.** Asking more than half of what can be borne
 *    lowers where the power's provinces settle, as a level rather than a blow:
 *    a province taxed hard is a sullener place for as long as the tax stands.
 *    Which lowers what can be borne -- so a tax raised tenfold yields perhaps
 *    twice as much, and a province in unrest.
 *
 * What a province can bear is read province by province, by the policy it is
 * taxed under (`tax-policy.ts`): its regime (a tithe swings with the harvest,
 * a levy does not, customs follow the harbour, a tribute of men is no money),
 * its rate, and how much of it reaches the treasury, which falls with the
 * distance from the capital along the map's graph and with the skill of the
 * tax office. The sum over a power's held provinces is what it can bear; a
 * power with no policy is taxed by the uniform levy it always was, less the
 * distance. A power's own tax rolls are written at its rate (`rateScale`), so
 * raising the rate raises both what is asked and what can be borne, and costs
 * order province by province; a farmer's demand and a tribute ask what they
 * ask, against the same ceiling.
 */

/**
 * The share of a province's stability-weighted tax capacity that can be raised
 * each month. Set so every power in the opening asks under the customary half
 * of it -- Syracuse, one province carrying a whole city's treasury, is the
 * tightest -- and Rome can roughly half again its revenue before its
 * provinces feel it.
 */
export const TAX_EXTRACTION_BPS = 1_000;
/** Asked below this share of what can be borne, a tax costs no order at all: it is what people expect to pay. */
export const CUSTOMARY_TAX_BURDEN = 0.5;
/** How far stability settles below its baseline for each whole multiple of the bearable a power asks past the customary. */
export const TAX_UNREST_BPS_PER_BURDEN = 4_000;
/** However hard a power presses, order settles no further than this below baseline on its account. */
export const MAX_TAX_UNREST_BPS = 6_000;

const DOMESTIC_REVENUE_KINDS: ReadonlySet<IncomeSource["kind"]> = new Set(["tax", "land", "tribute", "trade"]);

export interface TaxBurden {
  readonly polityId: string;
  /** What its held provinces can bear, per month. */
  readonly bearable: number;
  /** What its domestic revenues ask, per month, after their collection rates. */
  readonly asked: number;
  /** The share of each domestic revenue that actually arrives: 1 unless it asks more than can be borne, or an enemy holds some of its land. */
  readonly collectedShare: number;
  /** The share of its own land's capacity it still holds: below 1 while an enemy occupies some of it, whose districts pay nobody. */
  readonly held: number;
  /** How far below baseline the power's provinces settle on account of it, in basis points (0 or negative). */
  readonly stabilityShiftBps: number;
  /**
   * What its tax rolls are written at, against what the old uniform levy
   * asked: 1 where every province is taxed at the default rate, 2 where they
   * are taxed at twice it. The money a power's own tax sources ask is
   * multiplied by it, so raising a rate raises the revenue, and so does the
   * ceiling it is weighed against.
   */
  readonly rateScale?: number;
  /** What its provinces can bear each month, by regime: where the money comes from. */
  readonly bearableByRegime?: Readonly<Partial<Record<TaxRegime, number>>>;
  /** The men a year its `men` provinces owe it: manpower tribute, no money. */
  readonly menPerYear?: number;
  /**
   * Further order lost, province by province, to how it is taxed: a chosen
   * regime is resented, and a rate over the customary one is hated. Only for
   * provinces with a policy of their own or the power's; the rest feel only
   * `stabilityShiftBps`.
   */
  readonly provinceStabilityShiftBps?: ReadonlyMap<string, number>;
  /**
   * How much higher a `men` province's rolls of men fit for the call-up stand
   * than a province's ordinarily do, as a share of the ordinary ceiling
   * (`ProvinceTargets.manpowerShift`): what is owed a year, as a share of what
   * the ordinary ceiling is. A power that takes its tribute in men has more of
   * them to raise, and the people have fewer to marry and to plough.
   */
  readonly provinceManpowerShift?: ReadonlyMap<string, number>;
  /** How many of its held provinces are taxed by a chosen policy, and so lie under it. */
  readonly policyProvinces?: number;
}

/**
 * How much of a province's yield a power loses to its distance from the
 * capital, a step at a time along the map's graph. Half a point of a hundred
 * per step, so a province forty steps off the capital pays a fifth less, and
 * never less than half whatever the distance: some officer is always there.
 */
export const LEAK_PER_STEP = 0.005;
export const MIN_COLLECTION_EFFICIENCY = 0.5;
/** How far a good tax office stretches a power's reach, or a bad one shrinks it: at best two fifths of the leak is saved. */
const TAX_OFFICE_REACH = 0.4;

const provinceOfSettlementByList = new WeakMap<readonly Province[], Map<string, string>>();
const hopsByEdges = new WeakMap<readonly ProvinceEdge[], Map<string, Map<string, number>>>();

/** The province holding a settlement, from an index built once for as long as the province list lives. */
function provinceOfSettlement(world: Pick<WorldState, "map">, settlementId: string): string | undefined {
  let index = provinceOfSettlementByList.get(world.map.provinces);
  if (index === undefined) {
    index = new Map();
    for (const province of world.map.provinces) for (const settlement of province.settlements) index.set(settlement.id, province.id);
    provinceOfSettlementByList.set(world.map.provinces, index);
  }
  return index.get(settlementId);
}

/**
 * The steps from a power's capital to every province it can reach, by
 * breadth-first search over the province graph. Kept for as long as the map's
 * edge list lives, per capital, so a tick that reads the taxes of thirty
 * powers searches thirty times at most and a month of ticks searches nothing.
 * Null for a power with no capital standing in a province.
 */
export function stepsFromCapital(world: Pick<WorldState, "map">, polityId: string): ReadonlyMap<string, number> | null {
  const polity = world.map.polities.find((candidate) => candidate.id === polityId);
  const capitalProvinceId = polity?.capitalSettlementId == null ? undefined : provinceOfSettlement(world, polity.capitalSettlementId);
  if (capitalProvinceId === undefined) return null;
  let byCapital = hopsByEdges.get(world.map.edges);
  if (byCapital === undefined) {
    byCapital = new Map();
    hopsByEdges.set(world.map.edges, byCapital);
  }
  const known = byCapital.get(capitalProvinceId);
  if (known !== undefined) return known;
  const steps = new Map<string, number>([[capitalProvinceId, 0]]);
  let frontier = [capitalProvinceId];
  for (let depth = 1; frontier.length > 0 && depth <= 400; depth += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbour of adjacentTo(world, id)) {
        if (steps.has(neighbour.provinceId)) continue;
        steps.set(neighbour.provinceId, depth);
        next.push(neighbour.provinceId);
      }
    }
    frontier = next;
  }
  byCapital.set(capitalProvinceId, steps);
  return steps;
}

/** What share of a province's yield reaches the treasury, by distance, regime and the skill of the tax office. */
export function collectionEfficiency(steps: number | undefined, regime: TaxRegime, officeSkill: number): number {
  if (steps === undefined) return 1;
  const leak = steps * LEAK_PER_STEP * REGIME_LEAK_SCALE[regime] * (1 - skillShare(officeSkill, TAX_OFFICE_REACH));
  return Math.max(MIN_COLLECTION_EFFICIENCY, Math.min(1, 1 - leak));
}

/** One province's contribution to what its power can raise. */
export interface ProvinceTaxReading {
  readonly provinceId: string;
  readonly policy: TaxPolicy;
  /** What it can bear each month, after regime, rate and distance. */
  readonly monthly: number;
  /** The share of that which reaches the treasury. */
  readonly efficiency: number;
  /** Men a year, for a `men` province. */
  readonly menPerYear: number;
  /** Whether the power owns and holds it: occupied ground pays nobody. */
  readonly held: boolean;
}

/**
 * What one province can be made to pay, by its policy. The old uniform levy
 * is what a power with no policy gets: a steady tenth of what the people can
 * make, as it always was, less what distance costs.
 */
export function readProvinceTax(
  province: Province,
  row: ProvinceMaterial,
  policy: TaxPolicy,
  steps: number | undefined,
  officeSkill: number,
  polityId: string,
  /** How much a customs province's hub trades (`tradeIntensity`): its market's flows against its use. */
  trade?: number | undefined,
): ProvinceTaxReading {
  const efficiency = collectionEfficiency(steps, policy.regime, officeSkill);
  const base = (row.taxCapacity * row.stabilityBps) / 10_000;
  const monthly = policy.regime === "men" ? 0 : base * (policy.rateBps / 10_000) * regimeFactor(policy.regime, row, province, trade) * efficiency;
  const menPerYear = policy.regime === "men" ? Math.floor(row.population * (policy.rateBps / 1_000) * MEN_PER_YEAR_SHARE * (row.stabilityBps / 10_000)) : 0;
  return { provinceId: province.id, policy, monthly, efficiency, menPerYear, held: ownsAndHolds(province, polityId) };
}

/** The power whose treasury a revenue is paid into, if it is a power's own and levied at home. */
export function domesticRevenuePolity(world: WorldState, source: IncomeSource): string | null {
  if (!source.active || !DOMESTIC_REVENUE_KINDS.has(source.kind) || source.counterpartyPolityId !== null) return null;
  // A tax farmer collects a government's tax into his own purse, and the
  // province bears it as it bears the government's: his demand counts against
  // the same ceiling, and presses on the same people.
  const farm = source.originKind === "position" ? world.material.contracts.find((contract) => contract.id === source.originId && contract.role === "tax_farmer") : undefined;
  if (farm !== undefined) return world.map.provinces.find((province) => province.id === farm.provinceId)?.controllerPolityId ?? null;
  const owner = world.material.accounts.find((account) => account.id === source.beneficiaryAccountId)?.owner;
  return owner?.kind === "polity" ? owner.id : null;
}

const monthly = (source: IncomeSource): number =>
  source.cadenceSteps <= 0 ? 0 : (source.amount * source.collectionRateBps) / 10_000 * (30 / source.cadenceSteps);

/** Every power's burden, keyed by polity. Powers asking nothing of their land are absent. */
export function taxBurdens(world: WorldState, options: { readonly officeSkill?: (polityId: string) => number } = {}): Map<string, TaxBurden> {
  // Who is asked for what, by each power's own domestic revenues. A power's
  // own tax rolls are written at the rate it has chosen (`rateScale`, below),
  // so those are held apart until it is known; a tax farmer's, a land rent
  // and a tribute ask what they ask.
  const askedOther = new Map<string, number>();
  const askedRolls = new Map<string, number>();
  for (const source of world.material.incomeSources) {
    const polityId = domesticRevenuePolity(world, source);
    if (polityId === null) continue;
    const rolls = source.kind === "tax" && source.originKind !== "position" && ownedByPolity(world, source);
    const bucket = rolls ? askedRolls : askedOther;
    bucket.set(polityId, (bucket.get(polityId) ?? 0) + monthly(source));
  }
  const polityIds = new Set([...askedOther.keys(), ...askedRolls.keys()]);
  if (polityIds.size === 0) return new Map();

  const materialById = new Map(world.material.provinceMaterial.map((row) => [row.provinceId, row]));
  const policyOf = taxPolicyIndex(world);
  let departments: ReturnType<typeof readDepartments> | undefined;
  const officeSkill = options.officeSkill ?? ((polityId: string): number => {
    departments ??= readDepartments(world);
    return departments.skill({ kind: "polity", id: polityId }, "tax_roll");
  });

  // Every province once, under its owner: reading them again for each power
  // that asks something was a pass over the whole map per power.
  const ownedBy = new Map<string, Province[]>();
  for (const province of world.map.provinces) {
    const owner = ownerOf(province);
    if (owner === null || !polityIds.has(owner)) continue;
    const list = ownedBy.get(owner);
    if (list === undefined) ownedBy.set(owner, [province]);
    else list.push(province);
  }

  const burdens = new Map<string, TaxBurden>();
  let intensity: Map<string, number> | undefined;
  for (const polityId of polityIds) {
    // What its own land can bear, and how much of its land it still holds.
    // Occupied ground pays nobody (`world/occupation.ts`): not the occupier,
    // whose it is not, and not the owner, whose collectors cannot reach it.
    const owned = ownedBy.get(polityId) ?? [];
    const steps = stepsFromCapital(world, polityId);
    const skill = officeSkill(polityId);
    let bearable = 0;
    let ownedCapacity = 0;
    let rated = 0;
    let weights = 0;
    let menPerYear = 0;
    let policyProvinces = 0;
    const byRegime: Partial<Record<TaxRegime, number>> = {};
    const provinceShift = new Map<string, number>();
    const manpowerShift = new Map<string, number>();
    for (const province of owned) {
      const row = materialById.get(province.id) ?? deriveDefaultProvinceMaterial(province, world.elapsedStep);
      const policy = policyOf(province, row);
      const reading = readProvinceTax(province, row, policy, steps?.get(province.id), skill, polityId, policy.regime === "customs" ? (intensity ??= tradeIntensities(world)).get(province.id) : undefined);
      ownedCapacity += reading.monthly;
      if (!reading.held) continue;
      bearable += reading.monthly;
      menPerYear += reading.menPerYear;
      if (reading.menPerYear > 0 && row.population > 0) manpowerShift.set(province.id, reading.menPerYear / (row.population * MANPOWER_FRACTION_OF_POPULATION));
      byRegime[policy.regime] = (byRegime[policy.regime] ?? 0) + reading.monthly;
      if (reading.monthly > 0) {
        rated += reading.monthly * (policy.rateBps / DEFAULT_TAX_RATE_BPS);
        weights += reading.monthly;
      }
      if (policy.explicit) {
        policyProvinces += 1;
        const pressure = policyPressureBps(policy);
        if (pressure !== 0) provinceShift.set(province.id, pressure);
      }
    }
    const rateScale = weights <= 0 ? 1 : rated / weights;
    const askedMonthly = (askedOther.get(polityId) ?? 0) + (askedRolls.get(polityId) ?? 0) * rateScale;
    const held = ownedCapacity <= 0 ? 1 : bearable / ownedCapacity;
    const burden = bearable <= 0 ? Number.POSITIVE_INFINITY : askedMonthly / bearable;
    burdens.set(polityId, {
      polityId,
      bearable: Math.round(bearable),
      asked: Math.round(askedMonthly),
      collectedShare: askedMonthly <= 0 ? held : Math.min(held, bearable / askedMonthly),
      held,
      stabilityShiftBps: burden <= CUSTOMARY_TAX_BURDEN
        ? 0
        : -Math.min(MAX_TAX_UNREST_BPS, Math.round((burden - CUSTOMARY_TAX_BURDEN) * TAX_UNREST_BPS_PER_BURDEN)),
      rateScale,
      bearableByRegime: byRegime,
      menPerYear,
      provinceStabilityShiftBps: provinceShift,
      provinceManpowerShift: manpowerShift,
      policyProvinces,
    });
  }
  return burdens;
}


/** Whether the money a source brings goes into its power's own purse: its own tax rolls, not a farmer's, a rent or a tribute. */
function ownedByPolity(world: WorldState, source: IncomeSource): boolean {
  return world.material.accounts.find((account) => account.id === source.beneficiaryAccountId)?.owner.kind === "polity";
}

/**
 * Every province of a power, as the tax reads it: what each bears, by what
 * policy and how much of it arrives. For the world slice's per-power summary
 * and for a ruler deciding where to press.
 */
export function polityTaxReadings(world: WorldState, polityId: string, options: { readonly officeSkill?: (polityId: string) => number } = {}): ProvinceTaxReading[] {
  const materialById = new Map(world.material.provinceMaterial.map((row) => [row.provinceId, row]));
  const policyOf = taxPolicyIndex(world);
  const steps = stepsFromCapital(world, polityId);
  const skill = (options.officeSkill ?? ((id: string): number => readDepartments(world).skill({ kind: "polity", id }, "tax_roll")))(polityId);
  let intensity: Map<string, number> | undefined;
  return world.map.provinces
    .filter((province) => ownerOf(province) === polityId)
    .map((province) => {
      const row = materialById.get(province.id) ?? deriveDefaultProvinceMaterial(province, world.elapsedStep);
      const policy = policyOf(province, row);
      return readProvinceTax(province, row, policy, steps?.get(province.id), skill, polityId, policy.regime === "customs" ? (intensity ??= tradeIntensities(world)).get(province.id) : undefined);
    });
}

/** How hard a burden presses, in the words a ruler would hear it in. */
export function taxBurdenInWords(burden: TaxBurden): string {
  const ratio = burden.bearable <= 0 ? Number.POSITIVE_INFINITY : burden.asked / burden.bearable;
  if (ratio <= CUSTOMARY_TAX_BURDEN) return "borne without complaint";
  if (ratio <= 0.8) return "felt, and resented";
  if (ratio <= 1) return "pressing hard; order is suffering for it";
  return "more than the land can give; the collectors fall short and order is breaking down";
}

/**
 * The line a government hears when its collectors come back short, or null
 * when they did not.
 *
 * It used to be written whenever the collected share fell below one, and always
 * blamed the tax. But occupied ground lowers the share while a skilled treasury
 * raises the take by up to a seventh, and the chronicle read "asked more of its
 * lands than they could bear: of 816 due, the collectors raised 874". A surplus
 * is nobody's news. A shortfall names its cause: a tax pressed past what the
 * land bears, districts the enemy holds, or both.
 */
export function taxShortfallSummary(name: string, burden: TaxBurden | undefined, tally: { readonly asked: number; readonly raised: number }): string | null {
  if (tally.raised >= tally.asked) return null;
  const overAsked = burden === undefined || burden.asked > burden.bearable;
  const occupied = burden !== undefined && burden.held < 1;
  const cause = overAsked && occupied
    ? "asked more of the lands it still holds than they could bear, and its occupied districts paid nothing"
    : occupied
      ? "could not reach its occupied districts, which paid nothing"
      : "asked more of its lands than they could bear";
  return `${name} ${cause}: of ${tally.asked} due in taxes and dues, the collectors raised ${tally.raised}.`;
}
