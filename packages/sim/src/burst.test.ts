import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, factsVisibleTo, type Office, type ScenarioClock, type WorldState } from "@chronica/shared";
import { runSimulationBurst, type BurstInput } from "./burst";
import type { SimModelPort, SimOperation } from "./ports";

const definition = ScenarioDefinitionSchema.parse(firstPunicWarScenario.definition);
const offices: readonly Office[] = definition.government.offices;
const clock: ScenarioClock = definition.clock;
const world = (): WorldState => WorldStateSchema.parse(structuredClone(firstPunicWarScenario.initialWorld));

/**
 * A scripted stand-in for the model. Every burst test drives this rather than a
 * live adapter: the loop's behaviour must be reproducible, and a test that can
 * disagree with itself run-to-run is worth nothing as a regression guard.
 */
function scriptedPort(script: Partial<Record<SimOperation, string[]>>): SimModelPort & { calls: SimOperation[] } {
  const remaining: Partial<Record<SimOperation, string[]>> = structuredClone(script);
  const calls: SimOperation[] = [];
  return {
    calls,
    complete(operation) {
      calls.push(operation);
      const queue = remaining[operation];
      const next = queue?.shift();
      if (next === undefined) return Promise.reject(new Error(`the script has no further "${operation}" response`));
      return Promise.resolve(next);
    },
  };
}

const RAISE_TWO_LEGIONS = JSON.stringify({
  intent: { summary: "Increase Roman field strength by two legions.", domains: ["military", "finance"] },
  narrativeSummary: "Recruitment opens across Latium and Campania, paid for from the treasury and short-term merchant credit.",
  frictions: ["Treasury reserves cover only part of the cost; the remainder is borrowed."],
  deltas: [
    { op: "money_transfer", fromAccountRef: "marcus-purse", toAccountRef: null, amount: 220, reason: "Levy chests and equipment contracts." },
    {
      op: "character_create",
      localId: "quaestor",
      name: "Marcus Fabius Varro",
      polityId: "rome",
      provinceId: null,
      age: 38,
      officeLabel: "Military Quaestor",
      traits: ["methodical", "politically cautious"],
      generatedBecause: "Responsible for financing the current mobilization.",
    },
    {
      op: "project_create",
      localId: "recruitment",
      kind: "recruitment",
      label: "Two new legions",
      sponsorRef: { kind: "polity", id: "rome" },
      fundingAccountRef: "marcus-purse",
      milestones: [
        { label: "Financing committed", dueInDays: 9, costAmount: 0 },
        { label: "First recruits assemble", dueInDays: 60, costAmount: 0 },
      ],
      reason: "Recruitment runs for months, so it persists as a project.",
    },
    { op: "obligation_upsert", obligationRef: null, localId: "upkeep", kind: "army_upkeep", label: "Pay for two new legions", payerAccountRef: "marcus-purse", recipientAccountRef: null, amount: 31, cadenceDays: 30, priority: 500, active: true, reason: "The new legions must be paid." },
  ],
  facts: [
    { localId: "mobilization", kind: "military_mobilization", summary: "Rome begins raising two new legions in Latium and Campania.", affectedRefs: [{ kind: "polity", id: "rome" }, { kind: "polity", id: "carthage" }], visibility: "public", discoveryState: "delayed", knowableInDays: 1, significance: 55 },
    { localId: "borrowing", kind: "state_borrowing", summary: "The mobilization is part-funded by credit from Roman merchants on unusual terms.", affectedRefs: [{ kind: "character", id: "quintus-fabius" }], visibility: "private", discoveryState: "private", knowableInDays: 0, significance: 20 },
  ],
  delegations: [
    { localId: "financing", issuerRef: { kind: "character", id: "marcus-atilius" }, recipientRef: { kind: "character", id: "quintus-fabius" }, claimedAuthorityGrantRef: null, instruction: "Find the money for two new legions." },
  ],
  schedule: [
    { kind: "recruitment_milestone", dueInDays: 60, summary: "First recruits assemble.", subjectRefs: ["local:recruitment"], causeFactLocalId: "mobilization" },
  ],
  cognitionCandidates: [],
  outcome: "chronicle",
  playerDecision: null,
});

const CARTHAGE_REACTS = JSON.stringify({
  actors: [
    {
      actorRef: { kind: "character", id: "hanno" },
      reasoning: "Roman recruitment on this scale cannot be ignored; Sicily must be quietly strengthened.",
      proposal: {
        narrativeSummary: "Carthage quietly reinforces its position in western Sicily.",
        frictions: [],
        deltas: [{ op: "force_modify", forceRef: "carthaginian-army", authorizedStrengthDelta: 1500, reason: "Quiet reinforcement in answer to Roman mobilization." }],
        facts: [
          { localId: "reinforcement", kind: "military_reinforcement", summary: "Carthage secretly reinforces western Sicily.", affectedRefs: [{ kind: "polity", id: "carthage" }], visibility: "private", discoveryState: "private", knowableInDays: 0, significance: 40 },
        ],
        delegations: [],
        schedule: [],
      },
    },
  ],
});

function input(port: SimModelPort, overrides: Partial<BurstInput> = {}): BurstInput {
  return {
    world: world(),
    clock,
    offices,
    burstId: "b1",
    gameId: "game-1",
    actorRef: { kind: "character", id: "marcus-atilius" },
    actorPolityId: "rome",
    orderText: "Raise two new legions.",
    knownFacts: [],
    dueEvents: [],
    pendingEvents: [],
    port,
    ...overrides,
  };
}

describe("a burst answering \"Raise two new legions\"", () => {
  it("turns one short order into money spent, a person created, a project, an obligation and scheduled milestones", async () => {
    const port = scriptedPort({ simulate_orchestrate: [RAISE_TWO_LEGIONS], simulate_cognition: [CARTHAGE_REACTS] });
    const result = await runSimulationBurst(input(port));

    expect(result.world.material.accounts.find((a) => a.id === "marcus-purse")!.balance).toBe(980);
    expect(result.world.characters.some((c) => c.name === "Marcus Fabius Varro")).toBe(true);
    expect(result.world.projects).toHaveLength(1);
    expect(result.world.projects[0]!.milestones).toHaveLength(2);
    expect(result.world.material.obligations.some((o) => o.label === "Pay for two new legions")).toBe(true);
    expect(result.scheduled.some((event) => event.kind === "recruitment_milestone")).toBe(true);
    expect(result.outcome).toBe("chronicle");
  });

  it("records the delegation as an order its recipient still has to answer", async () => {
    const port = scriptedPort({ simulate_orchestrate: [RAISE_TWO_LEGIONS], simulate_cognition: [CARTHAGE_REACTS] });
    const result = await runSimulationBurst(input(port));

    const attempt = result.world.orderAttempts.find((candidate) => candidate.recipientRef.id === "quintus-fabius");
    expect(attempt).toBeDefined();
    expect(attempt!.status).toBe("issued");
  });

  it("carries the order's friction through to the record rather than swallowing it", async () => {
    const port = scriptedPort({ simulate_orchestrate: [RAISE_TWO_LEGIONS], simulate_cognition: [CARTHAGE_REACTS] });
    const result = await runSimulationBurst(input(port));
    expect(result.frictions.join(" ")).toContain("Treasury reserves cover only part");
  });

  it("lets Carthage react to the mobilization, in its own iteration", async () => {
    const port = scriptedPort({ simulate_orchestrate: [RAISE_TWO_LEGIONS], simulate_cognition: [CARTHAGE_REACTS] });
    const result = await runSimulationBurst(input(port));

    expect(port.calls).toEqual(["simulate_orchestrate", "simulate_cognition"]);
    const before = world().material.forces.find((f) => f.id === "carthaginian-army")!.authorizedStrength;
    const after = result.world.material.forces.find((f) => f.id === "carthaginian-army")!.authorizedStrength;
    expect(after).toBe(before + 1_500);
    expect(result.newFacts.some((fact) => fact.kind === "military_reinforcement")).toBe(true);
  });

  it("stays inside the two-to-four model call budget", async () => {
    const port = scriptedPort({ simulate_orchestrate: [RAISE_TWO_LEGIONS], simulate_cognition: [CARTHAGE_REACTS] });
    const result = await runSimulationBurst(input(port));
    expect(result.modelCalls).toBeLessThanOrEqual(4);
    expect(result.modelCalls).toBeGreaterThanOrEqual(2);
  });
});

describe("information boundaries", () => {
  it("keeps a secret out of the player's view while the world still knows it", async () => {
    const port = scriptedPort({ simulate_orchestrate: [RAISE_TWO_LEGIONS], simulate_cognition: [CARTHAGE_REACTS] });
    const result = await runSimulationBurst(input(port));

    const secret = result.newFacts.find((fact) => fact.kind === "military_reinforcement")!;
    expect(secret.visibility).toBe("private");

    const playerCanSee = factsVisibleTo(result.newFacts, { kind: "character", id: "marcus-atilius" }, result.world.instant);
    expect(playerCanSee.map((fact) => fact.kind)).not.toContain("military_reinforcement");
  });

  it("delays news until it could have travelled", async () => {
    const port = scriptedPort({ simulate_orchestrate: [RAISE_TWO_LEGIONS], simulate_cognition: [CARTHAGE_REACTS] });
    const result = await runSimulationBurst(input(port));

    const mobilization = result.newFacts.find((fact) => fact.kind === "military_mobilization")!;
    expect(mobilization.discovery.knowableAtInstant).not.toBeNull();
    expect(mobilization.discovery.knowableAtInstant!.day).toBeGreaterThan(result.world.instant.day - 3);
  });
});

describe("budget and termination", () => {
  it("stops rather than looping when nobody further can react", async () => {
    const quiet = JSON.stringify({ actors: [] });
    const port = scriptedPort({ simulate_orchestrate: [RAISE_TWO_LEGIONS], simulate_cognition: [quiet] });
    const result = await runSimulationBurst(input(port));
    expect(result.stopReason).toBe("no_due_events");
  });

  it("ends the burst when accumulated significance crosses the threshold", async () => {
    const momentous = JSON.stringify({
      ...JSON.parse(RAISE_TWO_LEGIONS),
      facts: [{ localId: "war", kind: "war_declared", summary: "Rome declares war on Carthage.", affectedRefs: [], visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 100 }],
    });
    const port = scriptedPort({ simulate_orchestrate: [momentous] });
    const result = await runSimulationBurst(input(port));
    expect(result.accumulatedSignificance).toBeGreaterThanOrEqual(100);
    expect(result.iterations).toBe(1);
  });

  it("survives a model that answers with nothing usable, and says so as friction", async () => {
    const port = scriptedPort({ simulate_orchestrate: ["I'm afraid I can't help with that.", "still not JSON"] });
    const result = await runSimulationBurst(input(port));

    expect(result.parseFailures.length).toBeGreaterThan(0);
    expect(result.world.material.accounts).toEqual(world().material.accounts);
    expect(result.outcome).toBe("continue");
  });

  it("interrupts for a decision that needs the ruler's own authority", async () => {
    const needsRuler = JSON.stringify({
      ...JSON.parse(RAISE_TWO_LEGIONS),
      outcome: "player_decision",
      playerDecision: {
        prompt: "Syracuse offers a treaty in exchange for recognition of its claims in eastern Sicily. Accept?",
        options: [
          { id: "accept", label: "Accept the treaty", summary: "Secure the east, at the cost of the claim." },
          { id: "refuse", label: "Refuse", summary: "Keep the claim, and risk a second front." },
        ],
      },
    });
    const port = scriptedPort({ simulate_orchestrate: [needsRuler] });
    const result = await runSimulationBurst(input(port));

    expect(result.outcome).toBe("player_decision");
    expect(result.stopReason).toBe("player_decision");
    expect(result.playerDecision!.options).toHaveLength(2);
    expect(port.calls).toEqual(["simulate_orchestrate"]);
  });
});
