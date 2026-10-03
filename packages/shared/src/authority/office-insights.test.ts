import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema } from "../world/scenario";
import { WorldStateSchema, type WorldState } from "../world/world-state";
import { FactSchema, type Fact } from "../world/facts";
import { readOfficeInsights } from "./office-insights";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
const read = (state: WorldState, facts: Fact[] = [], characterId: string | null = "gaius-genucius") => readOfficeInsights({ world: state, characterId, offices, facts });
const report = (state: WorldState, id: string, men: number, day = state.elapsedStep): Fact => FactSchema.parse({
  id, time: { day, minute: 0 }, atStep: day, kind: "sighting", summary: `Account ${id}`,
  visibility: "public", discovery: { state: "public", discoveredBy: [] },
  forcesAsReported: [{ forceId: state.material.forces[0]!.id, men, locationId: state.characters.find((person) => person.id === "gaius-genucius")!.locationProvinceId! }],
});

describe("office information from records the player can read", () => {
  it("returns no information before a character is chosen", () => {
    expect(read(world(), [], null)).toEqual({ permissions: [], departures: [], readiness: {}, exposure: { own: [], kept: [] }, disagreements: [], service: {} });
  });

  it("shows the Senate's reserved permissions without treating a consul's command as a right to declare war", () => {
    const state = world();
    const chamber = state.material.institutions.find((body) => body.polityId === "rome")!;
    state.material.reservedPowers.push({ id: "test-war-permission", polityId: "rome", category: "declare_war", institutionId: chamber.id });
    const result = read(state);
    const war = result.permissions.find((line) => line.text === "Declare war");
    expect(war).toBeDefined();
    expect(war?.direct).toBe(false);
    expect(war?.detail).toMatch(/must authorise/);
  });

  it("does not grant permission from a claimed office", () => {
    const opening = world();
    const state = { ...opening, material: { ...opening.material, officeSeats: opening.material.officeSeats.filter((seat) => seat.holderCharacterId !== "gaius-genucius") } };
    expect(read(state).permissions.some((line) => line.direct)).toBe(false);
    expect(read(state).departures).toEqual([]);
  });

  it("keeps the Senate appointment and personal property distinct from an expiring consulship", () => {
    const departure = read(world()).departures.find((item) => item.office === "Roman consul");
    expect(departure).toBeDefined();
    expect(departure?.retained).toContain("Roman senator");
    expect(departure?.lost.some((line) => line.includes("fiscal"))).toBe(true);
    expect(departure?.lost.some((line) => line.includes("purse"))).toBe(false);
  });

  it("only assesses forces on the viewer's muster", () => {
    const state = world();
    const result = read(state);
    for (const force of state.material.forces.filter((force) => force.polityId !== "rome" && force.commanderCharacterId !== "gaius-genucius" && force.controllerCharacterId !== "gaius-genucius")) {
      expect(result.readiness[force.id]).toBeUndefined();
    }
  });

  it("describes a strength gap and provision horizon without claiming an army cannot march", () => {
    const result = read(world());
    const army = Object.values(result.readiness).find((lines) => lines.some((line) => line.key === "strength"));
    expect(army?.find((line) => line.key === "strength")?.detail).toContain("not a prohibition");
    expect(army?.find((line) => line.key === "supply")?.text).toMatch(/Provision/);
  });

  it("flags an unassigned payer even before wages fall into arrears", () => {
    const state = world();
    const force = state.material.forces.find((force) => force.commanderCharacterId === "gaius-genucius")!;
    force.payObligationId = null;
    force.payArrearsPeriods = 0;
    expect(read(state).readiness[force.id]?.find((line) => line.key === "pay")?.text).toMatch(/nobody has undertaken/i);
  });

  it("distinguishes an advisory council from one with binding powers", () => {
    const state = world();
    const council = state.material.institutions.find((body) => body.polityId === "rome")!;
    council.advisory = true;
    council.powers = ["war"];
    const permission = read(state).permissions.find((line) => line.key === `chamber:${council.id}`);
    expect(permission?.text).toContain("war, peace");
    expect(permission?.detail).toContain("advice");
  });

  it("calculates loss of a source independently for private and public books", () => {
    const result = read(world());
    expect(result.exposure.own.some((line) => line.text.includes("100%"))).toBe(true);
    expect(result.exposure.kept.length).toBeGreaterThan(0);
    expect(result.exposure.kept.every((line) => !result.exposure.own.some((own) => own.key === line.key))).toBe(true);
    expect(result.exposure.kept.some((line) => line.detail?.includes("other income and expenses unchanged"))).toBe(true);
  });

  it("compares different observations of one instant, without silently resolving them", () => {
    const state = world();
    const result = read(state, [report(state, "one", 1_000), report(state, "two", 2_000)]);
    expect(result.disagreements).toHaveLength(1);
    expect(result.disagreements[0]?.accounts.map((account) => account.text)).toEqual(["Account one", "Account two"]);
  });

  it("does not confuse movement or losses over time with a contradiction", () => {
    const state = world();
    state.elapsedStep = 10;
    state.instant = { day: 10, minute: 0 };
    expect(read(state, [report(state, "one", 1_000, 0), report(state, "two", 2_000, 10)]).disagreements).toEqual([]);
  });

  it("never includes an undiscovered report", () => {
    const state = world();
    const secret = report(state, "secret", 2_000);
    secret.visibility = "private";
    secret.discovery = { state: "private", knowableAtInstant: null, discoveredBy: [] };
    secret.affectedEntities = [{ kind: "character", id: "gaius-genucius" }];
    const result = read(state, [report(state, "one", 1_000), secret]);
    expect(result.disagreements).toEqual([]);
    expect(result.service["person:gaius-genucius"]).toBeUndefined();
  });

  it("uses known events as attributed evidence, without presenting involvement as responsibility", () => {
    const state = world();
    const fact = report(state, "known", 1_000);
    fact.affectedEntities = [{ kind: "character", id: "gaius-genucius" }];
    const evidence = read(state, [fact]).service["person:gaius-genucius"];
    expect(evidence?.[0]?.text).toBe("Account known");
    expect(evidence?.[0]?.detail).toContain("does not by itself establish responsibility");
  });
});
