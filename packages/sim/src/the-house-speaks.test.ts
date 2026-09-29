import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, openWar, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { routeAmbientActors } from "./attention";
import { renderCharacterPortrait } from "./cognition";
import { createIdFactory } from "./ports";
import { debatersOf } from "./senate";

/**
 * A Senate with people in it, who say things, and beaten powers that want
 * their ground back.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const MESSANA = PUNIC_IDS.messana;
const nameOf = (id: string): string => punicWarsScenario.initialWorld.map.provinces.find((province) => province.id === id)!.name;
const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Where the beaten garrison has fallen back to: the Mamertines' own ground next to the city, a day or so off. */
const BESIDE_MESSANA = (() => {
  const edge = punicWarsScenario.initialWorld.map.edges.find((candidate) => candidate.crossing === "land" && (candidate.from === MESSANA || candidate.to === MESSANA))!;
  return edge.from === MESSANA ? edge.to : edge.from;
})();
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const context = (actor: string): ApplyContext => ({
  now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: actor }, offices, warfare: definition.warfare,
  terrains: definition.map.terrains, ids: createIdFactory(`house-${actor}`), gameId: "game-house",
});

function taxesBefore(state: WorldState = opening()) {
  const opened = applyDeltas(state, [WorldDeltaSchema.parse({
    op: "political_procedure_open", localId: "taxes", type: "council_deliberation", institutionRef: "roman-senate", sponsorCharacterRef: "gaius-genucius",
    subjectKind: "polity", subjectRef: "rome", label: "Raise war taxes", resolutionMechanism: "vote", deadlineInDays: 10, reason: "The war.",
  })], context("gaius-genucius"));
  return { world: opened.world, id: opened.assignedIds.get("taxes")! };
}

describe("the Senate of 270", () => {
  it("has its consulars in the house, to be asked before a vote", () => {
    const { world, id } = taxesBefore();
    const asked = debatersOf({ ...world, instant: { ...world.instant, day: 7 } }, offices, 7, ["gaius-genucius"]);
    expect([...asked.keys()].some((characterId) => ["gaius-fabricius", "lucius-papirius", "quintus-fabius", "lucius-postumius"].includes(characterId))).toBe(true);
    expect([...asked.values()][0]).toContain(id);
  });

  it("records what a senator says in the house, tied to the question", () => {
    const { world, id } = taxesBefore();
    const spoken = applyDeltas(world, [WorldDeltaSchema.parse({
      op: "political_support_set", procedureRef: id, supporterKind: "character", supporterRef: "gaius-fabricius", position: "oppose",
      influenceWeight: 60, reasonKind: "material_interest", reasonLabel: "Dear grain.", words: "A war tax in a year of dear grain will lose us the plebs.", reason: "He speaks.",
    })], context("gaius-fabricius"));
    expect(spoken.rejected).toEqual([]);
    const speech = spoken.factProposals.find((fact) => fact.kind === "senate_speech")!;
    expect(speech.summary).toMatch(/Gaius Fabricius Luscinus spoke against "Raise war taxes".*"A war tax in a year of dear grain will lose us the plebs\."/);
    expect(speech.affectedRefs?.[0]).toEqual({ kind: "procedure", id });
  });
});

describe("a beaten power", () => {
  function messanaTaken(): WorldState {
    const world = opening();
    return {
      ...world,
      polityAgreements: openWar(world.polityAgreements, { id: "war-mamertines", polityId: "rome", otherPolityId: "mamertines", terms: "Messana.", atStep: 0, sourceMessageId: null, reason: "Stormed." }),
      map: { ...world.map, provinces: world.map.provinces.map((province) => (province.id === MESSANA
        ? { ...province, controllerPolityId: "rome", settlements: province.settlements.map((city) => ({ ...city, controllerPolityId: "rome" })), lostBy: { polityId: "mamertines", atStep: 0 } }
        : province)) },
      material: { ...world.material, forces: world.material.forces.map((force) => (force.id === "mamertine-garrison" ? { ...force, locationId: BESIDE_MESSANA } : force)) },
    };
  }

  it("is told the ground it lost and how far its army is from it", () => {
    const text = renderCharacterPortrait("mamertine-spokesman", "Statius Mettius", messanaTaken(), definition.clock);
    expect(text).toMatch(new RegExp(`Their power lost ${escaped(nameOf(MESSANA))} .* to Roman Republic 0 days ago; Mamertine garrison is about \\d+ km from it`));
  });

  it("has its general pressed to take it back", () => {
    const routed = routeAmbientActors({ world: messanaTaken(), facts: [], offices, excludeCharacterIds: [], max: 1_000 });
    const general = routed.find((actor) => actor.characterId === "mamertine-spokesman")!;
    expect(general.pressing).toBe(true);
    expect(general.why).toMatch(new RegExp(`lost ${escaped(nameOf(MESSANA))} .* can reach it`));
  });
});
