import { describe, expect, it } from "vitest";
import { aMonth, atWar, forceOf, romeAndCarthageAlone } from "./war-plan-kit";

/**
 * A general obeys his head's order.
 *
 * Nothing flowed from the head of a state to the man at the head of an army; the general chose for himself. Now the army is sent
 * ("the consul sends X against Y"), the order is a fact told in the power's own words, it is kept in the world with the man who
 * gave it and the day it runs out, and the army marches where it was sent.
 */
describe("a general obeys his head's order", () => {
  const { world, decisions, facts } = aMonth(romeAndCarthageAlone(atWar(120)));
  const orders = world.campaigns.find((entry) => entry.forceId === "roman-field-army")!;
  const marched = decisions.find((decision) => decision.polityId === "rome" && decision.act === "march" && decision.actorCharacterId === "gaius-genucius");

  it("is sent by the man who commands him, and the orders say until when", () => {
    expect(orders.issuedByCharacterId).toBe("gaius-genucius");
    expect(orders.issuedStep).toBe(120);
    expect(orders.expiresStep - orders.issuedStep).toBeGreaterThan(30);
    expect(orders.expiresStep - orders.issuedStep).toBeLessThanOrEqual(240);
  });

  it("is told, in the language of the age", () => {
    const told = facts.find((summary) => summary.includes(forceOf(world, "roman-field-army").name) && /sends|keeps|quarters|bids/.test(summary));
    expect(told).toBeDefined();
    expect(told).toContain("Gaius Genucius");
  });

  it("marches where he was sent, and not elsewhere", () => {
    expect(marched).toBeDefined();
    const move = marched!.deltas.find((delta) => delta.op === "force_modify");
    const objective = orders.objective.kind === "province" ? orders.objective.provinceId : forceOf(world, orders.objective.forceId).locationId;
    expect(move && "locationId" in move ? move.locationId : undefined).toBe(objective);
  });
});
