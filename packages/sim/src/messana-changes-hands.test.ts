import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, atWar, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { renderCharacterPortrait } from "./cognition";
import { engineWork, type NarratorSeed } from "./narrator";
import { createIdFactory } from "./ports";

/**
 * Legio I stormed Messana with Rome and the Mamertines at war on no account.
 * The city passed to Rome and nothing said so -- the battle report said the
 * Mamertines "still held" it -- and their spokesman went on gathering
 * provisions for a city that was no longer his.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const MESSANA = PUNIC_IDS.messana;
const context: ApplyContext = {
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: "gaius-genucius" },
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory("hands"),
  gameId: "game-hands",
};
const before = (): WorldState => {
  const opening = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
  return { ...opening, material: { ...opening.material, forces: opening.material.forces.map((force) => (force.id === "roman-field-army" ? { ...force, locationId: MESSANA } : force)) } };
};

describe("Messana changing hands", () => {
  it("is a war when Rome attacks the Mamertines with neither war nor peace between them", () => {
    const result = applyDeltas(before(), [{ op: "force_engage", forceRef: "roman-field-army", targetForceRef: "mamertine-garrison", posture: "offer_battle", tactic: null, reason: "Storm the city." }], context);
    expect(result.rejected.map((rejection) => rejection.reason)).toEqual([]);
    expect(atWar(result.world.polityAgreements, "rome", "mamertines")).toBe(true);
    expect(result.factProposals.some((fact) => fact.kind === "war_declared" && /beginning it with/.test(fact.summary))).toBe(true);
  });

  it("is said when the city passes, and the province with it", () => {
    const result = applyDeltas(before(), [{ op: "settlement_control_set", settlementId: "settlement-messana", toPolityRef: "rome", sacked: false, reason: "The gates are open." }], context);
    expect(result.rejected.map((rejection) => rejection.reason)).toEqual([]);
    const said = result.factProposals.find((fact) => fact.kind === "city_taken");
    expect(said?.summary).toMatch(/Messana, held by Mamertines of Messana, passed to Roman Republic, and with it/);
  });

  it("tells a power that has lost its ground that it has", () => {
    const world = before();
    const lost: WorldState = { ...world, map: { ...world.map, provinces: world.map.provinces.map((province) => (province.controllerPolityId === "mamertines" ? { ...province, controllerPolityId: "rome", settlements: province.settlements.map((city) => ({ ...city, controllerPolityId: "rome" })) } : province)) } };
    expect(renderCharacterPortrait("mamertine-spokesman", "Statius Mettius", lost, definition.clock)).toContain("Their power holds no ground at all");
  });

  it("closes a road for the season only in winter", () => {
    const seed: NarratorSeed = {
      key: "seed-road", kind: "world_event", archetype: "road_or_pass", severity: "grave", secret: false, oneShot: true,
      target: { provinceId: PUNIC_IDS.capua, provinceName: before().map.provinces.find((province) => province.id === PUNIC_IDS.capua)!.name, polityId: "rome", polityName: "Roman Republic", characterId: null, characterName: null, otherPolityId: null, otherPolityName: null, forceId: null, forceName: null, forceIsNaval: false },
      inPlayerRealm: true, repeated: false, pressureId: null, why: "Weather.", brief: "The road.",
    };
    expect(engineWork(seed, true)!.fact.summary).toMatch(/closed for the season/);
    expect(engineWork(seed, false)!.fact.summary).not.toMatch(/for the season/);
  });
});
