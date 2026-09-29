import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, type WorldState } from "../index";
import { buildStation } from "../authority/station";
import { emitFacts, type Fact, type FactDraft } from "../world/facts";
import { fitStrengthOf } from "../warfare/sea";
import { strangerStrength } from "./glossary";
import { ARMY_REPORT_DAYS, armiesInSight } from "./sight";

/**
 * What a Roman knows of other men's armies.
 *
 * The map drew every army in the world where it stood, and a count built
 * from a week-old report knew the battle fought since. Now an army is known
 * where it can be seen or was lately reported, and a report counts what it saw.
 */

const offices = ScenarioDefinitionSchema.parse(punicWarsScenario.definition).government.offices;
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
const CONSUL = "gaius-genucius";
const CITIZEN = "manius-curius";

let counter = 0;
function report(overrides: Partial<FactDraft>): Fact {
  return emitFacts([{
    time: { day: 0, minute: 0 }, atStep: 0, kind: "sighting", summary: "An army is seen.", affectedEntities: [], resourceChanges: [], authorityChange: undefined,
    visibility: "public", discovery: { state: "public", knowableAtInstant: null, discoveredBy: [] }, evidence: null,
    eligibleReactionScopes: [], sourceEventId: null, sourceActionId: null, causalDepth: 0, ...overrides,
  }], () => `sight-${(counter += 1)}`)[0]!;
}

/** A foreign army nowhere near Rome's ground or any Roman. */
function aFarArmy(state: WorldState): WorldState["material"]["forces"][number] {
  const station = buildStation({ world: state, characterId: CITIZEN, offices });
  const seen = new Set(armiesInSight(state, station, []).map((army) => army.forceId));
  return state.material.forces.find((force) => force.polityId !== "rome" && !seen.has(force.id))!;
}

describe("a count of another power's men", () => {
  it("is what the report saw, not what the army is today", () => {
    const state = world();
    const far = aFarArmy(state);
    const menThen = fitStrengthOf(far);
    const seenThen = report({ affectedEntities: [{ kind: "force", id: far.id }], forcesAsReported: [{ forceId: far.id, men: menThen, locationId: far.locationId }] });
    // A battle since has halved it; the report does not know.
    const halved = { ...far, personnel: far.personnel.map((group) => ({ ...group, fit: Math.floor(group.fit / 2) })) };
    const count = strangerStrength(halved, new Set(), [seenThen], CITIZEN, 3);
    expect(count.source?.channel).toBe("report");
    expect(count.men).not.toBeNull();
    expect(Math.abs(count.men! - menThen)).toBeLessThan(Math.abs(count.men! - fitStrengthOf(halved)));
  });
});

describe("the armies on a Roman's map", () => {
  it("are Rome's own, and whoever is on or beside Roman ground -- not every army in the world", () => {
    const state = world();
    const station = buildStation({ world: state, characterId: CITIZEN, offices });
    const shown = armiesInSight(state, station, []);
    const ids = new Set(shown.map((army) => army.forceId));
    for (const force of state.material.forces.filter((candidate) => candidate.polityId === "rome")) expect(ids.has(force.id)).toBe(true);
    expect(shown.length).toBeLessThan(state.material.forces.length);
  });

  it("shows a far army where the last report put it, for a month", () => {
    const state = world();
    const far = aFarArmy(state);
    const station = buildStation({ world: state, characterId: CITIZEN, offices });
    const reportedAt = state.map.provinces.find((province) => province.id !== far.locationId)!.id;
    const heard = report({ time: { day: state.elapsedStep, minute: 0 }, affectedEntities: [{ kind: "force", id: far.id }], forcesAsReported: [{ forceId: far.id, men: fitStrengthOf(far), locationId: reportedAt }] });
    expect(armiesInSight(state, station, [heard]).find((army) => army.forceId === far.id)?.provinceId).toBe(reportedAt);
    const monthOn = { ...state, elapsedStep: state.elapsedStep + ARMY_REPORT_DAYS + 1, instant: { day: state.elapsedStep + ARMY_REPORT_DAYS + 1, minute: 0 } };
    expect(armiesInSight(monthOn, station, [heard]).some((army) => army.forceId === far.id)).toBe(false);
  });

  it("counts Rome's own men exactly for the consul, and in round figures for a private citizen", () => {
    const state = world();
    const legion = state.material.forces.find((force) => force.polityId === "rome")!;
    const consul = armiesInSight(state, buildStation({ world: state, characterId: CONSUL, offices }), []).find((army) => army.forceId === legion.id)!;
    const citizen = armiesInSight(state, buildStation({ world: state, characterId: CITIZEN, offices }), []).find((army) => army.forceId === legion.id)!;
    expect(consul.strengthLabel).toBe(`${fitStrengthOf(legion).toLocaleString("en-GB")} men`);
    expect(citizen.strengthLabel).toMatch(/^About /);
  });
});
