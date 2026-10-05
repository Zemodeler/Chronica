import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema } from "@chronica/shared";
import { runSimulationBurst } from "./burst";
import { createWindowWriter } from "./chronicle-windows";
import { orderOutcomeLines, withOrderOutcomes } from "./order-outcomes";
import type { SimModelPort, SimOperation } from "./ports";
import { createRequestLedger, meteredPort } from "./request-ledger";

/**
 * Plan item 3: a turn on a spent allowance is still a whole turn.
 *
 * The runner shares one metered port between the burst and the historian
 * (`burst-runner.ts`); this does the same with the same pieces, short of the
 * database, and holds the result to what the player must always get: the
 * order answered, its outcome line told, the historian's share untouched by
 * the world's decisions, and the requests inside the allowance.
 */

const definition = ScenarioDefinitionSchema.parse(firstPunicWarScenario.definition);
const ORDER = JSON.stringify({
  intent: { summary: "Raise a legion.", domains: ["military"], parts: [{ said: "Raise a legion", factLocalIds: ["levy"], whyNot: null }] },
  narrativeSummary: "Recruitment opens across Latium.", frictions: [], deltas: [],
  facts: [{ localId: "levy", kind: "military_mobilization", summary: "Rome begins raising a new legion.", affectedRefs: [{ kind: "polity", id: "rome" }, { kind: "polity", id: "carthage" }], visibility: "public", discoveryState: "delayed", knowableInDays: 1, significance: 55 }],
  delegations: [], schedule: [], cognitionCandidates: [], outcome: "chronicle", playerDecision: null,
});

function raw(asked: SimOperation[]): SimModelPort {
  return {
    complete(operation, _system, user) {
      asked.push(operation);
      if (operation === "simulate_orchestrate") return Promise.resolve(ORDER);
      if (operation === "compose_chronicle") {
        const threads = [...user.matchAll(/^THREAD (\d+)/gm)].map((match) => Number(match[1]));
        return Promise.resolve(JSON.stringify({ entries: threads.map((thread) => ({ thread, title: "Rome Raises a Legion", body: "Rome began to raise a new legion." })) }));
      }
      return Promise.resolve(JSON.stringify({ actors: [] }));
    },
  };
}

describe("a turn on a tight allowance", () => {
  it("answers the order, tells it, and stays inside the allowance", async () => {
    const asked: SimOperation[] = [];
    const ledger = createRequestLedger({ total: 5, reserveForOrder: 1, reserveForChronicle: 3 });
    const port = meteredPort(raw(asked), ledger);
    const writer = createWindowWriter({ port, clock: definition.clock, observer: { kind: "character", id: "marcus-atilius" }, observerPolityId: "rome", offices: definition.government.offices, recentSubjects: [], recentTitles: [] });
    const result = await runSimulationBurst({
      world: WorldStateSchema.parse(structuredClone(firstPunicWarScenario.initialWorld)), clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare,
      burstId: "tight", gameId: "game-tight", actorRef: { kind: "character", id: "marcus-atilius" }, actorPolityId: "rome", orderText: "Raise a legion.",
      spanDays: 30, knownFacts: [], queue: [], port, requests: ledger, onWindowClosed: writer.closed,
    });
    const chronicle = await writer.finish();

    // Inside the allowance, whichever path sent the requests.
    expect(ledger.spent).toBeLessThanOrEqual(5);
    expect(asked.length).toBe(ledger.spent);
    // The order was answered and its outcome is told, whatever the world's own business cost.
    expect(result.orderRecordId).not.toBeNull();
    const lines = orderOutcomeLines(result.world, result.orderRecordId!, definition.clock);
    expect(lines.length).toBeGreaterThan(0);
    const told = withOrderOutcomes(chronicle.entries, lines, result.orderFactIds, result.world.instant.day * 1440);
    expect(told.some((entry) => entry.body.includes("What came of the order:"))).toBe(true);
    // The historian was never starved by the world's decisions.
    expect(asked).toContain("compose_chronicle");
    expect(chronicle.entries.length).toBeGreaterThan(0);
  });
});
