import { describe, expect, it } from "vitest";
import { aMonth, atWar, forceOf, romeAndCarthageAlone } from "./war-plan-kit";

/**
 * A new consul takes up the plan.
 *
 * The orders an army had, and the plan's man of the theatre, stayed in the name of a consul who had left the command (a playtest found
 * "Genucius sends the army" on the books a year after he went home). When the man who commands changes, the orders are written again in the
 * new man's name, and the plan names the new man at the head of the theatre.
 */
describe("a new consul takes up the plan", () => {
  const start = romeAndCarthageAlone(atWar(120));
  const first = aMonth(start);
  const successor = start.characters.find((character) => character.polityId === "rome" && character.alive && character.id !== "gaius-genucius" && !start.material.forces.some((force) => force.commanderCharacterId === character.id))!;
  const changed = {
    ...first.world, instant: { ...first.world.instant, day: 130 }, elapsedStep: 130,
    material: { ...first.world.material, forces: first.world.material.forces.map((force) => (force.id === "roman-field-army" ? { ...force, commanderCharacterId: successor.id, controllerCharacterId: successor.id } : force)) },
  };
  const next = aMonth(changed);

  it("writes the orders again in the new man's name", () => {
    expect(first.world.campaigns.find((entry) => entry.forceId === "roman-field-army")!.issuedByCharacterId).toBe("gaius-genucius");
    const orders = next.world.campaigns.find((entry) => entry.forceId === "roman-field-army")!;
    expect(orders.forCommanderId).toBe(successor.id);
    expect(orders.issuedByCharacterId).toBe(successor.id);
    expect(orders.issuedStep).toBe(130);
  });

  it("names the new man at the head of the theatre", () => {
    const plan = next.world.warPlans.find((entry) => entry.polityId === "rome")!;
    const theatre = plan.theatres.find((entry) => entry.forceIds.includes("roman-field-army"))!;
    expect(theatre.commanderId).toBe(successor.id);
    expect(forceOf(next.world, "roman-field-army").commanderCharacterId).toBe(successor.id);
  });
});
