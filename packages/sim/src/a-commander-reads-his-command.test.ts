import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { commandReport, forceNameWithoutBirthplace } from "./command-report";
import { createIdFactory } from "./ports";

/**
 * Round 5 H2: the burst output gave a commander his men and their morale and nothing else; who stood in the province, what the
 * army's chest held and how long its bread lasted were in the order prompt and the web page's force card only.
 */
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);

function withEnemyInLatium(): WorldState {
  const opening = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
  const moved: WorldState = {
    ...opening,
    material: { ...opening.material, forces: opening.material.forces.map((force) => (force.id !== "syracusan-army" ? force
      : { ...force, locationId: PUNIC_IDS.rome, personnel: [{ ...force.personnel[0]!, fit: 2_300 }], authorizedStrength: 2_300 })) },
  };
  const war = WorldDeltaSchema.parse({ op: "agreement_open", localId: "war", kind: "war", polityId: "rome", otherPolityId: "syracuse", terms: "War.", forDays: null, sourceMessageRef: null, visibility: "public", reason: "War." });
  const context: ApplyContext = {
    now: moved.instant, actorRef: { kind: "character", id: "gaius-genucius" }, offices: definition.government.offices, warfare: definition.warfare,
    terrains: definition.map.terrains, ids: createIdFactory("report"), gameId: "game-report", orderDeltas: new Set([war]),
  };
  return applyDeltas(moved, [war], context).world;
}

describe("what a commander reads of his command", () => {
  it("names his bread, his army's chest and the enemy in his province", () => {
    const world = withEnemyInLatium();
    const lines = commandReport(world, "gaius-genucius");
    expect(lines.some((line) => /^ {2}bread: .* (has bread until|has no bread left)/.test(line))).toBe(true);
    expect(lines.some((line) => /^ {2}chest: the war chest of .* holds \d+/.test(line))).toBe(true);
    const enemy = lines.find((line) => line.includes("enemy in"));
    expect(enemy).toBeDefined();
    expect(enemy).toMatch(/Syracuse, about 2300 men/);
  });

  it("says nothing of an enemy where none stands in the province", () => {
    const lines = commandReport(ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0), "hieron-ii");
    expect(lines.filter((line) => line.includes("enemy in"))).toEqual([]);
  });

  it("keeps the place a levy was raised at out of its name once it has moved", () => {
    const world = withEnemyInLatium();
    const province = world.map.provinces[0]!;
    expect(forceNameWithoutBirthplace(world, `Levy of Rome at ${province.name}`)).toBe("Levy of Rome");
    expect(forceNameWithoutBirthplace(world, "Levy of Rome at nowhere in particular")).toBe("Levy of Rome at nowhere in particular");
  });
});
