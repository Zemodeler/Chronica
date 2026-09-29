import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, openWar, type Force, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { resolveEngagement } from "./battle";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";

/**
 * "Carry the legion over to Messana."
 *
 * The Carthaginian navy could lie off Messana while a Roman legion was
 * carried past it in six loads: a crossing asked whether Rome had the hulls,
 * never whether anybody's fleet stood in the way. It is fought for now --
 * turned back where the escorts could not hope to pass, and a sea battle
 * where they could.
 *
 * And a field fought over is trampled, whoever keeps it.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const MESSANA = PUNIC_IDS.messana;
const nameOf = (id: string): string => punicWarsScenario.initialWorld.map.provinces.find((province) => province.id === id)!.name;
const BRUTTIUM = PUNIC_IDS.rhegium;
const AGRIGENTUM = PUNIC_IDS.agrigentum;

const context: ApplyContext = {
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: "gaius-genucius" },
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory("strait"),
  gameId: "game-strait",
};

function world(legionMen: number, romanHulls: number): WorldState {
  const opening = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
  return {
    ...opening,
    polityAgreements: openWar(opening.polityAgreements, { id: "war-carthage", polityId: "rome", otherPolityId: "carthage", terms: "Sicily.", atStep: 0, sourceMessageId: null, reason: "Messana." }),
    material: {
      ...opening.material,
      forces: opening.material.forces.map((force): Force => {
        if (force.id === "roman-field-army") return { ...force, locationId: BRUTTIUM, personnel: [{ categoryId: "infantry", label: "Legionaries", fit: legionMen, unavailable: [] }] };
        if (force.id === "allied-greek-hulls") return { ...force, personnel: [{ categoryId: "warship", label: "Allied transports", fit: romanHulls, unavailable: [] }] };
        if (force.id === "carthaginian-fleet") return { ...force, locationId: MESSANA };
        return force;
      }),
    },
  };
}

const cross = { op: "force_modify" as const, forceRef: "roman-field-army", locationId: MESSANA, reason: "Over the strait." };
const legion = (state: WorldState): Force => state.material.forces.find((force) => force.id === "roman-field-army")!;
function arrive(state: WorldState) {
  const march = state.projects.find((project) => project.completionOutcome?.kind === "force_move")!;
  const day = march.startedAtStep + march.milestones.at(-1)!.requiredAtElapsedOffset;
  return runDeterministicTick({ world: { ...state, elapsedStep: day, instant: { day, minute: 0 } }, toDay: day, ids: createIdFactory(`arrive-${day}`), warfare: definition.warfare });
}

describe("a crossing past an enemy fleet", () => {
  it("is never made in one go under its eyes", () => {
    const set = applyDeltas(world(500, 18), [cross], context);
    expect(set.rejected).toEqual([]);
    expect(legion(set.world).locationId).toBe(BRUTTIUM);
    expect(set.world.projects.some((project) => project.completionOutcome?.kind === "force_move" && project.completionOutcome.forceId === "roman-field-army")).toBe(true);
  });

  it("turns back when the escorts could not hope to carry it past", () => {
    const set = applyDeltas(world(3_000, 18), [cross], context).world;
    const landed = arrive(set);
    expect(legion(landed.world).locationId).toBe(BRUTTIUM);
    expect(landed.factProposals.some((fact) => fact.kind === "crossing_stopped" && fact.summary.includes(`Carthaginian fleet lay off ${nameOf(MESSANA)}`))).toBe(true);
    expect(landed.world.projects.find((project) => project.completionOutcome?.forceId === "roman-field-army")!.status).toBe("failed");
  });

  it("is fought for at sea when the escorts dare", () => {
    const set = applyDeltas(world(3_000, 90), [cross], context).world;
    const landed = arrive(set);
    // One fight at sea. (Waiting in Bruttium, the legion also meets the
    // Campanians of Rhegium, Rome's enemies there -- `contact.ts`.)
    expect(landed.contingencyBattles.filter((battle) => battle.sides.every((side) => side.unit === "ships"))).toHaveLength(1);
    const march = landed.world.projects.find((project) => project.completionOutcome?.forceId === "roman-field-army")!;
    // Won, the legion lands; lost, it is back on the Italian shore, fewer.
    if (march.status === "failed") expect(legion(landed.world).locationId).toBe(BRUTTIUM);
    else expect(legion(landed.world).locationId).toBe(MESSANA);
  });
});

describe("a battle that changes nobody's ground", () => {
  it("still tramples the province it was fought in", () => {
    const opening = world(7_000, 18);
    const here = { ...opening, material: { ...opening.material, forces: opening.material.forces.map((force) => (force.id === "roman-field-army" || force.id === "carthaginian-garrison" ? { ...force, locationId: AGRIGENTUM } : force)) } };
    const before = here.material.provinceMaterial.find((row) => row.provinceId === AGRIGENTUM)!;
    const fought = resolveEngagement({
      world: here,
      attacker: legion(here),
      defender: here.material.forces.find((force) => force.id === "carthaginian-garrison")!,
      posture: "offer_battle", tactic: null, warfare: definition.warfare, battleId: "agrigentum", seed: "agrigentum",
    }, 0);
    const after = fought.world.material.provinceMaterial.find((row) => row.provinceId === AGRIGENTUM)!;
    expect(fought.world.map.provinces.find((province) => province.id === AGRIGENTUM)!.controllerPolityId).toBe("carthage");
    expect(after.warDamageBps).toBeGreaterThan(before.warDamageBps);
    expect(after.foodSecurityBps).toBeLessThan(before.foodSecurityBps);
  });
});
