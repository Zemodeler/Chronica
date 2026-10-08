import { describe, expect, it } from "vitest";
import { hubOf, type WorldState } from "@chronica/shared";
import { months, opening, priceOf, romeFieldArmy, stockOf } from "./equipment-test-kit";

/**
 * A war drains the metal market.
 *
 * Metals and timber had prices and no buyer among the armies: a war made no sword dear. Now the quartermaster re-arms an army worn by campaigning out of the hubs behind it, through the
 * market door, the stock leaving the hubs; the more armies are worn, the more metal is drawn, and the dearer it is the less a month's stoppage buys.
 */
const START = opening();
const HUB = hubOf(START, romeFieldArmy(START).locationId)!;

/** The same world, with every Roman army's kit worn to `kit` (or left unlooked-at when it is `null`). */
const withKit = (world: WorldState, kit: number): WorldState => ({
  ...world,
  material: {
    ...world.material,
    forces: world.material.forces.map((force) => (force.polityId === "rome" && force.payObligationId !== null ? { ...force, equipmentBps: kit, equipmentReckonedToStep: 0 } : force)),
  },
});

describe("a war drains the metal market", () => {
  // The markets open in the first month; the armies are worn in one world and sound in the other.
  const opened = months(START, 0, 1, "drain-open");
  const worn = months(withKit(opened, 3_000), 1, 6, "drain");
  const sound = months(withKit(opened, 10_000), 1, 6, "drain");

  it("draws metal out of the hubs behind an army that has been worn by the work", () => {
    expect(stockOf(worn, HUB, "metals")).toBeLessThan(stockOf(sound, HUB, "metals"));
    expect(stockOf(worn, HUB, "textiles")).toBeLessThan(stockOf(sound, HUB, "textiles"));
  });

  it("makes metal dearer where the war has drawn it", () => {
    expect(priceOf(worn, HUB, "metals")).toBeGreaterThan(priceOf(sound, HUB, "metals"));
  });

  it("restores the army's kit by what it bought, and no more than the month's stoppage", () => {
    expect(romeFieldArmy(worn).equipmentBps!).toBeGreaterThan(3_000);
    expect(romeFieldArmy(sound).equipmentBps!).toBeLessThanOrEqual(10_000);
    const bought = worn.material.transactions.filter((txn) => txn.external === "market" && txn.cause.explanation.startsWith("Arms, clothing and shafts"));
    expect(bought.length).toBeGreaterThan(0);
  });
});
