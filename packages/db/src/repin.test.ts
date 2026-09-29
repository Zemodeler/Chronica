import { describe, expect, it } from "vitest";
import type { WorldState } from "@chronica/shared";
import { punicWarsScenario } from "./punic-wars-scenario";
import { repinnedWorld } from "./queries/repin";

const opening = (): WorldState => structuredClone(punicWarsScenario.initialWorld);

describe("a campaign moved onto a newer version of its scenario", () => {
  it("gains the seats the newer opening has, and the offices its people hold there, and keeps everything else", () => {
    const newer = opening();
    // The save as an older version opened it: one seat fewer, and the man in
    // it holding nothing.
    const seat = newer.material.officeSeats.find((candidate) => candidate.holderCharacterId !== null)!;
    const holder = newer.characters.find((character) => character.id === seat.holderCharacterId)!;
    const older: WorldState = {
      ...opening(),
      pins: { ...newer.pins, scenarioVersion: newer.pins.scenarioVersion - 1 },
      material: { ...newer.material, officeSeats: newer.material.officeSeats.filter((candidate) => candidate.id !== seat.id) },
      characters: newer.characters.map((character) => (character.id === holder.id ? { ...character, officeId: null } : character)),
      // Something the campaign made for itself, which the repin must not touch.
      elapsedStep: newer.elapsedStep + 40,
      instant: { ...newer.instant, day: newer.instant.day + 40 },
    };

    const carried = repinnedWorld(older, newer, newer.pins.scenarioVersion);
    expect(carried.world.pins.scenarioVersion).toBe(newer.pins.scenarioVersion);
    expect(carried.seatsAdded).toEqual([seat.id]);
    expect(carried.world.material.officeSeats.some((candidate) => candidate.id === seat.id)).toBe(true);
    if (holder.officeId !== null) {
      expect(carried.officesGiven).toContain(holder.id);
      expect(carried.world.characters.find((character) => character.id === holder.id)?.officeId).toBe(holder.officeId);
    }
    expect(carried.world.instant.day).toBe(older.instant.day);
  });

  it("changes nothing but the pin when the save already has everything", () => {
    const world = opening();
    const carried = repinnedWorld(world, opening(), world.pins.scenarioVersion + 1);
    expect(carried.seatsAdded).toEqual([]);
    expect(carried.officesGiven).toEqual([]);
    expect({ ...carried.world, pins: world.pins }).toEqual(world);
  });
});
