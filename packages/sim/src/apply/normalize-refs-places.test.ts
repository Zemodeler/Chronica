import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldDeltaSchema, WorldStateSchema, type WorldState } from "@chronica/shared";
import { normalizeRefs } from "./normalize-refs";
import { findPolityGaps } from "../population";

/** The scenario's world with a map of 4,400 small provinces whose ids say nothing. */
function denseWorld(): WorldState {
  const state = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
  const terrainId = state.map.provinces[0]!.terrainId;
  const provinces = Array.from({ length: 4_400 }, (_, n) => ({
    id: `it-${n.toString(36).padStart(5, "0")}`, name: n === 1234 ? "Bovianum Vetus" : `Locus ${n.toString(36)}`, formerNames: [], terrainId,
    settlements: n === 77 ? [{ id: "settlement-luceria", name: "Luceria", kind: "town" as const, provinceId: `it-${(77).toString(36).padStart(5, "0")}`, controllerPolityId: "rome", size: 10, fortificationLevel: 1 }] : [],
    controllerPolityId: n < 200 ? "rome" : null, controlFirmnessBps: 5_000,
  }));
  return { ...state, map: { ...state.map, provinces, edges: [] } };
}

describe("province references on a map of thousands", () => {
  const state = denseWorld();
  const force = state.material.forces[0]!.id;

  it("puts a province written by its name to the one id it means", () => {
    const delta = WorldDeltaSchema.parse({ op: "force_modify", forceRef: force, locationId: "Bovianum Vetus", reason: "March." });
    expect(normalizeRefs(delta, state)).toMatchObject({ locationId: `it-${(1234).toString(36).padStart(5, "0")}` });
    const byTown = WorldDeltaSchema.parse({ op: "force_modify", forceRef: force, locationId: "Luceria", reason: "March." });
    expect(normalizeRefs(byTown, state)).toMatchObject({ locationId: `it-${(77).toString(36).padStart(5, "0")}` });
  });

  it("leaves a real id alone, and an unknown place unguessed", () => {
    const real = WorldDeltaSchema.parse({ op: "force_modify", forceRef: force, locationId: "it-00005", reason: "March." });
    expect(normalizeRefs(real, state)).toMatchObject({ locationId: "it-00005" });
    const unknown = WorldDeltaSchema.parse({ op: "force_modify", forceRef: force, locationId: "Atlantis", reason: "March." });
    expect(normalizeRefs(unknown, state)).toMatchObject({ locationId: "Atlantis" });
  });

  it("reads the places an act's words name in one pass, however many provinces there are", () => {
    const started = Date.now();
    for (let n = 0; n < 24; n += 1) {
      normalizeRefs(WorldDeltaSchema.parse({ op: "force_modify", forceRef: force, locationId: "it-00005", reason: `Sail to Bovianum Vetus ${n}.` }), state);
    }
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe("which countries the world owes people, on a finer map", () => {
  it("does not call every polity major because provinces are small", () => {
    const state = denseWorld();
    const gaps = findPolityGaps({ world: state, ownPolityId: "carthage", facts: [], limit: 50 });
    // Rome holds 200 of 4,400: under the share that made a power major on the old map (12 of 780).
    expect(gaps.every((gap) => gap.polityId !== "rome" || gap.why.includes("they hold"))).toBe(true);
    const small = { ...state, map: { ...state.map, polities: state.map.polities.filter((polity) => polity.capitalSettlementId === null) } };
    expect(findPolityGaps({ world: small, ownPolityId: "carthage", facts: [], limit: 50 }).filter((gap) => gap.provinceCount < 68 && !gap.why.includes("border"))).toEqual([]);
  });
});
