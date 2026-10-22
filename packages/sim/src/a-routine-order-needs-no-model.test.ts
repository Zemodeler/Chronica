import { describe, expect, it } from "vitest";
import { fitStrengthOf, type Force, type WorldState } from "@chronica/shared";
import { DEFAULT_BUDGET, runSimulationBurst } from "./burst";
import { definition, government, withWar } from "./fiscal-test-kit";
import { stockedWorld } from "./grain-test-kit";
import { clausesOf, forcesUnder, matchOrderTemplates, supplyDelegateOf } from "./order-templates";
import type { SimModelPort, SimOperation } from "./ports";

/**
 * A routine order needs no model (the user's rule, 2026-10-08): "Orders from a player should still be automatic: an order like 'find supply for my army' should
 * automatically delegate to other NPCs which in turn use deterministic ways of doing it."
 *
 * The common routine orders are read by rule (`order-templates.ts`); an order of which every clause fits one is answered without the orchestrator; one that is political,
 * conditional, ambiguous or simply not in the table is the orchestrator's, whole.
 */

const PLAYER = "gaius-genucius";
const world = (): WorldState => withWar(stockedWorld(150, 2.2, [], 3_000_000), "rome", "carthage");
const match = (text: string, state = world()) => matchOrderTemplates(state, PLAYER, text, definition.warfare);

describe("a routine order needs no model", () => {
  it("reads the common routine orders: supply, hold, tribute, a public work, a levy", () => {
    const supply = match("Find supply for my army.")!;
    expect(supply.templates).toEqual(["supply"]);
    expect(supply.output.delegations.length + supply.output.deltas.length).toBeGreaterThan(0);
    expect(supply.output.intent.parts).toHaveLength(1);
    expect(match("Feed the legions for two months.")!.templates).toEqual(["supply"]);
    expect(match("Hold the army where it stands.")!.templates).toEqual(["hold"]);
    expect(match("Hold the army where it stands.")!.output.deltas[0]).toMatchObject({ op: "force_modify", hold: true });
    expect(match("Set the tribute at 12 percent.")!.output.deltas[0]).toMatchObject({ op: "tax_policy_set", scope: "polity", polityId: "rome", rateBps: 1_200 });
    const build = match("Build a depot at Latium on the Almo.")!;
    expect(build.templates).toEqual(["build"]);
    expect(build.output.deltas[0]).toMatchObject({ op: "project_create", kind: "depot", completionOutcome: { kind: "structure", structureKind: "depot" } });
    expect(match("Build a road.")!.output.deltas[0]).toMatchObject({ op: "project_create", kind: "road" });
    expect(match("Raise 3000 men.")!.output.deltas[0]).toMatchObject({ op: "force_create", authorizedStrength: 3_000, commanderCharacterRef: PLAYER });
  });

  it("hands the supply to the man who feeds the army, or does it himself where he is that man", () => {
    const state = world();
    const [army] = forcesUnder(state, PLAYER, definition.warfare);
    expect(army).toBeDefined();
    const delegate = supplyDelegateOf(state, army!, PLAYER);
    const match = matchOrderTemplates(state, PLAYER, "Find supply for my army for 60 days.", definition.warfare)!;
    if (delegate === null) {
      // He is the only man there is: the bread is his own act, by the plan.
      expect(match.output.deltas.some((delta) => delta.op === "force_provision")).toBe(true);
      expect(match.output.delegations).toHaveLength(0);
    } else {
      expect(match.output.delegations).toHaveLength(1);
      expect(match.output.delegations[0]).toMatchObject({ recipientRef: { id: delegate.id }, part: 0, ask: { kind: "supply", ref: army!.id, amount: 60 } });
      expect(match.output.deltas.some((delta) => delta.op === "force_provision")).toBe(false);
    }
  });

  it("leaves to the orchestrator what is political, conditional, ambiguous or not in the table", () => {
    for (const text of [
      "Make peace with Carthage.",
      "If Carthage lands in Sicily, feed the army and march.",
      "Find supply for the army, but only until the Senate votes.",
      "Write to Hiero of Syracuse.",
      "Find supply for the people of Rome.",
      "Raise 3000 men and feed them.",
      "Find supply for my army. Then conquer Sicily.",
      "Set the tribute high.",
      // A letter about grain and an army is a letter, not the bread of one's own garrison.
      "Write to the consul: we will sell grain to the Roman army, and ask Rome's friendship in return.",
      "",
    ]) expect(match(text), text).toBeNull();
    expect(clausesOf("Hold the army. Find supply for it.")).toHaveLength(2);
  });

  it("will not guess which army when he has two and names none, and takes the one he names", () => {
    const state = world();
    const [army] = forcesUnder(state, PLAYER, definition.warfare);
    const second: Force = { ...army!, id: "second-army", name: "The Army of the Liris", locationId: army!.locationId };
    const two: WorldState = { ...state, material: { ...state.material, forces: [...state.material.forces, second] } };
    expect(match("Find supply for my army.", two)).toBeNull();
    const named = match("Find supply for the Army of the Liris.", two)!;
    expect(JSON.stringify(named.output)).toContain("second-army");
  });

  it("is the same every time", () => {
    expect(JSON.stringify(match("Find supply for my army for 45 days."))).toBe(JSON.stringify(match("Find supply for my army for 45 days.")));
  });

  it("is answered without the orchestrator in a burst: no call for a matched order, one for any other", async () => {
    const calls: SimOperation[] = [];
    const port: SimModelPort = { complete(operation) {
      calls.push(operation);
      if (operation === "simulate_cognition") return Promise.resolve('{"actors":[]}');
      return Promise.resolve(JSON.stringify({ intent: { summary: "Wait", domains: ["administration"] }, narrativeSummary: "Time passes.", deltas: [], facts: [], delegations: [], schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null }));
    } };
    const run = (orderText: string) => runSimulationBurst({ world: world(), clock: definition.clock, offices: government.offices, warfare: definition.warfare, terrains: definition.map.terrains,
      burstId: "template", gameId: "template", actorRef: { kind: "character", id: PLAYER }, actorPolityId: "rome", orderText, spanDays: 2, knownFacts: [], queue: [], port, narratorSeeds: [], budget: DEFAULT_BUDGET });
    const matched = await run("Find supply for my army for 30 days.");
    expect(calls.filter((call) => call === "simulate_orchestrate")).toHaveLength(0);
    expect(matched.modelCalls).toBeLessThanOrEqual(calls.length);
    // The bread was found: the army has days in hand it did not have, or bread is on the road, and the order's part is in the ledger.
    const [before] = forcesUnder(world(), PLAYER, definition.warfare);
    const after = matched.world.material.forces.find((force) => force.id === before!.id)!;
    expect(after.provisionedThroughStep > before!.provisionedThroughStep || matched.world.convoys.some((convoy) => convoy.forceId === before!.id) || matched.world.orderAttempts.length > 0).toBe(true);
    expect(matched.world.orders.some((order) => order.text.includes("Find supply for my army"))).toBe(true);
    expect(fitStrengthOf(after)).toBeGreaterThan(0);
    calls.length = 0;
    await run("Make peace with Carthage.");
    expect(calls.filter((call) => call === "simulate_orchestrate")).toHaveLength(1);
  }, 120_000);
});
