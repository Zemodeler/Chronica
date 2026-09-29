import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  ScenarioDefinitionSchema,
  WorldStateSchema,
  atWar,
  economyOf,
  ensureProvinceMaterial,
  type WorldState,
} from "@chronica/shared";
import { createIdFactory } from "./ports";
import { ensureConstitutions } from "./constitutions";
import { reviewUnrest } from "./unrest";
import { runDeterministicTick } from "./tick";

/**
 * A general marches on the city.
 *
 * A state nobody believed in, with a general at the head of an army that was
 * his and not the state's, and the general against the man who ruled it, had
 * no civil war: a coup was something the general had to think of for himself,
 * and when he did not, nothing happened. Now, rarely and only when all of it
 * is true, his army and the ground it stands on become a rival power at war
 * with the one they left -- and a peace between them brings them home.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const government = { offices: definition.government.offices, successionRules: definition.government.successionRules };
const SYRACUSE_LAND = PUNIC_IDS.syracuse;

/**
 * Syracuse under Hieron, its government despised, and Leptines at the head of
 * three thousand men who follow him and not the state -- and Leptines hating
 * Hieron.
 */
function aGeneralAndAGrievance(options: { legitimacyBps?: number; hatred?: number } = {}): WorldState {
  const world = ensureConstitutions({ world: ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0), government, toDay: 0 });
  const army = {
    ...world.material.forces.find((force) => force.id === "syracusan-army")!,
    id: "leptines-army", name: "Leptines' army", commanderCharacterId: "leptines-syracuse", controllerCharacterId: "leptines-syracuse",
    locationId: SYRACUSE_LAND, personnel: [{ categoryId: "infantry", label: "Hoplites", fit: 3_000, unavailable: [] }], authorizedStrength: 3_000, payObligationId: null,
  };
  return {
    ...world,
    characters: world.characters.map((character) => (character.id === "leptines-syracuse"
      ? { ...character, relations: [...character.relations.filter((relation) => relation.subjectCharacterId !== "hieron-ii"), { subjectCharacterId: "hieron-ii", causes: [{ id: "slight", label: "Passed over for the command", score: options.hatred ?? -50, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null }] }] }
      : character)),
    material: {
      ...world.material,
      forces: [...world.material.forces, army],
      politicalGroups: [...world.material.politicalGroups, {
        id: "leptines-men", name: "Leptines' men", polityId: "syracuse", type: "military_command", leaderCharacterId: "leptines-syracuse", platform: [],
        resourceAccountId: null, publicReputationBps: 5_000, active: true, emergentKey: "army:leptines-army:leptines-syracuse", strengthBps: 7_000,
      }],
      polityLegitimacy: [...world.material.polityLegitimacy.filter((entry) => entry.polityId !== "syracuse"), { polityId: "syracuse", legitimacyBps: options.legitimacyBps ?? 2_000, institutionalConfidenceBps: 3_000, causes: [] }],
    },
  };
}

/** Month by month for two years, until a civil war opens. */
function months(world: WorldState) {
  let current = world;
  for (let month = 1; month <= 24; month += 1) {
    const reviewed = reviewUnrest({ world: current, toDay: month * 30, months: 1, ids: createIdFactory(`civil-${month}`), burdens: new Map(), government, playerCharacterId: "gaius-genucius" });
    current = reviewed.world;
    const war = reviewed.facts.find((fact) => fact.kind === "civil_war");
    if (war !== undefined) return { world: current, war, month };
  }
  return { world: current, war: undefined, month: null };
}

describe("a general marches on the city", () => {
  it("makes his army and the ground it stands on a rival power, at war with the one they left", () => {
    const { world, war } = months(aGeneralAndAGrievance());
    expect(war?.summary).toContain("Leptines");
    expect(WorldStateSchema.safeParse(world).success).toBe(true);
    const rebels = economyOf(world).civilWars[0]!;
    expect(rebels.fromPolityId).toBe("syracuse");
    expect(world.material.forces.find((force) => force.id === "leptines-army")!.polityId).toBe(rebels.rebelPolityId);
    expect(world.characters.find((character) => character.id === "leptines-syracuse")!.polityId).toBe(rebels.rebelPolityId);
    expect(world.map.provinces.find((province) => province.id === SYRACUSE_LAND)!.controllerPolityId).toBe(rebels.rebelPolityId);
    expect(atWar(world.polityAgreements, rebels.rebelPolityId, "syracuse")).toBe(true);
    // And the world goes on with it: the calendar's own review takes it.
    const ticked = runDeterministicTick({ world, toDay: 800, ids: createIdFactory("after"), warfare: definition.warfare, government });
    expect(WorldStateSchema.safeParse(ticked.world).success).toBe(true);
  });

  it("comes home when the two make peace", () => {
    const { world } = months(aGeneralAndAGrievance());
    const rebels = economyOf(world).civilWars[0]!;
    const peace: WorldState = {
      ...world,
      polityAgreements: [
        ...world.polityAgreements.map((agreement) => (agreement.kind === "war" && agreement.status === "active" && [agreement.polityId, agreement.otherPolityId].includes(rebels.rebelPolityId)
          ? { ...agreement, status: "ended" as const, endedAtStep: 750, endedReason: "Peace." } : agreement)),
        { id: "reconciliation", kind: "peace", polityId: rebels.rebelPolityId, otherPolityId: "syracuse", terms: "Leptines submits, and is forgiven.", sinceStep: 750, untilStep: null, sourceMessageId: null, status: "active", endedAtStep: null, endedReason: null, visibility: "public" },
      ],
    };
    const reviewed = reviewUnrest({ world: peace, toDay: 780, months: 1, ids: createIdFactory("peace"), burdens: new Map(), government, playerCharacterId: null });
    expect(reviewed.facts.some((fact) => fact.kind === "civil_war_ended")).toBe(true);
    expect(reviewed.world.material.forces.find((force) => force.id === "leptines-army")!.polityId).toBe("syracuse");
    expect(reviewed.world.map.provinces.find((province) => province.id === SYRACUSE_LAND)!.controllerPolityId).toBe("syracuse");
    expect(reviewed.world.map.polities.find((polity) => polity.id === rebels.rebelPolityId)!.endedAtStep).toBe(780);
    // And there is no second one in the same breath.
    const after = reviewUnrest({ world: reviewed.world, toDay: 810, months: 1, ids: createIdFactory("after-peace"), burdens: new Map(), government, playerCharacterId: null });
    expect(after.facts.some((fact) => fact.kind === "civil_war")).toBe(false);
  });

  it("does not happen under a government people believe in", () => {
    expect(months(aGeneralAndAGrievance({ legitimacyBps: 6_000 })).war).toBeUndefined();
  });

  it("does not happen when the general has no quarrel with the ruler", () => {
    expect(months(aGeneralAndAGrievance({ hatred: 30 })).war).toBeUndefined();
  });
});
