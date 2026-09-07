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

  // docs/32: seek_support/request_assistance reuse the same fixed-effect table.
  it("also accepts the two docs/32 kinds, seek_support and request_assistance", () => {
    const seekSupport = executeWorkflow(
      { actionId: "record_character_social_action", actorId: "marcus-atilius", parameters: { targetCharacterId: "hanno", kind: "seek_support", reasonLabel: "Asks Hanno to back him." } },
      world(),
      1,
    );
    expect(seekSupport.ok).toBe(true);
    const requestAssistance = executeWorkflow(
      { actionId: "record_character_social_action", actorId: "marcus-atilius", parameters: { targetCharacterId: "hanno", kind: "request_assistance", reasonLabel: "Asks Hanno for help." } },
      world(),
      1,
    );
    expect(requestAssistance.ok).toBe(true);
  });
});

describe("renegotiate_commitment", () => {
  it("proposes new terms the promisor can actually keep, staying pending", () => {
    const outcome = executeWorkflow(
      { actionId: "renegotiate_commitment", actorId: "marcus-atilius", parameters: { commitmentId: "marcus-pays-hanno", description: "Pay Hanno a smaller ransom instead.", requiredResource: { accountId: "marcus-purse", minAmount: 50 } } },
      world(),
      1,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const commitment = outcome.world.commitments.find((c) => c.id === "marcus-pays-hanno");
    expect(commitment?.status).toBe("pending");
    expect(commitment?.description).toBe("Pay Hanno a smaller ransom instead.");
    expect(commitment?.requiredResource).toEqual({ accountId: "marcus-purse", minAmount: 50 });
  });

  it("refuses terms the promisor still cannot actually keep", () => {
    const outcome = executeWorkflow(
      { actionId: "renegotiate_commitment", actorId: "marcus-atilius", parameters: { commitmentId: "marcus-pays-hanno", description: "Pay an impossible sum.", requiredResource: { accountId: "marcus-purse", minAmount: 999_999_999 } } },
      world(),
      1,
    );
    expect(outcome.ok).toBe(false);
  });

  it("refuses anyone but the promisor", () => {
    const outcome = executeWorkflow(
      { actionId: "renegotiate_commitment", actorId: "hanno", parameters: { commitmentId: "marcus-pays-hanno", description: "n/a" } },
      world(),
      1,
    );
    expect(outcome.ok).toBe(false);
  });

  it("produces byte-identical resulting state given the same snapshot and parameters", () => {
    const invocation = { actionId: "renegotiate_commitment" as const, actorId: "marcus-atilius", parameters: { commitmentId: "marcus-pays-hanno", description: "New terms.", requiredResource: { accountId: "marcus-purse", minAmount: 50 } } };
    const outcomeA = executeWorkflow(invocation, world(), 1);
    const outcomeB = executeWorkflow(invocation, world(), 1);
    expect(outcomeA).toEqual(outcomeB);
  });
});

describe("investigate", () => {
  const withBelief = (): WorldState => ({
    ...world(),
    characterBeliefs: [{
      id: "b1", holderCharacterId: "marcus-atilius", subjectEntityId: "hanno",
      claim: "Hanno may be moving against Messana.", kind: "suspicion",
      sourceCharacterId: null, sourceEventId: null, confidence: 25, visibility: "private",
      learnedAtStep: 0, expiresAtStep: null, supersedesBeliefIds: [], status: "active",
    }],
  });

  it("raises confidence on a belief the holder actually holds", () => {
    const outcome = executeWorkflow({ actionId: "investigate", actorId: "marcus-atilius", parameters: { beliefId: "b1" } }, withBelief(), 1);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.characterBeliefs.find((b) => b.id === "b1")?.confidence).toBe(45);
  });

  it("refuses anyone but the belief's own holder", () => {
    const outcome = executeWorkflow({ actionId: "investigate", actorId: "hanno", parameters: { beliefId: "b1" } }, withBelief(), 1);
    expect(outcome.ok).toBe(false);
  });

  it("refuses an unknown belief", () => {
    const outcome = executeWorkflow({ actionId: "investigate", actorId: "marcus-atilius", parameters: { beliefId: "nowhere" } }, withBelief(), 1);
    expect(outcome.ok).toBe(false);
  });

  it("produces byte-identical resulting state given the same snapshot and parameters", () => {
    const invocation = { actionId: "investigate" as const, actorId: "marcus-atilius", parameters: { beliefId: "b1" } };
    const outcomeA = executeWorkflow(invocation, withBelief(), 1);
    const outcomeB = executeWorkflow(invocation, withBelief(), 1);
    expect(outcomeA).toEqual(outcomeB);
  });
});

describe("spread_belief", () => {
  it("grants the target a belief through the private_disclosure channel", () => {
    const outcome = executeWorkflow(
      { actionId: "spread_belief", actorId: "marcus-atilius", parameters: { targetCharacterId: "hanno", subjectEntityId: "rome", claim: "Rome is mustering another legion.", kind: "rumour" } },
      world(),
      1,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const belief = outcome.world.characterBeliefs.find((b) => b.holderCharacterId === "hanno" && b.claim === "Rome is mustering another legion.");
    expect(belief).toBeDefined();
    expect(belief?.kind).toBe("rumour");
  });

  it("refuses a character sharing a belief with themselves", () => {
    const outcome = executeWorkflow(
      { actionId: "spread_belief", actorId: "marcus-atilius", parameters: { targetCharacterId: "marcus-atilius", subjectEntityId: null, claim: "n/a", kind: "rumour" } },
      world(),
      1,
    );
    expect(outcome.ok).toBe(false);
  });

  it("refuses an unknown target", () => {
    const outcome = executeWorkflow(
      { actionId: "spread_belief", actorId: "marcus-atilius", parameters: { targetCharacterId: "nobody", subjectEntityId: null, claim: "n/a", kind: "rumour" } },
      world(),
      1,
    );
    expect(outcome.ok).toBe(false);
  });

  it("produces byte-identical resulting state given the same snapshot and parameters", () => {
    const invocation = { actionId: "spread_belief" as const, actorId: "marcus-atilius", parameters: { targetCharacterId: "hanno", subjectEntityId: "rome", claim: "Rome is mustering another legion.", kind: "rumour" as const } };
    const outcomeA = executeWorkflow(invocation, world(), 1);
    const outcomeB = executeWorkflow(invocation, world(), 1);
    expect(outcomeA).toEqual(outcomeB);
  });
});
