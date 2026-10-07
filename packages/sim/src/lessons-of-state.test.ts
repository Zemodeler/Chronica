import { beforeAll, describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { NEUTRAL_MIND, ScenarioDefinitionSchema, WorldStateSchema, ageNudge, ageSusceptibility, driftMind, ensureProvinceMaterial, readDepartments, type WorldState } from "@chronica/shared";
import { DEFAULT_BUDGET, runSimulationBurst } from "./burst";
import { lessonsOfBreach, teachRulers } from "./state-lessons";
import type { SimModelPort } from "./ports";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const silent: SimModelPort = {
  complete(operation) {
    if (operation === "simulate_orchestrate") return Promise.resolve(JSON.stringify({ intent: { summary: "Wait.", domains: ["administration"] }, narrativeSummary: "w", deltas: [], facts: [], outcome: "continue" }));
    if (operation === "simulate_cognition") return Promise.resolve(JSON.stringify({ actors: [] }));
    return Promise.resolve("{}");
  },
};

describe("the years change people, each in their own way", () => {
  const people = Array.from({ length: 300 }, (_, i) => `person-${i}`);

  it("is not a rule that the old turn timid: between fifty and seventy some grow less bold, some do not change, some grow bolder", () => {
    const shifts = people.map((id) => ageNudge(id, 50, 70).boldness ?? 0);
    expect(shifts.some((shift) => shift < 0)).toBe(true);
    expect(shifts.some((shift) => shift === 0)).toBe(true);
    expect(shifts.some((shift) => shift > 0)).toBe(true);
    // Most still mellow a little, and a good share are untouched: the shape of ageing, not a law of it.
    expect(shifts.filter((shift) => shift < 0).length).toBeGreaterThan(people.length * 0.3);
    expect(shifts.filter((shift) => shift === 0).length).toBeGreaterThan(people.length * 0.15);
  });

  it("gives each person their own response to each part of themselves, fixed for life", () => {
    expect(ageSusceptibility("person-1", "boldness")).toBe(ageSusceptibility("person-1", "boldness"));
    const feels = people.map((id) => ageSusceptibility(id, "boldness"));
    expect(new Set(feels.map((feel) => feel.toFixed(2))).size).toBeGreaterThan(100);
    expect(feels.some((feel) => feel === 0)).toBe(true);
    expect(feels.some((feel) => feel < 0)).toBe(true);
    // And one part of a person is not the same as another.
    expect(people.some((id) => ageSusceptibility(id, "boldness") !== ageSusceptibility(id, "duty"))).toBe(true);
  });

  it("is the same however the years are cut up, so stepping the clock finely or coarsely makes the same man", () => {
    for (const id of people.slice(0, 40)) {
      const whole = ageNudge(id, 40, 66);
      const parts = [ageNudge(id, 40, 47), ageNudge(id, 47, 55), ageNudge(id, 55, 66)];
      for (const part of new Set([...Object.keys(whole), ...parts.flatMap((nudge) => Object.keys(nudge))])) {
        expect(parts.reduce((sum, nudge) => sum + ((nudge as Record<string, number>)[part] ?? 0), 0)).toBe((whole as Record<string, number>)[part] ?? 0);
      }
    }
  });

  it("moves nobody by more than a review's limit at once", () => {
    for (const id of people.slice(0, 40)) {
      const aged = driftMind(NEUTRAL_MIND, [], [], ageNudge(id, 45, 85));
      for (const value of Object.values(aged.mind.temperament)) expect(Math.abs(value - 50)).toBeLessThanOrEqual(6);
    }
  });
});

describe("what a state's life teaches the man who rules it", () => {
  it("makes winning a war and losing one move a mind in opposite directions", () => {
    const won = driftMind(NEUTRAL_MIND, [], [{ kind: "war_won", atStep: 1 }]).mind;
    const lost = driftMind(NEUTRAL_MIND, [], [{ kind: "war_lost", atStep: 1 }]).mind;
    expect(won.temperament.boldness).toBeGreaterThan(lost.temperament.boldness);
    expect(won.riskTolerance).toBeGreaterThan(lost.riskTolerance);
    expect(lost.temperament.caution).toBeGreaterThan(won.temperament.caution);
  });

  it("makes sacking a city greedier and crueller, a lost city more fearful and vengeful, a broken oath less honest", () => {
    const sacked = driftMind(NEUTRAL_MIND, [], [{ kind: "sacked_a_city", atStep: 1 }]).mind;
    expect(sacked.drives.wealth).toBeGreaterThan(50);
    expect(sacked.temperament.cruelty).toBeGreaterThan(50);
    const lostCity = driftMind(NEUTRAL_MIND, [], [{ kind: "city_lost", atStep: 1 }]).mind;
    expect(lostCity.drives.security).toBeGreaterThan(50);
    expect(lostCity.drives.revenge).toBeGreaterThan(50);
    const forsworn = driftMind(NEUTRAL_MIND, [], [{ kind: "oath_broken", atStep: 1 }]).mind;
    expect(forsworn.temperament.honesty).toBeLessThan(50);
    expect(forsworn.drives.duty).toBeLessThan(50);
  });

  it("grows a ruler who has held his throne for years steadier and more attached to it", () => {
    const reign = driftMind(NEUTRAL_MIND, [], Array.from({ length: 4 }, (_, i) => ({ kind: "ruled_long" as const, atStep: i })));
    expect(reign.mind.drives.security).toBeGreaterThan(50);
    expect(reign.mind.temperament.boldness).toBeLessThan(50);
  });

  describe("on a real world", () => {
    let world: WorldState;
    beforeAll(async () => {
      const result = await runSimulationBurst({
        world: ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0),
        clock: definition.clock, offices: definition.government.offices, successionRules: definition.government.successionRules, warfare: definition.warfare,
        terrains: definition.map.terrains, life: definition.life, wealth: definition.wealth, historicalPressures: definition.historicalPressures,
        burstId: "seed", gameId: "lessons-of-state", actorRef: { kind: "character", id: "gaius-genucius" }, actorPolityId: "rome",
        orderText: null, spanDays: 30, knownFacts: [], queue: [], port: silent, narratorSeeds: [], budget: DEFAULT_BUDGET,
      });
      world = result.world;
    }, 300_000);

    it("writes a broken treaty on both rulers: the oath-breaker's lesson and the victim's", () => {
      const rulers = readDepartments(world);
      const [breaker, victim] = world.map.polities.filter((polity) => rulers.rulers(polity.id).some((ruler) => ruler.alive)).slice(1, 3);
      expect(breaker).toBeDefined();
      const after = lessonsOfBreach(world, breaker!.id, victim!.id, 100);
      const lessons = (polityId: string) => readDepartments(after).rulers(polityId).flatMap((ruler) => ruler.lessons ?? []).map((lesson) => lesson.kind);
      expect(lessons(breaker!.id)).toContain("oath_broken");
      expect(lessons(victim!.id)).toContain("betrayed");
    });

    it("teaches every living ruler of a power, and no one else", () => {
      const rulers = readDepartments(world);
      const target = world.map.polities.find((polity) => rulers.rulers(polity.id).some((ruler) => ruler.alive))!;
      const after = teachRulers(world, target.id, "war_won", 5);
      const taught = after.characters.filter((character) => (character.lessons ?? []).some((lesson) => lesson.kind === "war_won" && lesson.atStep === 5));
      expect(taught.map((character) => character.id).sort()).toEqual(rulers.rulers(target.id).filter((ruler) => ruler.alive).map((ruler) => ruler.id).sort());
    });
  });
});
