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
  it("is answered when it calls for a decision or the world has been quiet, not on every day it arrives", async () => {
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
    // Rounds are paid for by events: other powers' letters on the road are not news of weight, so they are
    // answered when the world has been quiet for `newChainAfterDays`, not on the day they arrive (8th, 12th).
    expect(days).not.toContain("8 March 270 BC");
    expect(days.some((day) => /^(1[3-9]|2d) March/.test(day))).toBe(true);
  });
});

describe("a turn that has spent its time", () => {
  it("finishes the span on the engine alone, asking nobody after the first round", async () => {
    const days: string[] = [];
    let spent = false;
    const port = lettersOnTheRoad(days);
    const result = await runSimulationBurst({
      world: ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0),
      clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare,
      burstId: "rushed", gameId: "game-rushed", actorRef: { kind: "character", id: "gaius-genucius" }, actorPolityId: "rome",
      orderText: "Let the month pass.", spanDays: 30, knownFacts: [], queue: [],
      port: { complete: async (...args) => { const answer = await port.complete(...args); if (args[0] === "simulate_cognition") spent = true; return answer; } },
      outOfTime: () => spent, narratorSeeds: [], budget: DEFAULT_BUDGET,
    });
    // The first round was asked (3 March) and no other: the days after it passed with nobody asked.
    expect([...new Set(days)]).toEqual(["3 March 270 BC"]);
    expect(result.world.instant.day).toBe(30);
    expect(result.skipped.some((entry) => entry.reason.includes("time is spent"))).toBe(true);
  });
});

describe("the order being read", () => {
  it("does not hold up the world's own people, who are asked while it is still being read", async () => {
    let cognitionStarted = false;
    let releaseOrder: () => void = () => undefined;
    const seen = new Promise<void>((resolve) => { releaseOrder = resolve; });
    const ordered: boolean[] = [];
    const port: SimModelPort = {
      async complete(operation) {
        if (operation === "simulate_orchestrate") {
          // The order is not answered until somebody else has been asked: only an early question lets this return.
          await Promise.race([seen, new Promise((resolve) => setTimeout(resolve, 3_000))]);
          ordered.push(cognitionStarted);
          return JSON.stringify({ intent: { summary: "Wait.", domains: ["administration"] }, narrativeSummary: "The consul waits.", deltas: [], facts: [], outcome: "continue" });
        }
        if (operation === "simulate_cognition") { cognitionStarted = true; releaseOrder(); return JSON.stringify({ actors: [] }); }
        return "{}";
      },
    };
    await runSimulationBurst({
      world: ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0),
      clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare,
      burstId: "early", gameId: "game-early", actorRef: { kind: "character", id: "gaius-genucius" }, actorPolityId: "rome",
      orderText: "Start building a fleet.", spanDays: 7, knownFacts: [], queue: [], port, narratorSeeds: [], budget: DEFAULT_BUDGET, prefetch: true,
    });
    expect(ordered).toEqual([true]);
  });
});
