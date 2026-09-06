import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { CandidateAction, ProposedInvocation, WorkflowAuditEntry } from "@chronica/shared";
import {
  buildIntentInvocation,
  hasActiveAgencyState,
  isEligibleForNpcAgency,
  resolveFormedNpcIntentOutcome,
  type FormedNpcProposal,
} from "./character-agency";

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

describe("hasActiveAgencyState", () => {
  it("is true for a character with an active goal", () => {
    const w = { ...world(), characterGoals: [{ id: "g1", characterId: "hanno", objective: "x", category: "resource" as const, targetEntityIds: [], priority: 3, status: "active" as const, visibility: "polity" as const, causalFactIds: [], createdAtStep: 0, updatedAtStep: 0, history: [] }] };
    expect(hasActiveAgencyState(w, "hanno")).toBe(true);
  });

  it("is true for a character with an active plot, false once it is abandoned", () => {
    const plot = { id: "p1", characterId: "hanno", goalId: "g1", worldStorylineId: null, participantIds: [], allyIds: [], targetIds: [], objective: "x", stage: "forming" as const, momentum: 50, stakes: "x", visibility: "polity" as const, currentObstacle: null, nextIntendedMove: null, status: "active" as const, causalHistory: [], createdAtStep: 0, updatedAtStep: 0 };
    expect(hasActiveAgencyState({ ...world(), characterPlots: [plot] }, "hanno")).toBe(true);
    expect(hasActiveAgencyState({ ...world(), characterPlots: [{ ...plot, status: "abandoned" as const }] }, "hanno")).toBe(false);
  });

  it("is true for a character with an active pressure", () => {
    const pressure = { id: "pr1", characterId: "hanno", kind: "political_danger" as const, intensity: 40, label: "x", sourceEventId: null, createdAtStep: 0, reviewAtStep: 8, expiresAtStep: null, visibility: "polity" as const, status: "active" as const };
    expect(hasActiveAgencyState({ ...world(), characterPressures: [pressure] }, "hanno")).toBe(true);
  });

  it("is false for a character with none of the above, even if they command a force", () => {
    expect(hasActiveAgencyState(world(), "hanno")).toBe(false);
  });
});

describe("isEligibleForNpcAgency", () => {
  // Regression: a leader ensurePolityLeadership seeds this very turn (e.g.
  // Brennos, freshly named for an invaded or addressed power) has no
  // continuity history yet, so gating agency on continuity tier "principal"
  // alone silently excluded exactly the character a turn most needs to hear
  // from.
  it("admits a character seeded this turn even with no continuity history", () => {
    expect(isEligibleForNpcAgency(undefined, true, "background", false)).toBe(true);
  });

  it("admits a character the selector itself ranked as this turn's most relevant", () => {
    expect(isEligibleForNpcAgency("ordinary", false, "persistent", false)).toBe(true);
  });

  it("still admits an established principal-tier character", () => {
    expect(isEligibleForNpcAgency("principal", false, "background", false)).toBe(true);
  });

  // Regression: Carthage/Hanno commands a force and scores "important" in
  // selection, but was excluded from agency entirely because "important" is
  // not "persistent" and he has no continuity history. Explicit scenario
  // relevance (a real goal/plot/pressure) admits him without admitting every
  // other force commander who has none.
  it("admits an ordinary, unseeded, non-persistent character with explicit scenario relevance", () => {
    expect(isEligibleForNpcAgency("ordinary", false, "important", true)).toBe(true);
  });

  it("excludes an ordinary, unseeded, non-persistent character with no active agency state", () => {
    expect(isEligibleForNpcAgency("ordinary", false, "background", false)).toBe(false);
    expect(isEligibleForNpcAgency("remembered", false, "important", false)).toBe(false);
  });
});

describe("resolveFormedNpcIntentOutcome", () => {
  function proposal(overrides: Partial<FormedNpcProposal> = {}): FormedNpcProposal {
    return {
      intentId: "intent-hanno-5",
      actorCharacterId: "hanno",
      actionType: "seek_office",
      rationale: "Hanno wants the vacant office.",
      workflowIds: ["appoint_to_office"],
      invocation: { actionId: "appoint_to_office", actorId: "hanno", parameters: { characterId: "hanno", officeId: "suffete" } },
      ...overrides,
    };
  }

  function auditEntry(overrides: Partial<WorkflowAuditEntry> = {}): WorkflowAuditEntry {
    return {
      correlationId: "corr-1",
      source: "game_master",
      sourceRef: "npc",
      requestedActionId: "appoint_to_office",
      requestedInvocation: { actionId: "appoint_to_office", actorId: "hanno", parameters: { characterId: "hanno", officeId: "suffete" } },
      executionOk: false,
      executionReason: "The office is not vacant.",
      ...overrides,
    };
  }

  it("marks a proposal executed when the Game Master invoked the exact actor and workflow", () => {
    const executed: ProposedInvocation[] = [{ actionId: "appoint_to_office", actorId: "hanno", parameters: { characterId: "hanno", officeId: "suffete" } }];
    const outcome = resolveFormedNpcIntentOutcome(proposal(), executed, []);
    expect(outcome.status).toBe("executed");
  });

  it("matches on a parameter subset, tolerating extra fields the Game Master added", () => {
    const executed: ProposedInvocation[] = [{ actionId: "appoint_to_office", actorId: "hanno", parameters: { characterId: "hanno", officeId: "suffete", note: "By acclamation." } }];
    const outcome = resolveFormedNpcIntentOutcome(proposal(), executed, []);
    expect(outcome.status).toBe("executed");
  });

  it("defers, with the engine's own refusal reason, when the proposed workflow was attempted and refused", () => {
    const outcome = resolveFormedNpcIntentOutcome(proposal(), [], [auditEntry()]);
    expect(outcome.status).toBe("deferred");
    expect(outcome.reason).toContain("The office is not vacant.");
  });

  it("defers with a generic reason when the Game Master never invoked the proposed workflow at all", () => {
    const outcome = resolveFormedNpcIntentOutcome(proposal(), [], []);
    expect(outcome.status).toBe("deferred");
    expect(outcome.reason).toMatch(/did not invoke/);
  });

  it("does not count a different actor's identical workflow call as this proposal's execution", () => {
    const executed: ProposedInvocation[] = [{ actionId: "appoint_to_office", actorId: "someone-else", parameters: { characterId: "hanno", officeId: "suffete" } }];
    const outcome = resolveFormedNpcIntentOutcome(proposal(), executed, []);
    expect(outcome.status).toBe("deferred");
  });
});
