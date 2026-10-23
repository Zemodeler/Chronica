import { describe, expect, it } from "vitest";
import type { WorldState } from "@chronica/shared";
import { HUBS, bareNeighbours, bookOf, flow, inflowOf, opening, outflowOf, priceOf, setStock } from "./trade-test-kit";

/**
 * A blockade stops the sea trade (phase D of the economy rework).
 *
 * Carthage's city and Lilybaeum in Sicily are three hundred kilometres apart
 * by water, and the sea is what makes the grain of Africa cheap in Sicily: the
 * same road by land would cost five times as much. A fleet sitting off a
 * harbour (`world.blockades`) shuts its sea trade as tightly as it holds it:
 * a few ships make the passage dearer, a squadron that seals the harbour stops
 * it altogether. The land roads out of the hub go on, at the price of a hub
 * that is cut off from the world.
 */

const { carthage, lilybaeum } = HUBS;

const blockaded = (world: WorldState, provinceId: string, tightnessBps: number): WorldState => ({
  ...world,
  blockades: [...world.blockades, {
    id: `blockade_${provinceId}`,
    provinceId,
    blockadedPolityId: "carthage",
    blockaderPolityId: "rome",
    fleetIds: ["rome-fleet"],
    sinceStep: 0,
    tightnessBps,
    status: "active" as const,
    endedAtStep: null,
  }],
});

/** Lilybaeum short of grain, with Carthage's city the only hub that can send it any. */
function relief(world: WorldState): { inflow: number; sent: number; price: number } {
  const book = bookOf(world);
  setStock(book, lilybaeum, "grain", 0.3);
  bareNeighbours(world, book, lilybaeum, [carthage], "grain");
  flow(world, book);
  return { inflow: inflowOf(book, lilybaeum, "grain"), sent: outflowOf(book, carthage, "grain"), price: priceOf(book, lilybaeum, "grain") };
}

describe("a blockade stops the sea trade", () => {
  it("carries grain from Carthage's city to Lilybaeum by sea while the harbour is open", () => {
    const free = relief(opening());
    expect(free.inflow).toBeGreaterThan(0);
    expect(free.sent).toBeGreaterThan(0);
  });

  it("stops it altogether when a fleet seals the harbour", () => {
    const sealed = relief(blockaded(opening(), lilybaeum, 10_000));
    expect(sealed.inflow).toBe(0);
    expect(sealed.sent).toBe(0);
    // And the same at the other end: the harbour of Carthage is shut as well.
    expect(relief(blockaded(opening(), carthage, 10_000)).inflow).toBe(0);
  });

  it("makes the passage dearer, and so the relief smaller, when the blockade is loose", () => {
    const free = relief(opening());
    const loose = relief(blockaded(opening(), lilybaeum, 4_000));
    expect(loose.inflow).toBeGreaterThan(0);
    expect(loose.inflow).toBeLessThan(free.inflow);
    expect(loose.price).toBeGreaterThan(free.price);
  });

  it("leaves the trade of other harbours alone, and a blockade that has ended is no blockade", () => {
    const world = blockaded(opening(), HUBS.sardinia, 10_000);
    expect(relief(world).inflow).toBeGreaterThan(0);
    const ended: WorldState = { ...blockaded(opening(), lilybaeum, 10_000), blockades: [{ ...blockaded(opening(), lilybaeum, 10_000).blockades[0]!, status: "ended", endedAtStep: 5 }] };
    expect(relief(ended).inflow).toBeGreaterThan(0);
  });

  it("does not stop a land road: a hub the fleet shuts off from the sea is still fed by land at a hub's heavy price", () => {
    const world = blockaded(opening(), lilybaeum, 10_000);
    const book = bookOf(world);
    setStock(book, lilybaeum, "grain", 0.1);
    flow(world, book);
    // Panormus and Agrigentum, its neighbours by land, send it what they can spare.
    expect(inflowOf(book, lilybaeum, "grain")).toBeGreaterThan(0);
  });
});
