import { describe, expect, it } from "vitest";
import { PUNIC_IDS, punicWarsScenario } from "@chronica/db";
import type { Force } from "../material-state";
import { WorldStateSchema, type WorldState } from "../world/world-state";
import { openWar } from "../world/agreements";
import { ScenarioDefinitionSchema } from "../world/scenario";
import { resolveBattle, type ResolveBattleParticipant } from "./battle-resolver";
import { retreatRoute } from "./retreat";

/**
 * Where the beaten go, how many of them get there, and what a fleet stands on.
 *
 * Every retreat went to the alphabetically first neighbour of the field, for
 * both sides at once; a rout cost nothing beyond the fighting; and a fleet
 * defending off a mountainous coast was given the mountains.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const MESSANA = PUNIC_IDS.messana;
const AGRIGENTUM = PUNIC_IDS.agrigentum;
const SYRACUSE = PUNIC_IDS.syracuse;
const PANORMUS = PUNIC_IDS.panormus;

function atWar(): WorldState {
  const world = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
  return { ...world, polityAgreements: openWar(world.polityAgreements, { id: "war", polityId: "rome", otherPolityId: "carthage", terms: "Sicily.", atStep: 0, sourceMessageId: null, reason: "Messana." }) };
}
const forceOf = (world: WorldState, id: string): Force => world.material.forces.find((force) => force.id === id)!;

describe("a beaten army", () => {
  it("falls back toward ground that is not the enemy's -- and the enemy toward its own", () => {
    const world = atWar();
    const romans = { ...forceOf(world, "roman-field-army"), locationId: MESSANA };
    const carthaginians = { ...forceOf(world, "carthaginian-garrison"), locationId: MESSANA };
    const heldBy = (provinceId: string | null) => world.map.provinces.find((province) => province.id === provinceId)?.controllerPolityId;
    // Messana's neighbours are all the Mamertines': ground that is nobody's enemy, which neither side is driven off.
    const romanRetreat = retreatRoute(world, romans, MESSANA, new Set(["carthage"]));
    const punicRetreat = retreatRoute(world, carthaginians, MESSANA, new Set(["rome"]));
    expect(romanRetreat).not.toBeNull();
    expect(punicRetreat).not.toBeNull();
    expect(heldBy(romanRetreat)).not.toBe("carthage");
    expect(heldBy(punicRetreat)).not.toBe("rome");
  });

  it("does not take ship under the enemy's eyes", () => {
    const world = atWar();
    const romans = { ...forceOf(world, "roman-field-army"), locationId: MESSANA };
    // Bruttium is Rome's ally's, but over the strait.
    expect(retreatRoute(world, romans, MESSANA, new Set(["carthage"]))).not.toBe(PUNIC_IDS.rhegium);
  });

  it("each side of one field goes its own way", () => {
    const world = atWar();
    const province = world.map.provinces.find((candidate) => candidate.id === MESSANA)!;
    const strong = { ...forceOf(world, "carthaginian-garrison"), personnel: [{ categoryId: "infantry", label: "Infantry", fit: 12_000, unavailable: [] }] };
    const weak = { ...forceOf(world, "roman-field-army"), personnel: [{ categoryId: "infantry", label: "Legionaries", fit: 1_500, unavailable: [] }], cohesionBps: 3_000 };
    const result = resolveBattle({
      battle: { battleId: "b", provinceId: MESSANA, startedAtStep: 0, participants: [{ forceId: strong.id, side: "attacker", arrivesAtPhase: "contact" }, { forceId: weak.id, side: "defender", arrivesAtPhase: "contact" }] },
      participants: [{ forceId: strong.id, side: "attacker", force: strong, commander: null }, { forceId: weak.id, side: "defender", force: weak, commander: null }],
      province, provinceMaterial: null,
      adjacentProvinceIds: [AGRIGENTUM, PANORMUS, SYRACUSE],
      warfareRules: definition.warfare,
      retreatRoutes: new Map([[strong.id, PANORMUS], [weak.id, SYRACUSE]]),
    }, "retreat-seed");
    const fled = result.retreats.find((retreat) => retreat.forceId === weak.id);
    expect(fled?.toProvinceId).toBe(SYRACUSE);
  });
});

describe("a rout", () => {
  const fight = (victorCategory: string) => {
    const world = atWar();
    const province = world.map.provinces.find((candidate) => candidate.id === MESSANA)!;
    const victor: Force = { ...forceOf(world, "carthaginian-garrison"), personnel: [{ categoryId: victorCategory, label: "Victors", fit: 10_000, unavailable: [] }], moraleBps: 9_000, cohesionBps: 9_000 };
    const beaten: Force = { ...forceOf(world, "roman-field-army"), personnel: [{ categoryId: "infantry", label: "Legionaries", fit: 3_000, unavailable: [] }], moraleBps: 4_000, cohesionBps: 2_500 };
    const participants: ResolveBattleParticipant[] = [
      { forceId: victor.id, side: "attacker", force: victor, commander: null },
      { forceId: beaten.id, side: "defender", force: beaten, commander: null },
    ];
    return resolveBattle({
      battle: { battleId: "rout", provinceId: MESSANA, startedAtStep: 0, participants: participants.map((p) => ({ forceId: p.forceId, side: p.side, arrivesAtPhase: "contact" as const })) },
      participants, province, provinceMaterial: null, adjacentProvinceIds: [SYRACUSE], warfareRules: definition.warfare,
    }, "rout-seed");
  };
  const lostBy = (result: ReturnType<typeof fight>, forceId: string): number =>
    result.casualties.filter((casualty) => casualty.forceId === forceId).reduce((sum, casualty) => sum + casualty.dead + casualty.deserted + casualty.wounded, 0);

  it("is cut down running, the more so by horse", () => {
    const cavalry = definition.warfare.troopCategories.find((category) => category.mobilityBps >= 8_000 && !category.naval)!;
    const byFoot = fight("infantry");
    const byHorse = fight(cavalry.id);
    expect(byFoot.retreats.find((retreat) => retreat.forceId === "roman-field-army")?.orderly).toBe(false);
    expect(lostBy(byHorse, "roman-field-army")).toBeGreaterThan(lostBy(byFoot, "roman-field-army"));
  });
});

describe("a fleet", () => {
  it("stands on no hill", () => {
    const world = atWar();
    const ground = world.map.provinces.find((candidate) => candidate.id === AGRIGENTUM)!;
    const hills = { ...ground, terrainId: "hills" };
    const plain = { ...ground, terrainId: "coastal-plain" };
    const fleet = forceOf(world, "carthaginian-fleet");
    const other = { ...forceOf(world, "syracusan-squadron"), personnel: [{ categoryId: "warship", label: "Triremes", fit: 110, unavailable: [] }] };
    const opening = (province: typeof hills, defender: Force, attacker: Force) => resolveBattle({
      battle: { battleId: "sea", provinceId: province.id, startedAtStep: 0, participants: [{ forceId: attacker.id, side: "attacker", arrivesAtPhase: "contact" }, { forceId: defender.id, side: "defender", arrivesAtPhase: "contact" }] },
      participants: [{ forceId: attacker.id, side: "attacker", force: attacker, commander: null }, { forceId: defender.id, side: "defender", force: defender, commander: null }],
      province, provinceMaterial: null, adjacentProvinceIds: [], warfareRules: definition.warfare,
    }, "sea-seed").phases[0]!.defenderEffectiveStrength;
    expect(opening(hills, fleet, other)).toBe(opening(plain, fleet, other));
    // An army on the same hills still has them.
    const legion = forceOf(world, "roman-field-army");
    const foes = forceOf(world, "carthaginian-garrison");
    expect(opening(hills, legion, foes)).toBeGreaterThan(opening(plain, legion, foes));
  });
});
