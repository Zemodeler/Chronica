import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { createIdFactory } from "./ports";

/**
 * Hand run as Hannibal Gisco (docs/reports/hand-run-reports.md, H1): "land eight hundred marines at
 * Messana" drew from a fleet that held 110 warships and no marines. The engine took every hull, called them a garrison and
 * said "the fleet is no more". Men are drawn only of the kind asked for; a fleet that has none refuses.
 */
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);

describe("men drawn from a fleet", () => {
  it("refuses to take its ships for infantry, and leaves the fleet whole", () => {
    const world = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
    const fleet = world.material.forces.find((force) => force.id === "carthaginian-fleet")!;
    expect(fleet.personnel.every((group) => group.categoryId === "warship")).toBe(true);
    const deltas = [WorldDeltaSchema.parse({ op: "force_create", localId: "marines", name: "Carthaginian marines of Messana", polityId: "carthage", commanderCharacterRef: "hannibal-gisco", controllerCharacterRef: "hannibal-gisco",
      locationId: fleet.locationId, authorizedStrength: 800, payObligationRef: null, fromForceRef: "carthaginian-fleet", categoryId: "infantry", reason: "Eight hundred marines are landed." })];
    const result = applyDeltas(world, deltas, { now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: "hannibal-gisco" }, offices: definition.government.offices, warfare: definition.warfare,
      terrains: definition.map.terrains, ids: createIdFactory("marines"), gameId: "game-marines", orderDeltas: new Set(deltas) });
    expect(result.rejected.length).toBe(1);
    expect(result.rejected[0]!.reason).toMatch(/holds no infantry/i);
    const after = result.world.material.forces.find((force) => force.id === "carthaginian-fleet")!;
    expect(after.personnel.reduce((sum, group) => sum + group.fit, 0)).toBe(fleet.personnel.reduce((sum, group) => sum + group.fit, 0));
    expect(result.world.material.forces.some((force) => force.name === "Carthaginian marines of Messana")).toBe(false);
  });
});
