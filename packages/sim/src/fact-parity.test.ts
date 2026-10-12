import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, ensureProvinceMaterial, type OrderPartyRef, type WorldState } from "@chronica/shared";
import { factContradictsState } from "./fact-parity";

const world = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const where = (forceId: string, state: WorldState) => new Set([state.material.forces.find((force) => force.id === forceId)!.locationId]);

describe("a fact held to the state it claims", () => {
  // Plan chronicle-and-order-truth, 1.6 (R77).
  it("drops an arrival the army has not made, and lets one it has", () => {
    const state = world();
    const legion = state.material.forces.find((force) => force.id === "roman-field-army")!;
    const elsewhere = state.map.provinces.find((province) => province.id !== legion.locationId)!;
    const claim = (provinceId: string) => ({ kind: "arrival", summary: "Legio I arrived at the strait.", affectedRefs: [{ kind: "force", id: legion.id }, { kind: "province", id: provinceId }] as OrderPartyRef[] });
    expect(factContradictsState(state, claim(elsewhere.id), (id) => where(id, state))).toMatch(/not at/);
    expect(factContradictsState(state, claim(legion.locationId), (id) => where(id, state))).toBeNull();
  });

  it("drops a city said taken that is held by somebody else", () => {
    const state = world();
    const province = state.map.provinces.find((candidate) => candidate.controllerPolityId === "rome")!;
    const claim = { kind: "city_taken", summary: "The city fell to Carthage.", affectedRefs: [{ kind: "polity", id: "carthage" }, { kind: "province", id: province.id }] as OrderPartyRef[] };
    expect(factContradictsState(state, claim, () => new Set())).toMatch(/held by/);
    expect(factContradictsState(state, { ...claim, affectedRefs: [{ kind: "polity", id: "rome" }, { kind: "province", id: province.id }] }, () => new Set())).toBeNull();
  });

  it("drops an appointment to a seat the man does not hold", () => {
    const state = world();
    const person = state.characters[0]!;
    const claim = { kind: "appointment", summary: `${person.name} was appointed legate.`, affectedRefs: [{ kind: "character", id: person.id }, { kind: "office", id: "no-such-office" }] as OrderPartyRef[] };
    expect(factContradictsState(state, claim, () => new Set())).toMatch(/not his/);
  });

  it("passes what it cannot read", () => {
    const state = world();
    expect(factContradictsState(state, { kind: "feast", summary: "Rome held games.", affectedRefs: [] }, () => new Set())).toBeNull();
  });
});

describe("a fact that denies what it names", () => {
  it("is not taken for the claim: an army that never arrived is not said to have arrived", () => {
    const state = world();
    const legion = state.material.forces.find((force) => force.id === "roman-field-army")!;
    const elsewhere = state.map.provinces.find((province) => province.id !== legion.locationId)!;
    const refs = [{ kind: "force", id: legion.id }, { kind: "province", id: elsewhere.id }] as OrderPartyRef[];
    expect(factContradictsState(state, { kind: "march", summary: "The legion never arrived at the strait.", affectedRefs: refs }, (id) => where(id, state))).toBeNull();
    expect(factContradictsState(state, { kind: "march", summary: "The legion made landfall at the strait.", affectedRefs: refs }, (id) => where(id, state))).toMatch(/not at/);
  });
});
