import { punicWarsScenario } from "@chronica/db";
import {
  GOODS,
  WorldStateSchema,
  economyOf,
  ensureMarkets,
  ensureProvinceMaterial,
  goodIndex,
  marketGeography,
  priceBpsFrom,
  type GoodId,
  type PolityAgreement,
  type WorldState,
} from "@chronica/shared";
import { cutOffHubs, openBook, type Book } from "./markets";
import { tradeMonth, type FlowResult } from "./trade-flows";

/**
 * The few things the trade tests share: the Punic opening with its markets
 * opened, a book of its hubs to push goods through, and the hubs the tests
 * stand on. Not a test itself.
 */

/** Hubs on the Punic map, by what they are: the cities of the powers the trade tests set against one another. */
export const HUBS = {
  /** Rome's own hub, and Capua's (also Rome's), 200 km apart over land. */
  rome: "it-l865w",
  capua: "it-hn4oo",
  /** Carthage's city; a hub of the north African coast (53 km, land) and Lilybaeum in Sicily (297 km, sea). */
  carthage: "afr-9sdex",
  utica: "afr-nh05y",
  lilybaeum: "sic-4z01i",
  /** Agrigentum, a Carthaginian hub, and Syracuse, 151 km from it over land across the border. */
  agrigentum: "sic-doquc",
  syracuse: "sic-ecyan",
  /** Sardinia's hub (Carthaginian), reached from Rome by sea. */
  sardinia: "sard-21ha8",
} as const;

export const POWERS = { rome: "rome", carthage: "carthage", syracuse: "syracuse" } as const;

/** The Punic opening with its markets opened (six months of grain to the harvest). */
export const opening = (): WorldState => ensureMarkets(ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0));

export const rowsOf = (world: WorldState) => new Map(world.material.provinceMaterial.map((row) => [row.provinceId, row]));

export const bookOf = (world: WorldState, toHarvest = 6): Book => openBook(world, toHarvest);

/** Push a hub's stock of a good to a share of its target, and price it as the hub would. */
export function setStock(book: Book, hubId: string, good: GoodId, shareOfTarget: number): void {
  const hub = book.get(hubId)!;
  const index = goodIndex(good);
  hub.stock[index] = hub.target[index]! * shareOfTarget;
  hub.price[index] = priceBpsFrom(GOODS[index]!, hub.stock[index], hub.target[index]!);
}

/** One month of trade through a book, as the monthly pass runs it. */
export function flow(world: WorldState, book: Book, toHarvest = 6): FlowResult {
  const cut = cutOffHubs(world, marketGeography(world).hubs);
  return tradeMonth(book, { world, rows: rowsOf(world), cut, toHarvest });
}

export const priceOf = (book: Book, hubId: string, good: GoodId): number => book.get(hubId)!.price[goodIndex(good)]!;
export const stockOf = (book: Book, hubId: string, good: GoodId): number => book.get(hubId)!.stock[goodIndex(good)]!;
export const inflowOf = (book: Book, hubId: string, good: GoodId): number => book.get(hubId)!.inflow[goodIndex(good)]!;
export const outflowOf = (book: Book, hubId: string, good: GoodId): number => book.get(hubId)!.outflow[goodIndex(good)]!;

/** Every hub's grain left bare beside one: so that a flow into that hub can come only from where the test says. */
export function bareNeighbours(world: WorldState, book: Book, hubId: string, except: readonly string[], good: GoodId): void {
  for (const near of marketGeography(world).neighbours.get(hubId) ?? []) {
    if (except.includes(near.hubId)) continue;
    setStock(book, near.hubId, good, 0.4);
  }
}

/** An agreement between two powers, written as the world would hold it. */
export function agreement(kind: PolityAgreement["kind"], polityId: string, otherPolityId: string, more: Partial<PolityAgreement> = {}): PolityAgreement {
  return {
    id: `${kind}_${polityId}_${otherPolityId}`,
    kind,
    polityId,
    otherPolityId,
    terms: `A ${kind} between them.`,
    sinceStep: 0,
    untilStep: null,
    sourceMessageId: null,
    status: "active",
    endedAtStep: null,
    endedReason: null,
    visibility: "public",
    ...more,
  };
}

/** The world with agreements added, or with a customs rate set. */
export const withAgreements = (world: WorldState, ...added: PolityAgreement[]): WorldState => ({ ...world, polityAgreements: [...world.polityAgreements, ...added] });
export const withCustoms = (world: WorldState, polityId: string, rateBps: number): WorldState => ({
  ...world,
  economy: { ...economyOf(world), customsRates: [...economyOf(world).customsRates.filter((entry) => entry.polityId !== polityId), { polityId, rateBps }] },
});
