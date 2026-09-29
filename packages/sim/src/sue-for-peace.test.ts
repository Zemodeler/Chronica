import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, warWeariness, type WorldState } from "@chronica/shared";
import { ensureConstitutions } from "./constitutions";
import { createIdFactory } from "./ports";
import { sueForPeace } from "./sue-for-peace";

const { government } = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const base = (): WorldState => ensureConstitutions({ world: ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0), government, toDay: 0 });
const CAMPANIANS = "rhegium-campanians";

/** The men holding Rhegium, two years into a siege they are losing: broke, hungry and restless. */
const beaten = (): WorldState => {
  const world = base();
  const theirs = new Set(world.map.provinces.filter((province) => province.controllerPolityId === CAMPANIANS).map((province) => province.id));
  const day = 720;
  return {
    ...world,
    elapsedStep: day,
    instant: { ...world.instant, day },
    material: {
      ...world.material,
      accounts: world.material.accounts.map((account) => (account.owner.kind === "polity" && account.owner.id === CAMPANIANS ? { ...account, balance: 0 } : account)),
      provinceMaterial: world.material.provinceMaterial.map((entry) => (theirs.has(entry.provinceId) ? { ...entry, stabilityBps: 1_000, foodSecurityBps: 1_000 } : entry)),
      forces: world.material.forces.map((force) => (force.polityId === CAMPANIANS
        ? { ...force, history: [...force.history, { atStep: 100, kind: "battle_death" as const, count: 3_000, categoryId: force.personnel[0]?.categoryId ?? "infantry", explanation: "The sallies." }] as typeof force.history }
        : force)),
    },
  };
};

describe("a power tired of its war", () => {
  it("is tired for reasons it can name", () => {
    const tired = warWeariness(beaten(), CAMPANIANS, "rome");
    expect(tired.score).toBeGreaterThanOrEqual(40);
    expect(tired.parts).toEqual(expect.arrayContaining(["the men it has lost", "a war going badly", "2 years of it"]));
    expect(warWeariness(base(), "rome", CAMPANIANS).score).toBeLessThan(40);
  });

  it("writes to its enemy for an end to it, and waits for the answer before asking again", () => {
    const sued = sueForPeace(beaten(), 720, createIdFactory("peace"));
    const letter = sued.world.diplomacy.at(-1)!;
    expect(letter).toMatchObject({ fromPolityId: CAMPANIANS, toPolityId: "rome", status: "awaiting_reply" });
    expect(letter.kind === "peace_offer" || letter.proposes?.includes("truce")).toBe(true);
    expect(sued.facts[0]!.summary).toMatch(/asking for (peace|a truce)/);
    // Rome, winning, asks for nothing.
    expect(sued.world.diplomacy.some((message) => message.fromPolityId === "rome" && message.toPolityId === CAMPANIANS && message.sentAtStep === 720)).toBe(false);
    expect(sueForPeace(sued.world, 750, createIdFactory("again")).facts).toEqual([]);
  });
});
