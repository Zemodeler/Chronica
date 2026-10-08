import { describe, expect, it } from "vitest";
import { keepTheBodies } from "./bodies";
import { atDay, decideTheMonth, famine, government, holdersOfOffice, opening, question, withChest, withWar } from "./government-test-kit";
import { decideStatecraft } from "./statecraft";

/**
 * A government month: what the magistrates and the bodies cost.
 *
 * A month of the whole Punic world (sixty-odd powers, a thousand offices) with a war on, bread dear and a hundred questions before the chambers, must be settled within a
 * budget a month's tick can bear; the same month decided twice is the same.
 */

describe("a government month", () => {
  const world = (() => {
    let w = withChest(withWar(famine(opening(), "rome", 16_000, 1), "rome", "carthage"), "rome", 3_000_000);
    const sponsor = holdersOfOffice(w, "roman-consul")[0]!;
    for (let n = 0; n < 100; n += 1) w = question(w, { id: `q${n}`, bodyId: n % 3 === 0 ? "roman-comitia-centuriata" : "roman-senate", sponsor, label: `Motion of a consul: that matter ${n} be settled`, concerns: ["taxes"], openedAt: 100, votesOn: 200 });
    return atDay(w, 240);
  })();

  it("costs the magistrates and the bodies little, and the same twice", () => {
    decideTheMonth(world, 240);
    const t0 = performance.now();
    const first = decideTheMonth(world, 240);
    const magistrates = performance.now() - t0;
    const t1 = performance.now();
    const sat = keepTheBodies({ world, offices: government.offices, successionRules: government.successionRules, toDay: 240 });
    const bodies = performance.now() - t1;
    // eslint-disable-next-line no-console
    console.log(`a government month: magistrates ${magistrates.toFixed(1)} ms (${first.length} decisions), bodies ${bodies.toFixed(1)} ms`);
    expect(magistrates).toBeLessThan(250);
    expect(bodies).toBeLessThan(250);
    expect(JSON.stringify(decideTheMonth(world, 240))).toBe(JSON.stringify(first));
    expect(JSON.stringify(keepTheBodies({ world, offices: government.offices, successionRules: government.successionRules, toDay: 240 }).world.material.politicalProcedures)).toBe(JSON.stringify(sat.world.material.politicalProcedures));
  });

  it("is a small part of the world's own monthly pass", () => {
    const base = { world, gameId: "g", excludedPolityIds: new Set(["none"]), playedByModel: new Set<string>(), playerCharacterId: null, nearPlayer: null, pressures: [], offices: government.offices };
    const t = performance.now();
    decideStatecraft(base);
    const all = performance.now() - t;
    // eslint-disable-next-line no-console
    console.log(`the world's whole monthly pass (statecraft with the books and the magistrates): ${all.toFixed(1)} ms`);
    expect(all).toBeLessThan(1_500);
  });
});
