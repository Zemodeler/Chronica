import { describe, expect, it } from "vitest";
import { OrchestratorOutputSchema, type OrchestratorOutput, type WorldState } from "@chronica/shared";
import { DEFAULT_BUDGET, runSimulationBurst } from "./burst";
import { definition, government, opening } from "./fiscal-test-kit";
import { NO_WAY, cameToAPromise, isGivenAsAnOrder, replyFor, whatIsOpenTo, withTheHonestReply } from "./an-order-the-engine-cannot-read";
import type { SimModelPort } from "./ports";

/**
 * An order the engine cannot read gets an honest reply (the user's rule, 2026-10-08): "I do not know how to carry that out: what is open to you is ...", with two or three
 * concrete things drawn from his charge and from the orders the engine does read -- not a promise that the ledger then calls "ordered; no sign of it yet" for ever.
 */

const PLAYER = "gaius-genucius";
let built: WorldState | undefined;
const world = (): WorldState => (built ??= opening(150));
const hints = (): Parameters<typeof whatIsOpenTo>[0] => ({ world: world(), playerId: PLAYER, offices: government.offices, successionRules: government.successionRules, warfare: definition.warfare });

const promise = (said: string): { output: OrchestratorOutput } => ({
  output: OrchestratorOutputSchema.parse({
    intent: { summary: said, domains: ["politics"], parts: [{ said }] }, narrativeSummary: "The consul will see to it, and means to do it properly.",
    deltas: [], facts: [], delegations: [], schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null,
  }),
});

describe("an order the engine cannot read", () => {
  it("is told what is open to the man: two or three things, from his charge and from the orders the engine reads", () => {
    const open = whatIsOpenTo(hints());
    expect(open.length).toBeGreaterThanOrEqual(2);
    expect(open.length).toBeLessThanOrEqual(3);
    expect(open.join(" ")).toMatch(/find supply for|march|build a depot|yours alone|lay before/);
    const reply = replyFor(hints());
    expect(reply.startsWith(`${NO_WAY}: what is open to you is `)).toBe(true);
    expect(reply.length).toBeLessThanOrEqual(300);
    expect(reply).toBe(replyFor(hints()));
  });

  it("replaces the promise the orchestrator wrote with that reply, in the part and in the narrative", () => {
    const answer = withTheHonestReply(promise("Make the Samnites love Rome."), "Make the Samnites love Rome.", hints());
    expect(answer.output.intent.parts).toHaveLength(1);
    expect(answer.output.intent.parts[0]!.whyNot).toMatch(/^I do not know how to carry that out: what is open to you is /);
    expect(answer.output.narrativeSummary).toBe(answer.output.intent.parts[0]!.whyNot);
    // No part written at all: one is made for the order.
    const bare = promise("x");
    const partless = withTheHonestReply({ output: { ...bare.output, intent: { ...bare.output.intent, parts: [] } } }, "Make the Samnites love Rome.", hints());
    expect(partless.output.intent.parts[0]).toMatchObject({ said: "Make the Samnites love Rome.", whyNot: expect.stringContaining(NO_WAY) });
  });

  it("leaves alone what is no command, what the orchestrator did something for, and what it gave a reason for", () => {
    const quiet = promise("I start selling cutlery in Rome.");
    expect(isGivenAsAnOrder("I start selling cutlery in Rome.")).toBe(false);
    expect(isGivenAsAnOrder("Will the Senate give me the army?")).toBe(false);
    expect(withTheHonestReply(quiet, "I start selling cutlery in Rome.", hints())).toBe(quiet);
    expect(withTheHonestReply(quiet, "Will the Senate give me the army?", hints())).toBe(quiet);
    expect(withTheHonestReply(quiet, null, hints())).toBe(quiet);
    const reasoned = { output: OrchestratorOutputSchema.parse({ ...quiet.output, intent: { ...quiet.output.intent, parts: [{ said: "Make the Samnites love Rome.", whyNot: "The Samnites are far off." }] } }) };
    expect(cameToAPromise(reasoned.output)).toBe(false);
    expect(withTheHonestReply(reasoned, "Make the Samnites love Rome.", hints())).toBe(reasoned);
    const acted = { output: OrchestratorOutputSchema.parse({ ...quiet.output, deltas: [{ op: "tax_policy_set", scope: "polity", polityId: "rome", provinceId: null, regime: "land_levy", rateBps: 900, reason: "x" }] }) };
    expect(withTheHonestReply(acted, "Make the Samnites love Rome.", hints())).toBe(acted);
  });

  it("is the reply the player reads in a burst where the orchestrator wrote only a promise, and no pursuit stands for it", async () => {
    const port: SimModelPort = { complete(operation) {
      if (operation === "simulate_cognition") return Promise.resolve('{"actors":[]}');
      return Promise.resolve(JSON.stringify({ intent: { summary: "Make the Samnites love Rome.", domains: ["politics"], parts: [{ said: "Make the Samnites love Rome." }] }, narrativeSummary: "The consul will see to it.", deltas: [], facts: [], delegations: [], schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null }));
    } };
    const ran = await runSimulationBurst({ world: world(), clock: definition.clock, offices: government.offices, warfare: definition.warfare, terrains: definition.map.terrains, successionRules: government.successionRules,
      burstId: "honest", gameId: "honest", actorRef: { kind: "character", id: PLAYER }, actorPolityId: "rome", orderText: "Make the Samnites love Rome.", spanDays: 2, knownFacts: [], queue: [], port, narratorSeeds: [], budget: DEFAULT_BUDGET });
    const order = ran.world.orders.find((candidate) => candidate.text.includes("Samnites love Rome"));
    expect(order).toBeDefined();
    expect(JSON.stringify(order)).toContain(NO_WAY);
    expect(ran.world.genericEntities.some((entity) => entity.kind === "pursuit" && /Samnites love/.test(JSON.stringify(entity)))).toBe(false);
  }, 120_000);
});
