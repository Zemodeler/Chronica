import { describe, expect, it } from "vitest";
import {
  ScenarioClockSchema,
  applyPreemption,
  defaultPriorityContextFor,
  detectResourceConflicts,
  originateActionPlan,
  reserveResource,
  resolveConflicts,
  startPlanStage,
  type ActionPlan,
  type StageResourceClaim,
} from "@chronica/shared";
import { decideElasticStop } from "./elastic-scheduler";

// A vertical slice of docs/32's own canonical example (Phase 4/15): "An army
// is marching toward Syracuse. The player orders it back to Rome. The march
// does not vanish: the current movement stage is interrupted, the force
// remains wherever it has actually reached, and a return stage begins from
// there." This test exercises Phases 1 (ActionPlan), 4 (conflicts/
// reservations), 7 (the elastic scheduler's shadow decision), 8 (stage
// lifecycle), and 9 (origin-agnostic plans) together, entirely at the pure,
// unit-testable level -- none of it is wired into the live GM tool loop yet
// (docs/32 notes this explicitly), so this proves the mechanism, not the
// live pipeline's current behavior.

const clock = ScenarioClockSchema.parse({ stepLabel: "day", stepLabelPlural: "days", stepsPerYear: 365, minSpan: 1, maxSpan: 90 });

describe("priority reversal vertical slice (docs/32, Phases 1/4/7/8/9)", () => {
  it("supersedes an unfinished march when a new recall order claims the same force, without ever reversing what already happened", () => {
    // 1. The player's original plan starts marching a force toward Syracuse.
    let marchPlan = originateActionPlan("plan-march", { kind: "player", sourceId: "marcus-atilius", directiveId: "directive-0" }, "marcus-atilius", "March the legion to Syracuse", 1);
    marchPlan = {
      ...marchPlan,
      status: "active",
      stages: [{
        id: "march", objective: "March to Syracuse", actorId: "marcus-atilius", action: null,
        dependsOn: [], provinceId: null, notBeforeStep: null, repeatEverySteps: null,
        reservationIds: [], durationEstimate: null, status: "pending",
        plannedStartStep: null, startedAtStep: null, expectedCompletionStep: null, completedAtStep: null,
        resultFactIds: [], statusReason: null,
      }],
    };
    const started = startPlanStage(marchPlan, "march", 2) as ActionPlan;
    expect(typeof started).not.toBe("string");
    let reservations = reserveResource([], { planId: started.id, stageId: "march", kind: "force", resourceId: "legio-ii", atStep: 2 });

    // 2. A new player instruction recalls the same force to Rome -- a second, independent plan.
    let recallPlan = originateActionPlan("plan-recall", { kind: "player", sourceId: "marcus-atilius", directiveId: "directive-1" }, "marcus-atilius", "Recall the legion to Rome", 4);
    recallPlan = {
      ...recallPlan,
      status: "active",
      stages: [{
        id: "return", objective: "Return to Rome", actorId: "marcus-atilius", action: null,
        dependsOn: [], provinceId: null, notBeforeStep: null, repeatEverySteps: null,
        reservationIds: [], durationEstimate: null, status: "pending",
        plannedStartStep: null, startedAtStep: null, expectedCompletionStep: null, completedAtStep: null,
        resultFactIds: [], statusReason: null,
      }],
    };

    // 3. Both plans claim the same force -- the recall, as a fresh instruction, outranks the still-marching plan.
    const claims: StageResourceClaim[] = [
      { planId: started.id, stageId: "march", kind: "force", resourceId: "legio-ii", priorityContext: defaultPriorityContextFor(started.origin), updatedAtStep: started.updatedAtStep },
      { planId: recallPlan.id, stageId: "return", kind: "force", resourceId: "legio-ii", priorityContext: "new_instruction", updatedAtStep: recallPlan.updatedAtStep },
    ];
    const losers = resolveConflicts(detectResourceConflicts(claims));
    expect([...losers.keys()]).toEqual(["march"]);

    // 4. Preemption interrupts the march (it was in_progress, not merely pending) and releases its reservation.
    const preempted = applyPreemption([started, recallPlan], losers, reservations, 5);
    reservations = preempted.reservations;
    const interruptedMarch = preempted.plans.find((p) => p.id === started.id)!;
    expect(interruptedMarch.stages[0]!.status).toBe("interrupted");
    expect(reservations.every((r) => r.releasedAtStep !== null)).toBe(true);

    // 5. The recall's own stage can now start, unblocked by any lingering reservation on the force.
    const recallStarted = startPlanStage(preempted.plans.find((p) => p.id === recallPlan.id)!, "return", 6);
    expect(typeof recallStarted).not.toBe("string");

    // 6. The shadow elastic scheduler reports this as a plan_interrupted stop, once minSpan is cleared -- exactly the kind of event that should return control to the player, not slide past unattended.
    const decision = decideElasticStop({
      elapsedStepStart: 5,
      scenarioClock: clock,
      factualEvents: [],
      plans: [],
      planInterruptionFactIds: [interruptedMarch.id],
    });
    expect(decision.stopReason).toBe("plan_interrupted");
    expect(decision.stoppingFactIds).toEqual([interruptedMarch.id]);
  });
});
