import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { DEFAULT_BUDGET, runSimulationBurst, type BurstResult } from "./burst";
import { ensureConstitutions } from "./constitutions";
import { aFarCastMan, circleOf } from "./far-cast-rests";
import { playerInterests } from "./cognition-policy";
import type { SimModelPort, SimOperation } from "./ports";

/**
 * A turn spends few model calls (the user's rule, 2026-10-08: "model calls only for plots or complex plans of people near the player; the
 * count should stay near six a turn"). The playtests measured 13 to 14 a turn, up to 30, most of it cognition for far rulers and rule-writing
 * for far censuses. This lets four seasons pass with a model that answers everybody "nothing to do" and counts what was asked.
 *
 * Measured on this model before the change: nine to ten calls a turn (twenty-two asks of ten men, a far ruler asked four and five times in
 * ninety days), and on the first turn an orchestrate call and two census rule-writes though no order was given. After: about four and a half.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = (): WorldState => ensureConstitutions({ world: ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0), government: definition.government, toDay: 0 });

/** Everybody shown answers that he does nothing; the rule-writer writes nothing. */
function aQuietModel(): SimModelPort & { calls: SimOperation[]; asked: string[] } {
  const calls: SimOperation[] = [];
  const asked: string[] = [];
  return {
    calls, asked,
    complete(operation, _system, user) {
      calls.push(operation);
      if (operation === "simulate_cognition") {
        const people = [...user.matchAll(/^## (.+?) \[([^\]]+)\]/gm)].map((match) => ({ name: match[1]!, id: match[2]! }));
        asked.push(...people.map((person) => person.id));
        return Promise.resolve(JSON.stringify({ actors: people.map((person) => ({ actorRef: { kind: "character", id: person.id }, reasoning: "Nothing needs doing.", proposal: { narrativeSummary: `${person.name} lets it be.`, deltas: [], facts: [] } })) }));
      }
      if (operation === "simulate_orchestrate") return Promise.resolve(JSON.stringify({ intent: { summary: "x", domains: ["administration"] }, narrativeSummary: "x", deltas: [], facts: [], outcome: "continue" }));
      if (operation === "write_mechanic") return Promise.resolve(JSON.stringify({ mechanic: null }));
      if (operation === "reconcile_facts") return Promise.resolve(JSON.stringify({ withdraw: [], rewrite: [] }));
      return Promise.resolve("{}");
    },
  };
}

async function aTurn(world: WorldState, spanDays: number, orderText: string | null, turn: number): Promise<{ result: BurstResult; port: ReturnType<typeof aQuietModel> }> {
  const port = aQuietModel();
  const result = await runSimulationBurst({
    world, clock: definition.clock, offices: definition.government.offices, successionRules: definition.government.successionRules, warfare: definition.warfare,
    terrains: definition.map.terrains, life: definition.life, wealth: definition.wealth, historicalPressures: definition.historicalPressures,
    // Each turn a burst of its own, as in a game: under one name the second turn wrote its money lines under the first one's ids,
    // and the books took them for old lines (`ids.unique`, `money.conserved`).
    burstId: `a-turn-${turn}`, gameId: "a-turn-spends-few-calls", actorRef: { kind: "character", id: "gaius-genucius" }, actorPolityId: "rome",
    orderText, spanDays, knownFacts: [], queue: [], port, budget: DEFAULT_BUDGET,
  });
  return { result, port };
}

describe("a turn spends few calls", { timeout: 300_000 }, () => {
  it("lets four seasons pass on about six calls a turn, with no orchestrator call and no rule written for a far people", async () => {
    let world = opening();
    const perTurn: number[] = [];
    for (let turn = 0; turn < 4; turn += 1) {
      const { result, port } = await aTurn(world, 90, null, turn);
      world = result.world;
      const by = (operation: SimOperation): number => port.calls.filter((call) => call === operation).length;
      perTurn.push(port.calls.length);
      // A far ruler of the wider world's seats is asked at most twice in a season: once, then after his rest.
      const interests = playerInterests(world, "gaius-genucius", definition.government.offices);
      for (const member of world.cast.members) {
        if (!aFarCastMan(world, member, interests, circleOf(world, "gaius-genucius"))) continue;
        expect(port.asked.filter((id) => id === member.characterId).length, `${member.characterId} asked in turn ${turn}`).toBeLessThanOrEqual(2);
      }
      expect(by("simulate_orchestrate")).toBe(0);
      // The consul is the player's colleague, so of his circle (the cast rule of 2026-10-08): the few who deal with the player are asked on their weekly turn, no more than that
      // (a season is thirteen weeks). Before that rule he was asked three times a season among fourteen other men; with those men gone from the rounds the weekly turn is his.
      expect(port.asked.filter((id) => id === "gnaeus-cornelius").length, `the consul in turn ${turn}`).toBeLessThanOrEqual(13);
      // And nobody who is not of the player's dealings is asked at all: the asked are the cast, his circle and the near.
      expect(new Set(port.asked).size, `men asked in turn ${turn}`).toBeLessThanOrEqual(8);
      // The world's own censuses of the Boii and the Britons are candidates; none of them is written up by the model.
      const far = result.audit.filter((row) => row.kind === "mechanic_candidate" && /^(boii|britain|cretan|gaul|hejaz|iberia|thrace|pergamon|illyria|pannonii|garamantes|colchis|galatians|ireland|kush|pontus|rhodes|caucasian|pisidia)/.test(row.actorRef.id));
      for (const row of far) expect(result.skipped.some((skip) => skip.stage === "mechanic" && skip.reason.startsWith(row.reason.split(":")[0]!))).toBe(true);
      expect(by("write_mechanic")).toBeLessThanOrEqual(1);
    }
    const average = perTurn.reduce((sum, calls) => sum + calls, 0) / perTurn.length;
    // 2026-10-08, the cast rule: measured on this model, 2, 6, 8 and 10 calls (6.5 on average) with three men asked in a turn, where the same four seasons before the rule were
    // 2, 8, 9 and 12 (7.75) with fourteen men asked in the last turn, far rulers among them.
    expect(average).toBeLessThanOrEqual(7);
    expect(perTurn[0]).toBeLessThanOrEqual(6);
    expect(Math.max(...perTurn)).toBeLessThanOrEqual(11);
  });
});
