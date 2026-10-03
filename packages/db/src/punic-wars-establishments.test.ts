import { describe, expect, it } from "vitest";
import { DoctrineSchema, EstablishmentSchema, WorldStateSchema, doctrineNetGain } from "@chronica/shared";
import { PUNIC_DOCTRINES, PUNIC_ESTABLISHMENTS, SEASONED_ARMIES } from "./punic-wars-establishments";
import { punicWarsScenario } from "./punic-wars-scenario";

const SIX = ["rome", "carthage", "syracuse", "macedon", "seleucid-empire", "ptolemaic-egypt"] as const;
const world = punicWarsScenario.initialWorld;

describe("the great powers' establishments (v42)", () => {
  it("keeps one for each of the six great powers, and for no one else", () => {
    expect(PUNIC_ESTABLISHMENTS.map((establishment) => establishment.polityId).sort()).toEqual([...SIX].sort());
    for (const polityId of SIX) expect(world.map.polities.some((polity) => polity.id === polityId), polityId).toBe(true);
    expect(world.establishments.map((establishment) => establishment.polityId).sort()).toEqual([...SIX].sort());
  });

  it("parses every establishment and doctrine as the engine reads them", () => {
    for (const establishment of PUNIC_ESTABLISHMENTS) expect(() => EstablishmentSchema.parse(establishment), establishment.polityId).not.toThrow();
    for (const doctrine of PUNIC_DOCTRINES) expect(() => DoctrineSchema.parse(doctrine), doctrine.id).not.toThrow();
    expect(() => WorldStateSchema.parse(structuredClone(world))).not.toThrow();
  });

  it("draws every formation from a kind of troops the scenario has, and every body from formations it keeps", () => {
    const categories = new Set(punicWarsScenario.definition.warfare.troopCategories.map((category) => category.id));
    for (const establishment of PUNIC_ESTABLISHMENTS) {
      const templates = new Set(establishment.formations.map((template) => template.id));
      expect(templates.size, `${establishment.polityId} has a template id twice`).toBe(establishment.formations.length);
      for (const template of establishment.formations) expect(categories.has(template.categoryId), `${establishment.polityId}:${template.id} is ${template.categoryId}`).toBe(true);
      for (const body of establishment.bodies) for (const id of body.formationIds) expect(templates.has(id), `${establishment.polityId}:${body.id} draws up ${id}`).toBe(true);
      for (const rank of establishment.ranks) for (const id of rank.formationIds ?? []) expect(templates.has(id), `${establishment.polityId}:${rank.id} is found in ${id}`).toBe(true);
    }
    // No troop category is worth more a head than the baseline.
    for (const category of punicWarsScenario.definition.warfare.troopCategories) expect(category.combatWeightBps).toBeLessThanOrEqual(10_000);
  });

  it("gives every power the doctrines it opens with, each with its price", () => {
    const ids = new Set(PUNIC_DOCTRINES.map((doctrine) => doctrine.id));
    expect(ids.size).toBe(PUNIC_DOCTRINES.length);
    for (const establishment of PUNIC_ESTABLISHMENTS) {
      expect(establishment.doctrineIds.length, establishment.polityId).toBeGreaterThan(0);
      for (const id of establishment.doctrineIds) {
        expect(ids.has(id), id).toBe(true);
        expect(PUNIC_DOCTRINES.find((doctrine) => doctrine.id === id)!.polityId).toBe(establishment.polityId);
      }
    }
    for (const doctrine of PUNIC_DOCTRINES) {
      expect(doctrine.origin).toBe("scenario");
      // Something lowered, or a price raised: no doctrine is all gain.
      expect(doctrine.effects.some((effect) => effect.direction === "lower" || ["levy_cost", "veteran_claim", "service_length", "loyalty_to_general"].includes(effect.lever)), doctrine.id).toBe(true);
      expect(doctrineNetGain(doctrine.effects), doctrine.id).toBeLessThanOrEqual(2);
    }
    expect(world.doctrines.map((doctrine) => doctrine.id).sort()).toEqual([...ids].sort());
  });
});

describe("the opening armies, drawn up", () => {
  it("forms every man of the six powers' armies, and leaves everyone else's flat", () => {
    for (const force of world.material.forces) {
      if (!(SIX as readonly string[]).includes(force.polityId)) {
        expect(force.formations ?? [], force.id).toEqual([]);
        continue;
      }
      const formations = new Set((force.formations ?? []).map((formation) => formation.id));
      for (const row of force.personnel) {
        expect(row.formationId, `${force.id}: ${row.label}`).toBeDefined();
        expect(formations.has(row.formationId!), `${force.id}: ${row.label}`).toBe(true);
      }
    }
  });

  it("gives the consul a legion with its three lines, its velites and its horse, beside an ala of the allies", () => {
    const army = world.material.forces.find((force) => force.id === "roman-field-army")!;
    const legion = (army.formations ?? []).filter((formation) => formation.bodyLabel === "Legio I");
    expect(legion.map((formation) => formation.templateId).sort()).toEqual(["equites", "hastati", "principes", "triarii", "velites"]);
    expect(Object.fromEntries(legion.map((formation) => [formation.templateId, formation.line]))).toMatchObject({ hastati: "first", principes: "second", triarii: "third", velites: "screen", equites: "wing" });
    const men = (templateId: string): number => army.personnel.find((row) => legion.find((formation) => formation.templateId === templateId)?.id === row.formationId)?.fit ?? 0;
    expect([men("hastati"), men("principes"), men("triarii"), men("velites"), men("equites")]).toEqual([1_200, 1_200, 600, 1_200, 300]);
    expect((army.formations ?? []).some((formation) => formation.bodyLabel === "the first Ala of the allies" && formation.templateId === "allied-horse")).toBe(true);
    // Veterans of Pyrrhus, not a fresh levy.
    expect(legion.every((formation) => formation.trainingBps === SEASONED_ARMIES["roman-field-army"]!.trainingBps)).toBe(true);
  });

  it("opens the Hellenistic kingdoms with armies under their kings, and keeps the headcounts the armies had", () => {
    for (const [forceId, polityId] of [["macedonian-royal-army", "macedon"], ["seleucid-royal-army", "seleucid-empire"], ["ptolemaic-royal-army", "ptolemaic-egypt"], ["ptolemaic-royal-fleet", "ptolemaic-egypt"]] as const) {
      const force = world.material.forces.find((candidate) => candidate.id === forceId)!;
      expect(force.polityId).toBe(polityId);
      const commander = world.characters.find((character) => character.id === force.commanderCharacterId);
      expect(commander?.polityId, forceId).toBe(polityId);
      expect(world.map.provinces.find((province) => province.id === force.locationId)?.controllerPolityId, forceId).toBe(polityId);
      expect(force.personnel.reduce((sum, row) => sum + row.fit, 0)).toBeLessThanOrEqual(force.authorizedStrength);
    }
    expect(world.material.forces.find((force) => force.id === "seleucid-royal-army")!.personnel.some((row) => row.categoryId === "elephant")).toBe(true);
  });
});
