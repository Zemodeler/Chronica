import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { createGameMasterSession } from "./session";
import type { WorldState } from "../world/world-state";

// docs/30: `actionAllowance` used to be computed and threaded through but
// never enforced as a count -- only membership in the turn's cast was
// checked. This is the real constraint that makes "AI choice constrained by
// their state" bounded rather than unlimited.

const PLAYER = "marcus-atilius";
const NPC = "hanno";

function world(): WorldState {
  return structuredClone(firstPunicWarScenario.initialWorld);
}

function call(name: string, args: Record<string, unknown>) {
  return { id: `call-${name}`, name, arguments: args };
}

describe("actionAllowance enforcement", () => {
  it("refuses an NPC's action once its allowance is exhausted", () => {
    const gm = createGameMasterSession({
      world: world(),
      atStep: 1,
      actorCharacterId: PLAYER,
      directiveIds: [],
      actionAllowances: [{ characterId: NPC, allowance: 1 }],
    });
    const first = gm.invoke(call("rename_polity", { actorId: NPC, polityId: "carthage", newName: "Carthaginian Republic" }));
    expect(first.ok).toBe(true);
    const second = gm.invoke(call("rename_polity", { actorId: NPC, polityId: "carthage", newName: "Carthaginian Dominion" }));
    expect(second.ok).toBe(false);
    expect(second.factual).toContain("allowance of 1 action");
    expect(gm.stagedWorld.map.polities.find((p) => p.id === "carthage")?.name).toBe("Carthaginian Republic");
  });

  it("allows exactly as many actions as the allowance names", () => {
    const gm = createGameMasterSession({
      world: world(),
      atStep: 1,
      actorCharacterId: PLAYER,
      directiveIds: [],
      actionAllowances: [{ characterId: NPC, allowance: 2 }],
    });
    expect(gm.invoke(call("rename_polity", { actorId: NPC, polityId: "carthage", newName: "First" })).ok).toBe(true);
    expect(gm.invoke(call("rename_polity", { actorId: NPC, polityId: "carthage", newName: "Second" })).ok).toBe(true);
    expect(gm.invoke(call("rename_polity", { actorId: NPC, polityId: "carthage", newName: "Third" })).ok).toBe(false);
  });

  it("never limits the player's own character", () => {
    const gm = createGameMasterSession({
      world: world(),
      atStep: 1,
      actorCharacterId: PLAYER,
      directiveIds: [],
      actionAllowances: [{ characterId: NPC, allowance: 1 }],
    });
    for (const name of ["First", "Second", "Third"]) {
      expect(gm.invoke(call("rename_polity", { actorId: PLAYER, polityId: "rome", newName: name })).ok).toBe(true);
    }
  });
});
