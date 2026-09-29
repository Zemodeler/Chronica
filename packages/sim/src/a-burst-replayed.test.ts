import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, stableHash, type WorldState } from "@chronica/shared";
import { runSimulationBurst, type BurstInput, type BurstResult } from "./burst";
import type { SimModelPort, SimOperation } from "./ports";

/**
 * The same answers, the same world: a whole burst, replayed.
 *
 * The engine promises that a burst is a pure function of the world it starts
 * from and the model's answers -- that is what makes hand play work at all
 * (`packages/ai/src/adapters/hand.ts` answers each prompt from a file named by
 * its own hash, and a run started again asks every prompt it asked before,
 * word for word). Nothing tested that promise end to end: each stage had its
 * own determinism test, and a burst is where a clock read, a Map iterated in
 * insertion order or a shard applied as it finished would show.
 *
 * So the burst is run once against a scripted model, every answer recorded
 * under the hand adapter's key -- the operation and the prompt's hash -- and
 * run again from the recording alone, with the answers arriving in a
 * different order. The two runs must agree to the byte.
 */

const definition = ScenarioDefinitionSchema.parse(firstPunicWarScenario.definition);
const world = (): WorldState => WorldStateSchema.parse(structuredClone(firstPunicWarScenario.initialWorld));

const ORCHESTRATION = JSON.stringify({
  intent: { summary: "Raise two new legions and send word to Syracuse.", domains: ["military", "diplomacy"] },
  narrativeSummary: "Recruitment opens across Latium, and a letter goes south to Hiero.",
  frictions: [],
  deltas: [
    { op: "money_transfer", fromAccountRef: "marcus-purse", toAccountRef: null, amount: 120, reason: "Levy chests." },
    {
      op: "project_create", localId: "recruitment", kind: "recruitment", label: "Two new legions",
      sponsorRef: { kind: "polity", id: "rome" }, fundingAccountRef: "marcus-purse",
      milestones: [{ label: "First recruits assemble", dueInDays: 20, costAmount: 0 }],
      reason: "Recruitment runs for weeks.",
    },
  ],
  facts: [
    { localId: "mobilization", kind: "military_mobilization", summary: "Rome begins raising two new legions.", affectedRefs: [{ kind: "polity", id: "rome" }, { kind: "polity", id: "carthage" }], visibility: "public", discoveryState: "delayed", knowableInDays: 2, significance: 55 },
  ],
  delegations: [],
  schedule: [{ kind: "recruitment_milestone", dueInDays: 20, summary: "First recruits assemble.", subjectRefs: ["local:recruitment"], causeFactLocalId: "mobilization" }],
  cognitionCandidates: [],
  outcome: "chronicle",
  playerDecision: null,
});

const REACTION = JSON.stringify({
  actors: [{
    actorRef: { kind: "character", id: "hanno" },
    reasoning: "Rome is arming; Sicily must be held.",
    proposal: {
      narrativeSummary: "Carthage strengthens western Sicily.",
      frictions: [],
      deltas: [{ op: "force_modify", forceRef: "carthaginian-army", authorizedStrengthDelta: 800, reason: "An answer to the Roman levy." }],
      facts: [{ localId: "answer", kind: "military_reinforcement", summary: "Carthage reinforces western Sicily.", affectedRefs: [{ kind: "polity", id: "carthage" }], visibility: "private", discoveryState: "private", knowableInDays: 0, significance: 40 }],
      delegations: [],
      schedule: [],
    },
  }],
});

/** The scripted model: the orchestration, one reaction, then nobody with anything to add. */
function scripted(): SimModelPort {
  let reacted = false;
  return {
    complete(operation: SimOperation) {
      if (operation === "simulate_orchestrate") return Promise.resolve(ORCHESTRATION);
      if (operation === "simulate_cognition") {
        const answer = reacted ? JSON.stringify({ actors: [] }) : REACTION;
        reacted = true;
        return Promise.resolve(answer);
      }
      // Rules, repairs and reconciliations answered with nothing usable:
      // deterministic too, and exercises the paths that absorb a bad answer.
      return Promise.resolve("{}");
    },
  };
}

/** The hand adapter's key for a call: its operation and the hash of what was asked. */
const keyOf = (operation: SimOperation, system: string, user: string): string => `${operation}-${stableHash([system, user]).toString(16)}`;

function recording(inner: SimModelPort): SimModelPort & { readonly answers: Map<string, string>; readonly asked: string[] } {
  const answers = new Map<string, string>();
  const asked: string[] = [];
  return {
    answers,
    asked,
    async complete(operation, system, user) {
      const answer = await inner.complete(operation, system, user);
      const key = keyOf(operation, system, user);
      asked.push(key);
      answers.set(key, answer);
      return answer;
    },
  };
}

/** Answers only from the recording, and each one late by a different amount, so they land in another order. */
function replaying(answers: ReadonlyMap<string, string>): SimModelPort & { readonly asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async complete(operation, system, user) {
      const key = keyOf(operation, system, user);
      asked.push(key);
      const answer = answers.get(key);
      if (answer === undefined) throw new Error(`the replay was asked something the recording never was: ${key}`);
      await new Promise((resolve) => setTimeout(resolve, stableHash([key]) % 7));
      return answer;
    },
  };
}

const input = (port: SimModelPort): BurstInput => ({
  world: world(),
  clock: definition.clock,
  offices: definition.government.offices,
  successionRules: definition.government.successionRules,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  life: definition.life,
  wealth: definition.wealth,
  historicalPressures: definition.historicalPressures,
  burstId: "replayed",
  gameId: "game-replayed",
  actorRef: { kind: "character", id: "marcus-atilius" },
  actorPolityId: "rome",
  orderText: "Raise two new legions, and write to Hiero of Syracuse.",
  spanDays: 30,
  knownFacts: [],
  queue: [],
  port,
});

/** Everything a burst hands the caller to commit, as the bytes it would store. */
const committed = (result: BurstResult): Record<string, string> => ({
  world: JSON.stringify(result.world),
  facts: JSON.stringify(result.newFacts),
  rediscovered: JSON.stringify(result.rediscoveredFacts),
  scheduled: JSON.stringify(result.scheduled),
  fired: JSON.stringify(result.firedEventIds),
  audit: JSON.stringify(result.audit),
  significance: JSON.stringify([...result.significanceByFactId]),
  decision: JSON.stringify(result.playerDecision),
  stop: result.stopReason,
});

describe("a burst replayed from its recorded answers", () => {
  it("asks the same things and commits the same world and the same facts, byte for byte", async () => {
    const live = recording(scripted());
    const first = await runSimulationBurst(input(live));
    // Worth replaying only if it did something.
    expect(first.newFacts.length).toBeGreaterThan(0);
    expect(first.world.instant.day).toBeGreaterThan(world().instant.day);
    expect(live.asked.some((key) => key.startsWith("simulate_cognition"))).toBe(true);

    const replay = replaying(live.answers);
    const second = await runSimulationBurst(input(replay));

    expect([...replay.asked].sort()).toEqual([...live.asked].sort());
    expect(committed(second)).toEqual(committed(first));
  });
});
