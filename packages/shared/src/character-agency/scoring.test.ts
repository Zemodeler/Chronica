import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { CandidateAction } from "./candidates";
import { chooseTopCandidate, rankCandidates, scoreCandidate } from "./scoring";

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

describe("scoreCandidate determinism", () => {
  it("produces byte-identical scores for the same world, character, and candidate", () => {
    const w = world();
    const character = w.characters.find((c) => c.id === "marcus-atilius")!;
    const cand = candidate({ actionType: "threaten", targetIds: ["hanno"], expectedRisk: 50 });
    expect(scoreCandidate(w, character, cand)).toEqual(scoreCandidate(w, character, cand));
  });
});

describe("cautious vs bold characters under identical risk", () => {
  it("a cautious character discounts a risky candidate more than a bold one", () => {
    const w = world();
    const cautious = { ...w.characters.find((c) => c.id === "marcus-atilius")!, mind: { ...w.characters[0]!.mind, riskTolerance: 10, temperament: { ...w.characters[0]!.mind.temperament, boldness: 10 } } };
    const bold = { ...cautious, mind: { ...cautious.mind, riskTolerance: 90, temperament: { ...cautious.mind.temperament, boldness: 90 } } };
    const risky = candidate({ actionType: "military_action", expectedRisk: 80 });
    const cautiousScore = scoreCandidate(w, cautious, risky);
    const boldScore = scoreCandidate(w, bold, risky);
    expect(cautiousScore.riskAdjustment).toBeLessThan(boldScore.riskAdjustment);
  });
});

describe("rankCandidates / chooseTopCandidate", () => {
  it("prefers acting over waiting when a real pressure is active", () => {
    const w = world();
    w.characterPressures = [{
      id: "p1", characterId: "marcus-atilius", kind: "debt", intensity: 90, label: "Deep in debt.",
      sourceEventId: null, createdAtStep: 0, reviewAtStep: 10, expiresAtStep: null, visibility: "private", status: "active",
    }];
    const character = w.characters.find((c) => c.id === "marcus-atilius")!;
    const candidates = [
      candidate({ actionType: "wait" }),
      candidate({ actionType: "request_assistance", expectedRisk: 10 }),
    ];
    const top = chooseTopCandidate(w, character, candidates, 5);
    expect(top?.candidate.actionType).toBe("request_assistance");
  });

  it("ranking is stable and reproducible for the same input", () => {
    const w = world();
    const character = w.characters.find((c) => c.id === "marcus-atilius")!;
    const candidates = [candidate({ actionType: "wait" }), candidate({ actionType: "prepare" })];
    const a = rankCandidates(w, character, candidates, 3);
    const b = rankCandidates(w, character, candidates, 3);
    expect(a.map((r) => r.candidate.actionType)).toEqual(b.map((r) => r.candidate.actionType));
  });
});
