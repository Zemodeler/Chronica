import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema } from "@chronica/shared";
import { runSimulationBurst } from "./burst";
import type { SimModelPort } from "./ports";

/**
 * A decision card, answered, is told in the engine's own words ("The ruler has
 * answered: Offer battle.") and the part said "Nothing came of it that anyone
 * could see" beside the battle that followed. The answer is the player's
 * choice, taken up by the engine; it is not an order the model failed to carry.
 */
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const ACTOR = "gaius-genucius";
const ANSWER = "Offer battle";

const answer = () => JSON.stringify({
  intent: { summary: ANSWER, domains: ["war"], parts: [{ said: ANSWER, acts: [], factLocalIds: [] }] },
  narrativeSummary: "The consul gave the word.", frictions: [], deltas: [], facts: [],
  delegations: [], schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null,
});

describe("the answer to a decision card", () => {
  it("is not told as an order that came to nothing", async () => {
    const port: SimModelPort = { complete: (operation) => Promise.resolve(operation === "simulate_orchestrate" ? answer() : JSON.stringify({ actors: [] })) };
    const result = await runSimulationBurst({ world: WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), clock: definition.clock, offices: definition.government.offices,
      warfare: definition.warfare, burstId: "card-answer", gameId: "card-answer", actorRef: { kind: "character", id: ACTOR }, actorPolityId: "rome",
      orderText: `The ruler has answered: ${ANSWER}.`, answeredDecision: { prompt: "Fight, hold, or fall back?", label: ANSWER, summary: "Form the line.", optionId: "engagement-offer" },
      knownFacts: [], queue: [], port, narratorSeeds: [], spanDays: 1 });
    expect(result.newFacts.some((fact) => fact.kind === "order_part_unanswered")).toBe(false);
    expect(result.newFacts.some((fact) => /The ruler has answered/.test(fact.summary))).toBe(false);
    expect(result.orderRecordId).toBeNull();
    expect(result.world.orders.some((order) => /The ruler has answered/.test(order.text))).toBe(false);
  });
});
