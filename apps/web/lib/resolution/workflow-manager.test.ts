import { describe, expect, it } from "vitest";
import type { AiAdapter } from "@chronica/ai";
import { applyTemporaryWorkflowPatch, executeWorkflows, type WorkflowCandidate, type WorldState } from "@chronica/shared";
import { firstPunicWarScenario } from "@chronica/db";
import { runWorkflowManager, WorkflowManagerOutputError } from "./workflow-manager";

const ACTOR_ID = "marcus-atilius";
const ACCOUNT_ID = "marcus-purse";
const LEGION_ID = "legio-i";
const DESTINATION_ID = "ita-72843720b81376294924159-sicily-central";

function world(): WorldState {
  return structuredClone(firstPunicWarScenario.initialWorld);
}

function candidate(correlationId: string, actionId: string, parameters: Record<string, unknown>): WorkflowCandidate {
  return {
    correlationId,
    source: "player_directive",
    sourceRef: "directive-test",
    sourceRationale: "A bounded, AI-adjudicated workflow request.",
    requestedInvocation: { actionId, actorId: ACTOR_ID, parameters },
  };
}

function adapterWith(content: unknown): AiAdapter {
  return {
    async call() {
      return { content: JSON.stringify(content), inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, model: "fixture" };
    },
  };
}

function adapterWithSequence(...contents: unknown[]): AiAdapter {
  let callIndex = 0;
  return {
    async call() {
      const content = contents[Math.min(callIndex++, contents.length - 1)];
      return { content: JSON.stringify(content), inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, model: "fixture" };
    },
  };
}

describe("AI Workflow Manager", () => {
  it("approves army spawning, army movement, and gold addition through the final review", async () => {
    const candidates = [
      candidate("00000000-0000-4000-8000-000000000201", "create_force", {
        polityId: "rome", locationProvinceId: DESTINATION_ID, name: "Sicilian Reserves", size: 500, kind: "infantry", payerAccountId: ACCOUNT_ID,
      }),
      candidate("00000000-0000-4000-8000-000000000202", "move_force", {
        forceId: LEGION_ID, destinationProvinceId: DESTINATION_ID,
      }),
      candidate("00000000-0000-4000-8000-000000000203", "add_gold", {
        accountId: ACCOUNT_ID, amount: 75, reason: "Sale of supplies",
      }),
    ];
    const reviewed = await runWorkflowManager(adapterWith({
      decisions: candidates.map((item) => ({ correlationId: item.correlationId, decision: "approve", reason: "Valid registered workflow.", replacementInvocation: null })),
      novelActionProposals: [],
    }), world(), candidates, 1);
    const result = executeWorkflows(reviewed.acceptedInvocations, world(), 1);

    expect(reviewed.acceptedInvocations).toHaveLength(3);
    expect(result.log.every((entry) => entry.outcome.ok)).toBe(true);
    expect(result.world.material.forces).toHaveLength(world().material.forces.length + 1);
    expect(result.world.material.forces.find((force) => force.id === LEGION_ID)?.locationId).toBe(DESTINATION_ID);
    expect(result.world.material.accounts.find((account) => account.id === ACCOUNT_ID)?.balance).toBe(1_275);
  });

  it("repairs an unknown requested action with a valid registered workflow", async () => {
    const input = candidate("00000000-0000-4000-8000-000000000204", "grant_war_chest", { accountId: ACCOUNT_ID, amount: 40 });
    const reviewed = await runWorkflowManager(adapterWith({
      decisions: [{
        correlationId: input.correlationId,
        decision: "replace",
        reason: "add_gold is the registered income workflow.",
        replacementInvocation: { actionId: "add_gold", actorId: ACTOR_ID, parameters: { accountId: ACCOUNT_ID, amount: 40, reason: "War chest contribution" } },
      }],
      novelActionProposals: [],
    }), world(), [input], 1);

    expect(reviewed.acceptedInvocations[0]?.actionId).toBe("add_gold");
    expect(reviewed.auditBlob.candidates[0]?.replacementInvocation?.actionId).toBe("add_gold");
  });

  it("rejects a workflow without sending any mutation to execution", async () => {
    const input = candidate("00000000-0000-4000-8000-000000000206", "add_gold", { accountId: ACCOUNT_ID, amount: 1, reason: "Unfounded grant" });
    const reviewed = await runWorkflowManager(adapterWith({
      decisions: [{ correlationId: input.correlationId, decision: "reject", reason: "No grounded source for this income.", replacementInvocation: null }],
      novelActionProposals: [],
    }), world(), [input], 1);
    const result = executeWorkflows(reviewed.acceptedInvocations, world(), 1);

    expect(reviewed.acceptedInvocations).toEqual([]);
    expect(result.world.material.accounts.find((account) => account.id === ACCOUNT_ID)?.balance).toBe(1_200);
    expect(reviewed.auditBlob.candidates[0]?.executionOk).toBeUndefined();
  });

  it("applies a bounded temporary patch when no registered workflow fits", async () => {
    const input = candidate("00000000-0000-4000-8000-000000000207", "reward_logistics_network", { accountId: ACCOUNT_ID });
    const reviewed = await runWorkflowManager(adapterWith({
      decisions: [{ correlationId: input.correlationId, decision: "reject", reason: "No registered logistics-network workflow exists.", replacementInvocation: null }],
      novelActionProposals: [{
        intent: "Reward the established logistics network",
        targetEntityIds: [ACCOUNT_ID],
        estimatedMutationDescription: "Credit a verified logistics reward to the actor's account.",
        source: "player_directive",
        sourceRef: "directive-test",
        temporaryPatch: {
          id: "00000000-0000-4000-8000-000000000307",
          title: "Logistics reward",
          rationale: "The established supply network delivered its contracted stores.",
          actorId: ACTOR_ID,
          operations: [{ kind: "account_delta", accountId: ACCOUNT_ID, amount: 30, reason: "Logistics reward" }],
        },
        implementationReport: "A logistics-reward workflow was needed. This turn applied a bounded account credit; a permanent workflow should verify delivery conditions and calculate payment.",
      }],
    }), world(), [input], 1);
    const patched = applyTemporaryWorkflowPatch(world(), reviewed.temporaryPatches[0]!.temporaryPatch, 1);

    expect(reviewed.acceptedInvocations).toEqual([]);
    expect(patched?.world.material.accounts.find((account) => account.id === ACCOUNT_ID)?.balance).toBe(1_230);
    expect(reviewed.auditBlob.novelActionProposals).toHaveLength(1);
  });

  it("retries once when the model invents a correlation ID", async () => {
    const input = candidate("00000000-0000-4000-8000-000000000208", "add_gold", { accountId: ACCOUNT_ID, amount: 1, reason: "Test" });
    const reviewed = await runWorkflowManager(adapterWithSequence(
      { decisions: [{ correlationId: "00000000-0000-4000-8000-000000000999", decision: "approve", reason: "Wrong id.", replacementInvocation: null }], novelActionProposals: [] },
      { decisions: [{ correlationId: input.correlationId, decision: "approve", reason: "Correct id.", replacementInvocation: null }], novelActionProposals: [] },
    ), world(), [input], 1);

    expect(reviewed.acceptedInvocations).toHaveLength(1);
  });

  it("fails safely when the Manager does not decide every candidate", async () => {
    const input = candidate("00000000-0000-4000-8000-000000000205", "add_gold", { accountId: ACCOUNT_ID, amount: 1, reason: "Test" });
    await expect(runWorkflowManager(adapterWith({ decisions: [], novelActionProposals: [] }), world(), [input], 1))
      .rejects.toBeInstanceOf(WorkflowManagerOutputError);
  });
});
