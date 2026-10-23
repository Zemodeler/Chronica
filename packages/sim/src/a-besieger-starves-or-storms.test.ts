import { describe, expect, it } from "vitest";
import { withTheConsularArmyOnceDrawn } from "./the-opening-as-it-was";
import { besiegerOrder } from "./campaign-orders";
import { aSiegeLaid, atWar, forceOf, ledBy, neighboursOf, romeAndCarthageAlone, strategyCtx, withMen } from "./war-plan-kit";

/**
 * A besieger starves the city, or storms it, or goes away.
 *
 * Sieges were decided by pressure and the daily chance, and the man outside the walls had no say. Now the besieger reads his
 * bread, the garrison, the breach and the danger of a relief, and by his nature chooses: to sit and starve it, to carry it by
 * assault, or to raise the siege rather than be caught between the walls and an army come to the relief.
 */
describe("a besieger starves the city, or storms it, or goes away", () => {
  const laid = aSiegeLaid(withTheConsularArmyOnceDrawn(romeAndCarthageAlone(atWar(120))));
  const siege = laid.sieges.find((entry) => entry.status === "active")!;
  const withPressure = (world: typeof laid, pressureBps: number) => ({ ...world, sieges: world.sieges.map((entry) => (entry.id === siege.id ? { ...entry, pressureBps } : entry)) });
  const order = (world: typeof laid) => besiegerOrder(strategyCtx(world, "rome", ["carthage"]), forceOf(world, "roman-field-army"));

  it("has a siege to speak of", () => {
    expect(siege).toBeDefined();
    expect(siege.forceId).toBe("roman-field-army");
  });

  it("waits for hunger to do its work, when he is careful and has no cause to hurry", () => {
    const careful = withPressure(ledBy(laid, "roman-field-army", { boldness: 20, caution: 85, strategist: 40 }), 3_000);
    expect(order(careful)).toBeNull();
  });

  it("storms a breached city when he is bold and the stronger by half", () => {
    const bold = withPressure(ledBy(withMen(laid, "carthaginian-garrison", 1_000), "roman-field-army", { boldness: 85, caution: 20 }), 6_000);
    const decision = order(bold);
    expect(decision?.act).toBe("besiege");
    expect(decision!.deltas.some((delta) => delta.op === "siege_lay" && delta.assault === true)).toBe(true);
  });

  it("does not storm a whole wall: he builds for it first, if he is bold and skilled", () => {
    const bold = withPressure(ledBy(withMen(laid, "carthaginian-garrison", 1_000), "roman-field-army", { boldness: 85, caution: 20, strategist: 75 }), 1_000);
    const decision = order({ ...bold, instant: { ...bold.instant, day: bold.instant.day + 30 } , elapsedStep: bold.elapsedStep + 30 });
    expect(decision?.deltas.some((delta) => delta.op === "siege_lay" && delta.assault === true)).not.toBe(true);
  });

  it("raises the siege when an army more than half again his own comes to its relief, if he is a careful man", () => {
    const army = ledBy(laid, "roman-field-army", { boldness: 30, caution: 70 });
    const coming = { ...army, material: { ...army.material, forces: [...army.material.forces, { ...forceOf(army, "carthaginian-garrison"), id: "relief", name: "The relieving army", locationId: neighboursOf(army, "afr-9sdex")[0]! }] } };
    const decision = order(withMen(coming, "relief", 20_000));
    expect(decision?.act).toBe("fall_back");
    expect(decision!.deltas.some((delta) => delta.op === "siege_lift")).toBe(true);
    expect(decision!.why).toContain("relief");
  });

  it("does not run from a relief that is weaker than he is", () => {
    const army = ledBy(laid, "roman-field-army", { boldness: 30, caution: 70 });
    const coming = { ...army, material: { ...army.material, forces: [...army.material.forces, { ...forceOf(army, "carthaginian-garrison"), id: "relief", name: "The relieving army", locationId: neighboursOf(army, "afr-9sdex")[0]! }] } };
    expect(order(withMen(coming, "relief", 2_000))?.act).not.toBe("fall_back");
  });
});
