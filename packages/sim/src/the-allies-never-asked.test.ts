import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { DEFAULT_BUDGET, runSimulationBurst, type SimulationBudget } from "./burst";
import type { SimModelPort } from "./ports";

/**
 * Silence is a refusal only from somebody who read the letter.
 *
 * Played in the browser: Clepsina asked seven of Rome's allies for ships and
 * men for Messana, answer due in thirty days. The order's own Romans filled
 * three rounds, the depth cap then asked only men with plans, and the burst
 * jumped from 20 May to a project in mid-July. The tick found every letter
 * past its term, and seven allies "refused by silence" letters none of them
 * had been shown -- one of them an ultimatum, so a war opened on it too.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);

/**
 * Who reads each letter. The generated men are looked up by their post, not
 * by id: an id carries a hash of the man's name, and the name pools change.
 */
const opening = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
const byPost = (polityId: string, post: string): string =>
  opening.characters.find((character) => character.id.startsWith(`${polityId}-${post}-`))!.id;
const READERS = [
  ["umbrians", byPost("umbrians", "hipparch")],
  ["picentes", byPost("picentes", "ruler")],
  ["samnites", byPost("samnites", "hipparch")],
  ["lucanians", byPost("lucanians", "hipparch")],
  ["etruscan-cities", byPost("etruscan-cities", "hipparch")],
  ["marsi-paeligni", byPost("marsi-paeligni", "hipparch")],
  ["syracuse", "hieron-ii"],
] as const;
const DUE = 30;

function lettersSent(): WorldState {
  const world = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
  return WorldStateSchema.parse({
    ...world,
    diplomacy: [
      ...world.diplomacy,
      ...READERS.map(([polityId, readerId]) => ({
        id: `aid-${polityId}`,
        kind: polityId === "syracuse" ? "ultimatum" : "military_aid_request",
        fromPolityId: "rome",
        fromCharacterId: "gaius-genucius",
        toPolityId: polityId,
        toCharacterId: readerId,
        subject: polityId === "syracuse" ? "Withdraw pressure from Messana" : "Aid for the defence of Messana",
        terms: "Say what you can furnish, and when.",
        sentAtStep: 0,
        replyDueByStep: DUE,
        ...(polityId === "syracuse" ? { onRefusal: "war" } : {}),
      })),
    ],
  });
}

/** Records who each cognition call was about, and on what day; nobody ever writes anything. */
function listening(asked: Map<string, string>): SimModelPort {
  return {
    complete(operation, _system, user) {
      if (operation === "simulate_orchestrate") {
        return Promise.resolve(JSON.stringify({ intent: { summary: "Wait.", domains: ["administration"] }, narrativeSummary: "The consul waits.", deltas: [], facts: [], outcome: "continue" }));
      }
      if (operation !== "simulate_cognition") return Promise.resolve("{}");
      const day = /Today is ([^.]+)\./.exec(user)?.[1] ?? "?";
      for (const match of user.matchAll(/^## [^\n]*\[([^\]]+)\]/gm)) if (!asked.has(match[1]!)) asked.set(match[1]!, day);
      return Promise.resolve(JSON.stringify({ actors: [] }));
    },
  };
}

function burst(asked: Map<string, string>, budget: SimulationBudget) {
  return runSimulationBurst({
    world: lettersSent(),
    clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare,
    burstId: "allies", gameId: "game-allies", actorRef: { kind: "character", id: "gaius-genucius" }, actorPolityId: "rome",
    orderText: "Wait for the allies' answers.", knownFacts: [],
    // The only thing on the calendar, well past the reply date.
    queue: [{ id: "anio", dueInstantSortKey: 80 * 1440, kind: "project_work", summary: "The Anio works begin.", payload: {} }],
    port: listening(asked), narratorSeeds: [], budget,
  });
}

describe("letters to Rome's allies", { timeout: 60_000 }, () => {
  it("are put to every reader before their term runs out", async () => {
    const asked = new Map<string, string>();
    const result = await burst(asked, DEFAULT_BUDGET);
    for (const [, readerId] of READERS) expect(asked.has(readerId), readerId).toBe(true);
    for (const [polityId] of READERS) {
      expect(result.world.diplomacy.find((message) => message.id === `aid-${polityId}`)?.putToRecipientOnDay).not.toBeNull();
    }
  });

  it("are refused by silence on the day they fall due, not when the calendar next comes round", async () => {
    const result = await burst(new Map(), DEFAULT_BUDGET);
    const silences = result.newFacts.filter((fact) => fact.kind === "diplomatic_silence");
    // One for the allies' call, sent to six of them, and one for the ultimatum.
    expect(silences.length).toBe(2);
    for (const fact of silences) expect(fact.time.day).toBe(DUE);
    for (const [polityId] of READERS) expect(result.world.diplomacy.find((message) => message.id === `aid-${polityId}`)?.answer).toBe("ignored");
  });

  it("wait for the next burst when nobody could be asked", async () => {
    // One call: the order, and nothing left for anybody's answer.
    const result = await burst(new Map(), { ...DEFAULT_BUDGET, maxModelCalls: 1 });
    expect(result.newFacts.some((fact) => fact.kind === "diplomatic_silence" || fact.kind === "war_declared")).toBe(false);
    for (const [polityId] of READERS) {
      expect(result.world.diplomacy.find((message) => message.id === `aid-${polityId}`)?.status).toBe("awaiting_reply");
    }
  });
});

describe("silence to one letter sent to many", () => {
  it("is one refusal naming everybody who kept it, and trust falls with each of them", async () => {
    const { runDeterministicTick } = await import("./tick");
    const { createIdFactory } = await import("./ports");
    const read = lettersSent();
    const world = { ...read, elapsedStep: DUE + 1, diplomacy: read.diplomacy.map((message) => (message.id.startsWith("aid-") ? { ...message, putToRecipientOnDay: 1 } : message)) };
    const ticked = runDeterministicTick({ world, toDay: DUE + 1, ids: createIdFactory("silence"), warfare: definition.warfare });
    const silences = ticked.factProposals.filter((fact) => fact.kind === "diplomatic_silence");
    // The allies' call is one fact; the ultimatum to Syracuse, a different letter, is its own.
    expect(silences).toHaveLength(2);
    const allies = silences.find((fact) => fact.summary.includes("Aid for the defence of Messana"))!;
    expect(allies.summary).toMatch(/^Umbrians, Picentes, Samnites, Lucanians, Etruscan cities and Marsi and Paeligni refused Roman Republic by silence/);
    expect(allies.affectedRefs).toHaveLength(7);
    for (const [polityId] of READERS) {
      expect(ticked.world.polityStances.find((stance) => stance.polityId === "rome" && stance.towardPolityId === polityId)?.lastShiftReason).toContain("ignored");
    }
  });
});
