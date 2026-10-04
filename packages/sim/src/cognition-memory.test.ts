import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, type WorldState } from "@chronica/shared";
import type { RoutedActor } from "./attention";
import { cognitionDecisionContext, createCognitionMemory } from "./cognition-memory";
import { layPlan } from "./plans";
import { createIdFactory } from "./ports";

const clock = ScenarioDefinitionSchema.parse(firstPunicWarScenario.definition).clock;
const seed = () => WorldStateSchema.parse(structuredClone(firstPunicWarScenario.initialWorld));
const actorFor = (world: WorldState): RoutedActor => {
  const person = world.characters.find((candidate) => candidate.alive)!;
  return { ref: { kind: "character", id: person.id }, characterId: person.id, name: person.name,
    level: "focused", impetus: "own_business", pressing: true, score: 80, knownFacts: [], why: "same outstanding order" };
};

describe("whether a decision needs reconsideration", () => {
  it("remembers a successful decision within a burst, without treating routing or the date as new information", () => {
    const world = seed();
    const actor = actorFor(world);
    const memory = createCognitionMemory();
    expect(memory.changed(actor, world, clock, "same order")).toBe(true);
    memory.remember(actor, world, clock, "same order", 100);
    // Finishing an obligation is not a new reason to ask the same person again.
    expect(memory.changed(actor, world, clock)).toBe(false);
    expect(memory.changed({ ...actor, impetus: "reaction", score: 1, why: "different routing" }, world, clock, "same order")).toBe(false);
    expect(memory.changed(actor, { ...world, instant: { ...world.instant, minute: world.instant.minute + 1 } }, clock, "same order")).toBe(false);
    expect(createCognitionMemory().changed(actor, world, clock, "same order")).toBe(true);
    expect(memory.weights.get(actor.characterId)).toBe(100);
  });

  it("wakes for changed means, health, instructions, and extra information in the actor's note", () => {
    const world = seed();
    const actor = actorFor(world);
    const memory = createCognitionMemory();
    memory.remember(actor, world, clock, "same order", 100);
    const wounded = { ...world, characters: world.characters.map((person) => person.id === actor.characterId ? { ...person, healthBps: 2_000 } : person) };
    expect(memory.changed(actor, wounded, clock, "same order")).toBe(true);
    const purse = world.material.accounts.find((account) => account.owner.kind === "character" && account.owner.id === actor.characterId)!;
    const poorer = { ...world, material: { ...world.material, accounts: world.material.accounts.map((account) => account.id === purse.id ? { ...account, balance: account.balance - 1 } : account) } };
    expect(memory.changed(actor, poorer, clock, "same order")).toBe(true);
    expect(memory.changed(actor, world, clock, "changed order")).toBe(true);
    expect(memory.changed({ ...actor, note: "A new problem has reached them." }, world, clock, "same order")).toBe(true);
  });

  it("ignores a plan's ordinary countdown but keeps its last day and changed action", () => {
    let world = seed();
    const actor = actorFor(world);
    const plan = { ambition: "Inspect the army", kind: "office" as const, steps: [{ act: "Inspect the troops", inDays: 10, when: null }] };
    world = layPlan(world, actor.characterId, plan, createIdFactory("memory-test")).world;
    const before = cognitionDecisionContext(actor, world, clock);
    expect(cognitionDecisionContext(actor, { ...world, instant: { ...world.instant, day: world.instant.day + 1 } }, clock)).toBe(before);
    expect(cognitionDecisionContext(actor, { ...world, instant: { ...world.instant, day: world.instant.day + 9 } }, clock)).not.toBe(before);
    const changed = layPlan(world, actor.characterId, { ...plan, steps: [{ ...plan.steps[0]!, act: "Send the troops in 20 days" }] }, createIdFactory("memory-changed")).world;
    expect(cognitionDecisionContext(actor, changed, clock)).not.toBe(before);
  });
});
