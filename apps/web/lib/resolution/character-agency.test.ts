import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { CandidateAction, CharacterSuggestion } from "@chronica/shared";
import { buildCharacterSuggestionInvocation, buildIntentInvocation, buildIntentSocialEvent } from "./character-agency";

const world = () => structuredClone(firstPunicWarScenario.initialWorld);

function suggestion(overrides: Partial<CharacterSuggestion>): CharacterSuggestion {
  return {
    characterId: "marcus-atilius", suggestionKind: "create_goal",
    goalId: null, plotId: null, proposedGoal: null, proposedPlot: null,
    goalStatus: null, plotStage: null, plotResolutionStatus: null,
    rationale: "Because of a meaningful trigger.", causalFactIds: [], affectedEntityIds: [],
    storylineId: null, visibility: "private", salience: 5,
    ...overrides,
  };
}

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

describe("buildCharacterSuggestionInvocation", () => {
  it("builds create_character_goal from a create_goal suggestion", () => {
    const invocation = buildCharacterSuggestionInvocation(
      suggestion({
        suggestionKind: "create_goal",
        proposedGoal: { objective: "Secure the frontier.", category: "preserve_power", targetEntityIds: [], priority: 3, visibility: "private" },
      }),
      "marcus-atilius",
    );
    expect(invocation?.actionId).toBe("create_character_goal");
    expect(invocation?.parameters["objective"]).toBe("Secure the frontier.");
  });

  it("returns null for create_goal with no proposed goal payload", () => {
    expect(buildCharacterSuggestionInvocation(suggestion({ suggestionKind: "create_goal", proposedGoal: null }), "marcus-atilius")).toBeNull();
  });

  it("builds resolve_character_plot only when plotId and a resolution status are both present", () => {
    expect(buildCharacterSuggestionInvocation(
      suggestion({ suggestionKind: "resolve_plot", plotId: "plot-1", plotResolutionStatus: "succeeded" }),
      "marcus-atilius",
    )?.actionId).toBe("resolve_character_plot");
    expect(buildCharacterSuggestionInvocation(
      suggestion({ suggestionKind: "resolve_plot", plotId: null, plotResolutionStatus: "succeeded" }),
      "marcus-atilius",
    )).toBeNull();
  });

  it("never builds an invocation for a purely narrative suggestion kind", () => {
    expect(buildCharacterSuggestionInvocation(suggestion({ suggestionKind: "react" }), "marcus-atilius")).toBeNull();
    expect(buildCharacterSuggestionInvocation(suggestion({ suggestionKind: "develop_relationship" }), "marcus-atilius")).toBeNull();
  });
});

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
