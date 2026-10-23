import { describe, expect, it } from "vitest";
import { OrderPartSchema, isOrderPartStale, orderPartStatus, type OrderPart, type WorldState } from "@chronica/shared";
import { opening } from "./fiscal-test-kit";
import { lineOf, namedForceRaised } from "./order-outcomes";
import { carriedOutLine } from "./order-lines";

/**
 * "Nothing came of it that anyone could see", under an estate that was bought, a
 * venture that was closed, a convoy that arrived: the ledger read each part from
 * the world, and an act that was done by being done left nothing for it to read.
 * A part is told from what the world shows.
 */

const part = (change: Record<string, unknown> = {}): OrderPart => OrderPartSchema.parse({ said: "Buy a small estate near Capua.", ...change });
const world = (): WorldState => opening(150);

describe("what came of an order", () => {
  it("is done where every act it wrote was done by being done (the purse debited, the holding made)", () => {
    expect(orderPartStatus(world(), part({ actsCarried: 1, actsDone: 1 }))).toBe("achieved");
    expect(orderPartStatus(world(), part({ actsCarried: 2, actsDone: 2 }))).toBe("achieved");
  });

  it("is not done where an act of it is only begun, and says so, not 'nothing'", () => {
    const begun = part({ said: "Write to Hiero.", actsCarried: 1, actsDone: 0 });
    expect(orderPartStatus(world(), begun)).toBe("carried_unverified");
    expect(lineOf(world(), begun, "x")).toMatch(/ordered; no sign of it yet/);
  });

  it("is partly done where one act of it was refused", () => {
    expect(orderPartStatus(world(), part({ actsCarried: 1, actsDone: 1, actsRefused: 1 }))).toBe("partly_done");
  });

  it("goes stale and is closed when two months show nothing for what was ordered, and does not stand under way for years", () => {
    const w = { ...world(), elapsedStep: 400 };
    const ordered = part({ said: "Hold the army.", actsCarried: 1, actsDone: 0 });
    expect(isOrderPartStale(w, { givenAtStep: 390 }, ordered)).toBe(false);
    expect(isOrderPartStale(w, { givenAtStep: 300 }, ordered)).toBe(true);
    // And an order that was done is never stale: it is done.
    expect(isOrderPartStale(w, { givenAtStep: 300 }, part({ actsCarried: 1, actsDone: 1 }))).toBe(false);
  });

  it("says what was carried out when nothing public came of it", () => {
    expect(carriedOutLine([{ carried: true, said: "Buy a small estate near Capua." }, { carried: false, said: "Refused." }])).toBe("It was carried out: Buy a small estate near Capua.");
    expect(carriedOutLine([])).toBe("It was carried out.");
  });

  it("does not take a petition that mentions raising an army for the raising of it", () => {
    const w = world();
    const name = w.material.forces[0]!.name;
    expect(namedForceRaised(w, `Ask the consul to raise the matter of ${name}, called ${name}`)).toBeUndefined();
    expect(namedForceRaised(w, `Speak for me before the Senate: the army called ${name} is to be raised`)).toBeUndefined();
    expect(namedForceRaised(w, `Raise a second army called ${name}`)?.name).toBe(name);
  });
});
