import { describe, expect, it } from "vitest";
import { GENS_PASS_DAYS, keepGentes } from "./gentes";
import { opening, thinks, withDay, named } from "./gentes-test-kit";

/**
 * The monthly pass over the gentes is a function of the world and the day, and cheap: O(gentes + characters), about a hundred gentes and
 * four hundred people at the opening.
 */
describe("the gentes pass is the same and small", () => {
  const start = opening();

  it("gives the same world when it is run twice over ten years", () => {
    const run = () => {
      let world = thinks(start, named(start, "Gaius Claudius Canina").id, named(start, "Lucius Postumius Megellus").id, -80);
      const facts: string[] = [];
      for (let month = 1; month <= 120; month += 1) {
        const kept = keepGentes(withDay(world, month * GENS_PASS_DAYS), month * GENS_PASS_DAYS);
        world = kept.world;
        facts.push(...kept.facts.map((fact) => fact.summary));
      }
      return { gentes: world.gentes, facts };
    };
    expect(run()).toEqual(run());
  });

  it("does nothing between months: a call inside the month returns the very same world", () => {
    const first = keepGentes(withDay(start, GENS_PASS_DAYS), GENS_PASS_DAYS).world;
    const again = keepGentes(withDay(first, GENS_PASS_DAYS + 5), GENS_PASS_DAYS + 5);
    expect(again.world.gentes).toBe(first.gentes);
    expect(again.facts).toEqual([]);
  });

  it("takes a few milliseconds a month, at the size of the opening", () => {
    const warm = keepGentes(withDay(start, GENS_PASS_DAYS), GENS_PASS_DAYS).world;
    const times: number[] = [];
    let world = warm;
    for (let month = 2; month <= 61; month += 1) {
      const day = month * GENS_PASS_DAYS;
      const began = performance.now();
      world = keepGentes(withDay(world, day), day).world;
      times.push(performance.now() - began);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)]!;
    const worst = times[times.length - 1]!;
    // eslint-disable-next-line no-console
    console.log(`gentes pass: ${start.gentes.length} gentes, ${start.characters.length} characters, median ${median.toFixed(2)} ms, worst ${worst.toFixed(2)} ms`);
    expect(median).toBeLessThan(25);
    expect(worst).toBeLessThan(150);
  });
});
