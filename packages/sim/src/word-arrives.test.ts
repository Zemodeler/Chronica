import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial } from "@chronica/shared";
import { DEFAULT_BUDGET, runSimulationBurst } from "./burst";
import type { SimModelPort } from "./ports";

/**
 * A letter that arrives is a day on the calendar.
 *
 * Played in the browser: on the 3rd, Hieron wrote to Hanno and Hanno to
 * Hieron, each letter five days on the road. The only thing on the calendar
 * was a naval milestone three months off, so the burst jumped straight to it,
 * and on the 30th of May both kings "refused by silence" letters they had
 * never been shown. The world now stops the day word arrives.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);

function lettersOnTheRoad(days: string[]): SimModelPort {
  let rounds = 0;
  return {
    complete(operation, _system, user) {
      if (operation === "simulate_orchestrate") {
        return Promise.resolve(JSON.stringify({ intent: { summary: "Wait.", domains: ["administration"] }, narrativeSummary: "The consul waits.", deltas: [], facts: [], outcome: "continue" }));
      }
      if (operation !== "simulate_cognition") return Promise.resolve("{}");
      days.push(/Today is ([^.]+)\./.exec(user)?.[1] ?? "?");
      rounds += 1;
      const id = /^## [^\n]*\[([^\]]+)\]/m.exec(user)?.[1];
      // Only the first round writes anything: word sent to Carthage, five days on the road.
      if (id === undefined || rounds > 1) return Promise.resolve(JSON.stringify({ actors: [] }));
      return Promise.resolve(JSON.stringify({ actors: [{
        actorRef: { kind: "character", id }, reasoning: "Writes.",
        proposal: { narrativeSummary: "He writes to Carthage.", facts: [{ localId: "word_to_carthage", kind: "diplomatic_message", summary: `${id} sends word to Carthage about Messana.`, affectedRefs: [{ kind: "polity", id: "carthage" }], visibility: "polity", discoveryState: "delayed", knowableInDays: 5, significance: 45 }] },
      }] }));
    },
  };
}

describe("word on the road", { timeout: 30_000 }, () => {
  it("is answered the day it arrives, not when the next thing on the calendar comes round", async () => {
    const days: string[] = [];
    await runSimulationBurst({
      world: ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0),
      clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare,
      burstId: "road", gameId: "game-road", actorRef: { kind: "character", id: "gaius-genucius" }, actorPolityId: "rome",
      orderText: "Start building a fleet.", knownFacts: [],
      // A milestone near the end of the span, and nothing else on the calendar.
      queue: [{ id: "milestone", dueInstantSortKey: 89 * 1440, kind: "project_milestone", summary: "The fleet's timber is gathered.", payload: {} }],
      port: lettersOnTheRoad(days), narratorSeeds: [], budget: DEFAULT_BUDGET,
    });
    expect(days[0]).toBe("3 March 270 BC");
    // Written on the 3rd, five days on the road.
    expect(days).toContain("8 March 270 BC");
  });
});
