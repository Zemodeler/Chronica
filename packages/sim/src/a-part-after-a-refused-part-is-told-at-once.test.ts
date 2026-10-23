import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema } from "@chronica/shared";
import { runSimulationBurst } from "./burst";
import type { SimModelPort } from "./ports";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const ACTOR = "gaius-genucius";
const ORDER = "Declare war on the Campanians. Then lay siege to Rhegium.";

const answer = () => JSON.stringify({
  intent: { summary: ORDER, domains: ["war"], parts: [
    { said: "Declare war on the Campanians", acts: [0] },
    { said: "Then lay siege to Rhegium", acts: [], afterParts: [0], deferredActs: [{ op: "force_modify", forceRef: "roman-field-army", hold: true, reason: "Sit down before Rhegium." }] },
  ] },
  narrativeSummary: "The consul declared war.", frictions: [],
  deltas: [{ op: "agreement_open", localId: "war", kind: "war", polityId: "rome", otherPolityId: "rhegium-campanians", terms: "War.", forDays: null, visibility: "public", reason: "War." }],
  facts: [], delegations: [], schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null,
});

describe("a part held for another part that was refused", () => {
  it("is not left waiting for what will never be done", async () => {
    const port: SimModelPort = { complete: async (operation) => operation === "simulate_orchestrate" ? answer() : JSON.stringify({ actors: [] }) };
    const result = await runSimulationBurst({ world: WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), clock: definition.clock, offices: definition.government.offices,
      warfare: definition.warfare, burstId: "after-refused", gameId: "after-refused", actorRef: { kind: "character", id: ACTOR },
      actorPolityId: "rome", orderText: ORDER, knownFacts: [], queue: [], port, narratorSeeds: [], spanDays: 1 });
    const parts = result.world.orders.find((order) => order.id === result.orderRecordId)!.parts;
    process.stderr.write(`\nPARTS ${JSON.stringify(parts.map((p) => ({ said: p.said, refusal: p.refusal, carried: p.actsCarried, stages: p.stages.map((s) => s.status) })))}\n`);
    expect(parts[0]!.refusal).not.toBeNull();
    expect(parts[1]!.stages.some((stage) => stage.status === "waiting")).toBe(false);
    expect(parts[1]!.refusal).toMatch(/was refused/);
  });
});
