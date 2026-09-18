import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { FactSchema, ScenarioDefinitionSchema, WorldStateSchema, factsVisibleTo, type Office, type ScenarioClock, type WorldState } from "@chronica/shared";
import { DEFAULT_BUDGET, runSimulationBurst, type BurstInput } from "./burst";
import type { SimModelPort, SimOperation } from "./ports";

const definition = ScenarioDefinitionSchema.parse(firstPunicWarScenario.definition);
const offices: readonly Office[] = definition.government.offices;
const clock: ScenarioClock = definition.clock;
const warfare = definition.warfare;
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
    warfare,
    burstId: "b1",
    gameId: "game-1",
    actorRef: { kind: "character", id: "marcus-atilius" },
    actorPolityId: "rome",
    orderText: "Raise two new legions.",
    knownFacts: [],
    queue: [],
    port,
    ...overrides,
  };
}

describe("a burst answering \"Raise two new legions\"", () => {
  it("turns one short order into money spent, a person created, a project, an obligation and scheduled milestones", async () => {
    const port = scriptedPort({ simulate_orchestrate: [RAISE_TWO_LEGIONS], simulate_cognition: [CARTHAGE_REACTS] });
    const result = await runSimulationBurst(input(port));

    // The order's own 220 left the purse, and standing obligations were paid on
    // top of it as the burst carried the world forward.
    const purse = result.world.material.accounts.find((a) => a.id === "marcus-purse")!.balance;
    expect(purse).toBeLessThanOrEqual(1_200 - 220);
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
    expect(result.frictions.map((friction) => friction.line).join(" ")).toContain("Treasury reserves cover only part");
  });

  it("lets Carthage react to the mobilization, in its own iteration", async () => {
    const port = scriptedPort({ simulate_orchestrate: [RAISE_TWO_LEGIONS], simulate_cognition: [CARTHAGE_REACTS] });
    const result = await runSimulationBurst(input(port));

    expect(port.calls[0]).toBe("simulate_orchestrate");
    expect(port.calls).toContain("simulate_cognition");
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

describe("a secret coming to light", () => {
  /** A fact already on record that nobody outside Carthage has discovered. */
  const SECRET = FactSchema.parse({
    id: "fact-carthage-plot",
    time: { day: 0, minute: 540 },
    atStep: 0,
    kind: "secret_arrangement",
    summary: "Carthage has quietly promised Syracuse the western harbours.",
    affectedEntities: [{ kind: "polity" as const, id: "carthage" }],
    resourceChanges: [],
    visibility: "private" as const,
    discovery: { state: "private" as const, knowableAtInstant: null, discoveredBy: [] },
    evidence: null,
    eligibleReactionScopes: [],
    sourceEventId: null,
    sourceActionId: null,
    causalDepth: 0,
  });

  const FOUND_OUT = JSON.stringify({
    ...JSON.parse(RAISE_TWO_LEGIONS),
    deltas: [],
    facts: [],
    delegations: [],
    schedule: [],
    discoveries: [{ factId: "fact-carthage-plot", observerRef: { kind: "character", id: "marcus-atilius" }, via: "investigation", knowableInDays: 0 }],
  });

  it("widens who knows an existing fact rather than writing a second one", async () => {
    const port = scriptedPort({ simulate_orchestrate: [FOUND_OUT], simulate_cognition: [CARTHAGE_REACTS] });
    const result = await runSimulationBurst(input(port, { knownFacts: [SECRET] }));

    const amended = result.rediscoveredFacts.find((fact) => fact.id === "fact-carthage-plot");
    expect(amended).toBeDefined();
    expect(amended!.discovery.discoveredBy.some((entry) => entry.observerRef.id === "marcus-atilius" && entry.via === "investigation")).toBe(true);
    // The event did not happen twice.
    expect(result.newFacts.filter((fact) => fact.kind === "secret_arrangement")).toHaveLength(0);
    expect(factsVisibleTo([amended!], { kind: "character", id: "marcus-atilius" }, result.world.instant)).toHaveLength(1);
  });

  it("makes news that has to travel knowable only once it has arrived", async () => {
    const delayed = JSON.stringify({
      ...JSON.parse(FOUND_OUT),
      discoveries: [{ factId: "fact-carthage-plot", observerRef: { kind: "character", id: "marcus-atilius" }, via: "told", knowableInDays: 40 }],
    });
    const port = scriptedPort({ simulate_orchestrate: [delayed], simulate_cognition: [CARTHAGE_REACTS] });
    const result = await runSimulationBurst(input(port, { knownFacts: [SECRET] }));

    const amended = result.rediscoveredFacts.find((fact) => fact.id === "fact-carthage-plot")!;
    const entry = amended.discovery.discoveredBy[0]!;
    // Forty days after the thing happened, not forty days after wherever the
            // burst happened to stop.
    expect(entry.atInstant.day).toBe(40);
    expect(factsVisibleTo([amended], { kind: "character", id: "marcus-atilius" }, { day: 0, minute: 540 })).toHaveLength(0);
  });

  it("quietly ignores a discovery of something that never happened", async () => {
    const nonsense = JSON.stringify({
      ...JSON.parse(FOUND_OUT),
      discoveries: [{ factId: "fact-that-never-was", observerRef: { kind: "character", id: "marcus-atilius" }, via: "document", knowableInDays: 0 }],
    });
    const port = scriptedPort({ simulate_orchestrate: [nonsense], simulate_cognition: [CARTHAGE_REACTS] });
    const result = await runSimulationBurst(input(port, { knownFacts: [SECRET] }));
    expect(result.rediscoveredFacts).toHaveLength(0);
  });
});

describe("the future queue", () => {
  it("turns an event that comes due into a fact rather than retiring it silently", async () => {
    const port = scriptedPort({ simulate_orchestrate: [RAISE_TWO_LEGIONS], simulate_cognition: [CARTHAGE_REACTS] });
    const result = await runSimulationBurst(
      input(port, {
        queue: [{ id: "queued-1", dueInstantSortKey: world().instant.day * 1440, kind: "grain_convoy_arrives", summary: "The Sicilian grain convoy reaches Ostia." }],
      }),
    );

    expect(result.firedEventIds).toContain("queued-1");
    const fired = result.newFacts.find((fact) => fact.kind === "grain_convoy_arrives");
    expect(fired?.summary).toBe("The Sicilian grain convoy reaches Ostia.");
  });

  it("fires each due event exactly once, however far the burst carries the world", async () => {
    const port = scriptedPort({ simulate_orchestrate: [RAISE_TWO_LEGIONS], simulate_cognition: [CARTHAGE_REACTS] });
    const result = await runSimulationBurst(
      input(port, {
        queue: [{ id: "queued-1", dueInstantSortKey: world().instant.day * 1440, kind: "grain_convoy_arrives", summary: "The Sicilian grain convoy reaches Ostia." }],
      }),
    );

    expect(result.firedEventIds.filter((id) => id === "queued-1")).toHaveLength(1);
    expect(result.newFacts.filter((fact) => fact.kind === "grain_convoy_arrives")).toHaveLength(1);
  });
});

describe("friction the player hears about", () => {
  /** An order whose spending the treasury genuinely cannot cover. */
  const UNAFFORDABLE = JSON.stringify({
    ...JSON.parse(RAISE_TWO_LEGIONS),
    deltas: [{ op: "money_transfer", fromAccountRef: "marcus-purse", toAccountRef: null, amount: 999_999, reason: "An impossible levy." }],
    facts: [],
  });

  /** An order naming an official the same answer never created. */
  const PHANTOM = JSON.stringify({
    ...JSON.parse(RAISE_TWO_LEGIONS),
    deltas: [{ op: "character_intent_set", actorCharacterRef: "publius_scutarius", actionType: "prepare", targetRefs: [], rationale: "Preparing the levy.", priority: 50, visibility: "private" }],
    facts: [],
  });

  it("tells the player when the world itself could not comply", async () => {
    const port = scriptedPort({ simulate_orchestrate: [UNAFFORDABLE], simulate_cognition: [JSON.stringify({ actors: [] })] });
    const result = await runSimulationBurst(input(port));

    const friction = result.newFacts.find((fact) => fact.kind === "execution_friction");
    expect(friction).toBeDefined();
    expect(factsVisibleTo([friction!], { kind: "character", id: "marcus-atilius" }, result.world.instant)).toHaveLength(1);
  });

  it("keeps a malformed proposal out of the ruler's sight", async () => {
    // "No character publius_scutarius exists" is the engine catching a bad
    // payload, not a thing that happened in the world.
    const port = scriptedPort({ simulate_orchestrate: [PHANTOM], simulate_cognition: [JSON.stringify({ actors: [] })] });
    const result = await runSimulationBurst(input(port));

    const noise = result.newFacts.find((fact) => fact.kind === "engine_rejection");
    expect(noise).toBeDefined();
    expect(factsVisibleTo([noise!], { kind: "character", id: "marcus-atilius" }, result.world.instant)).toHaveLength(0);
    expect(result.newFacts.some((fact) => fact.kind === "execution_friction")).toBe(false);
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
    // Knowable exactly the one day later the orchestrator asked for, measured
    // from when it happened rather than from wherever the burst ended.
    expect(mobilization.discovery.knowableAtInstant!.day).toBe(mobilization.time.day + 1);
  });
});

describe("budget and termination", () => {
  it("stops rather than looping when nobody further can react", async () => {
    const quiet = JSON.stringify({ actors: [] });
    const port = scriptedPort({ simulate_orchestrate: [RAISE_TWO_LEGIONS], simulate_cognition: [quiet, quiet, quiet] });
    const result = await runSimulationBurst(input(port));
    expect(result.iterations).toBeLessThanOrEqual(DEFAULT_BUDGET.maxIterations);
    expect(result.modelCalls).toBeLessThanOrEqual(DEFAULT_BUDGET.maxModelCalls);
  });

  it("does not hand control back merely because something momentous happened", async () => {
    // Weight used to end a burst, so any news at all was an interruption: a
    // campaign that should have been one order took six, four of which asked
    // the player nothing. What is interesting earns a Chronicle entry; only
    // what is actionable earns the player's attention.
    const momentousOrder = JSON.stringify({
      ...JSON.parse(RAISE_TWO_LEGIONS),
      facts: [{ localId: "war", kind: "war_declared", summary: "Rome declares war on Carthage.", affectedRefs: [], visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 100 }],
    });
    const quiet = JSON.stringify({ actors: [] });
    const port = scriptedPort({ simulate_orchestrate: [momentousOrder], simulate_cognition: [quiet, quiet, quiet] });
    const result = await runSimulationBurst(input(port));

    expect(result.accumulatedSignificance).toBeGreaterThanOrEqual(100);
    expect(result.world.instant.day).toBeGreaterThan(world().instant.day);
    expect(["no_due_events", "max_span", "budget_exhausted"]).toContain(result.stopReason);
  });

  it("stops when somebody wants to answer and the calls are spent", async () => {
    const reacting = Array.from({ length: 6 }, () => CARTHAGE_REACTS);
    const port = scriptedPort({ simulate_orchestrate: [RAISE_TWO_LEGIONS], simulate_cognition: reacting });
    // An explicit, tiny budget: the point is what happens when the calls run
    // out while somebody still has something to say, not what the current
    // default happens to be.
    const result = await runSimulationBurst(input(port, { budget: { ...DEFAULT_BUDGET, maxIterations: 2, maxModelCalls: 2 } }));

    expect(result.stopReason).toBe("budget_exhausted");
    expect(result.modelCalls).toBeLessThanOrEqual(2);
  });

  it("walks quiet time for free rather than spending the budget on it", async () => {
    // A hop nobody answers is arithmetic, not a model call. Charging one made a
    // 45-day march cost four orders to cross.
    const quiet = JSON.stringify({ actors: [] });
    const port = scriptedPort({ simulate_orchestrate: [RAISE_TWO_LEGIONS], simulate_cognition: [quiet, quiet, quiet] });
    // An arrival two months out, and nothing at all before it.
    const queue = [{ id: "arrival", dueInstantSortKey: (world().instant.day + 60) * 1440, kind: "campaign_arrival", summary: "The army reaches Boii country." }];
    const result = await runSimulationBurst(input(port, { queue }));

    expect(result.world.instant.day - world().instant.day).toBeGreaterThanOrEqual(60);
    expect(result.firedEventIds).toContain("arrival");
  });

  it("lets the world elsewhere move even when nobody is reacting to the player", async () => {
    // The router is purely reactive, so anyone with no connection to the order
    // stayed dormant: Syracuse never moved on Messana and every Chronicle was
    // one thread about the player. The ambient cast rides along in the call the
    // reactors were already making.
    const quiet = JSON.stringify({ actors: [] });
    const port = scriptedPort({ simulate_orchestrate: [RAISE_TWO_LEGIONS], simulate_cognition: [quiet, quiet, quiet] });
    const seen: string[] = [];
    const watching: SimModelPort = {
      complete(operation, system, user) {
        if (operation === "simulate_cognition") seen.push(user);
        return port.complete(operation, system, user);
      },
    };
    await runSimulationBurst(input(watching));

    // Somebody is in the batch on their own account rather than as a reaction,
    // and is told so: asked to react to news nobody brought them, the world
    // elsewhere sensibly answers that it will do nothing.
    expect(seen.join("\n")).toContain("Nobody has brought them news");
  });

  it("carries an open-ended order to the thing it was waiting for", async () => {
    // "Wake me when the army reaches Boii country" was prose the world could not
    // act on: one order, one budget, and a long march had to be re-authorised
    // every couple of days to cross.
    const marchOrder = JSON.stringify({
      ...JSON.parse(RAISE_TWO_LEGIONS),
      deltas: [],
      schedule: [],
      watch: { label: "Wake me when Carthage's army reaches the north-east.", predicate: { kind: "force_enters_province", provinceId: "ita-72843720b81376294924159-sicily-northeast", polityId: "carthage" } },
    });
    const march = JSON.stringify({
      actors: [{
        actorRef: { kind: "character", id: "hanno" },
        reasoning: "The army moves.",
        proposal: {
          narrativeSummary: "The army crosses into Sicily.",
          frictions: [],
          deltas: [{ op: "force_modify", forceRef: "carthaginian-army", locationId: "ita-72843720b81376294924159-sicily-northeast", reason: "The crossing is made." }],
          facts: [],
          delegations: [],
          schedule: [],
        },
      }],
    });
    const quiet = JSON.stringify({ actors: [] });
    const port = scriptedPort({ simulate_orchestrate: [marchOrder], simulate_cognition: [march, quiet, quiet] });
    const result = await runSimulationBurst(input(port));

    expect(result.stopReason).toBe("watch_condition");
  });

  it("survives a model that answers with nothing usable, and says so as friction", async () => {
    const port = scriptedPort({ simulate_orchestrate: ["I'm afraid I can't help with that.", "still not JSON"] });
    const result = await runSimulationBurst(input(port));

    expect(result.parseFailures.length).toBeGreaterThan(0);
    // Nothing the model could have made exists. The world's own clock still
    // runs -- wages fall due while the order is being read -- so the test is
    // that no proposal was applied, not that no money moved.
    expect(result.world.characters).toHaveLength(world().characters.length);
    expect(result.world.projects).toHaveLength(0);
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

const QUIET = JSON.stringify({
  intent: { summary: "Carry on.", domains: [] },
  narrativeSummary: "The consul lets the levy run its course.",
  frictions: [], deltas: [], facts: [], delegations: [], schedule: [],
  cognitionCandidates: [], outcome: "continue", playerDecision: null,
});

describe("a later order carries the world to what was scheduled", () => {
  /** The world as the first order left it: a recruitment project mid-flight. */
  function midRecruitment(): WorldState {
    const state = world();
    return {
      ...state,
      projects: [{
        id: "project-1",
        kind: "recruitment",
        sponsorEntityRef: { kind: "polity", id: "rome" },
        label: "Two new legions",
        status: "in_progress",
        reservationId: null,
        milestones: [
          { id: "m1", label: "Financing committed", requiredAtElapsedOffset: 9, costAmount: 0, status: "pending", completedAtStep: null },
          { id: "m2", label: "First recruits assemble", requiredAtElapsedOffset: 60, costAmount: 0, status: "pending", completedAtStep: null },
        ],
        completionOutcome: null,
        linkedEntityIds: [],
        startedAtStep: 0,
        targetCompletionStep: 60,
        completedAtStep: null,
        provenanceEventIds: [],
      }],
    };
  }

  const queue = [{ id: "event-1", dueInstantSortKey: 60 * 1440, kind: "recruitment_milestone", summary: "First recruits assemble." }];

  it("advances time to the scheduled moment instead of creeping forward", async () => {
    const port = scriptedPort({ simulate_orchestrate: [QUIET], simulate_cognition: [JSON.stringify({ actors: [] })] });
    const result = await runSimulationBurst(input(port, { world: midRecruitment(), queue, orderText: "Let the levy proceed." }));
    expect(result.world.instant.day).toBeGreaterThanOrEqual(60);
  });

  it("completes the recruitment the first order set in motion", async () => {
    // The whole point of the queue: work that takes months actually finishes.
    const port = scriptedPort({ simulate_orchestrate: [QUIET], simulate_cognition: [JSON.stringify({ actors: [] })] });
    const result = await runSimulationBurst(input(port, { world: midRecruitment(), queue, orderText: "Let the levy proceed." }));

    expect(result.world.projects[0]!.status).toBe("completed");
    expect(result.newFacts.map((fact) => fact.kind)).toContain("project_completed");
    expect(result.outcome).toBe("chronicle");
  });

  it("retires the queue entry it consumed", async () => {
    const port = scriptedPort({ simulate_orchestrate: [QUIET], simulate_cognition: [JSON.stringify({ actors: [] })] });
    const result = await runSimulationBurst(input(port, { world: midRecruitment(), queue, orderText: "Let the levy proceed." }));
    expect(result.firedEventIds).toContain("event-1");
  });

  it("never carries the world past the scenario's maximum span", async () => {
    const distant = [{ id: "event-far", dueInstantSortKey: 5_000 * 1440, kind: "anniversary", summary: "A distant date." }];
    const port = scriptedPort({ simulate_orchestrate: [QUIET], simulate_cognition: [JSON.stringify({ actors: [] }), JSON.stringify({ actors: [] }), JSON.stringify({ actors: [] })] });
    const result = await runSimulationBurst(input(port, { queue: distant, orderText: "Wait." }));
    expect(result.world.instant.day).toBeLessThanOrEqual(clock.maxSpanDays);
  });
});
