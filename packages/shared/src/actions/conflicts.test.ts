import { describe, expect, it } from "vitest";
import { ActionPlanSchema, type ActionPlan } from "./plans";
import { reserveResource, activeReservations, type ResourceReservation } from "./reservations";
import {
  applyPreemption,
  defaultPriorityContextFor,
  detectResourceConflicts,
  priorityRank,
  resolveConflicts,
  type StageResourceClaim,
} from "./conflicts";

function plan(id: string, originKind: ActionPlan["origin"]["kind"], stageId: string, stageStatus: ActionPlan["stages"][number]["status"], updatedAtStep: number): ActionPlan {
  return ActionPlanSchema.parse({
    id,
    origin: { kind: originKind, sourceId: "someone", directiveId: null },
    ownerCharacterId: "marcus-atilius",
    rawText: "Do something",
    revisions: [{ atStep: 1, text: "Do something" }],
    options: {},
    interpretation: "Do something",
    status: "active",
    stages: [{ id: stageId, objective: "Move the fleet", actorId: "marcus-atilius", status: stageStatus }],
    assignments: [],
    spent: 0,
    createdAtStep: 1,
    updatedAtStep,
  });
}

describe("priorityRank / defaultPriorityContextFor", () => {
  it("ranks new instructions above revisions above existing plans above delegated work above NPC above world background", () => {
    expect(priorityRank("new_instruction")).toBeLessThan(priorityRank("revision"));
    expect(priorityRank("revision")).toBeLessThan(priorityRank("existing_plan"));
    expect(priorityRank("existing_plan")).toBeLessThan(priorityRank("delegated_work"));
    expect(priorityRank("delegated_work")).toBeLessThan(priorityRank("npc_self_directed"));
    expect(priorityRank("npc_self_directed")).toBeLessThan(priorityRank("world_background"));
  });

  it("defaults a player-origin plan to existing_plan and a world-origin plan to world_background", () => {
    expect(defaultPriorityContextFor({ kind: "player", sourceId: "x", directiveId: null })).toBe("existing_plan");
    expect(defaultPriorityContextFor({ kind: "npc", sourceId: "x", directiveId: null })).toBe("npc_self_directed");
    expect(defaultPriorityContextFor({ kind: "world", sourceId: "x", directiveId: null })).toBe("world_background");
  });
});

describe("detectResourceConflicts", () => {
  it("flags two different plans claiming the same force", () => {
    const claims: StageResourceClaim[] = [
      { planId: "plan-a", stageId: "a1", kind: "force", resourceId: "force-1", priorityContext: "existing_plan", updatedAtStep: 1 },
      { planId: "plan-b", stageId: "b1", kind: "force", resourceId: "force-1", priorityContext: "new_instruction", updatedAtStep: 3 },
    ];
    const conflicts = detectResourceConflicts(claims);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.claims).toHaveLength(2);
  });

  it("does not flag two stages of the same plan claiming the same resource", () => {
    const claims: StageResourceClaim[] = [
      { planId: "plan-a", stageId: "a1", kind: "force", resourceId: "force-1", priorityContext: "existing_plan", updatedAtStep: 1 },
      { planId: "plan-a", stageId: "a2", kind: "force", resourceId: "force-1", priorityContext: "existing_plan", updatedAtStep: 2 },
    ];
    expect(detectResourceConflicts(claims)).toHaveLength(0);
  });

  it("does not flag claims on different resources", () => {
    const claims: StageResourceClaim[] = [
      { planId: "plan-a", stageId: "a1", kind: "force", resourceId: "force-1", priorityContext: "existing_plan", updatedAtStep: 1 },
      { planId: "plan-b", stageId: "b1", kind: "force", resourceId: "force-2", priorityContext: "existing_plan", updatedAtStep: 1 },
    ];
    expect(detectResourceConflicts(claims)).toHaveLength(0);
  });
});

describe("resolveConflicts / applyPreemption (docs/32, Phase 4)", () => {
  it("a new instruction outranks an existing plan's unfinished claim on the same force", () => {
    const oldPlan = plan("plan-old", "player", "old-march", "pending", 2);
    const newPlan = plan("plan-new", "player", "new-march", "pending", 5);
    const claims: StageResourceClaim[] = [
      { planId: oldPlan.id, stageId: "old-march", kind: "force", resourceId: "force-1", priorityContext: defaultPriorityContextFor(oldPlan.origin), updatedAtStep: oldPlan.updatedAtStep },
      { planId: newPlan.id, stageId: "new-march", kind: "force", resourceId: "force-1", priorityContext: "new_instruction", updatedAtStep: newPlan.updatedAtStep },
    ];
    const losers = resolveConflicts(detectResourceConflicts(claims));
    expect([...losers.keys()]).toEqual(["old-march"]);

    let reservations = reserveResource([], { planId: oldPlan.id, stageId: "old-march", kind: "force", resourceId: "force-1", atStep: 2 });
    const result = applyPreemption([oldPlan, newPlan], losers, reservations, 6);
    const supersededPlan = result.plans.find((p) => p.id === oldPlan.id)!;
    expect(supersededPlan.stages[0]!.status).toBe("superseded");
    expect(supersededPlan.stages[0]!.statusReason).toMatch(/Superseded/);
    expect(activeReservations(result.reservations, { kind: "force", resourceId: "force-1" })).toHaveLength(0);
  });

  it("interrupts an in-progress losing stage instead of superseding it", () => {
    const oldPlan = plan("plan-old", "player", "old-march", "in_progress", 2);
    const newPlan = plan("plan-new", "player", "new-march", "pending", 5);
    const claims: StageResourceClaim[] = [
      { planId: oldPlan.id, stageId: "old-march", kind: "force", resourceId: "force-1", priorityContext: "existing_plan", updatedAtStep: 2 },
      { planId: newPlan.id, stageId: "new-march", kind: "force", resourceId: "force-1", priorityContext: "new_instruction", updatedAtStep: 5 },
    ];
    const losers = resolveConflicts(detectResourceConflicts(claims));
    const result = applyPreemption([oldPlan, newPlan], losers, [] as ResourceReservation[], 6);
    expect(result.plans.find((p) => p.id === oldPlan.id)!.stages[0]!.status).toBe("interrupted");
  });

  it("never reverses an already-completed stage (rule #8)", () => {
    const completedPlan = plan("plan-old", "player", "old-march", "completed", 2);
    const newPlan = plan("plan-new", "player", "new-march", "pending", 5);
    const claims: StageResourceClaim[] = [
      { planId: completedPlan.id, stageId: "old-march", kind: "force", resourceId: "force-1", priorityContext: "existing_plan", updatedAtStep: 2 },
      { planId: newPlan.id, stageId: "new-march", kind: "force", resourceId: "force-1", priorityContext: "new_instruction", updatedAtStep: 5 },
    ];
    const losers = resolveConflicts(detectResourceConflicts(claims));
    const result = applyPreemption([completedPlan, newPlan], losers, [] as ResourceReservation[], 6);
    expect(result.plans.find((p) => p.id === completedPlan.id)!.stages[0]!.status).toBe("completed");
  });

  it("touches no plan when there is no conflict", () => {
    const onlyPlan = plan("plan-a", "player", "a1", "pending", 2);
    const result = applyPreemption([onlyPlan], resolveConflicts([]), [] as ResourceReservation[], 6);
    expect(result.plans[0]).toBe(onlyPlan);
  });
});
