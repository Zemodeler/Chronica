import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ProjectSchema, ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { dueSteps, layPlan, nextPlanDay, settleRoutineSteps, takeSteps } from "./plans";
import { DEFAULT_BUDGET, runSimulationBurst } from "./burst";
import { createIdFactory, type SimModelPort } from "./ports";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const owner = "hieron-ii";
const initial = (): WorldState => {
  const world = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
  return { ...world, projects: [...world.projects, ProjectSchema.parse({ id: "routine-work", kind: "construction",
    sponsorEntityRef: { kind: "character", id: owner }, label: "Prepare the stores", status: "in_progress", startedAtStep: 0,
    targetCompletionStep: 7, milestones: [{ id: "routine-stage", label: "Stores ready", requiredAtElapsedOffset: 7, costAmount: 0, status: "pending" }] })] };
};
const planned = (ref = "routine-work", world = initial()) => layPlan(world, owner, { ambition: "Ready the stores", kind: "office",
  steps: [{ act: "Prepare the stores", inDays: 14, when: null, routineProjectRef: ref }] }, createIdFactory("routine"));
const stepOf = (world: WorldState) => world.characters.find((person) => person.id === owner)!.ambitions.find((ambition) => ambition.label === "Ready the stores")!.steps[0]!;

describe("approved routine work", () => {
  it("does not reconsider running work or mark its step done before completion", () => {
    const world = planned().world;
    const step = stepOf(world);
    expect(step.routineProjectId).toBe("routine-work");
    expect(dueSteps({ ...world, instant: { day: 10, minute: 0 } }, definition.clock).some((entry) => entry.stepId === step.id)).toBe(false);
    expect(nextPlanDay(world)).toBe(15);
    expect(takeSteps(world, owner, [step.id]).taken).toBe(0);
  });

  it("settles completion once and wakes for failures, missing work or lateness", () => {
    const world = planned().world;
    const step = stepOf(world);
    const completed = { ...world, projects: world.projects.map((project) => project.id === "routine-work" ? { ...project, status: "completed" as const } : project) };
    const settled = settleRoutineSteps(completed);
    expect(settled.taken).toBe(1);
    expect(stepOf(settled.world).status).toBe("done");
    expect(settleRoutineSteps(settled.world).taken).toBe(0);
    for (const status of ["failed", "cancelled"] as const) {
      const broken = { ...world, projects: world.projects.map((project) => project.id === "routine-work" ? { ...project, status } : project) };
      expect(dueSteps(broken, definition.clock).some((entry) => entry.stepId === step.id)).toBe(true);
      expect(settleRoutineSteps(broken).taken).toBe(0);
    }
    expect(dueSteps({ ...world, projects: [] }, definition.clock).some((entry) => entry.stepId === step.id)).toBe(true);
    expect(dueSteps({ ...world, instant: { day: 15, minute: 0 } }, definition.clock).some((entry) => entry.stepId === step.id)).toBe(true);
  });

  it("resolves new-work handles and refuses unknown, unapproved or another person's work", () => {
    const world = initial();
    const plan = { ambition: "Ready the stores", kind: "office" as const, steps: [{ act: "Prepare the stores", inDays: 14, when: null, routineProjectRef: "local:stores" }] };
    expect(stepOf(layPlan(world, owner, plan, createIdFactory("local"), new Map([["stores", "routine-work"]])).world).routineProjectId).toBe("routine-work");
    const depends = { ...plan, steps: [{ ...plan.steps[0]!, routineProjectRef: "routine-work", when: { kind: "question_decided" as const, procedureId: "pending-vote" } }] };
    expect(stepOf(layPlan(world, owner, depends, createIdFactory("dependent")).world).routineProjectId).toBeUndefined();
    expect(stepOf(planned("unknown").world).routineProjectId).toBeUndefined();
    for (const status of ["proposed", "failed"] as const) {
      const unavailable = { ...world, projects: world.projects.map((project) => ({ ...project, status })) };
      expect(stepOf(planned("routine-work", unavailable).world).routineProjectId).toBeUndefined();
    }
    const foreign = { ...world, projects: world.projects.map((project) => ({ ...project, sponsorEntityRef: { kind: "character" as const, id: "hanno-carthage" } })) };
    expect(stepOf(planned("routine-work", foreign).world).routineProjectId).toBeUndefined();
    expect(WorldStateSchema.safeParse(planned().world).success).toBe(true);
  });

  it("finishes engine work and the plan within a full burst without an NPC proposing its completion", async () => {
    const operations: string[] = [];
    const port: SimModelPort = { complete(operation) {
      operations.push(operation);
      if (operation === "simulate_cognition") return Promise.resolve('{"actors":[]}');
      if (operation !== "simulate_orchestrate") throw new Error(`Unexpected ${operation}`);
      return Promise.resolve(JSON.stringify({ intent: { summary: "Wait", domains: ["administration"] }, narrativeSummary: "Time passes.",
        deltas: [], facts: [], delegations: [], schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null }));
    } };
    const result = await runSimulationBurst({ world: planned().world, clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare,
      burstId: "routine", gameId: "routine", actorRef: { kind: "character", id: "gaius-genucius" }, actorPolityId: "rome",
      orderText: "Let fourteen days pass.", spanDays: 14, knownFacts: [], queue: [], port, narratorSeeds: [],
      budget: { ...DEFAULT_BUDGET, maxAmbientActors: 0, maxFocusedActors: 0 } });
    expect(result.world.projects.find((project) => project.id === "routine-work")?.status).toBe("completed");
    expect(stepOf(result.world).status).toBe("done");
    expect(result.plans.taken).toBe(1);
    expect(operations.every((operation) => ["simulate_orchestrate", "simulate_cognition"].includes(operation))).toBe(true);
    expect(result.newFacts.some((fact) => fact.summary.includes("Prepare the stores"))).toBe(true);
    expect(result.parseFailures).toEqual([]);
  });
});
