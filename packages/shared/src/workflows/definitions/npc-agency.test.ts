import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { executeWorkflow } from "../executor";
import type { WorldState } from "../../world/world-state";
import type { Commitment } from "../../character-agency/commitments";

const COMMITMENT: Commitment = {
  id: "marcus-pays-hanno",
  promisorCharacterId: "marcus-atilius",
  beneficiaryCharacterId: "hanno",
  actionKind: "payment",
  description: "Pay Hanno a ransom for the returned prisoners.",
  conditions: "",
  requiredOfficeId: null,
  requiredResource: { accountId: "marcus-purse", minAmount: 200 },
  visibility: "polity",
  sourceEventId: null,
  breachPressureKind: "humiliation",
  status: "pending",
  createdAtStep: 0,
  reviewAtStep: 1,
  resolvedAtStep: null,
  resolutionReason: null,
};

const world = (): WorldState => {
  const w = structuredClone(firstPunicWarScenario.initialWorld);
  return { ...w, commitments: [structuredClone(COMMITMENT)] };
};

describe("fulfill_commitment", () => {
  it("spends the promised resource and marks the commitment fulfilled", () => {
    const outcome = executeWorkflow(
      { actionId: "fulfill_commitment", actorId: "marcus-atilius", parameters: { commitmentId: "marcus-pays-hanno" } },
      world(),
      1,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.material.accounts.find((a) => a.id === "marcus-purse")?.balance).toBe(1_000);
    expect(outcome.world.material.accounts.find((a) => a.id === "hanno-purse")?.balance).toBe(1_100);
    expect(outcome.world.commitments.find((c) => c.id === "marcus-pays-hanno")?.status).toBe("fulfilled");
  });

  it("refuses anyone but the promisor", () => {
    const outcome = executeWorkflow(
      { actionId: "fulfill_commitment", actorId: "hanno", parameters: { commitmentId: "marcus-pays-hanno" } },
      world(),
      1,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain("only marcus-atilius may resolve it");
  });

  it("refuses an unknown commitment", () => {
    const outcome = executeWorkflow(
      { actionId: "fulfill_commitment", actorId: "marcus-atilius", parameters: { commitmentId: "nowhere" } },
      world(),
      1,
    );
    expect(outcome.ok).toBe(false);
  });

  it("refuses a commitment already resolved", () => {
    const already = executeWorkflow(
      { actionId: "fulfill_commitment", actorId: "marcus-atilius", parameters: { commitmentId: "marcus-pays-hanno" } },
      world(),
      1,
    );
    expect(already.ok).toBe(true);
    if (!already.ok) return;
    const outcome = executeWorkflow(
      { actionId: "fulfill_commitment", actorId: "marcus-atilius", parameters: { commitmentId: "marcus-pays-hanno" } },
      already.world,
      2,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain("already fulfilled");
  });

  // docs/30: a replay fixture -- the same command against the same snapshot
  // must yield byte-identical resulting state, run twice independently.
  it("produces byte-identical resulting state given the same snapshot and parameters", () => {
    const invocation = { actionId: "fulfill_commitment" as const, actorId: "marcus-atilius", parameters: { commitmentId: "marcus-pays-hanno" } };
    const outcomeA = executeWorkflow(invocation, world(), 1);
    const outcomeB = executeWorkflow(invocation, world(), 1);
    expect(outcomeA).toEqual(outcomeB);
  });
});

describe("defer_commitment", () => {
  it("defers without penalty and pushes the review step out", () => {
    const outcome = executeWorkflow(
      { actionId: "defer_commitment", actorId: "marcus-atilius", parameters: { commitmentId: "marcus-pays-hanno", reason: "The treasury is stretched this season.", reviewInSteps: 6 } },
      world(),
      1,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const commitment = outcome.world.commitments.find((c) => c.id === "marcus-pays-hanno");
    expect(commitment?.status).toBe("deferred");
    expect(commitment?.reviewAtStep).toBe(7);
    expect(outcome.world.material.accounts.find((a) => a.id === "marcus-purse")?.balance).toBe(1_200);
  });

  it("refuses anyone but the promisor", () => {
    const outcome = executeWorkflow(
      { actionId: "defer_commitment", actorId: "hanno", parameters: { commitmentId: "marcus-pays-hanno", reason: "n/a" } },
      world(),
      1,
    );
    expect(outcome.ok).toBe(false);
  });
});

describe("break_commitment", () => {
  it("marks the commitment broken and raises a pressure on the promisor", () => {
    const outcome = executeWorkflow(
      { actionId: "break_commitment", actorId: "marcus-atilius", parameters: { commitmentId: "marcus-pays-hanno", reason: "He chooses war over ransom." } },
      world(),
      1,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.commitments.find((c) => c.id === "marcus-pays-hanno")?.status).toBe("broken");
    expect(outcome.world.characterPressures.some((p) => p.characterId === "marcus-atilius" && p.kind === "humiliation")).toBe(true);
  });

  it("refuses anyone but the promisor", () => {
    const outcome = executeWorkflow(
      { actionId: "break_commitment", actorId: "hanno", parameters: { commitmentId: "marcus-pays-hanno", reason: "n/a" } },
      world(),
      1,
    );
    expect(outcome.ok).toBe(false);
  });
});

describe("record_character_social_action", () => {
  it("records the stated reason and moves the relationship by the kind's fixed magnitude", () => {
    const outcome = executeWorkflow(
      { actionId: "record_character_social_action", actorId: "marcus-atilius", parameters: { targetCharacterId: "hanno", kind: "threaten", reasonLabel: "Warns Hanno to withdraw from Drepanum." } },
      world(),
      1,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const hanno = outcome.world.characters.find((c) => c.id === "hanno");
    const cause = hanno?.relations.find((r) => r.subjectCharacterId === "marcus-atilius")?.causes.find((c) => c.label === "Warns Hanno to withdraw from Drepanum.");
    expect(cause?.score).toBe(15);
    expect(cause?.dimensions?.fear).toBe(15);
  });

  it("refuses a character directing a social action at themselves", () => {
    const outcome = executeWorkflow(
      { actionId: "record_character_social_action", actorId: "marcus-atilius", parameters: { targetCharacterId: "marcus-atilius", kind: "reconcile", reasonLabel: "n/a" } },
      world(),
      1,
    );
    expect(outcome.ok).toBe(false);
  });

  it("refuses an unknown target", () => {
    const outcome = executeWorkflow(
      { actionId: "record_character_social_action", actorId: "marcus-atilius", parameters: { targetCharacterId: "nobody", kind: "negotiate", reasonLabel: "n/a" } },
      world(),
      1,
    );
    expect(outcome.ok).toBe(false);
  });

  it("produces byte-identical resulting state given the same snapshot and parameters", () => {
    const invocation = { actionId: "record_character_social_action" as const, actorId: "marcus-atilius", parameters: { targetCharacterId: "hanno", kind: "publicly_oppose", reasonLabel: "Denounces Hanno before the Senate." } };
    const outcomeA = executeWorkflow(invocation, world(), 1);
    const outcomeB = executeWorkflow(invocation, world(), 1);
    expect(outcomeA).toEqual(outcomeB);
  });
});
