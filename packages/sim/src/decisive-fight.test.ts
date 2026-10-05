import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, ensureProvinceMaterial, type Force, type WorldState } from "@chronica/shared";
import { DECISIVE_SHARE_BPS, SKIRMISH_MEN, isDecisiveFight } from "./decisive-fight";

const world = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const army = (state: WorldState, id: string, polityId: string, fit: number, locationId: string): Force => ({
  ...state.material.forces.find((force) => force.id === "roman-field-army")!, id, name: id, polityId, locationId,
  personnel: [{ categoryId: "infantry", label: "Men", fit, unavailable: [] }],
});
const withForces = (state: WorldState, forces: Force[]): WorldState => ({ ...state, sieges: [], material: { ...state.material, forces } });
const quiet = (state: WorldState): string => state.map.provinces.find((province) => !state.map.polities.some((polity) => province.settlements.some((settlement) => settlement.id === polity.capitalSettlementId)))!.id;

describe("which fights stop the turn for the player's word", () => {
  // Plan item 5, battle narrowing.
  it("is not a skirmish between a few hundred men", () => {
    const state = world();
    const ground = quiet(state);
    const mine = army(state, "mine", "rome", 600, ground);
    const theirs = army(state, "theirs", "carthage", 700, ground);
    expect(600 + 700).toBeLessThan(SKIRMISH_MEN);
    expect(isDecisiveFight(withForces(state, [mine, theirs]), ground, [mine], [theirs])).toBe(false);
  });

  it("is not a detachment's fight when each side has most of its power elsewhere", () => {
    const state = world();
    const ground = quiet(state);
    const mine = army(state, "mine", "rome", 1_000, ground);
    const theirs = army(state, "theirs", "carthage", 1_200, ground);
    const elsewhere = [army(state, "rome-main", "rome", 20_000, ground), army(state, "carthage-main", "carthage", 20_000, ground)];
    expect(isDecisiveFight(withForces(state, [mine, theirs, ...elsewhere]), ground, [mine], [theirs])).toBe(false);
  });

  it("is decisive when a side puts a quarter of its field army on the ground", () => {
    const state = world();
    const ground = quiet(state);
    const mine = army(state, "mine", "rome", 5_000, ground);
    const theirs = army(state, "theirs", "carthage", 4_000, ground);
    const rest = army(state, "rest", "rome", 10_000, ground);
    expect(5_000 / 15_000 * 10_000).toBeGreaterThanOrEqual(DECISIVE_SHARE_BPS);
    expect(isDecisiveFight(withForces(state, [mine, theirs, rest]), ground, [mine], [theirs])).toBe(true);
  });

  it("is decisive at a capital, or where a city is under siege, however few are fighting", () => {
    const state = world();
    const capitalProvince = state.map.provinces.find((province) => state.map.polities.some((polity) => province.settlements.some((settlement) => settlement.id === polity.capitalSettlementId)))!.id;
    const mine = army(state, "mine", "rome", 1_000, capitalProvince);
    const theirs = army(state, "theirs", "carthage", 1_200, capitalProvince);
    const big = [army(state, "rome-main", "rome", 20_000, "x"), army(state, "carthage-main", "carthage", 20_000, "x")];
    const at = withForces(state, [mine, theirs, ...big]);
    expect(isDecisiveFight(at, capitalProvince, [mine], [theirs])).toBe(true);

    const ground = quiet(state);
    const a = army(state, "a", "rome", 1_000, ground);
    const b = army(state, "b", "carthage", 1_200, ground);
    const besieged = { ...withForces(state, [a, b, ...big]), sieges: [{ status: "active", provinceId: ground }] } as unknown as WorldState;
    expect(isDecisiveFight(besieged, ground, [a], [b])).toBe(true);
  });
});
