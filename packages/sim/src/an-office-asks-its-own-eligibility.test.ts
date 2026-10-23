import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, type WorldState } from "@chronica/shared";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";

/**
 * The Campanian Legion's assembly, with its leader dead, elected a Roman
 * senator: the seat's own list of requirements was empty, and an empty list
 * was taken as "none" instead of "ask the office".
 */
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const government = { offices: definition.government.offices, successionRules: definition.government.successionRules };

const leaderless = (): WorldState => {
  const world = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
  return {
    ...world,
    characters: world.characters.map((character) => (character.id === "decius-vibellius" ? { ...character, alive: false, diedAtStep: 0 } : character)),
    material: {
      ...world.material,
      officeSeats: world.material.officeSeats.map((seat) => (seat.officeId === "campanian-leader"
        ? { ...seat, holderCharacterId: null, status: "vacant" as const, vacancyCause: "never_filled" as const, termStartedAtStep: null, termExpiresAtStep: null, eligibilityRequirementIds: [] }
        : seat)),
    },
  };
};

describe("an election asks the office who may stand", () => {
  it("never seats a man of another power as leader of the Campanians", () => {
    let world = leaderless();
    for (const day of [1, 10, 30, 60, 120, 240]) {
      world = runDeterministicTick({ world, toDay: day, ids: createIdFactory(`campania-${day}`), warfare: definition.warfare, government, playerCharacterId: "gaius-genucius" }).world;
    }
    const holders = world.material.officeSeats.filter((seat) => seat.officeId === "campanian-leader" && seat.holderCharacterId !== null)
      .map((seat) => world.characters.find((character) => character.id === seat.holderCharacterId)!);
    for (const holder of holders) expect(holder.polityId).toBe("rhegium-campanians");
  });
});
