import { describe, expect, it } from "vitest";
import { lastCensus, rollFreshness, taxBurdens } from "@chronica/shared";
import { atDay, carryOut, decideTheMonth, opening } from "./government-test-kit";

/**
 * A censor takes the roll.
 *
 * The censors close the lustrum every fifth year: the people counted are written down, and the tax roll counts them truly for five years after, and less truly the longer it
 * goes untaken. A power with nobody given the roll takes none.
 */
const census = (world: ReturnType<typeof opening>, day: number, polityId = "rome") => decideTheMonth(atDay(world, day), day).filter((d) => d.polityId === polityId && /^census/.test(d.why));

describe("a censor takes the roll", () => {
  it("takes it in some month of the first five years, by a censor, and records it", () => {
    const world = opening();
    let found: { day: number; decision: ReturnType<typeof census>[number] } | undefined;
    for (let day = 90; day <= 1_800 && found === undefined; day += 30) {
      const [decision] = census(world, day);
      if (decision !== undefined) found = { day, decision };
    }
    expect(found, "the censors of Rome take the roll within the five years").toBeDefined();
    const censors = world.material.officeSeats.filter((s) => s.officeId === "roman-censor").map((s) => s.holderCharacterId);
    expect(censors).toContain(found!.decision.actorCharacterId);
    const done = carryOut(atDay(world, found!.day), found!.decision);
    expect(done.rejected).toEqual([]);
    expect(lastCensus(done.world, "rome")).toBe(found!.day);
    // Not again for the lustrum.
    for (let day = found!.day + 30; day < found!.day + 1_600; day += 120) expect(census(atDay(done.world, day), day)).toEqual([]);
  });

  it("is due again in the sixth year", () => {
    const world = opening();
    let first = 0;
    for (let day = 90; day <= 1_800 && first === 0; day += 30) if (census(world, day).length > 0) first = day;
    const done = carryOut(atDay(world, first), census(world, first)[0]!).world;
    let again: number | undefined;
    for (let day = first + 1_700; day <= first + 2_100 && again === undefined; day += 30) if (census(atDay(done, day), day).length > 0) again = day;
    expect(again).toBeDefined();
  });

  it("counts the people truly while the roll is fresh and less truly once it is stale", () => {
    const world = opening();
    const withRoll = (at: number | null, now: number) => ({
      ...atDay(world, now),
      genericEntities: at === null ? world.genericEntities : [...world.genericEntities, { id: "c", kind: "census", label: "The census", ownerRef: { kind: "polity" as const, id: "rome" }, attributes: { atStep: at }, linkedEntityIds: [], createdAtStep: at, provenanceEventIds: [], effects: [] }],
    });
    expect(rollFreshness(withRoll(null, 100), "rome")).toBe(1);
    expect(rollFreshness(withRoll(0, 100), "rome")).toBeGreaterThan(1);
    expect(rollFreshness(withRoll(0, 4_000), "rome")).toBeLessThan(1);
    const bearable = (w: ReturnType<typeof withRoll>) => taxBurdens(w).get("rome")!.bearable;
    expect(bearable(withRoll(0, 100))).toBeGreaterThan(bearable(withRoll(null, 100)));
    expect(bearable(withRoll(0, 4_000))).toBeLessThan(bearable(withRoll(null, 4_000)));
  });
});
