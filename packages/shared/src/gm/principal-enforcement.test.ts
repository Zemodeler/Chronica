import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { createGameMasterSession } from "./session";
import type { WorldState } from "../world/world-state";
import { buildAuthorityIndex } from "../authority/authority-grant";
import type { Principal } from "../authority/principal";

// docs/32 corrective pass, requirement 1: an agent's claimed `actorId` is
// only ever a claim; `GameMasterSession` must refuse a mismatch against the
// principal actually supplied to `invoke()`, regardless of what any prompt
// says. These tests exercise the mechanical backstop directly -- no model
// involved -- the same way a malicious or confused model's tool calls would
// be exercised in production.

function world(): WorldState {
  return structuredClone(firstPunicWarScenario.initialWorld);
}

let callCounter = 0;
function call(name: string, args: Record<string, unknown>) {
  callCounter += 1;
  return { id: `call-${callCounter}`, name, arguments: args };
}

const NPC_A: Principal = { kind: "npc", characterId: "hanno" };
const NPC_B: Principal = { kind: "npc", characterId: "hamilcar" };
const PLAYER: Principal = { kind: "player", characterId: "marcus-atilius" };
const CLOSING: Principal = { kind: "closing" };
const INTERPRETER: Principal = { kind: "interpreter" };

describe("GameMasterSession principal enforcement", () => {
  it("refuses an NPC agent calling a workflow action as a different character", () => {
    const session = createGameMasterSession({ world: world(), atStep: 1, actorCharacterId: "marcus-atilius", directiveIds: [] });
    const outcome = session.invoke(call("move_character", { actorId: "hamilcar", characterId: "hamilcar", destinationProvinceId: "x" }), NPC_A);
    expect(outcome.ok).toBe(false);
    expect(outcome.factual).toMatch(/you may only act as "hanno"/i);
  });

  it("refuses an NPC agent calling a world tool as a different character", () => {
    const session = createGameMasterSession({ world: world(), atStep: 1, actorCharacterId: "marcus-atilius", directiveIds: [], enableWorldTools: true });
    const outcome = session.invoke(call("create_entity", { actorId: "hamilcar", kind: "training_program", label: "Test" }), NPC_A);
    expect(outcome.ok).toBe(false);
    expect(outcome.factual).toMatch(/you may only act as "hanno"/i);
  });

  it("refuses an NPC agent recording a response to an order addressed to a different character", () => {
    const w = world();
    const session = createGameMasterSession({ world: w, atStep: 1, actorCharacterId: "marcus-atilius", directiveIds: [], enableWorldTools: true });
    const issued = session.invoke(call("issue_order", {
      actorId: "marcus-atilius", orderId: "order-1", actionId: "action-1",
      issuerRef: { kind: "character", id: "marcus-atilius" }, recipientRef: { kind: "character", id: "hamilcar" },
    }));
    expect(issued.ok).toBe(true);

    // NPC-A (hanno) tries to decide an order addressed to NPC-B (hamilcar).
    // hanno *is* the bound principal here, so this passes the session-level
    // identity check -- it is the world tool's own recipient check that
    // refuses deciding someone else's order.
    const decided = session.invoke(call("record_response", { actorId: "hanno", orderId: "order-1", decision: "accept" }), NPC_A);
    expect(decided.ok).toBe(false);
    expect(decided.factual).toMatch(/only the order's recipient/i);

    // The actual recipient may.
    const decidedByRecipient = session.invoke(call("record_response", { actorId: "hamilcar", orderId: "order-1", decision: "accept" }), NPC_B);
    expect(decidedByRecipient.ok).toBe(true);
  });

  it("refuses a character issuing an order impersonating a different character as issuer", () => {
    const session = createGameMasterSession({ world: world(), atStep: 1, actorCharacterId: "marcus-atilius", directiveIds: [], enableWorldTools: true });
    const outcome = session.invoke(call("issue_order", {
      actorId: "hanno", orderId: "order-1", actionId: "action-1",
      issuerRef: { kind: "character", id: "hamilcar" }, recipientRef: { kind: "character", id: "marcus-atilius" },
    }), NPC_A);
    expect(outcome.ok).toBe(false);
    expect(outcome.factual).toMatch(/cannot issue an order as a different character/i);
  });

  it("refuses the player agent claiming to act as an NPC's identity", () => {
    const session = createGameMasterSession({ world: world(), atStep: 1, actorCharacterId: "marcus-atilius", directiveIds: [] });
    const outcome = session.invoke(call("move_character", { actorId: "hanno", characterId: "hanno", destinationProvinceId: "x" }), PLAYER);
    expect(outcome.ok).toBe(false);
    expect(outcome.factual).toMatch(/you may only act as "marcus-atilius"/i);
  });

  it("refuses the closing pass taking any state-changing action", () => {
    const session = createGameMasterSession({ world: world(), atStep: 1, actorCharacterId: "marcus-atilius", directiveIds: [], enableWorldTools: true });
    const outcome = session.invoke(call("create_entity", { actorId: "marcus-atilius", kind: "training_program", label: "Test" }), CLOSING);
    expect(outcome.ok).toBe(false);
    expect(outcome.factual).toMatch(/may not take state-changing actions/i);
  });

  it("refuses a star-context agent with no living representative from acting at all", () => {
    const session = createGameMasterSession({ world: world(), atStep: 1, actorCharacterId: "marcus-atilius", directiveIds: [], enableWorldTools: true });
    const starContext: Principal = { kind: "star_context", representativeCharacterId: null, scopeRef: { kind: "polity", id: "rome" } };
    const outcome = session.invoke(call("create_entity", { actorId: "marcus-atilius", kind: "training_program", label: "Test" }), starContext);
    expect(outcome.ok).toBe(false);
    expect(outcome.factual).toMatch(/may not take state-changing actions/i);
  });

  it("still allows v1's unbound (system-default) session to act as any living character, unchanged", () => {
    const session = createGameMasterSession({ world: world(), atStep: 1, actorCharacterId: "marcus-atilius", directiveIds: [] });
    const outcome = session.invoke(call("move_character", { actorId: "hanno", characterId: "hanno", destinationProvinceId: "x" }));
    // Refused for an unrelated mechanical reason (bad province id), never a principal refusal.
    expect(outcome.factual).not.toMatch(/you may only act as/i);
  });

  it("a soldier claiming an unrelated king's grant is not authorized merely because the grant exists", () => {
    const w = world();
    const authorityIndex = buildAuthorityIndex({ officeSeats: [], forces: [] }, [
      {
        id: "grant-king", holder: { kind: "character", id: "hamilcar" }, source: "custom", sourceRef: null,
        domain: "military", scope: { kind: "polity", id: "syracuse" }, powers: ["command"], standing: "lawful",
        legitimacyBps: 10_000, visibility: "public", grantedAtStep: 0, expiresAtStep: null, revokedAtStep: null, revocationReason: null, succeedsGrantId: null,
      },
    ], [], 1);
    const session = createGameMasterSession({
      world: w, atStep: 1, actorCharacterId: "hanno", directiveIds: [], enableWorldTools: true, worldToolAuthorityIndex: authorityIndex,
    });
    const outcome = session.invoke(call("issue_order", {
      actorId: "hanno", orderId: "order-1", actionId: "move_force",
      issuerRef: { kind: "character", id: "hanno" }, recipientRef: { kind: "polity", id: "syracuse" },
      claimedAuthorityGrantId: "grant-king",
    }));
    expect(outcome.ok).toBe(true);
    expect(outcome.factual).toMatch(/order-1 issued/i);
    expect(session.stagedWorld.orderAttempts[0]?.authorityCheck.authorized).toBe(false);
    expect(session.stagedWorld.orderAttempts[0]?.authorityCheck.reason).toMatch(/held by character "hamilcar", not character "hanno"/i);
  });
});

// Routing NPCs through declared intent moves the identity question one step:
// the interpreter is not bound to one character, so what stops it acting for
// someone who decided nothing is the session's own record of what was
// actually declared -- never the interpreter's own say-so.
describe("GameMasterSession interpreter principal", () => {
  const declare = (actorId: string, intent: string) =>
    call("declare_intent", { actorId, intent, reason: "It serves my position to do so." });

  it("refuses to act for a character who declared no intent", () => {
    const session = createGameMasterSession({ world: world(), atStep: 1, actorCharacterId: "marcus-atilius", directiveIds: [] });
    const outcome = session.invoke(call("move_character", { actorId: "hanno", characterId: "hanno", destinationProvinceId: "x" }), INTERPRETER);
    expect(outcome.ok).toBe(false);
    expect(outcome.factual).toMatch(/declared no intent this turn/i);
  });

  it("acts for a character who did declare one", () => {
    const session = createGameMasterSession({ world: world(), atStep: 1, actorCharacterId: "marcus-atilius", directiveIds: [] });
    expect(session.invoke(declare("hanno", "Move myself to the strait and see the crossing for myself."), NPC_A).ok).toBe(true);

    // Reaches the workflow rather than the identity gate: refused for a bad
    // province id, which is a fact about the world, not about who is asking.
    const outcome = session.invoke(call("move_character", { actorId: "hanno", characterId: "hanno", destinationProvinceId: "nowhere-at-all" }), INTERPRETER);
    expect(outcome.factual).not.toMatch(/declared no intent/i);
  });

  it("still refuses an NPC agent declaring an intent for someone else", () => {
    const session = createGameMasterSession({ world: world(), atStep: 1, actorCharacterId: "marcus-atilius", directiveIds: [] });
    const outcome = session.invoke(declare("hamilcar", "Sail for Sicily at once with every ship I hold."), NPC_A);
    expect(outcome.ok).toBe(false);
    expect(outcome.factual).toMatch(/you may only act as "hanno"/i);
  });

  it("records an intent without moving the world, and reports it uncarried", () => {
    const session = createGameMasterSession({ world: world(), atStep: 1, actorCharacterId: "marcus-atilius", directiveIds: [] });
    const before = session.stagedWorld;

    const outcome = session.invoke(declare("hanno", "Raise the whole of Carthage against Syracuse this season."), NPC_A);

    expect(outcome.ok).toBe(true);
    expect(session.stagedWorld).toBe(before);
    const [intent] = session.result().declaredIntents;
    expect(intent?.actorId).toBe("hanno");
    expect(intent?.carried).toBe(false);
    // An intention is not an event. Nothing here may reach the Chronicle.
    expect(session.result().events).toEqual([]);
  });
});
