import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, type Office, type WorldState } from "@chronica/shared";
import { runSimulationBurst, type BurstInput, type BurstResult } from "./burst";
import { composeChronicle } from "./chronicle";
import { outcomeOfOrder } from "./order-outcome";
import type { SimModelPort, SimOperation } from "./ports";

/**
 * Whatever a player writes, the record answers it.
 *
 * The Chronicle's guarantee was that an order's own facts are always told. An
 * order with no facts of its own the player could see had nothing to guarantee:
 * a model answer that could not be read, a batch refused entirely over how it
 * was written ("No force exists to be given battle"), or an order whose only
 * result was private to other people. Each of those committed, moved the clock,
 * and left the player reading about everything but what they asked for.
 *
 * And one failure had to stop the turn rather than be absorbed: a player out of
 * coins. It was caught with every other provider error, so the turn committed
 * an empty answer and the handler that would have said "top up" never ran.
 */

const definition = ScenarioDefinitionSchema.parse(firstPunicWarScenario.definition);
const offices: readonly Office[] = definition.government.offices;
const world = (): WorldState => WorldStateSchema.parse(structuredClone(firstPunicWarScenario.initialWorld));

function scripted(script: Partial<Record<SimOperation, (string | Error)[]>>): SimModelPort {
  const remaining = { ...script };
  return {
    complete(operation) {
      const next = remaining[operation]?.shift();
      if (next === undefined) return Promise.reject(new Error(`the script has no further "${operation}" response`));
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
  };
}

function input(port: SimModelPort, orderText: string): BurstInput {
  return {
    world: world(), clock: definition.clock, offices, warfare: definition.warfare, burstId: "b1", gameId: "game-answered",
    actorRef: { kind: "character", id: "marcus-atilius" }, actorPolityId: "rome",
    orderText, knownFacts: [], queue: [], port, narratorSeeds: [],
  };
}

const NOBODY = JSON.stringify({ actors: [] });

/** An answer whose only act names an army nobody raised. */
const ATTACK_A_GHOST = JSON.stringify({
  intent: { summary: "Meet the Macedonians at the Aoos.", domains: ["military"] },
  narrativeSummary: "The legion marches to meet the phalanx.",
  frictions: [],
  deltas: [{ op: "force_engage", forceRef: "legio-i", targetForceRef: "macedonian-army", posture: "offer_battle", tactic: null, reason: "The Aoos." }],
  facts: [], delegations: [], schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null,
});

async function recordOf(result: BurstResult, port: SimModelPort) {
  return composeChronicle({
    port, clock: definition.clock, observer: { kind: "character", id: "marcus-atilius" }, observerPolityId: "rome",
    facts: result.newFacts, from: world().instant, to: result.world.instant,
    narrative: result.narrative, frictions: result.frictions, significanceByFactId: result.significanceByFactId,
    orderFactIds: new Set(result.orderFactIds),
    ownEntityIds: new Set(["rome", "marcus-atilius"]),
  });
}

describe("an order the engine could not carry out", () => {
  it("still reaches the record, saying what was ordered and what stood in the way", async () => {
    const port = scripted({
      simulate_orchestrate: [ATTACK_A_GHOST], repair_deltas: [JSON.stringify({ deltas: [] })],
      simulate_cognition: Array.from({ length: 8 }, () => NOBODY),
    });
    const result = await runSimulationBurst(input(port, "March on the Macedonians at the Aoos and break their phalanx."));

    const answer = result.newFacts.find((fact) => fact.kind === "order_given")!;
    expect(answer.summary).toContain("March on the Macedonians");
    expect(answer.summary).toContain("could not be done");
    expect(result.orderFactIds).toContain(answer.id);

    const record = await recordOf(result, port);
    expect(record.entries.some((entry) => entry.factIds.includes(answer.id))).toBe(true);

    // And scored the way a live run is scored: not carried out, malformed --
    // the engine's failure, not the world's -- and still in the record.
    const outcome = outcomeOfOrder(result, record.entries);
    expect(outcome.carriedOut).toBe(false);
    expect(outcome.malformed.length).toBeGreaterThan(0);
    expect(outcome.answeredOnly).toBe(true);
    expect(outcome.inChronicle).toBe(true);
  });
});

describe("an order every act of which was refused", () => {
  it("still reaches the record when the world's other doings were written beside it", async () => {
    // The embassy the engine refused to send once left no trace: a fire and a
    // quarrel written in the same answer counted as the order being seen.
    const port = scripted({
      simulate_orchestrate: [JSON.stringify({
        intent: { summary: "Meet the Macedonians at the Aoos.", domains: ["military"] },
        narrativeSummary: "The legion marches to meet the phalanx while Rome burns.",
        frictions: [],
        deltas: [{ op: "force_engage", forceRef: "legio-i", targetForceRef: "macedonian-army", posture: "offer_battle", tactic: null, reason: "The Aoos." }],
        facts: [{
          localId: "fire", kind: "fire", summary: "A fire consumes granaries in Latium; Marcus Atilius watches from the Capitol.",
          affectedRefs: [{ kind: "character", id: "marcus-atilius" }], visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 40,
        }],
        delegations: [], schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null,
      })],
      repair_deltas: [JSON.stringify({ deltas: [] })],
      simulate_cognition: Array.from({ length: 8 }, () => NOBODY),
    });
    const result = await runSimulationBurst(input(port, "March on the Macedonians at the Aoos and break their phalanx."));
    const answer = result.newFacts.find((fact) => fact.kind === "order_given")!;
    expect(answer).toBeDefined();
    expect(answer.summary).toContain("March on the Macedonians");
    expect(answer.summary).toContain("could not be done");
  });
});

describe("an order the model could not answer", () => {
  it("is still answered, and says that nothing came back", async () => {
    const port = scripted({
      simulate_orchestrate: ["not json at all", "still not json"],
      simulate_cognition: Array.from({ length: 8 }, () => NOBODY),
    });
    const result = await runSimulationBurst(input(port, "Send envoys to Egypt to find me a wife."));
    const answer = result.newFacts.find((fact) => fact.kind === "order_given")!;
    expect(answer.summary).toContain("nothing came back");
  });
});

describe("an order that did something the player can see", () => {
  it("is not answered twice", async () => {
    const port = scripted({
      simulate_orchestrate: [JSON.stringify({
        intent: { summary: "Address the legion.", domains: ["military"] },
        narrativeSummary: "The consul speaks to the men.",
        frictions: [], deltas: [],
        facts: [{
          localId: "speech", kind: "speech", summary: "Marcus Atilius addressed the legion before the walls.",
          affectedRefs: [{ kind: "character", id: "marcus-atilius" }], visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 30,
        }],
        delegations: [], schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null,
      })],
      simulate_cognition: Array.from({ length: 8 }, () => NOBODY),
    });
    const result = await runSimulationBurst(input(port, "Address the legion."));
    expect(result.newFacts.some((fact) => fact.kind === "order_given")).toBe(false);
  });
});

describe("an order nobody has to obey", () => {
  /** Quintus Fabius, who holds no office, raises an army on a promise. */
  const RAISE_ON_A_PROMISE = JSON.stringify({
    intent: { summary: "Raise the Gauls.", domains: ["military"] },
    narrativeSummary: "Fabius calls the Gauls to his banner.",
    frictions: [],
    deltas: [{
      op: "force_create", localId: "host", name: "The Host of Fabius", polityId: "rome",
      commanderCharacterRef: "quintus-fabius", controllerCharacterRef: "quintus-fabius",
      locationId: world().characters.find((character) => character.id === "quintus-fabius")!.locationProvinceId,
      authorizedStrength: 6_000, reason: "They are promised citizenship.",
    }],
    facts: [{
      localId: "flocked", kind: "muster", summary: "Thousands flocked to the banner of Quintus Fabius.",
      affectedRefs: [{ kind: "force", id: "local:host" }], visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 60,
    }],
    delegations: [], schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null,
  });

  it("does not happen, is told in public with a straight face, and leaves no fact saying it did", async () => {
    const port = scripted({ simulate_orchestrate: [RAISE_ON_A_PROMISE], simulate_cognition: Array.from({ length: 8 }, () => NOBODY) });
    const result = await runSimulationBurst({ ...input(port, "Rally the Gauls to me with a promise of citizenship."), actorRef: { kind: "character", id: "quintus-fabius" } });

    expect(result.world.material.forces.some((force) => force.name === "The Host of Fabius")).toBe(false);
    expect(result.newFacts.some((fact) => fact.summary.includes("flocked"))).toBe(false);
    const scene = result.newFacts.find((fact) => fact.kind === "order_ignored")!;
    expect(scene.visibility).toBe("public");
    expect(scene.summary).toContain("Quintus Fabius");

    const shown: string[] = [];
    const historian: SimModelPort = { complete: (_operation, _system, user) => { shown.push(user); return Promise.reject(new Error("unscripted")); } };
    const record = await composeChronicle({
      port: historian, clock: definition.clock, observer: { kind: "character", id: "quintus-fabius" }, observerPolityId: "rome",
      facts: result.newFacts, from: world().instant, to: result.world.instant,
      narrative: result.narrative, frictions: result.frictions, significanceByFactId: result.significanceByFactId,
      orderFactIds: new Set(result.orderFactIds), ownEntityIds: new Set(["rome", "quintus-fabius"]),
    });
    expect(record.entries.some((entry) => entry.factIds.includes(scene.id))).toBe(true);
    expect(shown.some((message) => message.includes("dry wit"))).toBe(true);
  });
});

describe("a fact about an act the engine refused", () => {
  const SPEND = JSON.stringify({
    intent: { summary: "Pay the shipwrights.", domains: ["finance"] },
    narrativeSummary: "Money leaves the consul's chest for the shipyards.",
    frictions: [],
    deltas: [{ op: "money_transfer", fromAccountRef: "marcus-purse", toAccountRef: "quintus-purse", amount: 120, reason: "The shipwrights want paying." }],
    facts: [
      {
        localId: "paid", kind: "expenditure", summary: "A sum left the consul's chest for the shipyards.",
        affectedRefs: [{ kind: "polity", id: "rome" }], visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 40,
      },
      {
        localId: "visit", kind: "visit", summary: "Quintus Fabius walked the shipyards at Ostia.",
        affectedRefs: [{ kind: "character", id: "quintus-fabius" }], visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 10,
      },
    ],
    delegations: [], schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null,
  });

  it("is taken back by its author, and what did happen stays", async () => {
    const port = scripted({
      simulate_orchestrate: [SPEND],
      reconcile_facts: [JSON.stringify({ withdraw: ["paid"], rewrite: [] })],
      simulate_cognition: Array.from({ length: 8 }, () => NOBODY),
    });
    const result = await runSimulationBurst({ ...input(port, "Pay the shipwrights out of the consul's chest."), actorRef: { kind: "character", id: "quintus-fabius" } });

    expect(result.newFacts.some((fact) => fact.summary.includes("left the consul's chest"))).toBe(false);
    expect(result.newFacts.some((fact) => fact.summary.includes("walked the shipyards"))).toBe(true);
    expect(result.newFacts.some((fact) => fact.kind === "order_ignored")).toBe(true);
  });

  it("keeps what was written when the correction cannot be had, rather than failing the turn", async () => {
    const port = scripted({ simulate_orchestrate: [SPEND], simulate_cognition: Array.from({ length: 8 }, () => NOBODY) });
    const result = await runSimulationBurst({ ...input(port, "Pay the shipwrights."), actorRef: { kind: "character", id: "quintus-fabius" } });
    expect(result.newFacts.some((fact) => fact.summary.includes("walked the shipyards"))).toBe(true);
  });
});

describe("a player out of coins", () => {
  it("ends the turn when the provider itself has no credit left", async () => {
    // A live run spent its last five orders against "429 You have no credits
    // remaining", and committed every one of them as a turn in which nothing
    // came of the order.
    const noCredit = Object.assign(new Error("429 You have no credits remaining. Add credits to continue using the API."), { status: 429 });
    const port = scripted({ simulate_orchestrate: [noCredit] });
    await expect(runSimulationBurst(input(port, "Start a church."))).rejects.toThrow("no credits");
  });

  it("ends the turn instead of committing an empty one", async () => {
    const broke = Object.assign(new Error("Insufficient coins — top up your wallet to continue."), { name: "InsufficientCoinsError" });
    const port = scripted({ simulate_orchestrate: [broke] });
    await expect(runSimulationBurst(input(port, "Raise two legions."))).rejects.toThrow("Insufficient coins");
  });
});
