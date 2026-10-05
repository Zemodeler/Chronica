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

describe("reviews kept between bursts", () => {
  // Player-focused simulation plan, S4.
  it("does not buy a person a first review again after a short wait", () => {
    const world = { ...seed(), elapsedStep: 10 };
    const actor = actorFor(world);
    const first = createCognitionMemory([], 10);
    first.remember(actor, world, clock, "same order", 40);
    const kept = first.snapshot(10);
    expect(kept).toHaveLength(1);
    const later = { ...world, elapsedStep: 13 };
    const second = createCognitionMemory(kept, 13);
    expect(second.changed(actor, later, clock, "same order")).toBe(false);
    expect(second.weights.get(actor.characterId)).toBe(40);
  });

  it("looks at him again once his circumstances change, or the review interval has passed", () => {
    const world = { ...seed(), elapsedStep: 10 };
    const actor = actorFor(world);
    const first = createCognitionMemory([], 10);
    first.remember(actor, world, clock, "same order", 40);
    const kept = first.snapshot(10);
    const wounded = { ...world, elapsedStep: 12, characters: world.characters.map((person) => person.id === actor.characterId ? { ...person, healthBps: 2_000 } : person) };
    expect(createCognitionMemory(kept, 12).changed(actor, wounded, clock, "same order")).toBe(true);
    expect(createCognitionMemory(kept, 40).changed(actor, { ...world, elapsedStep: 40 }, clock, "same order")).toBe(true);
  });

  it("ignores a review made under another policy", () => {
    const world = { ...seed(), elapsedStep: 10 };
    const actor = actorFor(world);
    const first = createCognitionMemory([], 10);
    first.remember(actor, world, clock, "same order", 40);
    const other = first.snapshot(10).map((review) => ({ ...review, version: 0 }));
    expect(createCognitionMemory(other, 10).changed(actor, world, clock, "same order")).toBe(true);
  });

  it("is written onto the world a burst returns", async () => {
    const { runSimulationBurst } = await import("./burst");
    const definition = ScenarioDefinitionSchema.parse(firstPunicWarScenario.definition);
    const result = await runSimulationBurst({
      world: seed(), clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare, burstId: "kept", gameId: "game-kept",
      actorRef: { kind: "character", id: "marcus-atilius" }, actorPolityId: "rome", orderText: null, knownFacts: [], queue: [], spanDays: 3,
      port: { complete: () => Promise.resolve(JSON.stringify({ actors: [] })) },
    });
    expect(Array.isArray(result.world.cognitionReviews)).toBe(true);
  });
});

describe("the kept reviews stay small, and an old save still loads", () => {
  // Plan item 7.
  it("holds at most 200 reviews, a few thousand bytes each at worst, however many people were asked", () => {
    const world = { ...seed(), elapsedStep: 20 };
    const base = actorFor(world);
    const memory = createCognitionMemory([], 20);
    for (let index = 0; index < 500; index += 1) memory.remember({ ...base, characterId: `person-${index}`, name: `Person ${index}` }, world, clock, `reason ${index}`, 50);
    const kept = memory.snapshot(20);
    expect(kept).toHaveLength(200);
    expect(JSON.stringify(kept).length).toBeLessThan(40_000);
  });

  it("forgets reviews past the interval, so a long game does not grow its save", () => {
    const world = { ...seed(), elapsedStep: 20 };
    const memory = createCognitionMemory([], 20);
    memory.remember(actorFor(world), world, clock, "same order", 50);
    expect(memory.snapshot(20)).toHaveLength(1);
    expect(memory.snapshot(200)).toHaveLength(0);
  });

  it("loads a save written before the reviews were kept, with none", () => {
    const old = structuredClone(firstPunicWarScenario.initialWorld) as Record<string, unknown>;
    delete old.cognitionReviews;
    expect(WorldStateSchema.parse(old).cognitionReviews).toEqual([]);
  });

  it("refuses more than the world's cap on load, so a corrupt save cannot carry a thousand", () => {
    const world = seed();
    const review = { characterId: "a", context: "00000000", reason: "00000000", atStep: 1, weight: 1, version: 1 };
    expect(WorldStateSchema.safeParse({ ...world, cognitionReviews: Array.from({ length: 201 }, () => review) }).success).toBe(false);
  });
});
