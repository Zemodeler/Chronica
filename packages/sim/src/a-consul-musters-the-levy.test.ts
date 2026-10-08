import { describe, expect, it } from "vitest";
import { type WorldState } from "@chronica/shared";
import { readBoard } from "./board";
import { atDay, carryOut, decideTheMonth, opening, withChest, withIncome, withWar } from "./government-test-kit";

/**
 * A consul musters the levy.
 *
 * At war with the host thin, the consul holds the dilectus in the month the year's magistrates take it up (the third month); the peoples bound to Rome by the
 * foedus send the contingents they owe when Rome is at war; and an army that has eaten what it carried is fed out of the chest, within the consul's allowance, the
 * rest the Senate's. A tribune's word stands against the levy while it stands.
 */

/** Rome at war with Carthage and with no army in the field. */
function romeWithoutAnArmy(): WorldState {
  const world = withChest(withIncome(withWar(opening(), "rome", "carthage"), "rome", 1), "rome", 3_000_000);
  return { ...world, material: { ...world.material, forces: world.material.forces.filter((force) => force.polityId !== "rome") } };
}
const levyDecisions = (world: WorldState, day: number, kind = /^dilectus/) => decideTheMonth(atDay(world, day), day).filter((d) => d.polityId === "rome" && kind.test(d.why));

describe("a consul musters the levy", () => {
  it("holds the dilectus in the third month of the year, and not in the rest", () => {
    const world = romeWithoutAnArmy();
    const march = levyDecisions(world, 430);
    expect(march.length).toBe(1);
    const consuls = world.material.officeSeats.filter((seat) => seat.officeId === "roman-consul").map((seat) => seat.holderCharacterId);
    expect(consuls).toContain(march[0]!.actorCharacterId);
    expect(march[0]!.deltas[0]).toMatchObject({ op: "force_create", polityId: "rome" });
    for (const day of [160, 220, 280, 340, 520, 580]) expect(levyDecisions(world, day), `day ${day}`).toEqual([]);
  });

  it("carries the levy out as the consul's own: the men are raised, and not again for the year", () => {
    const world = romeWithoutAnArmy();
    const [decision] = levyDecisions(world, 430);
    const done = carryOut(atDay(world, 430), decision!);
    expect(done.rejected).toEqual([]);
    expect(done.world.material.forces.some((force) => force.polityId === "rome")).toBe(true);
    expect(levyDecisions(atDay(done.world, 460), 460)).toEqual([]);
  });

  it("calls nobody out where the host is full or there is no war", () => {
    expect(levyDecisions(withChest(opening(), "rome", 3_000_000), 430)).toEqual([]);
  });

  it("sends the contingents the allies owe when their leader is at war", () => {
    const world = withWar(opening(), "rome", "carthage");
    const board = readBoard(world);
    const ally = [...board.values()].find((reading) => reading.leaderId === "rome" && reading.fielded < 800);
    expect(ally, "an ally of Rome with next to no men in the field").toBeDefined();
    const found = decideTheMonth(atDay(world, 200), 200).filter((d) => d.polityId === ally!.polityId && /^muster/.test(d.why));
    expect(found).toHaveLength(1);
    expect(found[0]!.deltas[0]).toMatchObject({ op: "force_create", polityId: ally!.polityId });
    expect(found[0]!.targetPolityId).toBe("rome");
  });

  it("feeds a hungry army out of the chest, and lays more than the allowance before the Senate", () => {
    const base = withChest(withIncome(withWar(opening(), "rome", "carthage"), "rome", 1), "rome", 3_000_000);
    const hungry: WorldState = { ...base, material: { ...base.material, forces: base.material.forces.map((force) => (force.polityId === "rome" ? { ...force, provisionStatus: "shortage" as const, provisionedThroughStep: 0 } : force)) } };
    const fed = [150, 180, 210, 240].flatMap((day) => decideTheMonth(atDay(hungry, day), day)).filter((d) => d.polityId === "rome" && /^(supply|asked the Senate that the bread)/.test(d.why));
    expect(fed.length).toBeGreaterThan(0);
    for (const decision of fed) expect(decision.deltas[0]!.op).toMatch(/force_provision|political_procedure_open/);
  });
});
