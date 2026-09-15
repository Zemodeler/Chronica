import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import {
  breakCommitment,
  cancelCommitment,
  checkCommitmentAuthority,
  createCommitment,
  detectConflictingCommitments,
  dueCommitments,
  fulfillCommitment,
  type Commitment,
} from "./commitments";

const world = () => structuredClone(firstPunicWarScenario.initialWorld);

function baseCommitment(overrides: Partial<Commitment> = {}): Commitment {
  return {
    id: "c1", promisorCharacterId: "marcus-atilius", beneficiaryCharacterId: "hanno",
    actionKind: "payment", description: "Pay twenty denarii.", conditions: "",
    requiredOfficeId: null, requiredResource: null, visibility: "private",
    sourceEventId: null, breachPressureKind: "humiliation", status: "pending",
    createdAtStep: 1, reviewAtStep: 5, resolvedAtStep: null, resolutionReason: null,
    ...overrides,
  };
}

describe("checkCommitmentAuthority / createCommitment", () => {
  it("rejects a promise of an office the promisor does not hold", () => {
    const w = world();
    const result = createCommitment(
      { characters: w.characters, commitments: [], material: w.material },
      {
        id: "c1", promisorCharacterId: "marcus-atilius", beneficiaryCharacterId: "hanno",
        actionKind: "office_favour", description: "Grant a magistracy.", requiredOfficeId: "office-not-held",
        visibility: "private", sourceEventId: null, atStep: 1, reviewInSteps: 4,
      },
    );
    expect("rejectionReason" in result).toBe(true);
  });

  it("rejects a promise of money the promisor's account cannot cover", () => {
    const w = world();
    const marcus = w.characters.find((c) => c.id === "marcus-atilius")!;
    const result = createCommitment(
      { characters: w.characters, commitments: [], material: w.material },
      {
        id: "c1", promisorCharacterId: "marcus-atilius", beneficiaryCharacterId: "hanno",
        actionKind: "payment", description: "Pay a fortune.",
        requiredResource: { accountId: marcus.personalAccountId, minAmount: 999_999_999 },
        visibility: "private", sourceEventId: null, atStep: 1, reviewInSteps: 4,
      },
    );
    expect("rejectionReason" in result).toBe(true);
  });

  it("creates a commitment the promisor genuinely controls", () => {
    const w = world();
    const marcus = w.characters.find((c) => c.id === "marcus-atilius")!;
    const account = w.material.accounts.find((a) => a.id === marcus.personalAccountId)!;
    const result = createCommitment(
      { characters: w.characters, commitments: [], material: w.material },
      {
        id: "c1", promisorCharacterId: "marcus-atilius", beneficiaryCharacterId: "hanno",
        actionKind: "payment", description: "Pay what I owe.",
        requiredResource: { accountId: account.id, minAmount: 1 },
        visibility: "private", sourceEventId: null, atStep: 1, reviewInSteps: 4,
      },
    );
    expect("commitment" in result).toBe(true);
  });

  it("authority check reports why a promise fails, not just that it fails", () => {
    const w = world();
    const result = checkCommitmentAuthority(w, "marcus-atilius", "unknown-office", null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("office");
  });
});

describe("detectConflictingCommitments", () => {
  it("flags the later commitment when both cannot be covered by the same account", () => {
    const w = world();
    const account = w.material.accounts[0]!;
    const commitments = [
      baseCommitment({ id: "early", createdAtStep: 1, requiredResource: { accountId: account.id, minAmount: account.balance } }),
      baseCommitment({ id: "late", createdAtStep: 2, requiredResource: { accountId: account.id, minAmount: account.balance } }),
    ];
    const conflicts = detectConflictingCommitments({ material: w.material }, commitments);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.losingCommitmentId).toBe("late");
    expect(conflicts[0]!.winningCommitmentId).toBe("early");
  });

  it("reports no conflict when the account can cover both", () => {
    const w = world();
    const account = w.material.accounts[0]!;
    const commitments = [
      baseCommitment({ id: "a", requiredResource: { accountId: account.id, minAmount: 1 } }),
      baseCommitment({ id: "b", requiredResource: { accountId: account.id, minAmount: 1 } }),
    ];
    expect(detectConflictingCommitments({ material: w.material }, commitments)).toHaveLength(0);
  });
});

describe("fulfillCommitment", () => {
  it("actually spends the promised resource, not merely flips a status", () => {
    const w = world();
    const marcus = w.characters.find((c) => c.id === "marcus-atilius")!;
    const hanno = w.characters.find((c) => c.id === "hanno")!;
    const account = w.material.accounts.find((a) => a.id === marcus.personalAccountId)!;
    const commitment = baseCommitment({
      id: "pay1", promisorCharacterId: marcus.id, beneficiaryCharacterId: hanno.id,
      requiredResource: { accountId: account.id, minAmount: 5 },
    });
    const result = fulfillCommitment(
      { characters: w.characters, commitments: [commitment], characterPressures: [], material: w.material },
      "pay1", 3,
    );
    const promisorAccountAfter = result.material.accounts.find((a) => a.id === account.id)!;
    expect(promisorAccountAfter.balance).toBe(account.balance - 5);
    expect(result.commitments[0]!.status).toBe("fulfilled");
  });
});

describe("breakCommitment", () => {
  it("creates a pressure on the promisor and marks the commitment broken", () => {
    const w = world();
    const commitment = baseCommitment();
    const result = breakCommitment(
      { characters: w.characters, commitments: [commitment], characterPressures: [], material: w.material },
      "c1", 3, "The promisor died before keeping their word.",
    );
    expect(result.commitments[0]!.status).toBe("broken");
    expect(result.characterPressures.some((p) => p.characterId === "marcus-atilius" && p.kind === "humiliation")).toBe(true);
  });
});

describe("cancelCommitment", () => {
  it("cancels without any breach pressure", () => {
    const w = world();
    const commitment = baseCommitment();
    const result = cancelCommitment(
      { characters: w.characters, commitments: [commitment], characterPressures: [], material: w.material },
      "c1", 3, "Both parties agreed to release the promise.",
    );
    expect(result.commitments[0]!.status).toBe("cancelled");
    expect(result.characterPressures).toHaveLength(0);
  });
});

describe("dueCommitments", () => {
  it("returns only pending/deferred commitments whose review step has arrived", () => {
    const commitments = [
      baseCommitment({ id: "due", status: "pending", reviewAtStep: 5 }),
      baseCommitment({ id: "not-due", status: "pending", reviewAtStep: 50 }),
      baseCommitment({ id: "resolved", status: "fulfilled", reviewAtStep: 5 }),
    ];
    expect(dueCommitments(commitments, 10).map((c) => c.id)).toEqual(["due"]);
  });
});
