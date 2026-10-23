import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ROUTINE_NEWS_KINDS, ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, factsKnownTo } from "@chronica/shared";
import { DEFAULT_BUDGET, runSimulationBurst } from "./burst";
import type { SimModelPort } from "./ports";

/**
 * A turn of ninety days wrote a hundred to six hundred facts the player was
 * shown, most of them the calendar of peoples he would never meet: sixty
 * elections called, a hundred terms laid down, Arabian harvests. Only news near
 * him, or touching his charge, his army or his purse, surfaces.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const PLAYER = "gaius-genucius";
/** The most routine calendar facts a ninety-day turn may show a man of Rome: his own city's elections, and nothing of the Boii's. */
const ROUTINE_CAP = 40;

describe("a turn of ninety days", { timeout: 120_000 }, () => {
  it("shows the player the calendar of his own city, and not of every people on the map", async () => {
    const port: SimModelPort = { complete: (operation) => Promise.resolve(operation === "simulate_orchestrate" ? JSON.stringify({ intent: { summary: "Wait.", domains: ["administration"] }, narrativeSummary: "He waits.", deltas: [], facts: [], outcome: "continue" }) : "{}") };
    const world = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
    const result = await runSimulationBurst({
      world, clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare,
      burstId: "flood", gameId: "flood", actorRef: { kind: "character", id: PLAYER }, actorPolityId: "rome",
      orderText: "Wait.", spanDays: 365, knownFacts: [], queue: [], port, narratorSeeds: [], budget: DEFAULT_BUDGET,
    });
    const routine = result.newFacts.filter((fact) => ROUTINE_NEWS_KINDS.has(fact.kind));
    const observer = { kind: "character" as const, id: PLAYER };
    const own = factsKnownTo(routine, observer, "rome", result.world.instant, result.world);
    // His own city's calendar is his: the consuls laying down their office, the elections called at Rome.
    expect(own.some((fact) => fact.kind === "office_term_ended")).toBe(true);
    expect(own.length).toBeLessThanOrEqual(ROUTINE_CAP * 4);
    // And the same facts of a people he has no part in are not shown him.
    const far = result.world.characters.find((person) => person.polityId !== null && person.polityId !== "rome" && person.alive)!;
    const theirs = routine.map((fact) => ({ ...fact, affectedEntities: [{ kind: "character" as const, id: far.id }] }));
    expect(factsKnownTo(theirs, observer, "rome", result.world.instant, result.world)).toEqual([]);
    // Unless he found it out himself.
    const found = theirs.map((fact) => ({ ...fact, discovery: { ...fact.discovery, discoveredBy: [{ observerRef: observer, atInstant: result.world.instant, via: "told" as const }] } }));
    expect(factsKnownTo(found, observer, "rome", result.world.instant, result.world).length).toBeGreaterThan(0);
  });
});
