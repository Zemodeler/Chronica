import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, openWar, type Force, type WorldState } from "@chronica/shared";
import { armiesMeet } from "./contact";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";

/**
 * Legio I at Messana, and Hieron's army there with it.
 *
 * Rome was at war with Syracuse from the forty-fifth day; the legion landed
 * where the Syracusans stood on the sixty-third, and nothing followed. Two
 * enemy armies on one field meet now, the day they are both there -- or the
 * weaker falls back, if it is badly outmatched and has somewhere to go.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const MESSANA = "ita-72843720b81376294924159-sicily-northeast";
const DAY = 63;

function atMessana(legionMen: number, options: { war?: boolean; fleet?: boolean } = {}): WorldState {
  const opening = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
  const world: WorldState = {
    ...opening,
    elapsedStep: DAY,
    instant: { day: DAY, minute: 0 },
    polityAgreements: options.war === false
      ? opening.polityAgreements
      : openWar(opening.polityAgreements, { id: "war-syracuse", polityId: "rome", otherPolityId: "syracuse", terms: "Messana.", atStep: 45, sourceMessageId: null, reason: "Hieron refused." }),
    material: {
      ...opening.material,
      forces: opening.material.forces
        // Only the two armies and, where asked for, a fleet: the Mamertines
        // have their own quarrel with Hieron.
        .filter((force) => force.id !== "mamertine-garrison")
        .map((force): Force => {
          if (force.id === "syracusan-army") return { ...force, locationId: MESSANA, personnel: [{ categoryId: "infantry", label: "Hoplites", fit: 4_000, unavailable: [] }] };
          if (force.id === "roman-field-army") return { ...force, name: "Legio I", locationId: MESSANA, personnel: [{ categoryId: "infantry", label: "Legionaries", fit: legionMen, unavailable: [] }] };
          if (force.id === "allied-greek-hulls" && options.fleet === true) return { ...force, polityId: "syracuse", locationId: MESSANA };
          return force;
        }),
    },
  };
  return world;
}

const tick = (world: WorldState, day = DAY) =>
  runDeterministicTick({ world: { ...world, elapsedStep: day, instant: { day, minute: 0 } }, toDay: day, ids: createIdFactory(`meet-${day}`), warfare: definition.warfare });
const forceOf = (world: WorldState, id: string): Force => world.material.forces.find((force) => force.id === id)!;

describe("enemy armies on one field", () => {
  it("fight the day they are both there", () => {
    const ticked = tick(atMessana(5_000));
    expect(ticked.contingencyBattles).toHaveLength(1);
    const [battle] = ticked.contingencyBattles;
    expect(battle!.losses.map((loss) => loss.name).sort()).toEqual(["Legio I", "Syracusan army"]);
    expect(battle!.sides.find((side) => side.attacking)!.name).toMatch(/Legio I/);
    expect(ticked.factProposals.some((fact) => fact.kind === "battle")).toBe(true);
  });

  it("do not fight when their powers are not at war", () => {
    expect(tick(atMessana(5_000, { war: false })).contingencyBattles).toHaveLength(0);
  });

  it("fight the same battle every time", () => {
    const a = tick(atMessana(5_000));
    const b = tick(atMessana(5_000));
    expect(a.contingencyBattles).toEqual(b.contingencyBattles);
    expect(a.world.material.forces).toEqual(b.world.material.forces);
  });

  it("are not brought to battle again the next morning", () => {
    const once = tick(atMessana(5_000));
    const left = once.world.material.forces.filter((force) => force.locationId === MESSANA).map((force) => force.id);
    // Both may still be there -- a field can be drawn -- but not fought over again for a week.
    const next = tick(once.world, DAY + 1);
    expect(next.contingencyBattles).toHaveLength(0);
    if (left.length === 2) expect(tick(next.world, DAY + 8).contingencyBattles.length).toBeLessThanOrEqual(1);
  });

  it("let a badly outmatched side fall back instead of standing", () => {
    const ticked = tick(atMessana(14_000));
    expect(ticked.contingencyBattles).toHaveLength(0);
    const syracusans = forceOf(ticked.world, "syracusan-army");
    expect(syracusans.locationId).not.toBe(MESSANA);
    expect(ticked.factProposals.some((fact) => fact.kind === "force_withdrew" && /fell back/.test(fact.summary))).toBe(true);
  });

  it("leave a fleet out of a battle on land", () => {
    const ticked = tick(atMessana(5_000, { fleet: true }));
    expect(ticked.contingencyBattles).toHaveLength(1);
    expect(ticked.contingencyBattles[0]!.losses.map((loss) => loss.name).sort()).toEqual(["Legio I", "Syracusan army"]);
  });

  it("leave a city's besiegers and its garrison to the siege", () => {
    const world = atMessana(5_000);
    const sieged: WorldState = {
      ...world,
      sieges: [{
        id: "siege-messana", forceId: "syracusan-army", provinceId: MESSANA, settlementId: null, besiegerPolityId: "syracuse", defenderPolityId: "rome",
        startedAtStep: DAY - 10, pressedToStep: DAY - 1, reportedAtStep: DAY - 1, pressureBps: 0, garrisonForceIds: ["roman-field-army"], status: "active", endedAtStep: null, endedReason: null,
      }],
    };
    expect(armiesMeet({ world: sieged, toDay: DAY, warfare: definition.warfare, ids: createIdFactory("siege") }).battles).toHaveLength(0);
  });
});
