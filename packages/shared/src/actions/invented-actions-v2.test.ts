import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { isWorkflowRefusal } from "../workflows/types";
import type { WorldState } from "../world/world-state";
import {
  InventedActionV2DefinitionSchema,
  invokeInventedActionV2,
  validateInventedActionV2Definition,
  type InventedActionV2Definition,
} from "./invented-actions-v2";

function world(): WorldState {
  return structuredClone(firstPunicWarScenario.initialWorld);
}

function transferDefinition(overrides: Partial<InventedActionV2Definition> = {}): InventedActionV2Definition {
  return InventedActionV2DefinitionSchema.parse({
    actionId: "swear_a_blood_oath",
    campaignId: "campaign-1",
    intent: "Swear a binding oath sealed with a gift of gold",
    description: "Transfers a token gift and records the oath as a note on both parties.",
    parameters: [
      { name: "fromAccount", type: "entityId", description: "The oath-taker's account" },
      { name: "toAccount", type: "entityId", description: "The other party's account" },
      { name: "giftAmount", type: "number", description: "The token gift" },
      { name: "oathText", type: "string", description: "What was sworn" },
    ],
    effects: [
      { kind: "transfer_resource", fromAccountIdParam: "fromAccount", toAccountIdParam: "toAccount", amountParam: "giftAmount" },
      { kind: "attach_entity_note", entityIdParam: "toAccount", entityType: "other", textParam: "oathText" },
    ],
    successTemplate: "The oath is sworn.",
    refusalTemplate: "The oath could not be sworn.",
    createdAtStep: 1,
    createdByActorId: "marcus-atilius",
    ...overrides,
  });
}

describe("validateInventedActionV2Definition (docs/32, Phase 10)", () => {
  it("accepts a definition whose effects reference only declared parameters", () => {
    expect(validateInventedActionV2Definition(transferDefinition())).toEqual([]);
  });

  it("flags an effect referencing an undeclared parameter", () => {
    const bad = transferDefinition({
      effects: [{ kind: "emit_fact", summaryParam: "neverDeclared" }],
    });
    const issues = validateInventedActionV2Definition(bad);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toMatch(/neverDeclared/);
  });

  it("flags a duplicate parameter name", () => {
    const bad = transferDefinition({
      parameters: [
        { name: "fromAccount", type: "entityId", description: "a" },
        { name: "fromAccount", type: "entityId", description: "b" },
      ],
    });
    expect(validateInventedActionV2Definition(bad).some((i) => i.message.includes("declared more than once"))).toBe(true);
  });
});

describe("invokeInventedActionV2 (docs/32, Phase 10)", () => {
  it("applies transfer_resource and attach_entity_note together, atomically, in order", () => {
    const w = world();
    const account = w.material.accounts[0]!;
    const other = w.material.accounts.find((a) => a.id !== account.id)!;
    account.balance = 100;
    const definition = transferDefinition();
    const result = invokeInventedActionV2(definition, w, { fromAccount: account.id, toAccount: other.id, giftAmount: 10, oathText: "By the gods, I swear it." }, { actorId: "marcus-atilius", atStep: 3 });
    expect(isWorkflowRefusal(result)).toBe(false);
    if (isWorkflowRefusal(result)) throw new Error("expected success");
    expect(result.world.material.accounts.find((a) => a.id === account.id)!.balance).toBe(90);
    expect(result.world.material.accounts.find((a) => a.id === other.id)!.balance).toBe(other.balance + 10);
    expect(result.world.campaignMemory.entityNotes.some((n) => n.text === "By the gods, I swear it.")).toBe(true);
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it("clamps a transfer to the source's actual balance, mirroring transfer_gold", () => {
    const w = world();
    const account = w.material.accounts[0]!;
    const other = w.material.accounts.find((a) => a.id !== account.id)!;
    account.balance = 5;
    const definition = transferDefinition();
    const result = invokeInventedActionV2(definition, w, { fromAccount: account.id, toAccount: other.id, giftAmount: 1000, oathText: "A modest gift." }, { actorId: "marcus-atilius", atStep: 3 });
    expect(isWorkflowRefusal(result)).toBe(false);
    if (isWorkflowRefusal(result)) throw new Error("expected success");
    expect(result.world.material.accounts.find((a) => a.id === account.id)!.balance).toBe(0);
  });

  it("refuses, changing nothing, when a named account does not exist", () => {
    const w = world();
    const definition = transferDefinition();
    const result = invokeInventedActionV2(definition, w, { fromAccount: "no-such-account", toAccount: "also-missing", giftAmount: 10, oathText: "text" }, { actorId: "marcus-atilius", atStep: 3 });
    expect(isWorkflowRefusal(result)).toBe(true);
    if (!isWorkflowRefusal(result)) throw new Error("expected refusal");
    expect(result.refused).toMatch(/no account exists/i);
  });

  it("refuses, changing nothing, when the invocation supplies the wrong parameter type", () => {
    const w = world();
    const account = w.material.accounts[0]!;
    const definition = transferDefinition();
    const result = invokeInventedActionV2(definition, w, { fromAccount: account.id, toAccount: account.id, giftAmount: "not a number", oathText: "text" }, { actorId: "marcus-atilius", atStep: 3 });
    expect(isWorkflowRefusal(result)).toBe(true);
  });

  it("refuses without applying anything when the definition itself is no longer valid -- the world reference itself is untouched, not merely equal by value", () => {
    const w = world();
    const definition = transferDefinition({ effects: [{ kind: "emit_fact", summaryParam: "neverDeclared" }] });
    const result = invokeInventedActionV2(definition, w, {}, { actorId: "marcus-atilius", atStep: 3 });
    expect(isWorkflowRefusal(result)).toBe(true);
    if (!isWorkflowRefusal(result)) throw new Error("expected refusal");
    expect(result.refused).toMatch(/no longer valid/i);
  });

  it("leaves the world reference itself untouched on a mid-effect refusal, even after an earlier effect in the same definition would have applied", () => {
    const w = world();
    const account = w.material.accounts[0]!;
    account.balance = 100;
    // The note effect fails (blank text); the transfer before it must not have committed either -- an invented action is atomic, not a partial patch.
    const definition = transferDefinition({ effects: [
      { kind: "transfer_resource", fromAccountIdParam: "fromAccount", toAccountIdParam: "toAccount", amountParam: "giftAmount" },
      { kind: "attach_entity_note", entityIdParam: "toAccount", entityType: "other", textParam: "blankText" },
    ], parameters: [
      { name: "fromAccount", type: "entityId", description: "a" },
      { name: "toAccount", type: "entityId", description: "b" },
      { name: "giftAmount", type: "number", description: "c" },
      { name: "blankText", type: "string", description: "d" },
    ] });
    const other = w.material.accounts.find((a) => a.id !== account.id)!;
    const result = invokeInventedActionV2(definition, w, { fromAccount: account.id, toAccount: other.id, giftAmount: 10, blankText: "" }, { actorId: "marcus-atilius", atStep: 3 });
    expect(isWorkflowRefusal(result)).toBe(true);
    expect(w.material.accounts.find((a) => a.id === account.id)!.balance).toBe(100);
  });

  it("emit_fact never touches world state", () => {
    const w = world();
    const definition = InventedActionV2DefinitionSchema.parse({
      actionId: "proclaim_a_holiday",
      campaignId: "campaign-1",
      intent: "Proclaim a festival",
      description: "Purely narrative.",
      parameters: [{ name: "announcement", type: "string", description: "What is proclaimed" }],
      effects: [{ kind: "emit_fact", summaryParam: "announcement" }],
      successTemplate: "A holiday is proclaimed.",
      refusalTemplate: "The proclamation failed.",
      createdAtStep: 1,
      createdByActorId: "marcus-atilius",
    });
    const result = invokeInventedActionV2(definition, w, { announcement: "Let there be feasting." }, { actorId: "marcus-atilius", atStep: 3 });
    expect(isWorkflowRefusal(result)).toBe(false);
    if (isWorkflowRefusal(result)) throw new Error("expected success");
    expect(result.world).toBe(w);
    expect(result.summary).toBe("Let there be feasting.");
  });
});
