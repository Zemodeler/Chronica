import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, formatWorldDate, type WorldState } from "@chronica/shared";
import { DEFAULT_BUDGET, callCapFor, runSimulationBurst, type BurstResult, type SimulationBudget } from "./burst";
import { ensureConstitutions } from "./constitutions";
import type { SimModelPort, SimOperation } from "./ports";

/**
 * A month let pass should be a month thought about (L17).
 *
 * The Codex play-test hit the call cap every turn with up to 26 of 29 days
 * nobody was asked about: the order's own chain spent the whole budget in its
 * first few days. Each round's cast cost three calls, every person whose
 * answer named something that did not exist bought a repair and a
 * reconciliation of his own, in series, and the powers' monthly business --
 * the engine's own writing -- bought them too.
 *
 * This walks a month with a model that answers for everybody it is shown and
 * gets one thing wrong in every answer: it addresses a legion that does not
 * exist, and says so in a fact. Every round therefore has something to repair
 * and something to reconcile -- the worst honest case.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = (): WorldState => ensureConstitutions({ world: ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0), government: definition.government, toDay: 0 });

const ORDER = JSON.stringify({
  intent: { summary: "Let the month pass while Rome weighs Messana.", domains: ["administration"] },
  narrativeSummary: "The consul lets the month pass and listens.",
  deltas: [],
  facts: [
    { localId: "debate", kind: "public_debate", summary: "Rome argues in the open over whether to answer the Mamertines' appeal against Carthage.", affectedRefs: [{ kind: "polity", id: "rome" }, { kind: "polity", id: "carthage" }], visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 50 },
  ],
  outcome: "continue",
});

/** Everybody it is shown answers, and addresses a legion that is not there. */
function aClumsyModel(): SimModelPort & { calls: SimOperation[]; cognitionDays: string[] } {
  const calls: SimOperation[] = [];
  const cognitionDays: string[] = [];
  return {
    calls,
    cognitionDays,
    complete(operation, _system, user) {
      calls.push(operation);
      if (operation === "simulate_orchestrate") return Promise.resolve(ORDER);
      if (operation === "simulate_cognition") {
        cognitionDays.push(/Today is ([^.]+)\./.exec(user)?.[1] ?? "?");
        const people = [...user.matchAll(/^## (.+?) \[([^\]]+)\]/gm)].map((match) => ({ name: match[1]!, id: match[2]! }));
        return Promise.resolve(JSON.stringify({
          actors: people.slice(0, 12).map((person) => ({
            actorRef: { kind: "character", id: person.id },
            reasoning: "He stiffens a legion against what is coming.",
            proposal: {
              narrativeSummary: `${person.name} looks to his soldiers.`,
              deltas: [{ op: "force_modify", forceRef: "the-phantom-legion", moraleBpsDelta: 100, reason: "The men are addressed against what is coming." }],
              facts: [{ localId: "addressed", kind: "troops_addressed", summary: `${person.name} addresses the phantom legion.`, affectedRefs: [{ kind: "character", id: person.id }, { kind: "force", id: "the-phantom-legion" }], visibility: "public", discoveryState: "public", knownToRefs: [], knowableInDays: 0, significance: 30 }],
              // Something to come back to in three days, as a busy man has.
              schedule: [{ kind: "follow_up", dueInDays: 3, summary: `${person.name} follows it up.`, significance: 30 }],
            },
          })),
        }));
      }
      if (operation === "repair_deltas") return Promise.resolve(JSON.stringify({ deltas: [] }));
      if (operation === "reconcile_facts") {
        return Promise.resolve(JSON.stringify({ withdraw: [...user.matchAll(/^- ([^:\s]+):/gm)].map((match) => match[1]!), rewrite: [] }));
      }
      return Promise.resolve("{}");
    },
  };
}

async function aMonth(budget: SimulationBudget = DEFAULT_BUDGET): Promise<{ result: BurstResult; port: ReturnType<typeof aClumsyModel>; lastDay: number }> {
  const port = aClumsyModel();
  const world = opening();
  const result = await runSimulationBurst({
    world, clock: definition.clock, offices: definition.government.offices, successionRules: definition.government.successionRules, warfare: definition.warfare,
    terrains: definition.map.terrains, life: definition.life, wealth: definition.wealth, historicalPressures: definition.historicalPressures,
    burstId: "a-month", gameId: "a-month-thought-about", actorRef: { kind: "character", id: "gaius-genucius" }, actorPolityId: "rome",
    orderText: "Let the month pass.", spanDays: 30, knownFacts: [], queue: [], port, narratorSeeds: [], budget: { ...budget, maxMechanicCalls: 0 },
  });
  const dayOf = new Map(Array.from({ length: 40 }, (_, offset) => [formatWorldDate({ ...world.instant, day: world.instant.day + offset }, definition.clock), offset] as const));
  const lastDay = Math.max(0, ...port.cognitionDays.map((date) => dayOf.get(date) ?? 0));
  return { result, port, lastDay };
}

describe("a month thought about", { timeout: 300_000 }, () => {
  it("asks somebody in the month's last week, within the budget, though every answer needs correcting", async () => {
    const { result, port, lastDay } = await aMonth();
    // Measured on this model before the change: twenty calls -- one order, three
    // cognition, eight repairs and eight reconciliations -- every person asked
    // once on the month's second day, and the burst stopped on its fifth with
    // the budget spent. After: seventeen -- one, eight, four, four -- with
    // people asked on the second, fifth, eighth and thirtieth days.
    expect(result.modelCalls).toBeLessThanOrEqual(callCapFor(DEFAULT_BUDGET, 30));
    expect(lastDay).toBeGreaterThanOrEqual(21);
    // One correction and one reconciliation a round at most, never one a person.
    const rounds = new Set(port.cognitionDays).size;
    expect(port.calls.filter((call) => call === "repair_deltas").length).toBeLessThanOrEqual(rounds);
    expect(port.calls.filter((call) => call === "reconcile_facts").length).toBeLessThanOrEqual(rounds);
    // A round of ten is two calls, not three.
    expect(port.calls.filter((call) => call === "simulate_cognition").length).toBeLessThanOrEqual(2 * rounds);
    // What named the legion that is not there is never the event: withdrawn
    // by the round's reconciliation, or -- for the world riding along, which
    // nobody pays to correct -- kept as somebody's report of it.
    const phantom = result.newFacts.filter((fact) => fact.summary.includes("phantom legion"));
    expect(phantom.every((fact) => fact.kind.startsWith("claim_"))).toBe(true);
    // And every skip says why: nobody is asked again with nothing new to answer.
    for (const skip of result.skipped.filter((entry) => entry.stage === "cognition")) expect(skip.reason.length).toBeGreaterThan(10);
    expect(result.skipped.some((entry) => entry.stage === "cognition" && entry.reason.includes("nothing new"))).toBe(true);
  });
});
