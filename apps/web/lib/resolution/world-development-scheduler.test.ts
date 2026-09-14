import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { ensureProvinceMaterial, type WorldDevelopment, type WorldState } from "@chronica/shared";
import { selectDevelopmentActors } from "./world-development-scheduler";

// `advanceWorldDevelopments`/`candidates` moved to
// `packages/shared/src/matters/advance.ts` (now tested in
// `packages/shared/src/matters/advance.test.ts`, which ports every case
// that used to live here). `selectDevelopmentActors` itself is untouched
// for Phase 1 -- see `world-development-scheduler.ts`'s own comment -- so
// this file now builds its `worldDevelopments` fixture by hand instead of
// through the function that used to populate it.
function fixture(): WorldState {
  const world = ensureProvinceMaterial(structuredClone(firstPunicWarScenario.initialWorld), 0);
  const living = world.characters.filter((c) => c.alive).sort((a, b) => a.id.localeCompare(b.id));
  const developments: WorldDevelopment[] = living.slice(0, 4).map((character, index) => ({
    id: `scarcity:fixture-${index}`,
    kind: "scarcity",
    sourceId: `province-${index}`,
    actorId: character.id,
    provinceId: null,
    summary: `Scheduled world concern ${index} for ${character.name}.`,
    status: "active",
    intensity: 50,
    reviews: 1,
    createdAtStep: 1,
    lastReviewedStep: 1,
    nextReviewStep: 2,
  }));
  return { ...world, worldDevelopments: developments };
}

describe("selectDevelopmentActors", () => {
  it("reserves bounded NPC attention without choosing actions for the player", () => {
    const world = fixture();
    const playerId = world.worldDevelopments![0]!.actorId;
    const selected = selectDevelopmentActors(world, 1, playerId);
    expect(selected.length).toBeLessThanOrEqual(3);
    expect(selected.some((c) => c.characterId === playerId)).toBe(false);
    expect(new Set(selected.map((c) => c.characterId)).size).toBe(selected.length);
  });
});
