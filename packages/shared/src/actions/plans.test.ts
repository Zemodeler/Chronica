import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { WorldStateSchema, type WorldState } from "../world/world-state";
import {
  ActionPlanSchema,
  ActionPlanStageSchema,
  InterpretPlanSchema,
  PlayerPlanSchema,
  attemptPlanStageAtomically,
  completePlanStage,
  interpretPlan,
  originateActionPlan,
  playerPlanToActionPlan,
  preparePlayerPlans,
  respondToActionPlanAssignment,
  startPlanStage,
  upgradePlayerPlansToActionPlans,
  type ActionPlan,
  type PlayerPlan,
} from "./plans";
import { defaultPriorityContextFor, detectResourceConflicts, resolveConflicts, type StageResourceClaim } from "./conflicts";

function actionPlan(overrides: Partial<ActionPlan> = {}): ActionPlan {
  return ActionPlanSchema.parse({
    id: "plan-1",
    origin: { kind: "player", sourceId: "marcus-atilius", directiveId: "directive-0" },
    ownerCharacterId: "marcus-atilius",
    rawText: "Besiege Messana",
    revisions: [{ atStep: 1, text: "Besiege Messana" }],
    options: {},
    interpretation: "Besiege Messana",
    status: "active",
    stages: [
      { id: "march", objective: "March to Messana", actorId: "marcus-atilius", status: "pending" },
      { id: "siege", objective: "Besiege Messana", actorId: "marcus-atilius", dependsOn: ["march"], status: "pending" },
    ],
    assignments: [],
    spent: 0,
    createdAtStep: 1,
    updatedAtStep: 1,
    ...overrides,
  });
}

function playerPlan(overrides: Partial<PlayerPlan> = {}): PlayerPlan {
  return PlayerPlanSchema.parse({
    id: "plan-1-directive-0",
    ownerId: "marcus-atilius",
    sourceDirectiveId: "directive-0",
    rawText: "Carry out the plan in stages.",
    revisions: [{ atStep: 1, text: "Carry out the plan in stages." }],
    options: {},
    interpretation: "Carry out the requested stages",
    status: "active",
    stages: [
      { id: "first", objective: "Task first", actorId: "marcus-atilius", status: "completed", reason: null, factRefs: ["fact-1"], lastCompletedStep: 3 },
      { id: "second", objective: "Task second", actorId: "marcus-atilius", dependsOn: ["first"], status: "pending", reason: null, factRefs: [] },
    ],
    assignments: [],
    spent: 20,
    createdAtStep: 1,
    updatedAtStep: 3,
    ...overrides,
  });
}

describe("playerPlanToActionPlan", () => {
  it("preserves identity, revisions, and completed-stage history exactly", () => {
    const plan = playerPlan();
    const converted = playerPlanToActionPlan(plan);
    expect(ActionPlanSchema.safeParse(converted).success).toBe(true);
    expect(converted.id).toBe(plan.id);
    expect(converted.revisions).toEqual(plan.revisions);
    expect(converted.origin).toEqual({ kind: "player", sourceId: plan.ownerId, directiveId: plan.sourceDirectiveId });
    expect(converted.stages[0]).toMatchObject({ id: "first", status: "completed", resultFactIds: ["fact-1"], completedAtStep: 3 });
    expect(converted.stages[1]).toMatchObject({ id: "second", status: "pending", dependsOn: ["first"] });
    expect(converted.spent).toBe(plan.spent);
  });

  it("maps every PlayerPlan status to its ActionPlan successor, including the renamed terminal state", () => {
    expect(playerPlanToActionPlan(playerPlan({ status: "completed" })).status).toBe("completed");
    expect(playerPlanToActionPlan(playerPlan({ status: "cancelled" })).status).toBe("abandoned");
  });

  it("leaves Phase 2-4 fields at their inert defaults, since nothing populates them yet", () => {
    const converted = playerPlanToActionPlan(playerPlan());
    expect(converted.feasibility).toBeNull();
    expect(converted.reservationIds).toEqual([]);
    expect(converted.standingInstructions).toEqual([]);
    expect(converted.stages.every(s => s.reservationIds.length === 0 && s.durationEstimate === null)).toBe(true);
  });
});

describe("upgradePlayerPlansToActionPlans", () => {
  it("converts every plan and tolerates an absent collection", () => {
    expect(upgradePlayerPlansToActionPlans(undefined)).toEqual([]);
    const upgraded = upgradePlayerPlansToActionPlans([playerPlan(), playerPlan({ id: "plan-2", status: "cancelled" })]);
    expect(upgraded).toHaveLength(2);
    expect(upgraded[1]!.status).toBe("abandoned");
  });
});

describe("InterpretPlanSchema (docs/32, Phase 2)", () => {
  const base = { planId: "plan-1", interpretation: "Carry out the requested stages", options: {} };

  it("requires at least one stage or a clarification question, never neither", () => {
    expect(InterpretPlanSchema.safeParse({ ...base, stages: [], claims: [], clarificationQuestions: [] }).success).toBe(false);
  });

  it("refuses to commit stages in the same call that asks a clarification question", () => {
    const stage = { id: "first", objective: "Task", actorId: "marcus-atilius" };
    expect(InterpretPlanSchema.safeParse({ ...base, stages: [stage], clarificationQuestions: ["Which legion?"] }).success).toBe(false);
  });

  it("accepts a clarification-only interpretation with no stages", () => {
    expect(InterpretPlanSchema.safeParse({ ...base, stages: [], clarificationQuestions: ["Which legion do you mean?"] }).success).toBe(true);
  });
});

describe("interpretPlan claim enforcement (docs/32, Phase 2)", () => {
  const PLAYER = "marcus-atilius";

  function worldWithPlan(): WorldState {
    const world = structuredClone(firstPunicWarScenario.initialWorld);
    return preparePlayerPlans(world, PLAYER, 1, [{ id: "directive-0", directive: { kind: "new", text: "Move the legion that does not exist." } }]);
  }

  it("refuses a contradicted world_premise as the basis for a stage", () => {
    const world = worldWithPlan();
    const result = interpretPlan(world, PLAYER, InterpretPlanSchema.parse({
      planId: "plan-1-directive-0",
      interpretation: "Move a legion the player does not actually have.",
      options: {},
      stages: [{ id: "march", objective: "March the legion", actorId: PLAYER }],
      claims: [{ text: "I have a legion at Rome", kind: "world_premise", verification: "contradicted", supportingFactIds: [], contradictionFactIds: ["fact-no-legion"] }],
      clarificationQuestions: [],
    }), 1);
    expect(typeof result).toBe("string");
    expect(result as string).toMatch(/contradicted world premise/i);
  });

  it("accepts a confirmed claim and stores it on the plan", () => {
    const world = worldWithPlan();
    const result = interpretPlan(world, PLAYER, InterpretPlanSchema.parse({
      planId: "plan-1-directive-0",
      interpretation: "Move the player's own person.",
      options: {},
      stages: [{ id: "march", objective: "Travel", actorId: PLAYER }],
      claims: [{ text: "I am able to travel", kind: "world_premise", verification: "confirmed", supportingFactIds: ["fact-alive"], contradictionFactIds: [] }],
      clarificationQuestions: [],
    }), 1);
    expect(typeof result).not.toBe("string");
    const plan = (result as WorldState).playerPlans!.find(p => p.id === "plan-1-directive-0")!;
    expect(plan.claims).toHaveLength(1);
    expect(plan.claims[0]!.verification).toBe("confirmed");
    expect(plan.stages).toHaveLength(1);
  });

  it("records clarification questions and leaves stages untouched until they are answered", () => {
    const world = worldWithPlan();
    const result = interpretPlan(world, PLAYER, InterpretPlanSchema.parse({
      planId: "plan-1-directive-0",
      interpretation: "Unclear which legion the player means.",
      options: {},
      stages: [],
      claims: [],
      clarificationQuestions: ["Which legion do you mean?"],
    }), 1);
    expect(typeof result).not.toBe("string");
    const plan = (result as WorldState).playerPlans!.find(p => p.id === "plan-1-directive-0")!;
    expect(plan.clarificationQuestions).toEqual(["Which legion do you mean?"]);
    expect(plan.stages).toEqual([]);
  });
});

describe("startPlanStage / completePlanStage (docs/32, Phase 8)", () => {
  it("refuses to start a stage whose dependency has not completed", () => {
    const result = startPlanStage(actionPlan(), "siege", 2);
    expect(typeof result).toBe("string");
    expect(result as string).toMatch(/depends on/i);
  });

  it("starts a ready stage, recording startedAtStep and an expected completion from its duration estimate", () => {
    const result = startPlanStage(actionPlan(), "march", 2, { durationEstimate: { minimumSteps: 1, likelySteps: 3, maximumSteps: 5, basis: ["distance"] } });
    expect(typeof result).not.toBe("string");
    const stage = (result as ActionPlan).stages.find((s) => s.id === "march")!;
    expect(stage.status).toBe("in_progress");
    expect(stage.startedAtStep).toBe(2);
    expect(stage.expectedCompletionStep).toBe(5);
  });

  it("refuses to start a stage that is not pending/ready", () => {
    const started = startPlanStage(actionPlan(), "march", 2) as ActionPlan;
    const result = startPlanStage(started, "march", 3);
    expect(typeof result).toBe("string");
  });

  it("refuses to complete a stage that was never started", () => {
    const result = completePlanStage(actionPlan(), "march", 2, { success: true, resultFactIds: ["fact-1"] });
    expect(typeof result).toBe("string");
  });

  it("completes an in-progress stage, unblocking its dependent and never reopening it", () => {
    const started = startPlanStage(actionPlan(), "march", 2) as ActionPlan;
    const completed = completePlanStage(started, "march", 4, { success: true, resultFactIds: ["fact-1"] }) as ActionPlan;
    const marchStage = completed.stages.find((s) => s.id === "march")!;
    expect(marchStage.status).toBe("completed");
    expect(marchStage.completedAtStep).toBe(4);
    expect(marchStage.resultFactIds).toEqual(["fact-1"]);
    // The dependent stage is now startable.
    const startedSiege = startPlanStage(completed, "siege", 5);
    expect(typeof startedSiege).not.toBe("string");
  });

  it("marks the plan completed once every non-recurring stage reaches a terminal state", () => {
    const started1 = startPlanStage(actionPlan(), "march", 2) as ActionPlan;
    const done1 = completePlanStage(started1, "march", 3, { success: true, resultFactIds: ["fact-1"] }) as ActionPlan;
    const started2 = startPlanStage(done1, "siege", 4) as ActionPlan;
    const done2 = completePlanStage(started2, "siege", 10, { success: true, resultFactIds: ["fact-2"] }) as ActionPlan;
    expect(done2.status).toBe("completed");
  });

  it("marks the plan failed if any non-recurring stage fails", () => {
    const started1 = startPlanStage(actionPlan(), "march", 2) as ActionPlan;
    const done1 = completePlanStage(started1, "march", 3, { success: true, resultFactIds: ["fact-1"] }) as ActionPlan;
    const started2 = startPlanStage(done1, "siege", 4) as ActionPlan;
    const failed = completePlanStage(started2, "siege", 10, { success: false, resultFactIds: ["fact-2"], statusReason: "The garrison held." }) as ActionPlan;
    expect(failed.status).toBe("failed");
    expect(failed.stages.find((s) => s.id === "siege")!.statusReason).toBe("The garrison held.");
  });

  it("never reopens a completed stage even after the plan's overall status changes", () => {
    const single = actionPlan({ stages: [{ id: "march", objective: "March to Messana", actorId: "marcus-atilius", status: "pending" }] as ActionPlan["stages"] });
    const started = startPlanStage(single, "march", 2) as ActionPlan;
    const done = completePlanStage(started, "march", 3, { success: true, resultFactIds: ["fact-1"] }) as ActionPlan;
    expect(done.status).toBe("completed");
    const restart = startPlanStage(done, "march", 4);
    expect(typeof restart).toBe("string");
  });

  it("attemptPlanStageAtomically starts and completes a stage in one call", () => {
    const single = actionPlan({ stages: [{ id: "march", objective: "March to Messana", actorId: "marcus-atilius", status: "pending" }] as ActionPlan["stages"] });
    const result = attemptPlanStageAtomically(single, "march", 2, { success: true, resultFactIds: ["fact-1"] }) as ActionPlan;
    const stage = result.stages.find((s) => s.id === "march")!;
    expect(stage.status).toBe("completed");
    expect(stage.startedAtStep).toBe(2);
    expect(stage.completedAtStep).toBe(2);
    expect(result.status).toBe("completed");
  });

  it("reopens a recurring stage as pending rather than completing it permanently", () => {
    const recurring = actionPlan({ stages: [{ id: "collect", objective: "Collect tribute", actorId: "marcus-atilius", status: "pending", repeatEverySteps: 4 }] as ActionPlan["stages"] });
    const result = attemptPlanStageAtomically(recurring, "collect", 2, { success: true, resultFactIds: ["fact-1"] }) as ActionPlan;
    expect(result.stages.find((s) => s.id === "collect")!.status).toBe("pending");
  });
});

describe("originateActionPlan / respondToActionPlanAssignment (docs/32, Phase 9)", () => {
  it("creates a draft plan identically for a player, an NPC, and the world itself", () => {
    for (const kind of ["player", "npc", "world"] as const) {
      const plan = originateActionPlan("plan-x", { kind, sourceId: "someone", directiveId: null }, "hanno", "Do something", 1);
      expect(plan.origin.kind).toBe(kind);
      expect(plan.status).toBe("draft");
      expect(plan.stages).toEqual([]);
    }
  });

  it("records an assignment answer regardless of who originated the plan", () => {
    const npcPlan = originateActionPlan("plan-npc", { kind: "npc", sourceId: "hanno", directiveId: null }, "hanno", "Raid the coast", 1);
    const answered = respondToActionPlanAssignment(npcPlan, "delegate-1", true, "It serves my interests.");
    expect(answered.assignments).toEqual([{ actorId: "delegate-1", accepted: true, reason: "It serves my interests." }]);
  });

  it("an NPC-origin plan's stage starts and completes through the identical lifecycle a player plan uses", () => {
    const npcPlan: ActionPlan = {
      ...originateActionPlan("plan-npc", { kind: "npc", sourceId: "hanno", directiveId: null }, "hanno", "Raid the coast", 1),
      status: "active",
      stages: [ActionPlanStageSchema.parse({ id: "raid", objective: "Raid the coast", actorId: "hanno", status: "pending" })],
    };
    const started = startPlanStage(npcPlan, "raid", 2) as ActionPlan;
    expect(started.stages[0]!.status).toBe("in_progress");
    const completed = completePlanStage(started, "raid", 5, { success: true, resultFactIds: ["fact-raid"] }) as ActionPlan;
    expect(completed.status).toBe("completed");
  });

  it("a new player instruction still outranks an NPC's self-directed claim on the same force -- unification does not change priority order", () => {
    const npcPlan = { ...originateActionPlan("plan-npc", { kind: "npc", sourceId: "hanno", directiveId: null }, "hanno", "Use the fleet", 1), status: "active" as const, updatedAtStep: 2 };
    const playerPlanClaim: ActionPlan = { ...originateActionPlan("plan-player", { kind: "player", sourceId: "marcus-atilius", directiveId: "directive-0" }, "marcus-atilius", "Recall the fleet", 5), status: "active" as const, updatedAtStep: 5 };
    const claims: StageResourceClaim[] = [
      { planId: npcPlan.id, stageId: "npc-stage", kind: "force", resourceId: "fleet-1", priorityContext: defaultPriorityContextFor(npcPlan.origin), updatedAtStep: npcPlan.updatedAtStep },
      { planId: playerPlanClaim.id, stageId: "player-stage", kind: "force", resourceId: "fleet-1", priorityContext: "new_instruction", updatedAtStep: playerPlanClaim.updatedAtStep },
    ];
    const losers = resolveConflicts(detectResourceConflicts(claims));
    expect([...losers.keys()]).toEqual(["npc-stage"]);
  });
});

describe("WorldState.plans", () => {
  it("stays absent on a snapshot that only ever populated playerPlans, and can be derived on demand", () => {
    const world = structuredClone(firstPunicWarScenario.initialWorld);
    expect(WorldStateSchema.safeParse(world).success).toBe(true);
    expect(world.plans).toBeUndefined();
    const derived = upgradePlayerPlansToActionPlans(world.playerPlans);
    expect(WorldStateSchema.safeParse({ ...world, plans: derived }).success).toBe(true);
  });
});
