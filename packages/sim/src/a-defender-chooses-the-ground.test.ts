import { describe, expect, it } from "vitest";
import { stableHash } from "@chronica/shared";
import { judgeTactic, resolveEngagement } from "./battle";
import { chooseBattlePlan, chooseManoeuvre } from "./battle-plan";
import { atWar, definition, forceOf, ledBy, placed, romeAndCarthageAlone, withMen } from "./war-plan-kit";

/**
 * A defender chooses the ground.
 *
 * The engine had a place for a plan of battle from the first, and the rules never wrote one: every army they led went into every
 * field with nothing in mind. Now a general reads the field and claims what it will bear out, and nothing else -- so that the plan
 * is worth something where he is the stronger or has the horse or the ground, and nothing where he has none of them.
 */
describe("a defender chooses the ground", () => {
  const base = ledBy(romeAndCarthageAlone(atWar(120)), "roman-field-army", { boldness: 60, caution: 55, strategist: 70, martial: 70 });
  const here = forceOf(base, "roman-field-army").locationId;
  const strong = withMen(placed(base, "carthaginian-garrison", here), "carthaginian-garrison", 3_000);
  const commander = strong.characters.find((character) => character.id === forceOf(strong, "roman-field-army").commanderCharacterId);
  const own = [forceOf(strong, "roman-field-army")];
  const enemy = [forceOf(strong, "carthaginian-garrison")];

  it("claims only what the field bears out, and the engine finds it so", () => {
    const plan = chooseBattlePlan(strong, here, own, enemy, commander, definition.warfare);
    expect(plan).not.toBeNull();
    const province = strong.map.provinces.find((candidate) => candidate.id === here)!;
    const judged = judgeTactic(strong, province, own, enemy, plan!.restsOn ?? [], definition.warfare);
    expect(judged.notBorneOut).toEqual([]);
    expect(judged.borneOut.length).toBeGreaterThan(0);
    expect(plan!.restsOn).toContain("numbers");
  });

  it("makes no plan where nothing is on his side", () => {
    const even = withMen(strong, "carthaginian-garrison", 8_860);
    expect(chooseBattlePlan(even, here, [forceOf(even, "carthaginian-garrison")], [forceOf(even, "roman-field-army")], commander, definition.warfare)?.restsOn ?? []).not.toContain("numbers");
  });

  it("makes the battle another: the plan is weighed in it, and no plan is not", () => {
    const plan = chooseBattlePlan(strong, here, own, enemy, commander, definition.warfare)!;
    const fight = (tactic: typeof plan | null) => resolveEngagement({
      world: strong, attacker: own[0]!, defender: enemy[0]!, posture: "offer_battle", tactic, warfare: definition.warfare,
      battleId: `battle-${stableHash(["defender"])}`, seed: "the-ground", playerCharacterId: null,
    }, 0);
    const planned = fight(plan);
    const bare = fight(null);
    expect(planned.account?.tactics.length ?? 0).toBeGreaterThan(0);
    expect(bare.account?.tactics.length ?? 0).toBe(0);
    expect(JSON.stringify(planned.account?.phases)).not.toBe(JSON.stringify(bare.account?.phases));
  });

  it("asks for little, and what it asks is what the engine will weigh (never more than three things)", () => {
    const plan = chooseBattlePlan(strong, here, own, enemy, commander, definition.warfare)!;
    expect(["minor", "meaningful"]).toContain(plan.magnitude);
    expect((plan.restsOn ?? []).length).toBeLessThanOrEqual(3);
    expect(plan.rationale.length).toBeGreaterThan(10);
  });
});

describe("an enemy who will not come out", () => {
  const base = ledBy(romeAndCarthageAlone(atWar(120)), "roman-field-army", { boldness: 85, caution: 40, strategist: 80, cruelty: 70 });
  const here = forceOf(base, "roman-field-army").locationId;
  const camp = { ...withMen(placed(base, "carthaginian-garrison", here), "carthaginian-garrison", 3_000) };
  const held = { ...camp, material: { ...camp.material, forces: camp.material.forces.map((force) => (force.id === "carthaginian-garrison" ? { ...force, hold: true, provisionStatus: "provisioned" as const } : force)) } };
  const commander = held.characters.find((character) => character.id === forceOf(held, "roman-field-army").commanderCharacterId);

  it("is met by a manoeuvre chosen by the man, the same every replay", () => {
    const first = chooseManoeuvre(held, [forceOf(held, "roman-field-army")], [forceOf(held, "carthaginian-garrison")], commander, "g");
    const again = chooseManoeuvre(held, [forceOf(held, "roman-field-army")], [forceOf(held, "carthaginian-garrison")], commander, "g");
    expect(first).not.toBeNull();
    expect(again).toEqual(first);
    expect(["storm_camp", "night_attack", "lure", "provoke"]).toContain(first!.kind);
  });

  it("is not offered one where he would come out anyway", () => {
    const rash = ledBy({ ...held, material: { ...held.material, forces: held.material.forces.map((force) => (force.id === "carthaginian-garrison" ? { ...force, hold: false } : force)) } }, "carthaginian-garrison", { caution: 10 });
    expect(chooseManoeuvre(rash, [forceOf(rash, "roman-field-army")], [forceOf(rash, "carthaginian-garrison")], commander, "g")).toBeNull();
  });

  it("is left to the plain offer of battle by a plain man", () => {
    const plain = ledBy(held, "roman-field-army", { boldness: 30, caution: 70, strategist: 30, cruelty: 30 });
    expect(chooseManoeuvre(plain, [forceOf(plain, "roman-field-army")], [forceOf(plain, "carthaginian-garrison")], plain.characters.find((character) => character.id === forceOf(plain, "roman-field-army").commanderCharacterId), "g")).toBeNull();
  });
});
