import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { Commitment } from "./commitments";
import { generateCandidateActions } from "./candidates";

const world = () => structuredClone(firstPunicWarScenario.initialWorld);

describe("generateCandidateActions", () => {
  it("always includes the baseline wait candidate, even with no other state", () => {
    const w = world();
    const character = w.characters.find((c) => c.id === "marcus-atilius")!;
    const candidates = generateCandidateActions({ world: w, character, atStep: 1, commitments: [] });
    expect(candidates.some((c) => c.actionType === "wait")).toBe(true);
  });

  it("proposes fulfill/defer/break only for commitments the character actually owes", () => {
    const w = world();
    const character = w.characters.find((c) => c.id === "marcus-atilius")!;
    const commitment: Commitment = {
      id: "c1", promisorCharacterId: "marcus-atilius", beneficiaryCharacterId: "hanno",
      actionKind: "payment", description: "Pay the debt.", conditions: "",
      requiredOfficeId: null, requiredResource: null, visibility: "private",
      sourceEventId: null, breachPressureKind: "humiliation", status: "pending",
      createdAtStep: 1, reviewAtStep: 2, resolvedAtStep: null, resolutionReason: null,
    };
    const candidates = generateCandidateActions({ world: w, character, atStep: 5, commitments: [commitment] });
    expect(candidates.some((c) => c.actionType === "fulfill_commitment" && c.sourceCommitmentId === "c1")).toBe(true);
    expect(candidates.some((c) => c.actionType === "defer_commitment" && c.sourceCommitmentId === "c1")).toBe(true);
    expect(candidates.some((c) => c.actionType === "break_commitment" && c.sourceCommitmentId === "c1")).toBe(true);
  });

  it("does not propose fulfill_commitment when the character lacks the required resource", () => {
    const w = world();
    const character = w.characters.find((c) => c.id === "marcus-atilius")!;
    const commitment: Commitment = {
      id: "c1", promisorCharacterId: "marcus-atilius", beneficiaryCharacterId: "hanno",
      actionKind: "payment", description: "Pay a fortune.", conditions: "",
      requiredOfficeId: null,
      requiredResource: { accountId: character.personalAccountId, minAmount: 999_999_999 },
      visibility: "private", sourceEventId: null, breachPressureKind: "humiliation", status: "pending",
      createdAtStep: 1, reviewAtStep: 2, resolvedAtStep: null, resolutionReason: null,
    };
    const candidates = generateCandidateActions({ world: w, character, atStep: 5, commitments: [commitment] });
    expect(candidates.some((c) => c.actionType === "fulfill_commitment")).toBe(false);
    expect(candidates.some((c) => c.actionType === "defer_commitment")).toBe(true);
  });

  it("never invents a target: advance_plot only appears for a plot this character actually owns", () => {
    const w = world();
    const character = w.characters.find((c) => c.id === "marcus-atilius")!;
    const candidates = generateCandidateActions({ world: w, character, atStep: 1, commitments: [] });
    expect(candidates.some((c) => c.actionType === "advance_plot")).toBe(false);
  });
});
