import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { FactSchema, ScenarioDefinitionSchema, WorldStateSchema, factsKnownTo, factsVisibleTo, type Office, type ScenarioClock, type WorldState } from "@chronica/shared";
import { DEFAULT_BUDGET, runSimulationBurst, type BurstInput, type WindowSnapshot } from "./burst";
import { composeChronicle } from "./chronicle";
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
      officeLabel: "Military Quaestor", officeAuthorises: [],
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

  it("stays inside the two-to-four round budget", async () => {
    // VISION §29 asks for "approximately 2--4 major model calls, not dozens",
    // and this counted calls until a call stopped being the unit it meant. A
    // round's cast is now dealt onto up to three requests issued at once --
    // the same portraits, the same answers, the same tokens, finishing in the
    // time of the longest instead of the sum. Counting those separately would
    // read as the budget tripling when nothing more was asked of the world.
    //
    // So the bound is rounds, which is what §29 was always about, and the call
    // count is held to the guard against a loop that will not stop.
    const port = scriptedPort({ simulate_orchestrate: [RAISE_TWO_LEGIONS], simulate_cognition: [CARTHAGE_REACTS] });
    const result = await runSimulationBurst(input(port));
    // The order's own chain. What the world does after a quiet stretch is a
    // chain of its own, bounded by the call guard (`newChainAfterDays`).
    expect(result.chainRounds[0]).toBeLessThanOrEqual(4);
    expect(result.chainRounds[0]).toBeGreaterThanOrEqual(2);
    expect(result.modelCalls).toBeLessThanOrEqual(DEFAULT_BUDGET.maxModelCalls);
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
  /**
   * An order whose spending the purse genuinely cannot cover. A payment larger
   * than the purse now pays what is in it, so it is the second, from a purse
   * already emptied, that the world refuses.
   */
  const UNAFFORDABLE = JSON.stringify({
    ...JSON.parse(RAISE_TWO_LEGIONS),
    deltas: [
      { op: "money_transfer", fromAccountRef: "marcus-purse", toAccountRef: null, amount: 999_999, reason: "Everything he has." },
      { op: "money_transfer", fromAccountRef: "marcus-purse", toAccountRef: null, amount: 500, reason: "An impossible levy." },
    ],
    facts: [],
  });

  /**
   * An order naming an army nobody raised. (A person named and never made is
   * made now -- the world's lists are open -- so the malformed reference that
   * stands for the whole class is one the engine cannot fill in: an army.)
   */
  const PHANTOM = JSON.stringify({
    ...JSON.parse(RAISE_TWO_LEGIONS),
    deltas: [{ op: "force_modify", forceRef: "legio-phantasma", name: "The Phantom Legion", reason: "Renaming an army nobody raised." }],
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
    // "No force legio-phantasma exists" is the engine catching a bad payload,
    // not a thing that happened in the world.
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
    for (const rounds of result.chainRounds) expect(rounds).toBeLessThanOrEqual(DEFAULT_BUDGET.maxIterations);
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
      watch: { label: "Wake me when Carthage's army moves up the north coast.", predicate: { kind: "force_enters_province", provinceId: "ita-72843720b81376294924159-sicily-northwest", polityId: "carthage" } },
    });
    const march = JSON.stringify({
      actors: [{
        actorRef: { kind: "character", id: "hanno" },
        reasoning: "The army moves.",
        proposal: {
          narrativeSummary: "The army crosses into Sicily.",
          frictions: [],
          // One province, because an army may only step to ground it borders.
          deltas: [{ op: "force_modify", forceRef: "carthaginian-army", locationId: "ita-72843720b81376294924159-sicily-northwest", reason: "The march up the coast." }],
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
    // What news there is, is the engine's own: the record that the order was
    // given, and a stirring the engine carries out itself (`engineWork`),
    // which happens whatever the model answers.
    const engineStirrings = new Set(["order_given", "harvest", "grain_fleet_lost", "fire", "road_or_pass"]);
    expect(result.newFacts.filter((fact) => (result.significanceByFactId.get(fact.id) ?? 0) > 0).every((fact) => engineStirrings.has(fact.kind))).toBe(true);
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
        // What the recruitment is for. A project that declares no product no
        // longer announces its own completion, which is the point: "the scheme
        // was completed" with nothing to show is a ledger entry, not history.
        completionOutcome: {
          kind: "force", label: "Two new legions", amount: 8_000,
          provinceId: "ita-72843720b81376294924159-sicily-northeast", polityId: "rome",
          commanderCharacterId: "marcus-atilius", forceId: null, beneficiaryAccountId: null,
          cadenceDays: null, agreementKind: null, withPolityId: null,
        },
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

/** A port that also keeps what it was shown, so a test can read the prompts. */
function capturingScriptedPort(script: Partial<Record<SimOperation, string[]>>): SimModelPort & { calls: SimOperation[]; shown: Partial<Record<SimOperation, string[]>> } {
  const remaining: Partial<Record<SimOperation, string[]>> = structuredClone(script);
  const calls: SimOperation[] = [];
  const shown: Partial<Record<SimOperation, string[]>> = {};
  return {
    calls,
    shown,
    complete(operation, _system, user) {
      calls.push(operation);
      (shown[operation] ??= []).push(user);
      const next = remaining[operation]?.shift();
      if (next === undefined) return Promise.reject(new Error(`the script has no further "${operation}" response`));
      return Promise.resolve(next);
    },
  };
}

const PLOT_SEED = {
  key: "seed-plot", kind: "person_problem" as const, archetype: "conspiracy", severity: "serious" as const, secret: true, oneShot: false, repeated: false, pressureId: null,
  target: { provinceId: null, provinceName: null, polityId: "rome", polityName: "Roman Republic", characterId: "quintus-fabius", characterName: "Quintus Fabius", otherPolityId: null, otherPolityName: null, forceId: null, forceName: null, forceIsNaval: false },
  inPlayerRealm: true, why: "The world has been quiet at home.", brief: "Quintus Fabius [quintus-fabius] has begun something against the government he serves.",
};

const FABIUS = { kind: "character" as const, id: "quintus-fabius" };

/** The order carried out, and beside it a conspiracy the model wrongly marks "polity" and then describes in its summary. */
const ORDER_AND_PLOT = JSON.stringify({
  intent: { summary: "Inspect the legion.", domains: ["military"] },
  narrativeSummary: "The consul inspects his legion. Meanwhile Fabius gathers his friends against him.",
  frictions: [],
  deltas: [
    { op: "force_modify", forceRef: "legio-i", moraleBpsDelta: 200, reason: "The consul's inspection lifts spirits." },
    { op: "storyline_open", localId: "plot", seedKey: "seed-plot", title: "The Quaestor's Silence", participantRefs: ["quintus-fabius"], provinceId: null, phase: "brewing", stakes: "Whether the Senate can be turned against the consul unnoticed.", nextDevelopment: "Fabius sounds out the patrician bloc.", visibility: "private", reason: "The world stirs." },
    { op: "character_pressure_set", characterRef: "quintus-fabius", action: "create", kind: "political_danger", intensity: 80, label: "Afraid the consul suspects him.", reviewInDays: 30, expiresInDays: null, visibility: "private", reason: "A plotter's fear." },
    { op: "character_intent_set", actorCharacterRef: "quintus-fabius", actionType: "seek_support", targetRefs: [], rationale: "Gather senators against the consul.", priority: 70, visibility: "private" },
  ],
  facts: [
    { localId: "inspection", kind: "inspection", summary: "The consul inspects the first legion.", affectedRefs: [{ kind: "force", id: "legio-i" }], visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 10 },
    { localId: "plot_fact", kind: "conspiracy_begun", summary: "Quintus Fabius begins quietly gathering senators against the consul.", affectedRefs: [FABIUS], visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance: 40, knownToRefs: [FABIUS], storylineRef: "local:plot" },
  ],
  delegations: [],
  schedule: [
    { kind: "plot_strike", dueInDays: 20, summary: "Fabius's friends move a motion of censure.", subjectRefs: ["quintus-fabius"], causeFactLocalId: "plot_fact", visibility: "private", significance: 60, knownToRefs: [FABIUS], storylineRef: "local:plot" },
  ],
  cognitionCandidates: [], outcome: "chronicle", playerDecision: null,
});

/** Fabius, asked what he does about it, oversteps -- and only he knows. */
const FABIUS_ACTS = JSON.stringify({
  actors: [{
    actorRef: FABIUS,
    reasoning: "The legion's discontent is a lever.",
    proposal: {
      narrativeSummary: "Fabius spreads discontent among the legion's officers.",
      frictions: [],
      deltas: [{ op: "force_modify", forceRef: "legio-i", moraleBpsDelta: -300, reason: "Whispers among the officers." }],
      facts: [{ localId: "whispers", kind: "sedition", summary: "Fabius's agents whisper against the consul in the camp.", affectedRefs: [FABIUS], visibility: "private", discoveryState: "private", knowableInDays: 0, significance: 35, knownToRefs: [FABIUS] }],
      delegations: [], schedule: [],
    },
  }],
});

describe("the world stirs: a secret plot", () => {
  const NOBODY = JSON.stringify({ actors: [] });
  const run = async () => {
    const port = capturingScriptedPort({ simulate_orchestrate: [ORDER_AND_PLOT], simulate_cognition: [FABIUS_ACTS, NOBODY, NOBODY, NOBODY] });
    const result = await runSimulationBurst(input(port, { orderText: "Inspect the legion.", narratorSeed: PLOT_SEED }));
    return { port, result };
  };
  const player = { kind: "character" as const, id: "marcus-atilius" };

  it("puts the seed to the orchestrator, and records that it was taken up", async () => {
    const { port, result } = await run();
    expect(port.shown.simulate_orchestrate![0]).toContain("(seed seed-plot)");
    const thread = result.world.storylines.find((storyline) => storyline.seedKey === "seed-plot")!;
    expect(thread.origin).toBe("world");
    expect(thread.visibility).toBe("private");
    // `lastSeedDay` is the far end of what the batch covers, not the day it
    // was decided: a batch sized for a season is that season's stirrings.
    expect(result.world.narrator).toEqual({ lastSeedDay: 90, seedCount: 1, lastSeedKey: "seed-plot", consumed: true, spentPressureIds: [] });
    expect(result.world.characterPressures.some((pressure) => pressure.characterId === "quintus-fabius" && pressure.visibility === "private")).toBe(true);
  });

  it("keeps a secret thread's fact secret whatever the model wrote, and known to its plotter", async () => {
    const { result } = await run();
    const plot = result.newFacts.find((fact) => fact.kind === "conspiracy_begun")!;
    expect(plot.visibility).toBe("private");
    expect(plot.discovery.discoveredBy.map((entry) => entry.observerRef.id)).toContain("quintus-fabius");
    expect(result.world.storylines.find((storyline) => storyline.seedKey === "seed-plot")!.causalFactIds).toContain(plot.id);
  });

  it("asks the plotter first what he does about it, showing him the thread", async () => {
    const { port } = await run();
    const first = port.shown.simulate_cognition![0]!;
    expect(first).toContain("## Quintus Fabius [quintus-fabius]");
    expect(first).toContain("Caught up in:");
    expect(first).toContain("The Quaestor's Silence");
    expect(first).toContain("They mean to:");
  });

  it("records the plotter's overreach as a breach only he knows of", async () => {
    const { result } = await run();
    expect(result.breaches.length).toBeGreaterThan(0);
    const breach = result.newFacts.find((fact) => fact.kind === "authority_breach")!;
    expect(breach.visibility).toBe("private");
    expect(breach.discovery.discoveredBy.map((entry) => entry.observerRef.id)).toEqual(["quintus-fabius"]);
  });

  it("fires the plot's next step as a private event naming its subject", async () => {
    const { result } = await run();
    const draft = result.scheduled.find((event) => event.kind === "plot_strike")!;
    expect(draft.payload.visibility).toBe("private");
    expect(draft.payload.storylineId).toBe(result.world.storylines.find((storyline) => storyline.seedKey === "seed-plot")!.id);
    const strike = result.newFacts.find((fact) => fact.kind === "plot_strike");
    expect(strike).toBeDefined();
    expect(strike!.visibility).toBe("private");
    expect(strike!.affectedEntities).toEqual([FABIUS]);
    expect(strike!.discovery.discoveredBy.map((entry) => entry.observerRef.id)).toEqual(["quintus-fabius"]);
  });

  it("lets nothing of it reach the ruler's record", async () => {
    const { result } = await run();
    const known = factsKnownTo(result.newFacts, player, "rome", result.world.instant).map((fact) => fact.kind);
    expect(known).toContain("inspection");
    for (const kind of ["conspiracy_begun", "sedition", "authority_breach", "plot_strike"]) expect(known).not.toContain(kind);

    // The plotter's own account travels with his private facts and is not
    // his ruler's to read; the thread's title is known to its participants
    // alone. The orchestrator's summary is the one thing code cannot gate --
    // it describes the visible order too -- which is what the secrecy principle (7) is for.
    const historian = capturingScriptedPort({ compose_chronicle: [JSON.stringify({ entries: [] })] });
    const record = await composeChronicle({
      port: historian, clock, observer: player, observerPolityId: "rome", facts: result.newFacts, from: { day: 0, minute: 0 }, to: result.world.instant,
      narrative: result.narrative, frictions: result.frictions, significanceByFactId: result.significanceByFactId, storylines: result.world.storylines,
    });
    // Whatever reaches the record: what the historian was shown, and what the
    // record printed.
    const shown = [...(historian.shown.compose_chronicle ?? []), ...record.entries.map((entry) => `${entry.title}\n${entry.body}`)].join("\n");
    expect(shown).toContain("inspects the first legion");
    expect(shown).not.toContain("spreads discontent");
    expect(shown).not.toContain("whisper");
    expect(shown).not.toContain("censure");
    expect(shown).not.toContain("Quaestor");
    expect(result.narrative.find((line) => line.line.includes("gathers his friends"))!.actorRef).toBeNull();
  });

  it("does not stir again until the cadence has run", async () => {
    const { result } = await run();
    // Ten days after the seed, not ninety: the ledger says the world stirred
    // on day 0, and a month has not passed.
    const soon: WorldState = { ...result.world, instant: { day: 10, minute: 0 }, elapsedStep: 10 };
    const port = capturingScriptedPort({ simulate_orchestrate: [QUIET], simulate_cognition: [NOBODY, NOBODY, NOBODY, NOBODY] });
    await runSimulationBurst(input(port, { world: soon, knownFacts: result.newFacts, orderText: "Wait." }));
    expect(port.shown.simulate_orchestrate![0]).not.toContain("THE WORLD STIRS");
  });
});

describe("the world stirs: a plague in the open", () => {
  const LATIUM = "ita-local-23120603B86473916475875";
  const SEED = {
    ...PLOT_SEED, key: "seed-plague", kind: "world_event" as const, archetype: "plague", secret: false,
    target: { provinceId: LATIUM, provinceName: "Latium", polityId: "rome", polityName: "Roman Republic", characterId: null, characterName: null, otherPolityId: null, otherPolityName: null, forceId: null, forceName: null, forceIsNaval: false },
    brief: `Sickness has come to Latium [${LATIUM}].`,
  };
  const PLAGUE = JSON.stringify({
    intent: { summary: "Wait.", domains: [] },
    narrativeSummary: "The consul waits on events. Sickness spreads through Latium.",
    frictions: [],
    deltas: [
      { op: "province_material_shift", provinceId: LATIUM, foodSecurityBpsDelta: -1800, stabilityBpsDelta: -1200, reason: "An epidemic." },
      { op: "storyline_open", localId: "plague", seedKey: "seed-plague", title: "The Sickness in Latium", participantRefs: ["quintus-fabius"], provinceId: LATIUM, phase: "escalating", stakes: "Whether Rome can feed itself through the summer.", nextDevelopment: "The sickness spreads or burns out.", visibility: "public", reason: "The world stirs." },
    ],
    facts: [{ localId: "outbreak", kind: "plague_outbreak", summary: "Sickness breaks out in Latium and the markets empty.", affectedRefs: [{ kind: "province", id: LATIUM }, { kind: "polity", id: "rome" }], visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 60, storylineRef: "local:plague" }],
    delegations: [],
    schedule: [{ kind: "plague_wave", dueInDays: 20, summary: "The sickness reaches the Aventine.", subjectRefs: [LATIUM], causeFactLocalId: "outbreak", visibility: "public", significance: 55, knownToRefs: [], storylineRef: "local:plague" }],
    cognitionCandidates: [], outcome: "chronicle", playerDecision: null,
  });

  it("changes the province, opens a public thread, and carries its next wave into the same thread", async () => {
    const NOBODY = JSON.stringify({ actors: [] });
    const port = capturingScriptedPort({ simulate_orchestrate: [PLAGUE], simulate_cognition: [NOBODY, NOBODY, NOBODY, NOBODY] });
    const result = await runSimulationBurst(input(port, { orderText: "Wait.", narratorSeed: SEED }));

    const thread = result.world.storylines.find((storyline) => storyline.seedKey === "seed-plague")!;
    expect(thread.visibility).toBe("public");
    const wave = result.newFacts.find((fact) => fact.kind === "plague_wave")!;
    expect(wave.visibility).toBe("public");
    expect(wave.affectedEntities).toEqual([{ kind: "province", id: LATIUM }]);
    expect(thread.causalFactIds).toContain(wave.id);
    expect(result.world.material.provinceMaterial.find((material) => material.provinceId === LATIUM)!.foodSecurityBps).toBeLessThan(10_000);

    const known = factsKnownTo(result.newFacts, { kind: "character", id: "marcus-atilius" }, "rome", result.world.instant).map((fact) => fact.kind);
    expect(known).toContain("plague_outbreak");
    expect(known).toContain("plague_wave");
  });
});

describe("what a person said", () => {
  const SPEAKS = JSON.stringify({
    actors: [
      {
        actorRef: { kind: "character", id: "hanno" },
        reasoning: "Rome is arming; the west of the island must be held.",
        proposal: {
          narrativeSummary: "Carthage quietly reinforces its position in western Sicily.",
          utterance: { line: "Let them count our ships when they are already in the strait.", occasion: "to the Council of Elders" },
          frictions: [],
          deltas: [],
          facts: [
            { localId: "reinforcement", kind: "military_reinforcement", summary: "Carthage reinforces western Sicily.", affectedRefs: [{ kind: "polity", id: "carthage" }], visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 60 },
          ],
          delegations: [],
          schedule: [],
        },
      },
    ],
  });

  it("carries a person's own words out of the burst, with the facts they belong to", async () => {
    const port = scriptedPort({ simulate_orchestrate: [RAISE_TWO_LEGIONS], simulate_cognition: [SPEAKS, SPEAKS, SPEAKS, SPEAKS] });
    const result = await runSimulationBurst(input(port));
    const spoken = result.utterances.find((utterance) => utterance.line.includes("count our ships"));
    expect(spoken).toBeDefined();
    expect(spoken!.speaker).toBe("Hanno");
    expect(spoken!.occasion).toBe("to the Council of Elders");
    expect(spoken!.factIds.length).toBeGreaterThan(0);
  });

  it("attributes nothing to the orchestrator, which speaks for everyone and so for no one", async () => {
    // The world's own answer covers Rome, the Boii chieftain and the weather in
    // one breath. A quotation drawn from it would have an invented speaker.
    const speaking = JSON.parse(RAISE_TWO_LEGIONS) as Record<string, unknown>;
    speaking.utterance = { line: "Rome will have her legions.", occasion: "in the Senate" };
    const port = scriptedPort({ simulate_orchestrate: [JSON.stringify(speaking)], simulate_cognition: [CARTHAGE_REACTS, CARTHAGE_REACTS, CARTHAGE_REACTS, CARTHAGE_REACTS] });
    const result = await runSimulationBurst(input(port));
    expect(result.utterances.map((utterance) => utterance.line)).not.toContain("Rome will have her legions.");
  });
});

describe("an irregularity somebody comes across", () => {
  it("writes the breach in words, and lets the right person find it out later", async () => {
    // The breach fact used to be the audit line, private to its author,
    // forever. A consequence nobody can ever learn of is not a consequence.
    const port = scriptedPort({ simulate_orchestrate: [RAISE_TWO_LEGIONS], simulate_cognition: [CARTHAGE_REACTS, CARTHAGE_REACTS, CARTHAGE_REACTS, CARTHAGE_REACTS] });
    const result = await runSimulationBurst(input(port));
    const breach = result.newFacts.find((fact) => fact.kind === "authority_breach");
    if (breach === undefined) return; // A burst with no overreach has nothing to test.

    expect(breach.summary).not.toContain("grant");
    expect(breach.summary).not.toContain("domain");
    // Either nobody noticed -- which must stay possible -- or somebody did,
    // and it takes them time.
    const others = breach.discovery.discoveredBy.filter((entry) => entry.observerRef.id !== "marcus-atilius");
    if (others.length > 0) {
      expect(breach.discovery.state).toBe("delayed");
      expect(breach.discovery.knowableAtInstant).not.toBeNull();
      expect(others.length).toBeLessThanOrEqual(2);
    }
  });
});

describe("the order, and the world beside it", () => {
  const ANSWER = (lists: { deltas?: unknown[]; worldDeltas?: unknown[] }) => JSON.stringify({
    intent: { summary: "Nothing much.", domains: [] },
    narrativeSummary: "The world goes on.",
    frictions: [],
    deltas: lists.deltas ?? [],
    worldDeltas: lists.worldDeltas ?? [],
    facts: [], delegations: [], schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null,
  });
  const RENAME = { op: "force_modify", forceRef: "carthaginian-army", name: "The Army of Sicily", reason: "Hanno renames his army." };
  const quiet = JSON.stringify({ actors: [] });
  const named = (result: Awaited<ReturnType<typeof runSimulationBurst>>) =>
    result.world.material.forces.find((force) => force.id === "carthaginian-army")!.name;

  it("will not have a Roman's order rename a Carthaginian army", async () => {
    const port = scriptedPort({ simulate_orchestrate: [ANSWER({ deltas: [RENAME] })], simulate_cognition: [quiet, quiet, quiet, quiet] });
    const result = await runSimulationBurst(input(port, { orderText: "Have the Carthaginians call their army the Army of Sicily." }));
    expect(named(result)).not.toBe("The Army of Sicily");
    expect(result.newFacts.some((fact) => fact.kind === "order_ignored")).toBe(true);
  });

  it("lets the world rename it, when it is Carthage's own business", async () => {
    const port = scriptedPort({ simulate_orchestrate: [ANSWER({ worldDeltas: [RENAME] })], simulate_cognition: [quiet, quiet, quiet, quiet] });
    const result = await runSimulationBurst(input(port));
    expect(named(result)).toBe("The Army of Sicily");
    expect(result.breaches).toEqual([]);
  });
});

describe("the player says how long", () => {
  const NOTHING = JSON.stringify({
    intent: { summary: "Wait.", domains: [] }, narrativeSummary: "Time passes.", frictions: [],
    deltas: [], facts: [], delegations: [], schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null,
  });
  const quiet = JSON.stringify({ actors: [] });

  it("lets a month pass with no order, in a world with nothing on its calendar", async () => {
    const port = scriptedPort({ simulate_orchestrate: [NOTHING], simulate_cognition: [quiet, quiet, quiet, quiet] });
    const before = world().instant.day;
    const result = await runSimulationBurst(input(port, { orderText: null, spanDays: 30 }));
    expect(result.world.instant.day - before).toBeGreaterThanOrEqual(30);
  });

  it("carries a year when asked for one, past the ordinary ceiling of a season", async () => {
    const port = scriptedPort({ simulate_orchestrate: [NOTHING], simulate_cognition: [quiet, quiet, quiet, quiet] });
    const before = world().instant.day;
    const result = await runSimulationBurst(input(port, { orderText: null, spanDays: 365 }));
    expect(result.world.instant.day - before).toBe(Math.min(365, clock.maxSpanDays));
  });
});

describe("the audit", () => {
  const ORDER = JSON.stringify({
    ...JSON.parse(QUIET),
    narrativeSummary: "The consul pays his steward and takes on a clerk.",
    deltas: [
      // No such account: the consul's own purse is the obvious payer.
      { op: "obligation_upsert", obligationRef: null, localId: "clerk", kind: "salary", label: "A clerk's wage", payerAccountRef: "marcus-strongbox", recipientAccountRef: null, amount: 2, cadenceDays: 30, priority: 500, active: true, reason: "He takes on a clerk." },
      // No such legion, and which army he meant is not the engine's to guess.
      { op: "force_modify", forceRef: "the-stewards-guard", authorizedStrengthDelta: 10, reason: "He adds men to his guard." },
    ],
  });
  const REPAIRED = JSON.stringify({ deltas: [{ op: "money_transfer", fromAccountRef: "marcus-purse", toAccountRef: null, amount: 5, reason: "He pays his steward." }] });

  it("keeps what was filled in and what the repair had to put right, which the merged result forgets", async () => {
    const port = scriptedPort({ simulate_orchestrate: [ORDER, REPAIRED], simulate_cognition: [] });
    const result = await runSimulationBurst(input(port, { spanDays: 7 }));
    const ofTheOrder = result.audit.filter((entry) => entry.ofTheOrder);
    expect(ofTheOrder.find((entry) => entry.kind === "assumed")).toMatchObject({ op: "obligation_upsert", attempt: "first" });
    expect(ofTheOrder.find((entry) => entry.kind === "reference")).toMatchObject({ op: "force_modify", attempt: "first" });
    // The repair carried it out, so nothing of the order's is refused the second time.
    expect(ofTheOrder.filter((entry) => entry.attempt === "repair" && entry.kind !== "assumed")).toEqual([]);
  });
});

describe("the burst hands out its windows as the clock leaves them", () => {
  it("cuts one window per move of the clock, partitioning every fact it wrote, with the order's facts in the first", async () => {
    const port = scriptedPort({ simulate_orchestrate: [RAISE_TWO_LEGIONS], simulate_cognition: [CARTHAGE_REACTS, QUIET, QUIET, QUIET] });
    const windows: WindowSnapshot[] = [];
    const result = await runSimulationBurst(input(port, { onWindowClosed: (window) => { windows.push(window); } }));

    expect(windows.length).toBeGreaterThanOrEqual(2);
    // Numbered from the order, and the clock never moves backwards.
    expect(windows.map((window) => window.index)).toEqual(windows.map((_, index) => index));
    for (let index = 1; index < windows.length; index += 1) {
      expect(windows[index]!.from).toEqual(windows[index - 1]!.to);
      expect(windows[index]!.from.day).toBeGreaterThanOrEqual(windows[index - 1]!.from.day);
    }
    // Every fact of the burst lands in exactly one window, in the order written.
    expect(windows.flatMap((window) => window.facts.map((fact) => fact.id))).toEqual(result.newFacts.map((fact) => fact.id));
    // And the answer to the order is the first window's to tell.
    expect(new Set(windows[0]!.orderFactIds)).toEqual(new Set(result.orderFactIds));
    expect(windows.slice(1).every((window) => window.orderFactIds.length === 0)).toBe(true);
    // The last window ends where the burst ended.
    expect(windows[windows.length - 1]!.to).toEqual(result.world.instant);
  });

  it("is not failed by a listener that throws", async () => {
    const port = scriptedPort({ simulate_orchestrate: [RAISE_TWO_LEGIONS], simulate_cognition: [CARTHAGE_REACTS, QUIET, QUIET, QUIET] });
    const result = await runSimulationBurst(input(port, { onWindowClosed: () => { throw new Error("the page went away"); } }));
    expect(result.newFacts.length).toBeGreaterThan(0);
    expect(result.stopReason).not.toBe("budget_exhausted");
  });
});

describe("calls the burst decides not to make", () => {
  it("does not ask a cast of nobody pressing past the rounds it pays for, and says so", async () => {
    const port = scriptedPort({ simulate_orchestrate: [QUIET], simulate_cognition: [QUIET, QUIET, QUIET, QUIET] });
    const result = await runSimulationBurst(input(port, { budget: { ...DEFAULT_BUDGET, maxAmbientOnlyRounds: 0 } }));
    expect(port.calls.filter((call) => call === "simulate_cognition")).toHaveLength(0);
    expect(result.skipped.some((skip) => skip.stage === "cognition" && skip.reason.includes("nobody pressing"))).toBe(true);
    expect(result.stopReason).toBe("no_due_events");
  });

  it("still asks when somebody is pressing, however many quiet rounds went before", async () => {
    // Carthage reacts to the levy: a reaction is always pressing.
    const port = scriptedPort({ simulate_orchestrate: [RAISE_TWO_LEGIONS], simulate_cognition: [CARTHAGE_REACTS, QUIET, QUIET, QUIET] });
    const result = await runSimulationBurst(input(port, { budget: { ...DEFAULT_BUDGET, maxAmbientOnlyRounds: 0 } }));
    expect(port.calls.filter((call) => call === "simulate_cognition").length).toBeGreaterThan(0);
    expect(result.newFacts.length).toBeGreaterThan(0);
  });

  it("spends no repair on a refusal no correction can cure", async () => {
    const spendsHisPurse = JSON.stringify({
      intent: { summary: "Games are held.", domains: [] }, narrativeSummary: "The world holds games.", frictions: [], deltas: [], facts: [], delegations: [], schedule: [],
      worldDeltas: [{ op: "money_transfer", fromAccountRef: "marcus-purse", toAccountRef: null, amount: 100, reason: "The city holds games at the consul's expense." }],
      cognitionCandidates: [], outcome: "continue", playerDecision: null,
    });
    const port = scriptedPort({ simulate_orchestrate: [spendsHisPurse], repair_deltas: [JSON.stringify({ deltas: [] })], simulate_cognition: [QUIET, QUIET, QUIET, QUIET] });
    const result = await runSimulationBurst(input(port));
    expect(port.calls.filter((call) => call === "repair_deltas")).toHaveLength(0);
    expect(result.skipped.some((skip) => skip.stage === "repair" && skip.reason.includes("player's own purse"))).toBe(true);
    expect(result.audit.some((entry) => entry.kind === "reference" && entry.reason.includes("player's own purse"))).toBe(true);
  });
});
