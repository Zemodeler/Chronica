import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { createGameMasterSession } from "../gm/session";
import type { WorldState } from "../world/world-state";
import { buildAuthorityIndex, buildWorkflowAuthorityGate } from "./authority-grant";

function world(): WorldState {
  return structuredClone(firstPunicWarScenario.initialWorld);
}

let callCounter = 0;
function call(name: string, args: Record<string, unknown>) {
  callCounter += 1;
  return { id: `call-${callCounter}`, name, arguments: args };
}

describe("GameMasterSession.authorityGate (docs/32, Phase 7)", () => {
  it("is a no-op when not supplied -- today's single-GM path is unaffected", () => {
    const session = createGameMasterSession({ world: world(), atStep: 1, actorCharacterId: "marcus-atilius", directiveIds: [] });
    const outcome = session.invoke(call("assign_command", { actorId: "marcus-atilius", forceId: "carthaginian-army", commanderCharacterId: "marcus-atilius" }));
    expect(outcome.ok).toBe(true); // no gate wired in -> unchanged behavior, the workflow itself has no such restriction
  });

  it("refuses an actor with no command grant over the target force", () => {
    const w = world();
    const authorityIndex = buildAuthorityIndex({ officeSeats: [], forces: w.material.forces }, [], [], 1);
    const session = createGameMasterSession({
      world: w,
      atStep: 1,
      actorCharacterId: "marcus-atilius",
      directiveIds: [],
      authorityGate: buildWorkflowAuthorityGate(authorityIndex),
    });
    // marcus-atilius commands legio-i, not carthaginian-army -- ordering the latter's commander changed is unauthorized.
    const outcome = session.invoke(call("assign_command", { actorId: "marcus-atilius", forceId: "carthaginian-army", commanderCharacterId: "marcus-atilius" }));
    expect(outcome.ok).toBe(false);
    expect(outcome.factual).toMatch(/refused/i);
  });

  it("authorizes the force's own commander to reassign it", () => {
    const w = world();
    const authorityIndex = buildAuthorityIndex({ officeSeats: [], forces: w.material.forces }, [], [], 1);
    const session = createGameMasterSession({
      world: w,
      atStep: 1,
      actorCharacterId: "hanno",
      directiveIds: [],
      authorityGate: buildWorkflowAuthorityGate(authorityIndex),
    });
    const outcome = session.invoke(call("assign_command", { actorId: "hanno", forceId: "carthaginian-army", commanderCharacterId: "hanno" }));
    expect(outcome.ok).toBe(true);
  });

  it("leaves an untagged workflow completely ungated", () => {
    const w = world();
    const authorityIndex = buildAuthorityIndex({ officeSeats: [], forces: w.material.forces }, [], [], 1);
    const session = createGameMasterSession({
      world: w,
      atStep: 1,
      actorCharacterId: "marcus-atilius",
      directiveIds: [],
      authorityGate: buildWorkflowAuthorityGate(authorityIndex),
    });
    // move_force is not in DEFAULT_AUTHORITY_REQUIREMENTS -- unaffected by the gate regardless of standing.
    const outcome = session.invoke(call("move_force", { actorId: "marcus-atilius", forceId: "legio-i", destinationProvinceId: "ita-local-23120603B86473916475875" }));
    expect(outcome.ok).toBe(true);
  });
});
