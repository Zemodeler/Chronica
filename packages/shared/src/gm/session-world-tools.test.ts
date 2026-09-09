import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { createGameMasterSession } from "./session";
import type { WorldState } from "../world/world-state";
import { buildAuthorityIndex } from "../authority/authority-grant";

function world(): WorldState {
  return structuredClone(firstPunicWarScenario.initialWorld);
}

let callCounter = 0;
function call(name: string, args: Record<string, unknown>) {
  callCounter += 1;
  return { id: `call-${callCounter}`, name, arguments: args };
}

describe("GameMasterSession world tools (docs/32, Part C.6 step 9)", () => {
  it("refuses a world-tool name when enableWorldTools is not set -- the default path is unaffected", () => {
    const session = createGameMasterSession({ world: world(), atStep: 1, actorCharacterId: "marcus-atilius", directiveIds: [] });
    const outcome = session.invoke(call("create_entity", { actorId: "marcus-atilius", kind: "training_program", label: "Test" }));
    expect(outcome.ok).toBe(false);
    expect(outcome.factual).toMatch(/no tool named/i);
  });

  it("does not list world tools when enableWorldTools is not set", () => {
    const session = createGameMasterSession({ world: world(), atStep: 1, actorCharacterId: "marcus-atilius", directiveIds: [] });
    expect(session.listTools().some((t) => t.name === "create_entity")).toBe(false);
  });

  it("lists world tools and accepts a world-tool call once enableWorldTools is set", () => {
    const session = createGameMasterSession({ world: world(), atStep: 1, actorCharacterId: "marcus-atilius", directiveIds: [], enableWorldTools: true });
    expect(session.listTools().some((t) => t.name === "create_entity")).toBe(true);
    const outcome = session.invoke(call("create_entity", { actorId: "marcus-atilius", kind: "training_program", label: "Siege Engineering" }));
    expect(outcome.ok).toBe(true);
    expect(session.stagedWorld.genericEntities).toHaveLength(1);
    expect(session.result().worldToolInvocations).toHaveLength(1);
  });

  it("dispatches a world tool through the real underlying workflow, staging the same effect act() would", () => {
    const w = world();
    const provinceId = w.map.provinces[0]!.id;
    const polityId = w.map.polities[0]!.id;
    const session = createGameMasterSession({ world: w, atStep: 1, actorCharacterId: "marcus-atilius", directiveIds: [], enableWorldTools: true });
    const outcome = session.invoke(call("create_force", { actorId: "marcus-atilius", polityId, locationProvinceId: provinceId, name: "Legio Nova", size: 1000, kind: "infantry" }));
    expect(outcome.ok).toBe(true);
    expect(session.stagedWorld.material.forces.some((f) => f.name === "Legio Nova")).toBe(true);
  });

  it("routes a read tool through with no actor requirement", () => {
    const session = createGameMasterSession({ world: world(), atStep: 1, actorCharacterId: "marcus-atilius", directiveIds: [], enableWorldTools: true });
    const outcome = session.invoke(call("inspect_entity", { entityId: "marcus-atilius" }));
    expect(outcome.ok).toBe(true);
  });

  it("refuses an authority-sensitive world tool when worldToolAuthorityIndex says the actor lacks standing", () => {
    const w = world();
    const authorityIndex = buildAuthorityIndex({ officeSeats: [], forces: [] }, [], [], 1);
    const [account] = w.material.accounts;
    const other = w.material.accounts.find((a) => a.id !== account?.id);
    const session = createGameMasterSession({
      world: w, atStep: 1, actorCharacterId: "marcus-atilius", directiveIds: [],
      enableWorldTools: true, worldToolAuthorityIndex: authorityIndex,
    });
    const outcome = session.invoke(call("transfer_resource", { actorId: "marcus-atilius", sourceAccountId: account!.id, destinationAccountId: other!.id, amount: 10, reason: "test" }));
    expect(outcome.ok).toBe(false);
  });

  it("collects a fact from record_fact without folding it into the staged world", () => {
    const session = createGameMasterSession({ world: world(), atStep: 1, actorCharacterId: "marcus-atilius", directiveIds: [], enableWorldTools: true });
    const before = session.stagedWorld;
    const outcome = session.invoke(call("record_fact", { actorId: "marcus-atilius", kind: "test_event", summary: "Something happened worth recording." }));
    expect(outcome.ok).toBe(true);
    expect(session.stagedWorld).toBe(before);
    expect(session.result().worldToolFacts).toHaveLength(1);
  });

  it("stamps record_fact with the session's real current instant, never a hardcoded day zero (docs/32 corrective pass, requirement 4)", () => {
    const w = world();
    const withInstant = { ...w, elapsedStep: 5, instant: { day: 12, minute: 480 } };
    const session = createGameMasterSession({ world: withInstant, atStep: 5, actorCharacterId: "marcus-atilius", directiveIds: [], enableWorldTools: true });
    session.invoke(call("record_fact", { actorId: "marcus-atilius", kind: "test_event", summary: "Something happened at a real moment." }));
    const [fact] = session.result().worldToolFacts;
    expect(fact?.time).toEqual({ day: 12, minute: 480 });
  });

  it("with deferMutations, validates a workflow action but rolls it back and records it as scheduled instead of applying it (docs/32 corrective pass, requirement 3)", () => {
    const w = world();
    const hanno = w.characters.find((c) => c.id === "hanno")!;
    const session = createGameMasterSession({ world: w, atStep: 1, actorCharacterId: "marcus-atilius", directiveIds: [], deferMutations: true });
    const outcome = session.invoke(
      call("move_character", { actorId: "hanno", characterId: "hanno", destinationProvinceId: "ita-72843720b81376294924159-sicily-northeast" }),
      { kind: "npc", characterId: "hanno" },
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.factual).toMatch(/scheduled/i);
    // The world is untouched -- hanno has not actually moved.
    expect(session.stagedWorld.characters.find((c) => c.id === "hanno")?.locationProvinceId).toBe(hanno.locationProvinceId);
    expect(session.result().executedInvocations).toHaveLength(0);
    expect(session.result().scheduledActions).toEqual([
      { actionId: "move_character", actorId: "hanno", parameters: { characterId: "hanno", destinationProvinceId: "ita-72843720b81376294924159-sicily-northeast" } },
    ]);
  });

  it("with deferMutations, still refuses (and does not schedule) an invalid action", () => {
    const session = createGameMasterSession({ world: world(), atStep: 1, actorCharacterId: "marcus-atilius", directiveIds: [], deferMutations: true });
    const outcome = session.invoke(
      call("move_character", { actorId: "hanno", characterId: "hanno", destinationProvinceId: "no-such-province" }),
      { kind: "npc", characterId: "hanno" },
    );
    expect(outcome.ok).toBe(false);
    expect(session.result().scheduledActions).toEqual([]);
  });

  it("gives record_fact a deterministic id across repeated calls with the same kind (docs/32 corrective pass, requirement 4)", () => {
    const session = createGameMasterSession({ world: world(), atStep: 1, actorCharacterId: "marcus-atilius", directiveIds: [], enableWorldTools: true });
    session.invoke(call("record_fact", { actorId: "marcus-atilius", kind: "test_event", summary: "First." }));
    session.invoke(call("record_fact", { actorId: "marcus-atilius", kind: "test_event", summary: "Second." }));
    const [first, second] = session.result().worldToolFacts;
    expect(first?.id).not.toBe(second?.id);
    expect(first?.id).not.toMatch(/0\.\d+|[a-z0-9]{6,}$/); // not a Math.random() suffix
  });

  it("refuses a world-tool action call from a dead or unknown actor", () => {
    const session = createGameMasterSession({ world: world(), atStep: 1, actorCharacterId: "marcus-atilius", directiveIds: [], enableWorldTools: true });
    const outcome = session.invoke(call("create_entity", { actorId: "no-such-character", kind: "training_program", label: "Test" }));
    expect(outcome.ok).toBe(false);
  });
});
