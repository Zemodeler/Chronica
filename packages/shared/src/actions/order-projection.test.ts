import { describe, expect, it } from "vitest";
import type { WorkflowAuditEntry } from "../workflows/manager-types";
import { projectOrdersAndOperations, applyCancellationDirectives, applyRevisionDirectives, MAX_TERMINAL_ACTION_HISTORY } from "./order-projection";

const isLongRunningAction = (actionId: string) => actionId === "move_force" || actionId === "start_siege";

function auditEntry(overrides: Partial<WorkflowAuditEntry> & Pick<WorkflowAuditEntry, "correlationId" | "source" | "sourceRef" | "requestedActionId" | "requestedInvocation">): WorkflowAuditEntry {
  return { ...overrides };
}

describe("projectOrdersAndOperations", () => {
  it("gives a simple, quickly-executed order sensible inferred defaults", () => {
    const result = projectOrdersAndOperations({
      previousActions: [],
      previousOperations: [],
      turnIndex: 1,
      atStep: 1,
      isLongRunningAction,
      candidates: [auditEntry({
        correlationId: "11111111-1111-1111-1111-111111111111",
        source: "player_directive",
        sourceRef: "directive-1",
        requestedActionId: "add_gold",
        requestedInvocation: { actionId: "add_gold", actorId: "marcus-atilius", parameters: { accountId: "marcus-purse", amount: 50 } },
        finalInvocation: { actionId: "add_gold", actorId: "marcus-atilius", parameters: { accountId: "marcus-purse", amount: 50 } },
        managerDecision: "approve",
        executionOk: true,
      })],
    });

    expect(result.actions).toHaveLength(1);
    const action = result.actions[0]!;
    expect(action.status).toBe("completed");
    expect(action.desiredOutcome).toBe("add gold");
    expect(action.issuerRef).toEqual({ kind: "character", id: "marcus-atilius" });
    expect(action.targetRefs).toEqual([{ kind: "account", id: "marcus-purse" }]);
    expect(action.operationId).toBeUndefined();
    expect(result.refusals).toEqual([]);
  });

  it("turns an authority-rejected order into a grounded refusal, not a silent drop", () => {
    const result = projectOrdersAndOperations({
      previousActions: [],
      previousOperations: [],
      turnIndex: 1,
      atStep: 1,
      isLongRunningAction,
      candidates: [auditEntry({
        correlationId: "22222222-2222-2222-2222-222222222222",
        source: "player_directive",
        sourceRef: "directive-2",
        requestedActionId: "move_force",
        requestedInvocation: { actionId: "move_force", actorId: "player-character", parameters: { forceId: "legio-x", destinationProvinceId: "capua" } },
        policyViolation: { kind: "authority_mismatch", message: "Skill \"move_force\" may only be invoked by [character_director]; source \"player_directive\" maps to \"player\"." },
      })],
    });

    expect(result.actions).toHaveLength(1);
    const action = result.actions[0]!;
    expect(action.status).toBe("impossible");
    expect(action.authorityBasis?.validated).toBe(false);
    expect(action.authorityBasis?.claimedType).toBe("command_or_office");
    expect(action.terminalReason).toContain("may only be invoked by");
    // No operation is opened for an order that never executed.
    expect(action.operationId).toBeUndefined();
    expect(result.operations).toEqual([]);

    expect(result.refusals).toHaveLength(1);
    expect(result.refusals[0]).toMatchObject({ actorId: "player-character", actionId: "move_force", kind: "authority" });
  });

  it("emits one refusal when the same failed invocation is retried in a turn", () => {
    const refusedVote = {
      source: "game_master" as const,
      sourceRef: "game_master",
      requestedActionId: "call_vote",
      requestedInvocation: { actionId: "call_vote", actorId: "gaius-genucius", parameters: { procedureId: "senate-motion", callerCharacterId: "gaius-genucius" } },
      finalInvocation: { actionId: "call_vote", actorId: "gaius-genucius", parameters: { procedureId: "senate-motion", callerCharacterId: "gaius-genucius" } },
      dryRunOk: false,
      executionOk: false,
      executionReason: "The Senate cannot hear this vote.",
    };
    const result = projectOrdersAndOperations({
      previousActions: [], previousOperations: [], turnIndex: 1, atStep: 1, isLongRunningAction,
      candidates: [
        auditEntry({ correlationId: "22222222-2222-2222-2222-222222222224", ...refusedVote }),
        auditEntry({ correlationId: "22222222-2222-2222-2222-222222222225", ...refusedVote }),
      ],
    });

    expect(result.refusals).toEqual([expect.objectContaining({ actionId: "call_vote", actorId: "gaius-genucius", reason: "The Senate cannot hear this vote." })]);
  });

  it("keeps a guessed force id in the audit only, never turning it into a false world refusal", () => {
    const result = projectOrdersAndOperations({
      previousActions: [],
      previousOperations: [],
      turnIndex: 1,
      atStep: 1,
      isLongRunningAction,
      candidates: [auditEntry({
        correlationId: "22222222-2222-2222-2222-222222222223",
        source: "game_master",
        sourceRef: "game_master",
        requestedActionId: "move_force",
        requestedInvocation: {
          actionId: "move_force",
          actorId: "gaius-genucius",
          parameters: { forceId: "force-?", destinationProvinceId: "sicily" },
        },
        finalInvocation: {
          actionId: "move_force",
          actorId: "gaius-genucius",
          parameters: { forceId: "force-?", destinationProvinceId: "sicily" },
        },
        executionOk: false,
        executionReason: 'Nothing in the world answers to forceId "force-?". Inspect the entity to get its real id, then call move_force again.',
      })],
    });

    expect(result.actions).toEqual([]);
    expect(result.operations).toEqual([]);
    expect(result.refusals).toEqual([]);
  });

  it("projects an NPC-originated candidate through the same schema and path as a player order", () => {
    const result = projectOrdersAndOperations({
      previousActions: [],
      previousOperations: [],
      turnIndex: 1,
      atStep: 1,
      isLongRunningAction,
      candidates: [auditEntry({
        correlationId: "33333333-3333-3333-3333-333333333333",
        source: "character_director",
        sourceRef: "hanno",
        requestedActionId: "raise_morale",
        requestedInvocation: { actionId: "raise_morale", actorId: "hanno", parameters: { forceId: "carthaginian-field-army" } },
        finalInvocation: { actionId: "raise_morale", actorId: "hanno", parameters: { forceId: "carthaginian-field-army" } },
        managerDecision: "approve",
        executionOk: true,
      })],
    });

    const action = result.actions[0]!;
    // Same OngoingAction shape as a player order, only the origin differs.
    expect(action.issuerRef).toEqual({ kind: "character", id: "hanno" });
    expect(action.invocation.source).toBe("npc");
    expect(action.status).toBe("completed");
  });

  it("carries a persistent operation forward, untouched, into the next turn", () => {
    const turn1 = projectOrdersAndOperations({
      previousActions: [],
      previousOperations: [],
      turnIndex: 1,
      atStep: 1,
      isLongRunningAction,
      candidates: [auditEntry({
        correlationId: "44444444-4444-4444-4444-444444444444",
        source: "player_directive",
        sourceRef: "directive-3",
        requestedActionId: "move_force",
        requestedInvocation: { actionId: "move_force", actorId: "marcus-atilius", parameters: { forceId: "legio-i", destinationProvinceId: "capua" } },
        finalInvocation: { actionId: "move_force", actorId: "marcus-atilius", parameters: { forceId: "legio-i", destinationProvinceId: "capua" } },
        managerDecision: "approve",
        executionOk: true,
      })],
    });

    expect(turn1.operations).toHaveLength(1);
    const opened = turn1.operations[0]!;
    expect(opened.status).toBe("active");

    const turn2 = projectOrdersAndOperations({
      previousActions: turn1.actions,
      previousOperations: turn1.operations,
      turnIndex: 2,
      atStep: 2,
      isLongRunningAction,
      candidates: [],
    });

    expect(turn2.operations).toEqual([opened]);
    expect(turn2.actions).toEqual(turn1.actions);
  });

  it("resolves two same-turn candidates deterministically into two distinct actions", () => {
    const result = projectOrdersAndOperations({
      previousActions: [],
      previousOperations: [],
      turnIndex: 1,
      atStep: 1,
      isLongRunningAction,
      candidates: [
        auditEntry({
          correlationId: "55555555-5555-5555-5555-555555555555",
          source: "player_directive",
          sourceRef: "directive-4",
          requestedActionId: "move_force",
          requestedInvocation: { actionId: "move_force", actorId: "marcus-atilius", parameters: { forceId: "legio-i", destinationProvinceId: "capua" } },
          finalInvocation: { actionId: "move_force", actorId: "marcus-atilius", parameters: { forceId: "legio-i", destinationProvinceId: "capua" } },
          managerDecision: "approve",
          executionOk: true,
        }),
        auditEntry({
          correlationId: "66666666-6666-6666-6666-666666666666",
          source: "character_director",
          sourceRef: "hanno",
          requestedActionId: "move_force",
          requestedInvocation: { actionId: "move_force", actorId: "hanno", parameters: { forceId: "carthaginian-field-army", destinationProvinceId: "capua" } },
          policyViolation: { kind: "duplicate", message: "Duplicate: \"move_force\" by actor \"hanno\" already proposed." },
        }),
      ],
    });

    expect(result.actions).toHaveLength(2);
    expect(new Set(result.actions.map((action) => action.id)).size).toBe(2);
    expect(result.actions[0]!.status).toBe("active");
    expect(result.actions[1]!.status).toBe("impossible");
  });

  it("bounds terminal action history while never dropping an active one (long-running simulation stays bounded)", () => {
    let actions: ReturnType<typeof projectOrdersAndOperations>["actions"] = [];
    for (let turn = 0; turn < MAX_TERMINAL_ACTION_HISTORY + 50; turn++) {
      const result = projectOrdersAndOperations({
        previousActions: actions,
        previousOperations: [],
        turnIndex: turn,
        atStep: turn,
        isLongRunningAction: () => false,
        candidates: [auditEntry({
          correlationId: `${turn}0000000-0000-0000-0000-000000000000`,
          source: "player_directive",
          sourceRef: `directive-${turn}`,
          requestedActionId: "add_gold",
          requestedInvocation: { actionId: "add_gold", actorId: "marcus-atilius", parameters: {} },
          finalInvocation: { actionId: "add_gold", actorId: "marcus-atilius", parameters: {} },
          managerDecision: "approve",
          executionOk: true,
        })],
      });
      actions = result.actions;
    }
    expect(actions.length).toBe(MAX_TERMINAL_ACTION_HISTORY);
    expect(actions.every((action) => action.status === "completed")).toBe(true);
  });

  it("never drops a still-active action to enforce the terminal-history bound", () => {
    const stillActive = { ...projectOrdersAndOperations({
      previousActions: [], previousOperations: [], turnIndex: 0, atStep: 0, isLongRunningAction: () => true,
      candidates: [auditEntry({
        correlationId: "aaaaaaaa-0000-0000-0000-000000000000", source: "player_directive", sourceRef: "d",
        requestedActionId: "move_force", requestedInvocation: { actionId: "move_force", actorId: "marcus-atilius", parameters: {} },
        finalInvocation: { actionId: "move_force", actorId: "marcus-atilius", parameters: {} }, managerDecision: "approve", executionOk: true,
      })],
    }).actions[0]! };
    expect(stillActive.status).toBe("active");

    let actions = [stillActive];
    for (let turn = 1; turn < MAX_TERMINAL_ACTION_HISTORY + 50; turn++) {
      const result = projectOrdersAndOperations({
        previousActions: actions, previousOperations: [], turnIndex: turn, atStep: turn, isLongRunningAction: () => false,
        candidates: [auditEntry({
          correlationId: `${turn}0000000-0000-0000-0000-000000000000`, source: "player_directive", sourceRef: `d${turn}`,
          requestedActionId: "add_gold", requestedInvocation: { actionId: "add_gold", actorId: "marcus-atilius", parameters: {} },
          finalInvocation: { actionId: "add_gold", actorId: "marcus-atilius", parameters: {} }, managerDecision: "approve", executionOk: true,
        })],
      });
      actions = result.actions;
    }
    expect(actions.some((action) => action.id === stillActive.id)).toBe(true);
    expect(actions.length).toBe(MAX_TERMINAL_ACTION_HISTORY + 1);
  });
});

describe("applyCancellationDirectives", () => {
  function openLongRunningAction() {
    return projectOrdersAndOperations({
      previousActions: [], previousOperations: [], turnIndex: 1, atStep: 1, isLongRunningAction: () => true,
      candidates: [auditEntry({
        correlationId: "cccccccc-0000-0000-0000-000000000000", source: "player_directive", sourceRef: "d",
        requestedActionId: "move_force", requestedInvocation: { actionId: "move_force", actorId: "marcus-atilius", parameters: {} },
        finalInvocation: { actionId: "move_force", actorId: "marcus-atilius", parameters: {} }, managerDecision: "approve", executionOk: true,
      })],
    });
  }

  it("cancels an active order and cascades the cancellation to its linked operation", () => {
    const opened = openLongRunningAction();
    const action = opened.actions[0]!;
    const operation = opened.operations[0]!;
    expect(action.operationId).toBe(operation.id);

    const result = applyCancellationDirectives(opened.actions, opened.operations, [action.id], 5);

    const cancelledAction = result.actions.find((a) => a.id === action.id)!;
    expect(cancelledAction.status).toBe("cancelled");
    expect(cancelledAction.terminalReason).toContain("Cancelled");
    const cancelledOperation = result.operations.find((o) => o.id === operation.id)!;
    expect(cancelledOperation.status).toBe("cancelled");
    expect(cancelledOperation.statusReason).toBeTruthy();
    expect(result.cancelled).toEqual([{ actionId: action.id, actorId: "marcus-atilius", operationId: operation.id, chronicleChainId: `chain:${operation.id}` }]);
  });

  it("is a no-op for an unknown action id", () => {
    const opened = openLongRunningAction();
    const result = applyCancellationDirectives(opened.actions, opened.operations, ["no-such-action"], 5);
    expect(result.actions).toEqual(opened.actions);
    expect(result.operations).toEqual(opened.operations);
    expect(result.cancelled).toEqual([]);
  });

  it("is a no-op for an action that already reached a terminal status", () => {
    const opened = openLongRunningAction();
    const alreadyDone = opened.actions.map((a) => ({ ...a, status: "completed" as const, terminalReason: "Executed successfully." }));
    const result = applyCancellationDirectives(alreadyDone, opened.operations, [alreadyDone[0]!.id], 5);
    expect(result.actions).toEqual(alreadyDone);
    expect(result.cancelled).toEqual([]);
  });
});

describe("applyRevisionDirectives", () => {
  function openLongRunningAction() {
    return projectOrdersAndOperations({
      previousActions: [], previousOperations: [], turnIndex: 1, atStep: 1, isLongRunningAction: () => true,
      candidates: [auditEntry({
        correlationId: "dddddddd-0000-0000-0000-000000000000", source: "player_directive", sourceRef: "d",
        requestedActionId: "move_force", requestedInvocation: { actionId: "move_force", actorId: "marcus-atilius", parameters: {} },
        finalInvocation: { actionId: "move_force", actorId: "marcus-atilius", parameters: {} }, managerDecision: "approve", executionOk: true,
      })],
    });
  }

  it("revises an active order in place and cascades the new text to its linked operation", () => {
    const opened = openLongRunningAction();
    const action = opened.actions[0]!;
    const operation = opened.operations[0]!;
    expect(action.operationId).toBe(operation.id);

    const result = applyRevisionDirectives(opened.actions, opened.operations, [{ actionId: action.id, text: "March instead toward Messana." }], 2, 5);

    const revisedAction = result.actions.find((a) => a.id === action.id)!;
    expect(revisedAction.status).toBe("active"); // still the same action, continuing -- not replaced or reset.
    expect(revisedAction.revision).toBe(action.revision + 1);
    expect(revisedAction.revisions.length).toBe(action.revisions.length + 1);
    expect(revisedAction.revisions.at(-1)).toMatchObject({ directiveKind: "revise", rawText: "March instead toward Messana." });
    expect(revisedAction.desiredOutcome).toBe("March instead toward Messana.");
    expect(revisedAction.invocation).toEqual(action.invocation); // the underlying invocation/progress is untouched.
    expect(revisedAction.progress).toEqual(action.progress);

    const revisedOperation = result.operations.find((o) => o.id === operation.id)!;
    expect(revisedOperation.objective).toBe("March instead toward Messana.");
    expect(revisedOperation.standingInstructions).toBe("March instead toward Messana.");
    expect(revisedOperation.status).toBe("active");

    expect(result.revised).toEqual([{ actionId: action.id, actorId: "marcus-atilius", text: "March instead toward Messana.", operationId: operation.id, chronicleChainId: `chain:${operation.id}` }]);
  });

  it("is a no-op for an unknown action id", () => {
    const opened = openLongRunningAction();
    const result = applyRevisionDirectives(opened.actions, opened.operations, [{ actionId: "no-such-action", text: "Anything." }], 2, 5);
    expect(result.actions).toEqual(opened.actions);
    expect(result.operations).toEqual(opened.operations);
    expect(result.revised).toEqual([]);
  });

  it("is a no-op for an action that already reached a terminal status", () => {
    const opened = openLongRunningAction();
    const alreadyDone = opened.actions.map((a) => ({ ...a, status: "completed" as const, terminalReason: "Executed successfully." }));
    const result = applyRevisionDirectives(alreadyDone, opened.operations, [{ actionId: alreadyDone[0]!.id, text: "Too late." }], 2, 5);
    expect(result.actions).toEqual(alreadyDone);
    expect(result.revised).toEqual([]);
  });
});

describe("chronicleChainId continuity across turns", () => {
  it("stamps an operation-linked action's chain id once, carries it unchanged into the next turn, and threads it into that turn's own Chronicle-facing fact", () => {
    // Turn 1: open a long-running action and revise it the same turn.
    const turn1 = projectOrdersAndOperations({
      previousActions: [], previousOperations: [], turnIndex: 1, atStep: 1, isLongRunningAction,
      candidates: [auditEntry({
        correlationId: "eeeeeeee-0000-0000-0000-000000000000", source: "player_directive", sourceRef: "d",
        requestedActionId: "move_force", requestedInvocation: { actionId: "move_force", actorId: "marcus-atilius", parameters: {} },
        finalInvocation: { actionId: "move_force", actorId: "marcus-atilius", parameters: {} }, managerDecision: "approve", executionOk: true,
      })],
    });
    const openedAction = turn1.actions[0]!;
    expect(openedAction.chronicleChainId).toBeTruthy();

    const revision = applyRevisionDirectives(turn1.actions, turn1.operations, [{ actionId: openedAction.id, text: "March toward Messana instead." }], 1, 1);
    const turn1Fact = revision.revised[0]!;
    expect(turn1Fact.chronicleChainId).toBe(openedAction.chronicleChainId);

    // Turn 2: the action carries forward untouched (no new candidates), still
    // carrying the same chain id, and this turn's own fact (a cancellation)
    // carries that same id too -- proving the chain actually links a fact
    // from turn 1 to a fact from turn 2, not just existing on the action.
    const turn2 = projectOrdersAndOperations({
      previousActions: revision.actions, previousOperations: revision.operations, turnIndex: 2, atStep: 2, isLongRunningAction, candidates: [],
    });
    const carriedAction = turn2.actions.find((a) => a.id === openedAction.id)!;
    expect(carriedAction.chronicleChainId).toBe(openedAction.chronicleChainId);

    const cancellation = applyCancellationDirectives(turn2.actions, turn2.operations, [openedAction.id], 2);
    const turn2Fact = cancellation.cancelled[0]!;
    expect(turn2Fact.chronicleChainId).toBe(turn1Fact.chronicleChainId);
  });
});
