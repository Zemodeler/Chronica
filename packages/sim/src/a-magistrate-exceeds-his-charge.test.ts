import { describe, expect, it } from "vitest";
import { WorldDeltaSchema, economyOf, type WorldState } from "@chronica/shared";
import { gatedAct } from "./apply/competence-gate";
import { act, chestOf, holdersOf, opening as competenceOpening } from "./competence-test-kit";
import { atDay, carryOut, decideTheMonth, opening, withChest, withIncome, withWar } from "./government-test-kit";

/**
 * A magistrate exceeds his charge.
 *
 * What is beyond a man's charge is the body's: his order for bread for an army, a work begun out of the chest, or the calling of men is weighed against what his office may do
 * alone, and what lies beyond it is laid before the chamber that holds the power (the player's order) or told that it is not his to do. And the man at the mint lays the lighter
 * coin before the Senate in the war's last need, as a consul and not a quaestor may.
 */

const consul = (world: WorldState) => holdersOf(world, "roman-consul")[0]!;

describe("a magistrate exceeds his charge", () => {
  it("lays a work too dear for his allowance before the Senate, and begins one within it", () => {
    const world = competenceOpening();
    const [man] = holdersOf(world, "roman-consul") as [string];
    const work = (cost: number) => ({
      op: "project_create", localId: "walls", kind: "fortification", label: "A wall for the city", sponsorRef: { kind: "polity", id: "rome" }, fundingAccountRef: "rome-treasury",
      milestones: [{ label: "The footings", dueInDays: 60, costAmount: cost }], reason: "The city wants a wall.",
    });
    expect(chestOf(world, "rome").balance).toBeGreaterThan(cost(1));
    const small = act(world, man, work(100_000));
    expect(small.rejected).toEqual([]);
    const great = act(world, man, work(9_000_000), { order: true });
    expect(great.rejected[0]?.reason).toMatch(/moved it in the chamber instead|laid before the Senate/);
    expect(great.world.material.politicalProcedures.at(-1)).toMatchObject({ institutionId: "roman-senate", sponsorCharacterId: man });
    function cost(n: number) { return n; }
  });

  it("is told the army's bread past his allowance is the Senate's, and that a levy in Carthage is the Elders'", () => {
    const world = competenceOpening();
    const [suffete] = holdersOf(world, "carthaginian-suffete") as [string];
    const levy = { op: "force_create", localId: "levy", name: "A levy at Carthage", polityId: "carthage", commanderCharacterRef: suffete, controllerCharacterRef: suffete, locationId: "carthage", authorizedStrength: 3_000, reason: "War." };
    const refused = act(world, suffete, levy, { order: true });
    expect(refused.rejected[0]?.reason).toMatch(/may not hold the levy himself: it is laid before the Council of Elders/);
    expect(refused.world.material.forces.length).toBe(world.material.forces.length);
    expect(refused.world.material.politicalProcedures.at(-1)).toMatchObject({ institutionId: "carthaginian-council" });
  });

  it("weighs the army's bread against the chest like any other draw", () => {
    const world = competenceOpening();
    const force = world.material.forces.find((f) => f.polityId === "rome")!;
    const bread = WorldDeltaSchema.parse({ op: "force_provision", forceRef: force.id, how: "buy", days: 30, payAccountRef: "rome-treasury", reason: "Bread." });
    const gated = gatedAct(bread, world, (ref) => ref);
    expect(gated).toMatchObject({ act: "spending", polityId: "rome" });
    expect(gated!.amount).toBeGreaterThan(0);
    const taken = WorldDeltaSchema.parse({ op: "force_provision", forceRef: force.id, how: "requisition", days: 30, reason: "Bread." });
    expect(gatedAct(taken, world, (ref) => ref)).toBeNull();
  });

  it("has the consul, not the quaestor, lay the lighter coin before the Senate when the war has emptied the chest", () => {
    let world = withChest(withIncome(withWar(opening(), "rome", "carthage"), "rome", 0.02), "rome", 0, 600_000);
    world = { ...world, economy: { ...economyOf(world), taxPolicies: economyOf(world).taxPolicies.map((policy) => (policy.polityId === "rome" ? { ...policy, rateBps: 2_200 } : policy)) } };
    let found: ReturnType<typeof decideTheMonth>[number] | undefined;
    let when = 0;
    for (let day = 150; day <= 750 && found === undefined; day += 30) {
      found = decideTheMonth(atDay(world, day), day).find((d) => d.polityId === "rome" && /^asked the Senate that .* be struck with less silver/.test(d.why));
      when = day;
    }
    expect(found, "the consul moves it").toBeDefined();
    expect(holdersOf(world, "roman-consul")).toContain(found!.actorCharacterId);
    expect(found!.deltas.map((d) => d.op)).toEqual(["political_procedure_open"]);
    const done = carryOut(atDay(world, when), found!);
    expect(done.rejected).toEqual([]);
    expect(done.world.material.politicalProcedures.at(-1)).toMatchObject({ institutionId: "roman-senate", outcome: null });
    void consul;
  });

  it("leaves a played man's and a played power's acts alone", () => {
    const world = withChest(withIncome(withWar(opening(), "rome", "carthage"), "rome", 0.02), "rome", 0, 600_000);
    const consuls = holdersOf(world, "roman-consul");
    for (let day = 150; day <= 450; day += 30) {
      const done = decideTheMonth(atDay(world, day), day, { played: consuls }).filter((d) => d.polityId === "rome" && consuls.includes(d.actorCharacterId));
      expect(done).toEqual([]);
    }
  });
});
