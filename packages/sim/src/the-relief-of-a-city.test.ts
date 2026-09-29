import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  ScenarioDefinitionSchema,
  WorldStateSchema,
  ensureProvinceMaterial,
  siegePressurePerDayBps,
  siegeWalls,
  type FactProposalDraft,
  type Force,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import type { BattleAccount } from "./battle";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";

/**
 * "Hold out; we are coming."
 *
 * A siege pressed on the ratio of men and nothing else: Messana's walls were
 * worth nothing, the besiegers never went hungry or sick in their lines, and
 * an army of the city's own that came up behind them simply stood with the
 * garrison and was counted as more mouths. Walls slow a siege now, and a
 * relief either drives the besiegers off or falls on them.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const MESSANA = PUNIC_IDS.messana;
const context: ApplyContext = {
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: "gaius-genucius" },
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory("relief"),
  gameId: "game-relief",
};
const WAR: WorldDelta = {
  op: "agreement_open", localId: "war", kind: "war", polityId: "rome", otherPolityId: "mamertines",
  terms: "War over Messana.", forDays: null, sourceMessageRef: null, visibility: "public", reason: "They refused to surrender.",
};
const LAY: WorldDelta = { op: "siege_lay", localId: "messana", forceRef: "roman-field-army", settlementId: "settlement-messana", reason: "Invest the city." };

function besieged(): WorldState {
  const opening = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
  const before = { ...opening, material: { ...opening.material, forces: opening.material.forces.map((force) => (force.id === "roman-field-army" ? { ...force, locationId: MESSANA } : force)) } };
  return applyDeltas(before, [WAR, LAY], context).world;
}

function run(state: WorldState, from: number, to: number): { world: WorldState; facts: FactProposalDraft[]; battles: BattleAccount[] } {
  let world = state;
  const facts: FactProposalDraft[] = [];
  const battles: BattleAccount[] = [];
  for (let day = from; day <= to; day += 5) {
    const ticked = runDeterministicTick({ world: { ...world, elapsedStep: day, instant: { ...world.instant, day } }, toDay: day, ids: createIdFactory(`relief-${day}`), warfare: definition.warfare });
    facts.push(...ticked.factProposals);
    battles.push(...ticked.contingencyBattles);
    world = ticked.world;
  }
  return { world, facts, battles };
}

const relief = (men: number): Force => ({
  id: "mamertine-relief", name: "Mamertine relief column", polityId: "mamertines",
  commanderCharacterId: "mamertine-spokesman", controllerCharacterId: "mamertine-spokesman",
  locationId: MESSANA, positionId: null, authorizedStrength: men,
  personnel: [{ categoryId: "infantry", label: "Mercenaries", fit: men, unavailable: [] }],
  moraleBps: 7_500, cohesionBps: 7_500, fatigueBps: 0, provisionStatus: "provisioned", provisionedThroughStep: 365,
  payObligationId: null, payArrearsPeriods: 0, history: [], memberCharacterIds: [],
});
const arrive = (world: WorldState, column: Force): WorldState => ({ ...world, material: { ...world.material, forces: [...world.material.forces, column] } });

describe("the walls of a city", () => {
  it("make its siege longer, and a fortress on them longer still", () => {
    const world = besieged();
    const siege = world.sieges[0]!;
    const walls = siegeWalls(world, siege);
    expect(walls).toBeGreaterThan(1);
    expect(siegePressurePerDayBps(7_100, 1_400, walls)).toBeLessThan(siegePressurePerDayBps(7_100, 1_400));
    const fortified: WorldState = {
      ...world,
      structures: [...world.structures, {
        id: "messana-citadel", kind: "fortress", name: "The citadel", provinceId: MESSANA, settlementId: "settlement-messana", ownerPolityId: "mamertines",
        garrisonCapacity: 2_000, defensiveEffectsBps: 2_000, supplyRadius: 0, builtAtStep: 0, provenanceProjectId: null, effects: [], upkeep: null,
      }],
    };
    expect(siegeWalls(fortified, siege)).toBeGreaterThan(walls);
  });

  it("remembers who was inside when it was first pressed", () => {
    const { world } = run(besieged(), 5, 5);
    expect(world.sieges[0]!.garrisonForceIds).toEqual(["mamertine-garrison"]);
  });
});

describe("a relief", () => {
  it("strong enough makes the besiegers draw off without a battle", () => {
    const pressed = run(besieged(), 5, 5).world;
    const { world, facts, battles } = run(arrive(pressed, relief(12_000)), 10, 10);
    expect(world.sieges[0]!.status).toBe("lifted");
    expect(facts.some((fact) => fact.kind === "siege_lifted" && /came up to its relief/.test(fact.summary))).toBe(true);
    expect(battles).toHaveLength(0);
  });

  it("falls on the lines, and the battle decides the siege", () => {
    const pressed = run(besieged(), 5, 5).world;
    const { world, battles } = run(arrive(pressed, relief(4_000)), 10, 10);
    expect(battles).toHaveLength(1);
    expect(battles[0]!.sides.some((side) => side.name === "Mamertine relief column" && side.attacking)).toBe(true);
    const siege = world.sieges[0]!;
    const romans = world.material.forces.find((force) => force.id === "roman-field-army")!;
    // Either the Romans were driven from the walls and the siege is raised, or
    // they held and it goes on -- with the relief counted inside from now on,
    // so it does not fall on the same lines every day.
    if (romans.locationId === MESSANA) {
      expect(siege.status).toBe("active");
      expect(siege.garrisonForceIds).toContain("mamertine-relief");
    } else {
      expect(siege.status).toBe("lifted");
    }
  });

  it("too weak to matter waits, and does not attack", () => {
    const pressed = run(besieged(), 5, 5).world;
    const { battles, world } = run(arrive(pressed, relief(500)), 10, 10);
    expect(battles).toHaveLength(0);
    expect(world.sieges[0]!.status).toBe("active");
  });
});
