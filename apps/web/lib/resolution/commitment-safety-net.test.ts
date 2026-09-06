import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { WorldState } from "@chronica/shared";
import { applyCommitmentSafetyNet } from "./commitment-safety-net";

// docs/30: resolving a due commitment is now the Game Master's own choice.
// This backstop must never auto-fulfill or auto-break -- only auto-defer,
// and only once a commitment has sat unaddressed past a grace window.

const COMMITMENT_BASE = {
  id: "marcus-pays-hanno",
  promisorCharacterId: "marcus-atilius",
  beneficiaryCharacterId: "hanno",
  actionKind: "payment" as const,
  description: "Pay Hanno a ransom for the returned prisoners.",
  conditions: "",
  requiredOfficeId: null,
  requiredResource: { accountId: "marcus-purse", minAmount: 200 },
  visibility: "polity" as const,
  sourceEventId: null,
  breachPressureKind: "humiliation" as const,
  resolvedAtStep: null,
  resolutionReason: null,
};

function world(overrides: Partial<typeof COMMITMENT_BASE & { status: "pending" | "deferred" | "fulfilled" | "broken"; reviewAtStep: number }>): WorldState {
  const w = structuredClone(firstPunicWarScenario.initialWorld);
  return {
    ...w,
    commitments: [{
      ...COMMITMENT_BASE,
      status: "pending",
      createdAtStep: 0,
      reviewAtStep: 1,
      ...overrides,
    }],
  };
}

describe("applyCommitmentSafetyNet", () => {
  it("leaves a commitment untouched within its grace window", () => {
    const result = applyCommitmentSafetyNet(world({ reviewAtStep: 5 }), 6);
    expect(result.world.commitments[0]?.status).toBe("pending");
    expect(result.events).toHaveLength(0);
  });

  it("auto-defers a commitment left unaddressed past the grace window", () => {
    const result = applyCommitmentSafetyNet(world({ reviewAtStep: 1 }), 4);
    const commitment = result.world.commitments[0]!;
    expect(commitment.status).toBe("deferred");
    expect(commitment.reviewAtStep).toBeGreaterThan(4);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.actionId).toBe("defer_commitment");
  });

  it("never auto-fulfills or auto-breaks", () => {
    const fulfilled = applyCommitmentSafetyNet(world({ status: "fulfilled", reviewAtStep: 1 }), 10);
    expect(fulfilled.world.commitments[0]?.status).toBe("fulfilled");
    expect(fulfilled.events).toHaveLength(0);

    const broken = applyCommitmentSafetyNet(world({ status: "broken", reviewAtStep: 1 }), 10);
    expect(broken.world.commitments[0]?.status).toBe("broken");
    expect(broken.events).toHaveLength(0);
  });

  it("re-defers an already-deferred commitment once its own review step also lapses", () => {
    const result = applyCommitmentSafetyNet(world({ status: "deferred", reviewAtStep: 1 }), 5);
    expect(result.world.commitments[0]?.status).toBe("deferred");
    expect(result.events).toHaveLength(1);
  });
});
