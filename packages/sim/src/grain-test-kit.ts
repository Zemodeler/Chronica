import { economyOf, ensureMarkets, goodSpec, marketGeography, priceBpsFrom, type WorldState } from "@chronica/shared";
import { opening, withChest } from "./fiscal-test-kit";

/**
 * A kit for the tests of grain bought with the state's silver and of armies fed by contract: the Punic opening with its markets reckoned, a hub's
 * grain set to a share of its target, and a world in which every market but the one asked about is stocked well past what it needs.
 */

/** A hub's grain set to a share of its target (the price follows). */
export function withGrain(world: WorldState, hubId: string, share: number): WorldState {
  const memory = economyOf(world);
  return {
    ...world,
    economy: {
      ...memory,
      markets: memory.markets.map((hub) => (hub.hubId !== hubId ? hub : {
        ...hub,
        goods: hub.goods.map((good) => {
          if (good.good !== "grain") return good;
          const stock = Math.round(good.target * share);
          return { ...good, stock, priceBps: priceBpsFrom(goodSpec("grain"), stock, good.target) };
        }),
      })),
    },
  };
}

/** The Punic opening at a day with its markets reckoned, Rome's chest set, and every hub but `except` stocked to `share` of its target. */
export function stockedWorld(day = 150, share = 2.2, except: readonly string[] = [], chest = 3_000_000): WorldState {
  let world = ensureMarkets(withChest(opening(day), "rome", chest));
  for (const hub of marketGeography(world).hubs) if (!except.includes(hub)) world = withGrain(world, hub, share);
  return world;
}
