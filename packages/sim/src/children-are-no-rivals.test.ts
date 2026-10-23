import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { decideVillainy } from "./villainy";

/** An infant is nobody's rival: only a grown, living man moves against the player. */

const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);

describe("children", () => {
  it("never plot against the player, however much they are made to hate him", () => {
    const base = { ...opening(), difficulty: "hard" as const };
    const player = base.characters.find((character) => character.id === "gaius-genucius")!;
    const donor = base.characters.find((character) => character.polityId === player.polityId && character.id !== player.id && character.alive)!;
    const child = {
      ...donor, id: "child:rome-kin-3ualq2:21", name: "Sempronia Minor", ageYearsAtStart: 0, birthStep: 0, traits: ["ambitious", "cruel"],
      mind: { ...donor.mind, drives: { ...donor.mind.drives, revenge: 95, status: 95 }, temperament: { ...donor.mind.temperament, cruelty: 90, boldness: 90 } },
      relations: [{ subjectCharacterId: player.id, causes: [{ id: "hate", label: "A slight.", score: -90, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null, dimensions: { trust: -90 } }] }],
      locationProvinceId: player.locationProvinceId,
    };
    // Everyone else of his polity is made to love him, so that the child is the only candidate there is.
    const world = { ...base, characters: [...base.characters.filter((character) => character.polityId !== player.polityId || character.id === player.id || !character.alive), child] };
    for (let month = 0; month < 60; month += 1) {
      const decisions = decideVillainy({ world: { ...world, instant: { ...world.instant, day: month * 30 }, elapsedStep: month * 30 }, gameId: "no-rivals", playerCharacterId: player.id, playedByModel: new Set() });
      expect(decisions.filter((decision) => decision.actorCharacterId === child.id)).toEqual([]);
    }
  });
});
