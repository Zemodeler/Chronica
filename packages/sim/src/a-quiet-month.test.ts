import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial } from "@chronica/shared";
import { DEFAULT_BUDGET, runSimulationBurst, type SimulationBudget } from "./burst";
import type { SimModelPort } from "./ports";

/**
 * A month let pass is a month, not its first nine days.
 *
 * The depth cap on reactions counted rounds for the whole burst. Played by
 * hand, a month spent its three rounds between the second and the eighth, and
 * then walked three weeks asking nobody: news written after that -- a
 * garrison let into Messana -- was answered by no one. News after a quiet
 * stretch now starts a chain of its own.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);

/**
 * Every section's first person records something public and means to follow
 * it up in three days, so each round is news for the next and the month is
 * walked in short hops -- the shape that spent the depth early when played.
 */
function busyWorld(days: string[]): SimModelPort {
  return {
    complete(operation, _system, user) {
      if (operation === "simulate_orchestrate") {
        return Promise.resolve(JSON.stringify({ intent: { summary: "Wait.", domains: ["administration"] }, narrativeSummary: "The consul waits.", deltas: [], facts: [], outcome: "continue" }));
      }
      if (operation !== "simulate_cognition") return Promise.resolve("{}");
      days.push(/Today is ([^.]+)\./.exec(user)?.[1] ?? "?");
      const id = /^## [^\n]*\[([^\]]+)\]/m.exec(user)?.[1];
      if (id === undefined) return Promise.resolve(JSON.stringify({ actors: [] }));
      return Promise.resolve(JSON.stringify({ actors: [{
        actorRef: { kind: "character", id }, reasoning: "Busy.",
        proposal: { narrativeSummary: "He acts.", facts: [{ localId: `act_${days.length}`, kind: "politics", summary: `A move by ${id}, the ${days.length}th of the month.`, affectedRefs: [{ kind: "polity", id: "mamertines" }, { kind: "polity", id: "syracuse" }], visibility: "public", discoveryState: "public", significance: 30 }],
          // Something to come back to in three days, as a busy man has: the
          // world walks in short hops, and the depth is spent early.
          schedule: [{ kind: "follow_up", dueInDays: 3, summary: `${id} follows it up.`, significance: 30 }] },
      }] }));
    },
  };
}

async function aMonth(budget: SimulationBudget) {
  const days: string[] = [];
  const result = await runSimulationBurst({
    world: ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0),
    clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare,
    burstId: "quiet", gameId: "game-quiet", actorRef: { kind: "character", id: "gaius-genucius" }, actorPolityId: "rome",
    orderText: "Let the month pass.", spanDays: 30, knownFacts: [], queue: [], port: busyWorld(days), narratorSeeds: [], budget,
  });
  return { days, result };
}

describe("a month let pass", { timeout: 30_000 }, () => {
  it("hears from the world again after a quiet stretch, not only in its first days", async () => {
    const { days, result } = await aMonth(DEFAULT_BUDGET);
    expect(result.stopReason).toBe("max_span");
    expect(days).toContain("31 March 270 BC");
  });

  it("used to go silent once its first cascade was spent", async () => {
    const { days, result } = await aMonth({ ...DEFAULT_BUDGET, newChainAfterDays: 10_000 });
    expect(days).not.toContain("31 March 270 BC");
    // And with nothing left on the calendar, the month ended on its ninth day.
    expect(result.stopReason).toBe("no_due_events");
  });

  it("skips a later chain it cannot pay for, rather than ending the month early", async () => {
    // Eight calls pay for the order and its first chain; the second finds the
    // budget spent, and the month still runs to its end. Seven, before war
    // took ground as occupation: the Campanian legion's patrols now hold the
    // Bruttian country round Rhegium on the first day, and Rome's allies hear
    // of it in the first chain.
    const { result } = await aMonth({ ...DEFAULT_BUDGET, maxModelCalls: 8 });
    expect(result.world.instant.day).toBe(30);
    expect(result.skipped.some((entry) => entry.reason.includes("call budget is spent"))).toBe(true);
  });
});
