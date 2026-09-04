import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { CandidateAction } from "@chronica/shared";
import { buildIntentInvocation, buildIntentSocialEvent } from "./character-agency";

const world = () => structuredClone(firstPunicWarScenario.initialWorld);

function candidate(overrides: Partial<CandidateAction>): CandidateAction {
  return {
    actorCharacterId: "marcus-atilius", actionType: "wait",
    sourceGoalId: null, sourcePlotId: null, sourceCommitmentId: null,
    targetIds: [], requiredBeliefClaim: null, minBeliefConfidence: 0,
    requiredOfficeId: null, requiredResource: null,
    expectedRisk: 0, expectedEffectSummary: "", legalWorkflowIds: [], rationale: "",
    ...overrides,
  };
}

describe("buildIntentInvocation", () => {
  it("builds appoint_to_office for seek_office with a required office", () => {
    const invocation = buildIntentInvocation(candidate({ actionType: "seek_office", requiredOfficeId: "consul" }), world());
    expect(invocation?.actionId).toBe("appoint_to_office");
    expect(invocation?.parameters["officeId"]).toBe("consul");
  });

  it("returns null for seek_office with no office named", () => {
    expect(buildIntentInvocation(candidate({ actionType: "seek_office", requiredOfficeId: null }), world())).toBeNull();
  });

  it("builds remove_gold for economic_action with a required resource", () => {
    const invocation = buildIntentInvocation(
      candidate({ actionType: "economic_action", requiredResource: { accountId: "acct-1", minAmount: 10 } }),
      world(),
    );
    expect(invocation?.actionId).toBe("remove_gold");
    expect(invocation?.parameters["amount"]).toBe(10);
  });

  it("returns null for advance_plot when the source plot no longer exists", () => {
    expect(buildIntentInvocation(candidate({ actionType: "advance_plot", sourcePlotId: "missing-plot" }), world())).toBeNull();
  });

  it("returns null for an action type with no legal workflow mapping", () => {
    expect(buildIntentInvocation(candidate({ actionType: "wait" }), world())).toBeNull();
  });
});

describe("buildIntentSocialEvent", () => {
  it("builds a social event whose relation cause targets the actor from the target's own perspective", () => {
    const event = buildIntentSocialEvent(candidate({ actionType: "threaten", targetIds: ["hanno"] }), 5, "game-1");
    expect(event?.relationCauses[0]?.subjectCharacterId).toBe("hanno");
    expect(event?.relationCauses[0]?.targetCharacterId).toBe("marcus-atilius");
    expect(event?.relationCauses[0]?.dimensions?.fear).toBeGreaterThan(0);
  });

  it("returns null for an action with no target", () => {
    expect(buildIntentSocialEvent(candidate({ actionType: "threaten", targetIds: [] }), 5, "game-1")).toBeNull();
  });

  it("returns null for an action with no modeled social effect", () => {
    expect(buildIntentSocialEvent(candidate({ actionType: "wait", targetIds: ["hanno"] }), 5, "game-1")).toBeNull();
  });
});
