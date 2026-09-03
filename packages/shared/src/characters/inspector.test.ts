import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { WorldState } from "../world/world-state";
import { buildCharacterInspectorView } from "./inspector";

const world = () => structuredClone(firstPunicWarScenario.initialWorld);

describe("buildCharacterInspectorView", () => {
  it("returns undefined for an unknown character", () => {
    expect(buildCharacterInspectorView(world(), "nobody")).toBeUndefined();
  });

  it("assembles identity, mind, traits, pressures, relationships, beliefs, commitments, and continuity tier", () => {
    const w: WorldState = {
      ...world(),
      characters: world().characters.map((c) => (c.id === "marcus-atilius" ? { ...c, traits: ["bold"] } : c)),
      characterPressures: [{
        id: "p1", characterId: "marcus-atilius", kind: "debt", intensity: 40, label: "Owes money.",
        sourceEventId: null, createdAtStep: 0, reviewAtStep: 10, expiresAtStep: null, visibility: "private", status: "active",
      }],
      characterBeliefs: [{
        id: "b1", holderCharacterId: "marcus-atilius", subjectEntityId: null, claim: "The grain fleet is late.",
        kind: "fact", sourceCharacterId: null, sourceEventId: null, confidence: 90, visibility: "private",
        learnedAtStep: 0, expiresAtStep: null, supersedesBeliefIds: [], status: "active",
      }],
    };
    const view = buildCharacterInspectorView(w, "marcus-atilius", [
      { id: "c1", npcCharacterId: "marcus-atilius", promiseType: "money", promisedResult: "Repay the loan.", status: "pending" },
    ]);
    expect(view?.name).toBe("Marcus Atilius");
    expect(view?.traits.map((t) => t.id)).toEqual(["bold"]);
    expect(view?.activePressures.map((p) => p.id)).toEqual(["p1"]);
    expect(view?.beliefs.map((b) => b.id)).toEqual(["b1"]);
    expect(view?.commitments).toEqual([{ id: "c1", promiseType: "money", promisedResult: "Repay the loan.", status: "pending" }]);
    expect(view?.continuityTier).toBeDefined();
  });
});
