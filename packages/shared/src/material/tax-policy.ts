import type { Province } from "../world/map";
import type { WorldState } from "../world/world-state";
import type { ProvinceMaterial, TaxRegime } from "../material-state";
import { MAX_TAX_RATE_BPS } from "../material-state";
import { economyOf } from "../world/economy";

/**
 * How a power takes its share, province by province.
 *
 * A power taxed every province of its own the same way: one uniform lump,
 * weighed against what all of them together could bear. But a harvest tithe
 * on a Sicilian grain-farm, a land levy on Latium, harbour dues at Carthage
 * and a tribute of men from a Samnite ally are different things: they swing
 * differently, cost differently to gather, are resented differently, and are
 * paid by different people. Each province now carries a *policy* -- a regime
 * and a rate -- set for it, or else by the power's default, or else the old
 * uniform levy that every power had before there was a choice.
 *
 *  - **tithe**: a share of the harvest. Swings with the year (a drought halves
 *    it, a glut raises it), is gathered locally in kind and so loses little to
 *    distance, and is the least hated way of paying.
 *  - **land levy**: a fixed sum by the acre, whatever the year. Steady, which
 *    is why a treasury prefers it, and resented for the same reason.
 *  - **customs**: dues on what passes through the province's hub market (a
 *    portoria on goods that cross it, from within the power as from without,
 *    paid out of the month's trade flows, `sim/trade-flows.ts`), and what the
 *    province can bear on top is read off how much its hub really trades. A
 *    hub on a busy sea lane yields; a hill-valley with no road to anywhere
 *    yields next to nothing. It needs trade, and cuts of trade cut it.
 *  - **men**: a tribute of manpower owed by allies and subjects. No money, and
 *    the most resented of all, since the men do not come home.
 */

/** The share of what a province can bear that the old uniform levy took, and what a regime takes unless its ruler says otherwise. */
export const DEFAULT_TAX_RATE_BPS = 1_000;
/** Asked below this share, a rate is what people expect to pay; above it each thousand costs order. */
export const CUSTOMARY_TAX_RATE_BPS = 1_200;
/** Of the people in a province, the share a year a `men` tribute takes at the default rate: a twentieth of the tenth. */
export const MEN_PER_YEAR_SHARE = 0.05;
/** What each regime costs in order, per thousand basis points of rate, over and above the cost of the rate itself. */
export const REGIME_RESENTMENT_BPS: Readonly<Record<TaxRegime, number>> = { tithe: 150, land_levy: 400, customs: 100, men: 250 };
/** Each additional thousand basis points of rate above the customary one lowers where order settles by this much. */
export const OVER_CUSTOMARY_UNREST_BPS = 1_500;
/** How far a regime's yield loses to distance, as a share of the ordinary leak per step from the capital. */
export const REGIME_LEAK_SCALE: Readonly<Record<TaxRegime, number>> = { tithe: 0.6, land_levy: 1, customs: 0.5, men: 0 };

export interface TaxPolicy {
  readonly regime: TaxRegime;
  readonly rateBps: number;
  /** False for the old uniform levy: no policy was set anywhere, and the province is taxed as every province was. */
  readonly explicit: boolean;
}

/** What a province is taxed by where nobody has said how. */
export const UNIFORM_LEVY: TaxPolicy = { regime: "land_levy", rateBps: DEFAULT_TAX_RATE_BPS, explicit: false };

export const clampTaxRate = (rateBps: number): number => Math.max(0, Math.min(MAX_TAX_RATE_BPS, Math.round(rateBps)));

/**
 * The policy a province is taxed by: its own, where its row names one, else
 * the power's default, else the uniform levy. A row that names a regime only
 * takes the power's rate (or the default one), and a row that names a rate
 * only takes the power's regime.
 *
 * Whose default: the power that holds it now, not the one that owns it, since
 * an occupier governs the ground whoever's it is.
 */
export function taxPolicyIndex(world: Pick<WorldState, "economy">): (province: Pick<Province, "controllerPolityId">, row?: Pick<ProvinceMaterial, "taxRegime" | "taxRateBps">) => TaxPolicy {
  const defaults = new Map((economyOf(world).taxPolicies ?? []).map((policy) => [policy.polityId, policy]));
  return (province, row) => {
    const own = province.controllerPolityId === null ? undefined : defaults.get(province.controllerPolityId);
    if (row?.taxRegime === undefined && row?.taxRateBps === undefined) {
      return own === undefined ? UNIFORM_LEVY : { regime: own.regime, rateBps: own.rateBps, explicit: true };
    }
    return {
      regime: row.taxRegime ?? own?.regime ?? UNIFORM_LEVY.regime,
      rateBps: row.taxRateBps ?? own?.rateBps ?? DEFAULT_TAX_RATE_BPS,
      explicit: true,
    };
  };
}

/**
 * What a regime makes of a province's tax capacity, as a multiplier.
 *
 * Tithe follows the harvest: where the granaries stand at the ordinary level
 * it is 1, in a drought year about a third, in a glut a third more. Land levy
 * is steady. Customs is read off harbour and size until trade is modelled: a
 * port with a sizeable town is worth more than its land, an inland valley a
 * seventh of it. Men yields no money at all.
 */
export function regimeFactor(regime: TaxRegime, row: Pick<ProvinceMaterial, "foodSecurityBps">, _province: Pick<Province, "settlements">, trade?: number | undefined): number {
  switch (regime) {
    case "tithe": return Math.max(0.35, Math.min(1.3, row.foodSecurityBps / 8_000));
    case "land_levy": return 1;
    // What a province bears by customs is what its hub's trade can bear: its quays and stalls
    // (a fifth of the land) and the goods that pass, which are the market's own flows of the last month.
    case "customs": return trade === undefined ? CUSTOMS_STALLS_FACTOR : CUSTOMS_STALLS_FACTOR + Math.min(CUSTOMS_TRADE_FACTOR_MAX, CUSTOMS_TRADE_FACTOR_PER_INTENSITY * trade);
    case "men": return 0;
  }
}

/** What the quays and stalls of a customs province bear, as a share of the land levy: the dues that do not need goods in transit. */
export const CUSTOMS_STALLS_FACTOR = 0.15;
/** And what the trade through a hub adds: this much for every whole month's use of the hub's country that crosses it in a month, up to the most. */
export const CUSTOMS_TRADE_FACTOR_PER_INTENSITY = 2;
export const CUSTOMS_TRADE_FACTOR_MAX = 1.6;

/**
 * How much order a policy costs a province, as a downward shift in where it
 * settles (0 or negative). The old uniform levy costs nothing of its own; one
 * that is chosen costs what its regime is resented for, and more for each
 * thousand points of rate above the customary one.
 */
export function policyPressureBps(policy: TaxPolicy): number {
  if (!policy.explicit) return 0;
  const resentment = REGIME_RESENTMENT_BPS[policy.regime] * (policy.rateBps / 1_000);
  const overCustomary = Math.max(0, policy.rateBps - CUSTOMARY_TAX_RATE_BPS) / 1_000 * OVER_CUSTOMARY_UNREST_BPS;
  return -Math.round(resentment + overCustomary);
}
