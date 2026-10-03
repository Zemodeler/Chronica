import type { WorldState } from "../world/world-state";
import type { IncomeSource, ProvinceMaterial } from "../material-state";
import { deriveDefaultProvinceMaterial } from "./province-material";
import { ownerOf, ownsAndHolds } from "../world/occupation";

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
 *    dues of subject peoples -- paid into that power's own treasury. Trade is
 *    not a levy on anybody's land, and war and blockade already bound it.
 *  - **More than can be borne is not collected.** Every such source is paid in
 *    the same proportion, so the collectors bring in what there is.
 *  - **Pressing hard costs order.** Asking more than half of what can be borne
 *    lowers where the power's provinces settle, as a level rather than a blow:
 *    a province taxed hard is a sullener place for as long as the tax stands.
 *    Which lowers what can be borne -- so a tax raised tenfold yields perhaps
 *    twice as much, and a province in unrest.
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

const DOMESTIC_REVENUE_KINDS: ReadonlySet<IncomeSource["kind"]> = new Set(["tax", "land", "tribute"]);

export interface TaxBurden {
  readonly polityId: string;
  /** What its held provinces can bear, per month. */
  readonly bearable: number;
  /** What its domestic revenues ask, per month, after their collection rates. */
  readonly asked: number;
  /** The share of each domestic revenue that actually arrives: 1 unless it asks more than can be borne. */
  readonly collectedShare: number;
  /** How far below baseline the power's provinces settle on account of it, in basis points (0 or negative). */
  readonly stabilityShiftBps: number;
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
export function taxBurdens(world: WorldState): Map<string, TaxBurden> {
  const asked = new Map<string, number>();
  for (const source of world.material.incomeSources) {
    const polityId = domesticRevenuePolity(world, source);
    if (polityId !== null) asked.set(polityId, (asked.get(polityId) ?? 0) + monthly(source));
  }

  const materialById = new Map(world.material.provinceMaterial.map((row) => [row.provinceId, row]));
  const materialOf = (provinceId: string): ProvinceMaterial | undefined => {
    const row = materialById.get(provinceId);
    if (row !== undefined) return row;
    const province = world.map.provinces.find((candidate) => candidate.id === provinceId);
    return province === undefined ? undefined : deriveDefaultProvinceMaterial(province, world.elapsedStep);
  };

  const burdens = new Map<string, TaxBurden>();
  for (const [polityId, askedMonthly] of asked) {
    // What its own land can bear, and how much of its land it still holds.
    // Occupied ground pays nobody (`world/occupation.ts`): not the occupier,
    // whose it is not, and not the owner, whose collectors cannot reach it.
    const capacityOf = (province: (typeof world.map.provinces)[number]): number => {
      const material = materialOf(province.id);
      return material === undefined ? 0 : (material.taxCapacity * material.stabilityBps / 10_000) * (TAX_EXTRACTION_BPS / 10_000);
    };
    const owned = world.map.provinces.filter((province) => ownerOf(province) === polityId);
    const bearable = owned.filter((province) => ownsAndHolds(province, polityId)).reduce((sum, province) => sum + capacityOf(province), 0);
    const ownedCapacity = owned.reduce((sum, province) => sum + capacityOf(province), 0);
    const held = ownedCapacity <= 0 ? 1 : bearable / ownedCapacity;
    const burden = bearable <= 0 ? Number.POSITIVE_INFINITY : askedMonthly / bearable;
    burdens.set(polityId, {
      polityId,
      bearable: Math.round(bearable),
      asked: Math.round(askedMonthly),
      collectedShare: askedMonthly <= 0 ? held : Math.min(held, bearable / askedMonthly),
      stabilityShiftBps: burden <= CUSTOMARY_TAX_BURDEN
        ? 0
        : -Math.min(MAX_TAX_UNREST_BPS, Math.round((burden - CUSTOMARY_TAX_BURDEN) * TAX_UNREST_BPS_PER_BURDEN)),
    });
  }
  return burdens;
}

/** How hard a burden presses, in the words a ruler would hear it in. */
export function taxBurdenInWords(burden: TaxBurden): string {
  const ratio = burden.bearable <= 0 ? Number.POSITIVE_INFINITY : burden.asked / burden.bearable;
  if (ratio <= CUSTOMARY_TAX_BURDEN) return "borne without complaint";
  if (ratio <= 0.8) return "felt, and resented";
  if (ratio <= 1) return "pressing hard; order is suffering for it";
  return "more than the land can give; the collectors fall short and order is breaking down";
}
