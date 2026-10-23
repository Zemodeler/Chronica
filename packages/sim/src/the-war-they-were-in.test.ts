import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, outlookFor, type WorldState } from "@chronica/shared";
import { routeAmbientActors } from "./attention";
import { renderCharacterPortrait } from "./cognition";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";

/**
 * The Campanians of Rhegium were at war with Rome from the first day, and
 * Decius Vibellius reviewed the walls fifteen times; Carthage's admiral kept
 * watch four months into a war with Rome. Nobody had told either of them.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const clock = definition.clock;
const BRUTTIUM = PUNIC_IDS.rhegium;

function legionAtRhegium(): WorldState {
  const opening = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
  return {
    ...opening,
    material: { ...opening.material, forces: opening.material.forces.map((force) => (force.id === "roman-field-army" ? { ...force, locationId: BRUTTIUM } : force)) },
  };
}

describe("a man at war", () => {
  it("is told his war, and where the enemy stands", () => {
    const text = renderCharacterPortrait("decius-vibellius", "Decius Vibellius", legionAtRhegium(), clock);
    expect(text).toMatch(/Their power is at war with Roman Republic \[rome\], and the allies who follow it/);
    expect(text).toContain("Enemy forces near them:");
    expect(text).toMatch(/\[roman-field-army\].*here, in the same province/);
  });

  it("is told which of his forces the enemy stands near, not only that it is near one of them", () => {
    // The consul's army a march away, his small flotilla at Rhegium: the legion there is near the flotilla, not near him.
    const world = legionAtRhegium();
    const hulls = world.material.forces.find((force) => force.commanderCharacterId === "gaius-genucius" && force.id !== "roman-field-army")!;
    const consul = world.characters.find((character) => character.id === "gaius-genucius")!;
    const away = world.map.provinces.find((province) => province.id !== BRUTTIUM && province.controllerPolityId === "rome")!.id;
    const split: WorldState = {
      ...world,
      characters: world.characters.map((character) => (character.id === consul.id ? { ...character, locationProvinceId: away } : character)),
      material: { ...world.material, forces: world.material.forces.map((force) => (force.id === "roman-field-army" ? { ...force, locationId: away } : force.id === hulls.id ? { ...force, locationId: BRUTTIUM } : force)) },
    };
    const campanians = split.material.forces.find((force) => force.polityId === "rhegium-campanians")!;
    const placed = { ...split, material: { ...split.material, forces: split.material.forces.map((force) => (force.id === campanians.id ? { ...force, locationId: BRUTTIUM } : force)) } };
    const text = renderCharacterPortrait("gaius-genucius", consul.name, placed, clock);
    expect(text).toMatch(new RegExp(`\\[${campanians.id}\\].*here, with ${hulls.name}`));
  });

  it("counts his fleet in ships, not men (consul-run-issues M18)", () => {
    const world = legionAtRhegium();
    const hulls = world.material.forces.find((force) => force.commanderCharacterId === "gaius-genucius" && force.id !== "roman-field-army")!;
    const text = renderCharacterPortrait("gaius-genucius", "Gaius Genucius Clepsina", world, clock);
    expect(text).toMatch(new RegExp(`${hulls.name} \\[${hulls.id}\\] — \\d+ ships at`));
  });

  it("is asked, and pressed, with the enemy in his province", () => {
    const routed = routeAmbientActors({ world: legionAtRhegium(), facts: [], offices: definition.government.offices, excludeCharacterIds: [], max: 40 });
    const decius = routed.find((actor) => actor.characterId === "decius-vibellius");
    expect(decius?.pressing).toBe(true);
    expect(decius?.why).toMatch(/enemy in the same province/);
  });

  it("serves a government whose aims say the war it is in", () => {
    const world = legionAtRhegium();
    const ticked = runDeterministicTick({ world: { ...world, elapsedStep: 1, instant: { ...world.instant, day: 1 } }, toDay: 1, ids: createIdFactory("aims"), warfare: definition.warfare }).world;
    const campanians = outlookFor(ticked.polityOutlooks, "rhegium-campanians")!;
    expect(campanians.intentions[0]).toMatch(/press the war with/);
    expect(campanians.concerns[0]!.label).toMatch(/the war with/);
    // Said once, however many ticks.
    const again = runDeterministicTick({ world: { ...ticked, elapsedStep: 2, instant: { ...ticked.instant, day: 2 } }, toDay: 2, ids: createIdFactory("aims-2"), warfare: definition.warfare }).world;
    expect(outlookFor(again.polityOutlooks, "rhegium-campanians")!.intentions.filter((line) => /press the war with/.test(line))).toHaveLength(1);
  });
});
