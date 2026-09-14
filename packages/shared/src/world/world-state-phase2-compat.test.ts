import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { WorldStateSchema } from "./world-state";
import { NEUTRAL_MIND } from "../characters/mind";

// Simulates an archived snapshot persisted before character-sim phase 2:
// no `mind` on any character, and no `characterPressures`/`characterBeliefs`/
// `socialLinks` arrays on the world at all.
function stripPhase2Fields(world: unknown): unknown {
  const w = JSON.parse(JSON.stringify(world)) as Record<string, unknown>;
  delete w.characterPressures;
  delete w.characterBeliefs;
  delete w.socialLinks;
  w.characters = (w.characters as Record<string, unknown>[]).map((character) => {
    const { mind: _mind, ...rest } = character;
    return rest;
  });
  return w;
}

describe("WorldStateSchema — phase 2 backward compatibility", () => {
  it("parses a legacy snapshot missing mind/characterPressures/characterBeliefs/socialLinks, filling in valid defaults", () => {
    const legacy = stripPhase2Fields(firstPunicWarScenario.initialWorld);
    const result = WorldStateSchema.safeParse(legacy);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.characterPressures).toEqual([]);
    expect(result.data.characterBeliefs).toEqual([]);
    expect(result.data.socialLinks).toEqual([]);
    for (const character of result.data.characters) {
      expect(character.mind).toEqual(NEUTRAL_MIND);
    }
  });

  it("parses a snapshot with neither worldDevelopments nor worldMatters, leaving worldMatters undefined", () => {
    const legacy = stripPhase2Fields(firstPunicWarScenario.initialWorld) as Record<string, unknown>;
    delete legacy.worldDevelopments;
    delete legacy.worldMatters;
    const result = WorldStateSchema.safeParse(legacy);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.worldDevelopments).toBeUndefined();
    expect(result.data.worldMatters).toBeUndefined();
  });

  it("parses a legacy relation cause with no `dimensions` map", () => {
    const legacy = stripPhase2Fields(firstPunicWarScenario.initialWorld) as { characters: Record<string, unknown>[] };
    legacy.characters[0]!.relations = [{
      subjectCharacterId: "someone",
      causes: [{ id: "c1", label: "An old cause.", score: 10, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null }],
    }];
    const result = WorldStateSchema.safeParse(legacy);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.characters[0]!.relations[0]!.causes[0]!.dimensions).toBeUndefined();
  });
});
