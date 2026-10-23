import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, type Character, type WorldState } from "@chronica/shared";
import { dispositionOf } from "./disposition";
import { teach } from "./grievances";
import { feel, feeling, moodInWords, moodsAt } from "./moods";
import { conductInWords } from "./nature";

const BASE: WorldState = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
const ID = BASE.characters.find((c) => c.alive)!.id;
const man = (world: WorldState): Character => world.characters.find((c) => c.id === ID)!;
const even = (world: WorldState): WorldState => ({
  ...world,
  characters: world.characters.map((c) => (c.id === ID ? { ...c, moods: undefined, lessons: [], mind: { ...c.mind, riskTolerance: 50, temperament: { boldness: 50, caution: 50, honesty: 50, sociability: 50, discipline: 50, cruelty: 50 }, drives: { security: 50, status: 50, wealth: 50, family: 50, faith: 50, duty: 50, revenge: 50 } } } : c)),
});

describe("what a man feels, for a few weeks", () => {
  it("halves every thirty days and is gone in a season", () => {
    const angry = feel(even(BASE), ID, "defied_by", 100);
    expect(feeling(man(angry), 100, "anger")).toBeCloseTo(0.55, 1);
    expect(feeling(man(angry), 130, "anger")).toBeCloseTo(0.275, 1);
    expect(feeling(man(angry), 160, "anger")).toBeLessThan(0.15);
    expect(moodsAt(man(angry), 400)).toEqual([]);
  });

  it("deepens when the same thing happens again, and never goes past the whole of it", () => {
    let world = even(BASE);
    for (let i = 0; i < 6; i += 1) world = feel(world, ID, "bereaved", 100);
    expect(feeling(man(world), 100, "grief")).toBe(1);
  });

  it("moves how he is read: anger makes him rasher and slower to forgive, grief takes his appetite, fear his nerve, elation makes him sure", () => {
    const calm = dispositionOf(man(even(BASE)), 100);
    const angry = dispositionOf(man(feel(even(BASE), ID, "betrayed", 100)), 100);
    expect(angry.nerve).toBeGreaterThan(calm.nerve + 0.1);
    expect(angry.grudge).toBeGreaterThan(calm.grudge + 0.1);
    expect(angry.steadiness).toBeLessThan(calm.steadiness - 0.1);
    const grieving = dispositionOf(man(feel(even(BASE), ID, "bereaved", 100)), 100);
    expect(grieving.greed).toBeLessThan(calm.greed - 0.1);
    expect(grieving.nerve).toBeLessThan(calm.nerve);
    const afraid = dispositionOf(man(feel(even(BASE), ID, "plotted_against", 100)), 100);
    expect(afraid.fear).toBeGreaterThan(calm.fear + 0.1);
    expect(afraid.nerve).toBeLessThan(calm.nerve - 0.08);
    const exultant = dispositionOf(man(feel(even(BASE), ID, "war_won", 100)), 100);
    expect(exultant.nerve).toBeGreaterThan(calm.nerve + 0.1);
    expect(exultant.fear).toBeLessThan(calm.fear - 0.05);
    const shamed = dispositionOf(man(feel(even(BASE), ID, "war_lost", 100)), 100);
    expect(shamed.pride).toBeGreaterThan(calm.pride + 0.1);
  });

  it("is gone from how he is read when it has faded, and always within 0 to 1", () => {
    const calm = dispositionOf(man(even(BASE)), 100);
    const later = dispositionOf(man(feel(even(BASE), ID, "betrayed", 100)), 400);
    expect(later.nerve).toBeCloseTo(calm.nerve, 5);
    let world = even(BASE);
    for (const cause of ["bereaved", "betrayed", "plotted_against", "war_lost", "city_lost"] as const) world = feel(world, ID, cause, 100);
    for (const value of Object.values(dispositionOf(man(world), 100))) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("is put on a man by what happens to him, wherever the engine already teaches him a lesson", () => {
    const taught = teach(even(BASE), ID, "bereaved", 100);
    expect(man(taught).lessons?.map((l) => l.kind)).toContain("bereaved");
    expect(feeling(man(taught), 100, "grief")).toBeGreaterThan(0.5);
  });

  it("is told to whoever writes him, only while it is strong enough to matter", () => {
    const angry = feel(even(BASE), ID, "betrayed", 100);
    expect(conductInWords(angry, man(angry)).join(" ")).toMatch(/angry/);
    expect(moodInWords(man(angry), 100)[0]).toMatch(/strongly/);
    expect(moodInWords(man(angry), 400)).toEqual([]);
    expect(conductInWords(even(BASE), man(even(BASE))).join(" ")).not.toMatch(/Just now/);
  });

  it("never touches somebody who is dead or unknown", () => {
    expect(feel(BASE, "nobody", "bereaved", 100)).toBe(BASE);
  });
});
