import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { advanceWorldMatters, deriveWorldInstant, type WorldEventRecord, type WorldMatter, type WorldState } from "@chronica/shared";
import { runMatterReviewTick } from "./matter-review-tick";

const AT_STEP = 5;
const INSTANT = deriveWorldInstant(AT_STEP);

function baseWorld(): WorldState {
  return structuredClone(firstPunicWarScenario.initialWorld);
}

/** A real, freshly-detected matter -- the scenario's own legio-pay obligation, overdue by step 5. */
function realMatter(): WorldMatter {
  const detected = advanceWorldMatters(baseWorld(), INSTANT, AT_STEP);
  const matter = detected.world.worldMatters!.find((m) => m.sourceRef.kind === "obligation" && m.sourceRef.id === "legio-pay")!;
  expect(matter).toBeDefined();
  return matter;
}

function tickEvent(matterId: string, instant = INSTANT): WorldEventRecord {
  return {
    id: "evt-1", gameId: "game-1", scheduledForTurnId: null, kind: "world_process_tick", status: "pending",
    instant, priority: 0, isPlayerAction: false, subjectRef: { kind: "matter", id: matterId },
    actionId: null, operationId: null,
    payload: { kind: "world_process_tick", processKind: "matter", targetRef: { kind: "matter", id: matterId } },
    causalDepth: 0, causedByEventId: null, causedByFactId: null, createdAtStep: AT_STEP, resolvedAtStep: null, resolvedFactIds: [],
  };
}

describe("runMatterReviewTick (docs/plans/ai-world-matters-runtime.md, \"Chronological integration\")", () => {
  it("schedules no follow-up for an event naming a matter that no longer exists", () => {
    const w = baseWorld();
    const result = runMatterReviewTick({ ...w, worldMatters: [] }, tickEvent("no-such-matter"), AT_STEP);
    expect(result.followUpEvents?.some((e) => e.subjectRef.id === "no-such-matter")).not.toBe(true);
  });

  it("schedules its own next review as a follow-up event when the matter is still non-terminal", () => {
    const matter = realMatter();
    const w: WorldState = { ...baseWorld(), worldMatters: [matter] };
    const result = runMatterReviewTick(w, tickEvent(matter.id), AT_STEP);
    const updated = result.world.worldMatters!.find((m) => m.id === matter.id)!;
    expect(updated.status).not.toBe("addressed");
    expect(updated.status).not.toBe("cancelled");
    const selfSchedule = result.followUpEvents?.find((e) => e.subjectRef.kind === "matter" && e.subjectRef.id === matter.id);
    expect(selfSchedule).toBeDefined();
    expect(selfSchedule?.payload).toMatchObject({ kind: "world_process_tick", processKind: "matter" });
  });

  it("its own internal fact carries no stateDeltas, so it can never derive affectedEntities and trigger a reaction on its own", () => {
    const matter = realMatter();
    const w: WorldState = { ...baseWorld(), worldMatters: [matter] };
    const result = runMatterReviewTick(w, tickEvent(matter.id), AT_STEP);
    for (const event of result.events) {
      expect(event.stateDeltas ?? []).toEqual([]);
    }
  });

  it("clears a standing plan and reopens the matter for AI attention when the plan it names no longer exists", () => {
    const matter = { ...realMatter(), standingPlanId: "plan-gone" };
    const w: WorldState = { ...baseWorld(), worldMatters: [matter], plans: [] };
    const result = runMatterReviewTick(w, tickEvent(matter.id), AT_STEP);
    const updated = result.world.worldMatters!.find((m) => m.id === matter.id)!;
    expect(updated.standingPlanId).toBeNull();
    expect(updated.status).toBe("due");
  });

  it("produces no follow-up once the matter reaches a terminal status and its underlying source is resolved", () => {
    // legio-pay's own obligation is due every single step in this scenario
    // (cadenceSteps: 1), so a still-active source would legitimately reopen
    // an "addressed" matter immediately -- that's real, intended behavior
    // (docs/plans/ai-world-matters-runtime.md: "resolve when the condition
    // ends... may reopen... if it later returns"), not what this test is
    // about. Deactivating the obligation removes it from the detector's own
    // candidates, so the terminal record is left untouched.
    const addressed: WorldMatter = { ...realMatter(), status: "addressed", resolutionFactIds: ["fact-1"] };
    const w: WorldState = {
      ...baseWorld(),
      worldMatters: [addressed],
      material: { ...baseWorld().material, obligations: baseWorld().material.obligations.map((o) => (o.id === "legio-pay" ? { ...o, active: false } : o)) },
    };
    const result = runMatterReviewTick(w, tickEvent(addressed.id), AT_STEP);
    const updated = result.world.worldMatters!.find((m) => m.id === addressed.id)!;
    expect(updated.status).toBe("addressed");
    expect(result.followUpEvents?.some((e) => e.subjectRef.id === addressed.id)).not.toBe(true);
  });
});
