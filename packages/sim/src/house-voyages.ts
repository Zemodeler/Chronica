import {
  customsOn,
  economyOf,
  stableHash,
  tradeTermsBetween,
  type GoodId,
  type MerchantHouse,
  type TradeVenture,
  type WorldState,
} from "@chronica/shared";

/**
 * What a merchant house's cargo risks and pays on the way in (docs/economy.md, "Who manages the economy").
 *
 * A cargo of the old kind -- a player's, or a ruler's -- sells at the margin the two markets make and that
 * is all of it. A house sends cargoes every month for years, and a trade that never loses a ship, never pays
 * a duty and never feeds a crew would turn a handful of families into a mint. So a house's cargo (and only
 * a house's: `houseOfVenture`) is given the things a real voyage had:
 *
 *  - **A chance of loss.** Shipwreck, pirates, a cargo seized in a port where the quarrel was not its own.
 *    Longer by sea and by days, worse where war has reached either end. A stableHash roll, the same on every
 *    replay of the same cargo.
 *  - **A crew and a chandler.** A share of what the cargo fetches goes to the men nobody names: sailors,
 *    shipwrights, dockers (the `the_unnamed` door).
 *  - **Customs.** The power whose market it lands in lays its rate on what comes from another power, brought
 *    down by any pact (`customsOn`); the duty is the treasury's, paid through the same door as every other
 *    customs (`sim/customs.ts`), so the merchant's profit is what is left after the state has had its share.
 *
 * Nothing here reads the whole world: a handful of finds in the economy's own list of houses.
 */

/** What a crew, a chandler and the dock take of a cargo's sale, in basis points. */
export const CREW_SHARE_BPS = 600;
/** What a house gives the power it lives under of what a cargo clears over its cost, in basis points: its rates and liturgies (the treasury's share of a merchant's year). */
export const LITURGY_OF_PROFIT_BPS = 600;
/** A cargo's chance of being lost on a voyage by sea before the days and the war are counted, in basis points. */
const SEA_BASE_LOSS_BPS = 90;
/** And over land, which has its own bandits and its own tolls. */
const LAND_BASE_LOSS_BPS = 40;
/** Each day of the voyage adds this much to the chance. */
const LOSS_PER_DAY_BPS = 7;
/** A war or a blockade at either end adds this much. */
const WAR_LOSS_BPS = 350;
/** However bad it is, a voyage is lost no oftener than this. */
const MAX_LOSS_BPS = 1_800;

/** The house a venture belongs to, or undefined: the head of a trading house owns it. */
export function houseOfVenture(world: Pick<WorldState, "economy">, venture: Pick<TradeVenture, "ownerCharacterId">): MerchantHouse | undefined {
  const houses = world.economy?.houses;
  if (houses === undefined || houses.length === 0) return undefined;
  return houses.find((house) => house.status === "trading" && house.headCharacterId === venture.ownerCharacterId);
}

/**
 * The chance, in basis points, that a house's cargo is lost on this voyage: by the sea or the road it takes,
 * the days it is out, and whatever war has reached either end (`openBps` of each end, from `routeOpenBps`).
 */
export function voyageLossBps(bySea: boolean, days: number, fromOpenBps: number, toOpenBps: number): number {
  const war = fromOpenBps < 10_000 || toOpenBps < 10_000 ? WAR_LOSS_BPS : 0;
  return Math.min(MAX_LOSS_BPS, (bySea ? SEA_BASE_LOSS_BPS : LAND_BASE_LOSS_BPS) + Math.max(0, days) * LOSS_PER_DAY_BPS + war);
}

/** Whether this cargo's voyage is the one that goes wrong: one roll a cargo, fixed by the cargo and the day it sailed. */
export function voyageIsLost(venture: Pick<TradeVenture, "id" | "cargo">, lossBps: number): boolean {
  const cargo = venture.cargo;
  if (cargo === undefined) return false;
  return stableHash([venture.id, "voyage-lost", String(cargo.voyages), String(cargo.sailedAtStep)]) % 10_000 < lossBps;
}

/**
 * The duty on a cargo's sale, in basis points of what it fetches: nothing at home, else the rate of the power
 * whose market it lands in, as a pact or an embargo leaves it. Never above the customs the law allows.
 */
export function dutyOnCargoBps(world: WorldState, ownPolityId: string | null, landedPolityId: string | null, good: GoodId | undefined): number {
  if (ownPolityId === null || landedPolityId === null || ownPolityId === landedPolityId || good === undefined) return 0;
  const rate = economyOf(world).customsRates.find((entry) => entry.polityId === landedPolityId)?.rateBps ?? 0;
  if (rate <= 0) return 0;
  return customsOn(tradeTermsBetween(world, ownPolityId, landedPolityId), rate, good);
}
