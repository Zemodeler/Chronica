import { describe, expect, it } from "vitest";
import { type PoliticalProcedure, type WorldState } from "@chronica/shared";
import { DECREE_AFTER_DAYS, DECREE_LAPSES_DAYS, carriedMotionsAreDone, markerOfDecree } from "./decrees-by-rule";
import { readDecree } from "./decree-reader";
import { rateOf } from "./fiscal-test-kit";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";
import { atWar, definition, romeAndCarthageAlone } from "./war-plan-kit";

/**
 * A carried motion becomes an act (the user's decision, 2026-10-08: "carried Senate motions become acts by rule: yes").
 *
 * A question the Senate has carried that names a concrete act -- a fleet built, an army sent to a place, men levied, the tribute laid at a rate, peace sought of Carthage --
 * is done the month after by the man who put it, through the deltas the engine already has, as the decree of the hulls is. A question whose words name no act, or two, stays
 * "a resolution of the Senate, no one is charged with it". Once, never twice, and told either way.
 */

const DAY = 260;
const offices = definition.government.offices;
const base = (): WorldState => {
  const world = romeAndCarthageAlone(atWar(120));
  return { ...world, instant: { ...world.instant, day: DAY }, elapsedStep: DAY };
};
let built: WorldState | undefined;
const world = (): WorldState => (built ??= base());
const consul = (state: WorldState): string => state.characters.find((character) => character.polityId === "rome" && character.alive && state.material.officeSeats.some((seat) => seat.holderCharacterId === character.id && /consul/.test(seat.officeId)))!.id;

/** The Senate has carried a question, so many days ago. */
function carried(state: WorldState, label: string, daysAgo = DECREE_AFTER_DAYS + 5, id = "motion-x"): WorldState {
  const procedure = {
    id, type: "law_proposal", institutionId: "roman-senate", sponsorCharacterId: consul(state), subjectKind: "polity", subjectId: "rome", label: `Motion of the consul: ${label}`,
    eligibilityRequirementIds: [], eligibleParticipantIds: [], stage: "resolved", resolutionMechanism: "vote", openedAtStep: DAY - daysAgo - 12, deadlineStep: DAY - daysAgo, resolvedAtStep: DAY - daysAgo,
    visibility: "polity", voteRecordId: null, outcome: "passed", outcomeReason: "The Senate carried it.", sourceEventIds: [], resultingEventIds: [], concerns: [],
  } as unknown as PoliticalProcedure;
  return { ...state, material: { ...state.material, politicalProcedures: [...state.material.politicalProcedures, procedure] } };
}
const run = (state: WorldState, toDay = DAY) => carriedMotionsAreDone({ world: state, toDay, offices, ids: createIdFactory("decree"), playerCharacterId: null, rules: { warfare: definition.warfare, gameId: "decree", successionRules: definition.government.successionRules } });
const marked = (state: WorldState, id = "motion-x"): boolean => state.genericEntities.some((entity) => entity.kind === "decree" && entity.label === markerOfDecree(id));

describe("a carried motion becomes an act", () => {
  it("builds the fleet a carried question asked for, and tells it", () => {
    const done = run(carried(world(), "that a fleet of eighty ships be built"));
    expect(done.world.projects.some((project) => project.kind === "shipbuilding" && project.status !== "cancelled")).toBe(true);
    expect(done.facts.map((fact) => fact.kind)).toEqual(["decree_carried_out"]);
    expect(done.facts[0]!.summary).toMatch(/carried out what the .* resolved: \d+ hulls are laid down/);
    expect(marked(done.world)).toBe(true);
  });

  it("levies the men, lays the tribute, sends the army and gives a man the army, as the words say", () => {
    const state = world();
    const levy = run(carried(state, "that three thousand men be levied")).world;
    expect(levy.material.forces.some((force) => /^Levy of /.test(force.name) && force.authorizedStrength === 3_000)).toBe(true);
    const tribute = run(carried(state, "that the tribute be set at 11 percent")).world;
    expect(rateOf(tribute, "rome")).toBe(1_100);
    const army = state.material.forces.filter((force) => force.polityId === "rome" && force.outlaw !== true).sort((a, b) => b.authorizedStrength - a.authorizedStrength)[0]!;
    const there = state.map.provinces.find((province) => province.id !== army.locationId && province.name.length >= 5 && state.map.provinces.filter((other) => other.name === province.name).length === 1)!;
    const sent = readDecree(carried(state, `that the army be sent to ${there.name}`), { label: `that the army be sent to ${there.name}`, institutionId: "roman-senate" }, definition.warfare);
    expect(sent).toMatchObject({ kind: "march", provinceId: expect.any(String) as unknown });
    const marched = run(carried(state, `that the army be sent to ${there.name}`)).world;
    const after = marched.material.forces.find((force) => force.id === army.id)!;
    expect(after.locationId !== army.locationId || marched.projects.some((project) => project.completionOutcome?.kind === "force_move" && project.completionOutcome.forceId === army.id)).toBe(true);
  });

  it("sends an offer of peace to the power it names, which that power answers as it does every letter", () => {
    const done = run(carried(world(), "that peace be made with Carthage"));
    expect(done.world.diplomacy.some((message) => message.kind === "peace_offer" && message.fromPolityId === "rome" && message.toPolityId === "carthage")).toBe(true);
    expect(done.facts[0]!.summary).toMatch(/an offer of peace goes to Carthage/);
  });

  it("waits the month, does it once, and lets a stale one lapse", () => {
    const early = carried(world(), "that the tribute be set at 11 percent", DECREE_AFTER_DAYS - 10);
    expect(run(early).facts).toEqual([]);
    const once = run(carried(world(), "that the tribute be set at 11 percent"));
    expect(once.facts).toHaveLength(1);
    expect(run(once.world).facts).toEqual([]);
    expect(run(carried(world(), "that the tribute be set at 11 percent", DECREE_LAPSES_DAYS + 5)).facts).toEqual([]);
  });

  it("leaves a resolution that names no act, or two, as the Senate's own and nobody's charge", () => {
    for (const label of ["that the Senate holds the consul in high esteem", "that three thousand men be levied and a fleet be built", "that peace be made with Carthage and the tribute be set at 9 percent"]) {
      const state = carried(world(), label);
      expect(readDecree(state, { label, institutionId: "roman-senate" }, definition.warfare), label).toBeNull();
      const done = run(state);
      expect(done.facts, label).toEqual([]);
      expect(marked(done.world), label).toBe(false);
    }
  });

  it("is done in the monthly tick the month after, with no model", () => {
    const state = carried(world(), "that the tribute be set at 11 percent", 20);
    const ticked = runDeterministicTick({ world: { ...state, elapsedStep: DAY }, toDay: DAY, ids: createIdFactory("tick-decree"), warfare: definition.warfare, government: definition.government });
    expect(rateOf(ticked.world, "rome")).toBe(1_100);
    expect(marked(ticked.world)).toBe(true);
  }, 120_000);
});
