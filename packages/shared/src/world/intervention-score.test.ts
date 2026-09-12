import { describe, expect, it } from "vitest";
import { detectResourceConflicts, type StageResourceClaim } from "../actions/conflicts";
import { computeInterventionScore, type InterventionPlanLike } from "./intervention-score";
import { FactSchema, type Fact, type FactInterventionSignals } from "./facts";

function fact(overrides: Partial<Fact> & { interventionSignals?: Partial<FactInterventionSignals> } = {}): Fact {
  const { interventionSignals, ...rest } = overrides;
  return FactSchema.parse({
    id: rest.id ?? `fact-${Math.random()}`,
    time: { day: 1, minute: 0 },
    atStep: 1,
    kind: "test_event",
    summary: "Something happened.",
    affectedEntities: [],
    resourceChanges: [],
    visibility: "public",
    discovery: { state: "public", knowableAtInstant: null, discoveredBy: [] },
    evidence: null,
    eligibleReactionScopes: [],
    interventionSignals: interventionSignals ?? {},
    sourceEventId: null,
    sourceActionId: null,
    causalDepth: 0,
    ...rest,
  });
}

function plan(overrides: Partial<InterventionPlanLike> = {}): InterventionPlanLike {
  return { id: "plan-1", clarificationQuestions: [], spent: 0, options: { budget: null }, ...overrides };
}

describe("computeInterventionScore -- the 0-100 score (unified action runtime)", () => {
  it("scores nothing, and does not require intervention, when no fact carries any signal", () => {
    const decision = computeInterventionScore({ facts: [fact()], plans: [plan()] });
    expect(decision.hardStopReason).toBeNull();
    expect(decision.score).toBe(0);
    expect(decision.requiresIntervention).toBe(false);
  });

  it("awards a factor's full points for a 'major' signal, and no more than that factor's own maximum", () => {
    const decision = computeInterventionScore({
      facts: [fact({ interventionSignals: { irreversibility: "major" } })],
      plans: [],
    });
    expect(decision.breakdown.irreversibility).toBe(30);
    expect(decision.score).toBe(30);
  });

  it("takes the strongest instance of each factor across facts, not a sum across facts", () => {
    const decision = computeInterventionScore({
      facts: [
        fact({ id: "f1", interventionSignals: { strategicConsequence: "minor" } }),
        fact({ id: "f2", interventionSignals: { strategicConsequence: "major" } }),
      ],
      plans: [],
    });
    expect(decision.breakdown.strategicConsequence).toBe(15);
    expect(decision.contributingFactIds).not.toContain("f1");
  });

  it("sums independent factors across different facts toward the same score", () => {
    const decision = computeInterventionScore({
      facts: [
        fact({ interventionSignals: { directPlayerInvolvement: "major" } }), // 20
        fact({ interventionSignals: { uncertainty: "major" } }), // 10
      ],
      plans: [],
      threshold: 100, // isolate the score from the default 60 threshold
    });
    expect(decision.score).toBe(30);
    expect(decision.requiresIntervention).toBe(false);
  });

  it("crosses the default threshold (60) and requires intervention once enough factors accumulate", () => {
    const decision = computeInterventionScore({
      facts: [
        fact({ interventionSignals: { irreversibility: "major" } }), // 30
        fact({ interventionSignals: { deviationFromPlan: "major" } }), // 25
        fact({ interventionSignals: { directPlayerInvolvement: "minor" } }), // 7
      ],
      plans: [],
    });
    expect(decision.score).toBe(62);
    expect(decision.requiresIntervention).toBe(true);
  });

  it("stays below threshold for an ordinary, low-stakes event -- a routine progress report should not wake the player", () => {
    // The Roman-navy build's middle milestone: work proceeds broadly on schedule.
    const decision = computeInterventionScore({
      facts: [fact({ interventionSignals: { deviationFromPlan: "minor" } })],
      plans: [],
    });
    expect(decision.requiresIntervention).toBe(false);
  });

  it("respects a scenario-supplied threshold override", () => {
    const decision = computeInterventionScore({
      facts: [fact({ interventionSignals: { strategicConsequence: "major" } })], // 15
      plans: [],
      threshold: 10,
    });
    expect(decision.requiresIntervention).toBe(true);
  });
});

describe("computeInterventionScore -- hard stops bypass the score entirely", () => {
  it("stops for an outstanding clarification question, regardless of any fact's score", () => {
    const decision = computeInterventionScore({
      facts: [fact()],
      plans: [plan({ id: "plan-clarify", clarificationQuestions: ["Which legion do you mean?"] })],
    });
    expect(decision.hardStopReason).toBe("clarification_required");
    expect(decision.requestedPlayerDecision).toBe("Which legion do you mean?");
    expect(decision.contributingFactIds).toEqual(["plan-clarify"]);
    expect(decision.requiresIntervention).toBe(true);
  });

  it("stops when an NPC initiated a dialogue this window", () => {
    const decision = computeInterventionScore({
      facts: [fact({ id: "fact-dialogue", kind: "flag_npc_initiated_dialogue" })],
      plans: [],
    });
    expect(decision.hardStopReason).toBe("salient_event");
    expect(decision.contributingFactIds).toEqual(["fact-dialogue"]);
  });

  it("stops when a plan's actual spend has exceeded its own stated budget", () => {
    const decision = computeInterventionScore({
      facts: [fact()],
      plans: [plan({ id: "plan-over", spent: 500, options: { budget: { accountId: "acct-1", amount: 400 } } })],
    });
    expect(decision.hardStopReason).toBe("threshold_crossed");
    expect(decision.contributingFactIds).toEqual(["plan-over"]);
  });

  it("does not stop for a plan spending within its stated budget", () => {
    const decision = computeInterventionScore({
      facts: [fact()],
      plans: [plan({ spent: 300, options: { budget: { accountId: "acct-1", amount: 400 } } })],
    });
    expect(decision.hardStopReason).toBeNull();
  });

  it("stops when two player-owned plans contend for the same resource with no newer instruction breaking the tie", () => {
    // The design doc's own example: "march the army to Syracuse" while an
    // unfinished order to remain at Messana still holds the same legion.
    const claims: StageResourceClaim[] = [
      { planId: "plan-remain-messana", stageId: "stage-a", kind: "force", resourceId: "legion-1", priorityContext: "existing_plan", updatedAtStep: 3 },
      { planId: "plan-march-syracuse", stageId: "stage-b", kind: "force", resourceId: "legion-1", priorityContext: "existing_plan", updatedAtStep: 3 },
    ];
    const decision = computeInterventionScore({
      facts: [fact()],
      plans: [],
      conflicts: detectResourceConflicts(claims),
    });
    expect(decision.hardStopReason).toBe("plan_interrupted");
    expect(decision.contributingFactIds.sort()).toEqual(["plan-march-syracuse", "plan-remain-messana"]);
  });

  it("does not stop when a newer explicit instruction outranks the standing plan", () => {
    // "march the army to Syracuse" arrives as a fresh new_instruction -- it
    // outranks the unfinished existing_plan order to remain at Messana, so
    // there is no ambiguity for the player to resolve.
    const claims: StageResourceClaim[] = [
      { planId: "plan-remain-messana", stageId: "stage-a", kind: "force", resourceId: "legion-1", priorityContext: "existing_plan", updatedAtStep: 3 },
      { planId: "plan-march-syracuse", stageId: "stage-b", kind: "force", resourceId: "legion-1", priorityContext: "new_instruction", updatedAtStep: 4 },
    ];
    const decision = computeInterventionScore({
      facts: [fact()],
      plans: [],
      conflicts: detectResourceConflicts(claims),
    });
    expect(decision.hardStopReason).toBeNull();
  });

  it("stops for an irreversible fact whose outcome is still genuinely uncertain", () => {
    const decision = computeInterventionScore({
      facts: [fact({ id: "fact-irreversible", interventionSignals: { irreversibility: "major", uncertainty: "minor" } })],
      plans: [],
    });
    expect(decision.hardStopReason).toBe("salient_event");
    expect(decision.contributingFactIds).toEqual(["fact-irreversible"]);
  });

  it("does not stop for an irreversible fact whose outcome is already certain", () => {
    const decision = computeInterventionScore({
      facts: [fact({ interventionSignals: { irreversibility: "major", uncertainty: "none" } })],
      plans: [],
      threshold: 100,
    });
    expect(decision.hardStopReason).toBeNull();
  });
});
