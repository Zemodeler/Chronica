import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { advanceWorldTo, ScenarioDefinitionSchema, WorldStateSchema, type WorldState } from "@chronica/shared";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";

/**
 * The scenario's own economy, run forward until it bites.
 *
 * `tick.test.ts` proves the arrears rules work by building a force, an
 * obligation and an empty treasury by hand. That is the test that passed
 * through eight scenario versions in which no force in the shipped world
 * referenced any obligation at all: the mechanism was right and nothing used
 * it. This one authors nothing. It takes the world a player actually starts
 * in and runs the clock.
 *
 * The Mamertines are the power this reaches first, and by design: 63 a month
 * in from the tolls on the strait against 120 owed to the soldiery, on a
 * chest of 600. Everything here is a consequence of those four numbers.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

/** Runs the world forward a month at a time, as a burst catching up would. */
function runMonths(world: WorldState, months: number): WorldState {
  const ids = createIdFactory("unpaid");
  let current = world;
  for (let month = 0; month < months; month += 1) {
    const toDay = current.instant.day + 30;
    current = advanceWorldTo(
      runDeterministicTick({ world: current, toDay, ids, warfare: definition.warfare }).world,
      { day: toDay, minute: 0 },
    );
  }
  return current;
}

const garrison = (world: WorldState) => world.material.forces.find((force) => force.id === "mamertine-garrison")!;
const fit = (world: WorldState) => garrison(world).personnel.reduce((sum, category) => sum + category.fit, 0);

describe("an army whose treasury runs dry", () => {
  it("keeps paying while there is money, and the men know nothing about it", () => {
    const after = runMonths(opening(), 9);
    expect(after.material.obligations.find((o) => o.id === "mamertine-soldiery")!.missedPeriods).toBe(0);
    expect(garrison(after).payArrearsPeriods).toBe(0);
    expect(garrison(after).moraleBps).toBe(garrison(opening()).moraleBps);
  });

  it("reaches the garrison holding Messana once the chest is empty", () => {
    const after = runMonths(opening(), 12);
    const owed = after.material.obligations.find((o) => o.id === "mamertine-soldiery")!;

    expect(owed.missedPeriods).toBeGreaterThan(0);
    // The point of the whole exercise: the arrears are not merely on the
    // books, they have reached the men. Before this was wired the obligation
    // read exactly the same and the force read as though nothing had happened.
    expect(garrison(after).payArrearsPeriods).toBe(owed.missedPeriods);
    expect(garrison(after).moraleBps).toBeLessThan(garrison(opening()).moraleBps);
  });

  it("costs the Mamertines their men, having first cost them their morale", () => {
    const opened = opening();
    const morale = runMonths(opened, 11);
    const desertion = runMonths(opened, 18);

    // `arrearsMoralePeriods: 1`, `arrearsDesertionPeriods: 2` -- so spirits go
    // first and the men follow, and never the other way round.
    expect(morale.material.forces.find((f) => f.id === "mamertine-garrison")!.moraleBps).toBeLessThan(garrison(opened).moraleBps);
    expect(fit(morale)).toBe(fit(opened));
    expect(fit(desertion)).toBeLessThan(fit(opened));

    // Desertion is permanent, and the establishment shrinks with it: the
    // garrison cannot go on reading as 1,600 strong on paper.
    const deserted = desertion.material.forces.find((f) => f.id === "mamertine-garrison")!;
    expect(deserted.authorizedStrength).toBe(fit(desertion));
  });

  it("leaves the solvent powers alone", () => {
    const after = runMonths(opening(), 18);
    for (const id of ["rome-legion-pay", "carthage-fleet-pay", "syracuse-squadron-pay", "syracuse-army-pay", "rome-allied-hulls"]) {
      expect(after.material.obligations.find((o) => o.id === id)!.missedPeriods).toBe(0);
    }
    expect(after.material.forces.filter((force) => force.payArrearsPeriods > 0).map((force) => force.id)).toEqual(["mamertine-garrison"]);
  });
});
