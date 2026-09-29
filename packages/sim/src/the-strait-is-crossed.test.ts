import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { livePressures } from "./narrator";

/**
 * Legio I landed at Messana, and the pressure "whoever crosses to Messana has
 * crossed the strait" fired with a brief that asked the model to decide which
 * great power had crossed. It chose Carthage, whose fleet was at Panormus,
 * and opened a war with Carthage over a crossing Carthage never made.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const MESSANA = PUNIC_IDS.messana;
const strait = definition.historicalPressures.find((pressure) => pressure.id === "the-strait-is-crossed")!;
const asked = (): WorldState => {
  const world = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
  return { ...world, narrator: { ...world.narrator, spentPressureIds: [...world.narrator.spentPressureIds, "messana-invites-a-protector"] } };
};
const landed = (world: WorldState, polityId: string): WorldState => {
  const force = world.material.forces.find((candidate) => candidate.polityId === polityId && candidate.personnel.some((category) => category.fit > 0))!;
  return { ...world, material: { ...world.material, forces: world.material.forces.map((candidate) => (candidate.id === force.id ? { ...candidate, locationId: MESSANA } : candidate)) } };
};

describe("the strait is crossed", () => {
  it("waits for somebody to have crossed", () => {
    const world = asked();
    const clear: WorldState = { ...world, material: { ...world.material, forces: world.material.forces.filter((force) => force.locationId !== MESSANA || !["rome", "carthage"].includes(force.polityId)) } };
    expect(livePressures(clear, [strait])).toEqual([]);
  });

  it("is reachable once a Roman army stands at Messana", () => {
    expect(livePressures(landed(asked(), "rome"), [strait]).map((pressure) => pressure.id)).toEqual(["the-strait-is-crossed"]);
  });

  it("no longer asks the model which power crossed", () => {
    expect(strait.brief).not.toMatch(/Decide which of them crossed/);
  });
});
