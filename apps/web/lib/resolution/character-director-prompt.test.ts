import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { CharacterGoal } from "@chronica/shared";
import { buildCharacterDirectorSystemPrompt } from "./character-director-prompt";

const world = () => structuredClone(firstPunicWarScenario.initialWorld);

function privateGoal(characterId: string): CharacterGoal {
  return {
    id: `goal-${characterId}`,
    characterId,
    objective: "Secretly undermine a rival's standing with the Senate.",
    category: "discredit_rival",
    targetEntityIds: [],
    priority: 3,
    status: "active",
    visibility: "private",
    causalFactIds: [],
    createdAtStep: 0,
    updatedAtStep: 0,
    history: [],
  };
}

describe("buildCharacterDirectorSystemPrompt — own private state visibility", () => {
  it("shows a character their own private goal", () => {
    const w = { ...world(), characterGoals: [privateGoal("marcus-atilius")] };
    const prompt = buildCharacterDirectorSystemPrompt(
      w,
      [{ characterId: "marcus-atilius", tier: "important", reasons: [] }],
      "marcus-atilius",
    );
    expect(prompt).toContain("Secretly undermine a rival's standing with the Senate.");
  });

  it("never shows one character another character's private goal", () => {
    const w = { ...world(), characterGoals: [privateGoal("marcus-atilius")] };
    const prompt = buildCharacterDirectorSystemPrompt(
      w,
      [{ characterId: "hanno", tier: "important", reasons: [] }],
      "marcus-atilius",
    );
    expect(prompt).not.toContain("Secretly undermine a rival's standing with the Senate.");
  });

  it("includes the selected character's own mind, traits, and active pressures", () => {
    const w = {
      ...world(),
      characters: world().characters.map((c) =>
        c.id === "marcus-atilius" ? { ...c, traits: ["bold"] } : c,
      ),
      characterPressures: [{
        id: "pressure-1", characterId: "marcus-atilius", kind: "debt" as const, intensity: 60,
        label: "Owes a Sicilian grain merchant.", sourceEventId: null, createdAtStep: 0, reviewAtStep: 10,
        expiresAtStep: null, visibility: "private" as const, status: "active" as const,
      }],
    };
    const prompt = buildCharacterDirectorSystemPrompt(
      w,
      [{ characterId: "marcus-atilius", tier: "important", reasons: [] }],
      "marcus-atilius",
    );
    expect(prompt).toContain("Drives:");
    expect(prompt).toContain("Bold");
    expect(prompt).toContain("Owes a Sicilian grain merchant.");
  });
});
