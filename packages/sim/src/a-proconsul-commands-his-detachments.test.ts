import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { createIdFactory } from "./ports";

/**
 * A man commands the detachments of his army that answer to him (docs/reports/consul-run-issues.md, M9). The proconsul's
 * legion split off under his brother as legate, and its cohorts under a tribune, each controlled by him: every order he gave
 * them was "beyond his authority", and splitting them was "raising men without leave".
 */
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);

function detachedUnderALegate(): WorldState {
  const world = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
  const army = world.material.forces.find((force) => force.id === "roman-field-army")!;
  return { ...world, material: { ...world.material, forces: [...world.material.forces, { ...structuredClone(army), id: "legio-i-detached", name: "Legio I detached", commanderCharacterId: "gnaeus-cornelius", controllerCharacterId: "manius-curius" }] } };
}

const asHim = (world: WorldState, raw: readonly unknown[]) => {
  const deltas = raw.map((delta) => WorldDeltaSchema.parse(delta));
  return applyDeltas(world, deltas, { now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: "manius-curius" }, offices: definition.government.offices, warfare: definition.warfare,
    terrains: definition.map.terrains, ids: createIdFactory("detached"), gameId: "game-detached", orderDeltas: new Set(deltas) });
};

describe("the detachment of a man's army, under his legate", () => {
  it("takes his orders within his authority, as does a part split from it in turn", () => {
    const world = detachedUnderALegate();
    const moved = asHim(world, [{ op: "force_modify", forceRef: "legio-i-detached", hold: true, reason: "Hold where it stands." }]);
    expect(moved.rejected).toEqual([]);
    expect(moved.breaches).toEqual([]);
    const split = asHim(world, [{ op: "force_create", localId: "cohorts", name: "Cohorts of Legio I", polityId: "rome", commanderCharacterRef: "gnaeus-cornelius", controllerCharacterRef: "manius-curius",
      locationId: world.material.forces.find((force) => force.id === "legio-i-detached")!.locationId, authorizedStrength: 2000, payObligationRef: null, fromForceRef: "legio-i-detached", categoryId: "infantry", reason: "Two thousand men sent on." }]);
    expect(split.rejected).toEqual([]);
    expect(split.breaches).toEqual([]);
  });
});
