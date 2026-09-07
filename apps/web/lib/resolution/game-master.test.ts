import { describe, expect, it } from "vitest";
import { createMockAdapter, type MockToolStep } from "@chronica/ai";
import { firstPunicWarScenario } from "@chronica/db";
import { WorldStateSchema, projectOrdersAndOperations, type WorldState } from "@chronica/shared";
import { runGameMaster } from "./game-master";
import { buildChronicleFromFacts } from "./chronicle-from-facts";

// The loop's job is to be boring and safe: forward tool calls, hand back exact
// engine results, and stop. These tests drive it with a scripted model so the
// interesting question -- what reached world state -- has a definite answer.

const PLAYER = "marcus-atilius";
const ROME = "rome";
const CARTHAGE = "carthage";
const LATIUM = "ita-local-23120603B86473916475875";
const SICILY_NORTHWEST = "ita-72843720b81376294924159-sicily-northwest";
const SICILY_NORTHEAST = "ita-72843720b81376294924159-sicily-northeast";

function world(): WorldState {
  return structuredClone(firstPunicWarScenario.initialWorld);
}

function run(steps: readonly MockToolStep[], overrides: Partial<Parameters<typeof runGameMaster>[1]> = {}) {
  return runGameMaster(createMockAdapter("{}", { toolSteps: steps }), {
    world: world(),
    atStep: 1,
    actorCharacterId: PLAYER,
    directives: [{ id: "directive-0", directive: { kind: "new", text: "Raise a legion in Latium." } }],
    selectedCharacters: [],
    playerContext: undefined,
    scenarioGovernment: undefined,
    scenarioChronicle: undefined,
    ...overrides,
  });
}

const finish = (report: Record<string, unknown>): MockToolStep => ({ toolCalls: [{ name: "finish_turn", arguments: { report } }] });

const playerOnlyReport = {
  directiveOutcomes: [{ directiveId: "directive-0", outcome: "carried_out", reason: "The levy went through.", factRefs: ["fact-1-1"] }],
  events: [{ factRefs: ["fact-1-1"], summary: "Rome raises a legion in Latium.", participantCharacterIds: [PLAYER], provinceId: LATIUM, visibility: "public", salience: 7, directiveRef: "directive-0", chainPosition: "root" }],
  openThreads: [],
  turnSummary: "Rome raised Legio I.",
};

describe("the game master loop", () => {
  it("carries out a player order and reports it against the fact the engine produced", async () => {
    const outcome = await run([
      { toolCalls: [{ name: "inspect_character", arguments: { characterId: PLAYER } }] },
      { toolCalls: [{ name: "create_force", arguments: { actorId: PLAYER, polityId: ROME, locationProvinceId: LATIUM, name: "Legio I", size: 4_000, kind: "infantry" } }] },
      // Reported twice: the first report holds nothing but the player's own
      // order, so the session sends it back once for the world to act. The
      // second stands.
      finish(playerOnlyReport),
      finish(playerOnlyReport),
    ]);

    expect(outcome.termination).toBe("reported");
    expect(outcome.world.material.forces.some((force) => force.name === "Legio I")).toBe(true);
    expect(outcome.events.map((event) => event.id)).toEqual(["fact-1-1"]);
    expect(outcome.report?.directiveOutcomes[0]?.outcome).toBe("carried_out");
  });

  it("cannot change the world through prose, however confidently written", async () => {
    const outcome = await run([
      { content: "Rome raises four legions, seizes Panormus, and Hanno is killed in the assault." },
      { content: "As stated, the legions are raised and the city has fallen." },
    ]);

    expect(outcome.termination).toBe("model_stopped");
    expect(outcome.executedInvocations).toHaveLength(0);
    expect(outcome.events).toHaveLength(0);
    expect(JSON.stringify(outcome.world)).toBe(JSON.stringify(world()));
  });

  it("cannot change the world through an invented workflow or a JSON patch", async () => {
    const outcome = await run([
      {
        toolCalls: [
          { name: "levy_sacred_band", arguments: { actorId: PLAYER, polityId: ROME } },
          { name: "apply_patch", arguments: { operations: [{ op: "replace", path: "/map/provinces/0/controllerPolityId", value: CARTHAGE }] } },
        ],
      },
      finish({
        directiveOutcomes: [{ directiveId: "directive-0", outcome: "failed", reason: "No tool exists for it.", factRefs: [] }],
        events: [],
        openThreads: [],
        turnSummary: "Nothing changed.",
      }),
    ]);

    expect(outcome.executedInvocations).toHaveLength(0);
    expect(outcome.world.map.provinces[0]?.controllerPolityId).toBe(world().map.provinces[0]?.controllerPolityId);
    expect(JSON.stringify(outcome.world)).toBe(JSON.stringify(world()));
  });

  it("records an unsupported action as a non-mutating capability request", async () => {
    const outcome = await run([
      {
        toolCalls: [{
          name: "request_capability",
          arguments: {
            requestedIntent: "Marcus wants to swear a public oath binding his heirs to finish the war.",
            whyNoRegisteredToolFits: "Commitments are formed in dialogue; no tool creates a binding multi-generation oath.",
            actorId: PLAYER,
            targetEntityIds: [ROME],
            proposedToolName: "swear_dynastic_oath",
            proposedParameters: [{ name: "characterId", type: "entity_id", required: true, purpose: "Who swears it." }],
            expectedStateEffect: "A commitment that passes to the swearer's heir on death.",
            safetyConstraints: ["Only a living character with an heir may swear one."],
            scenarioContext: "Roman oaths carry real political weight in this scenario.",
          },
        }],
      },
      finish({
        directiveOutcomes: [{ directiveId: "directive-0", outcome: "unsupported", reason: "The simulation does not model dynastic oaths.", factRefs: ["fact-1-1"] }],
        events: [],
        openThreads: [],
        turnSummary: "Marcus attempted an oath the simulation cannot represent.",
      }),
    ]);

    expect(outcome.capabilityRequests).toHaveLength(1);
    expect(outcome.capabilityRequests[0]?.resolution).toBe("unsupported");
    expect(outcome.executedInvocations).toHaveLength(0);
    expect(JSON.stringify(outcome.world)).toBe(JSON.stringify(world()));
  });

  it("lets the world answer a player army at the border with real opposing tools", async () => {
    // Marcus marches a Roman force to the Carthaginian border province; Hanno,
    // who is there, answers with a levy of his own and gives battle. Every
    // step is a registered workflow against the staged world.
    const outcome = await run([
      { toolCalls: [{ name: "create_force", arguments: { actorId: PLAYER, polityId: ROME, locationProvinceId: SICILY_NORTHEAST, name: "Legio I", size: 5_000, kind: "infantry" } }] },
      { toolCalls: [{ name: "inspect_province", arguments: { provinceId: SICILY_NORTHWEST } }] },
      { toolCalls: [{ name: "create_force", arguments: { actorId: "hanno", polityId: CARTHAGE, locationProvinceId: SICILY_NORTHWEST, name: "Carthaginian levy", size: 4_500, kind: "infantry" } }] },
      finish({
        directiveOutcomes: [{ directiveId: "directive-0", outcome: "carried_out", reason: "The legion was raised.", factRefs: ["fact-1-1"] }],
        events: [{ factRefs: ["fact-1-2"], summary: "Carthage answers the Roman muster.", participantCharacterIds: ["hanno"], provinceId: SICILY_NORTHWEST, visibility: "public", salience: 6, directiveRef: null, chainPosition: "reaction" }],
        openThreads: ["Two armies now face each other across north-western Sicily."],
        turnSummary: "Rome and Carthage both mustered in Sicily.",
      }),
    ]);

    expect(outcome.termination).toBe("reported");
    const carthaginian = outcome.world.material.forces.find((force) => force.name === "Carthaginian levy");
    expect(carthaginian).toBeDefined();
    expect(carthaginian?.polityId).toBe(CARTHAGE);
    expect(carthaginian?.commanderCharacterId).toBe("hanno");
    expect(carthaginian?.locationId).toBe(SICILY_NORTHWEST);
  });

  // docs/30: the Game Master can originate an NPC's commitment resolution or
  // social action itself, with no pre-formed proposal at all -- the same
  // unrestricted way it can already originate `create_force` for an NPC.
  it("resolves an NPC's due commitment and records a social action with no pre-formed proposal", async () => {
    const withCommitment: WorldState = {
      ...world(),
      commitments: [{
        id: "hanno-pays-marcus",
        promisorCharacterId: "hanno",
        beneficiaryCharacterId: PLAYER,
        actionKind: "payment",
        description: "Pay tribute for safe passage through Roman waters.",
        conditions: "",
        requiredOfficeId: null,
        requiredResource: { accountId: "hanno-purse", minAmount: 100 },
        visibility: "polity",
        sourceEventId: null,
        breachPressureKind: "humiliation",
        status: "pending",
        createdAtStep: 0,
        reviewAtStep: 1,
        resolvedAtStep: null,
        resolutionReason: null,
      }],
    };
    const outcome = await run(
      [
        { toolCalls: [{ name: "fulfill_commitment", arguments: { actorId: "hanno", commitmentId: "hanno-pays-marcus" } }] },
        { toolCalls: [{ name: "record_character_social_action", arguments: { actorId: "hanno", targetCharacterId: PLAYER, kind: "reconcile", reasonLabel: "Hanno offers a gesture of goodwill after paying the tribute." } }] },
        finish({
          directiveOutcomes: [{ directiveId: "directive-0", outcome: "unsupported", reason: "Not attempted this turn.", factRefs: [] }],
          events: [
            { factRefs: ["fact-1-1"], summary: "Hanno pays tribute.", participantCharacterIds: ["hanno"], provinceId: null, visibility: "public", salience: 4, directiveRef: null, chainPosition: "reaction" },
            { factRefs: ["fact-1-2"], summary: "Hanno reconciles with Marcus.", participantCharacterIds: ["hanno", PLAYER], provinceId: null, visibility: "public", salience: 3, directiveRef: null, chainPosition: "reaction" },
          ],
          openThreads: [],
          turnSummary: "Hanno pays his debt and mends the relationship.",
        }),
      ],
      { world: withCommitment },
    );

    expect(outcome.termination).toBe("reported");
    expect(outcome.world.commitments.find((c) => c.id === "hanno-pays-marcus")?.status).toBe("fulfilled");
    expect(outcome.world.material.accounts.find((a) => a.id === "hanno-purse")?.balance).toBe(800);
    const marcus = outcome.world.characters.find((c) => c.id === PLAYER);
    expect(marcus?.relations.find((r) => r.subjectCharacterId === "hanno")?.causes.some((c) => c.label.includes("goodwill"))).toBe(true);
  });

  // docs/32: the Game Master can likewise originate the newer NPC commands
  // (renegotiate_commitment, spread_belief) with no pre-formed proposal.
  it("renegotiates an NPC's commitment and lets it share a belief, with no pre-formed proposal", async () => {
    const withCommitment: WorldState = {
      ...world(),
      commitments: [{
        id: "hanno-pays-marcus",
        promisorCharacterId: "hanno",
        beneficiaryCharacterId: PLAYER,
        actionKind: "payment",
        description: "Pay tribute for safe passage through Roman waters.",
        conditions: "",
        requiredOfficeId: null,
        requiredResource: { accountId: "hanno-purse", minAmount: 900_000 },
        visibility: "polity",
        sourceEventId: null,
        breachPressureKind: "humiliation",
        status: "pending",
        createdAtStep: 0,
        reviewAtStep: 1,
        resolvedAtStep: null,
        resolutionReason: null,
      }],
    };
    const outcome = await run(
      [
        { toolCalls: [{ name: "renegotiate_commitment", arguments: { actorId: "hanno", commitmentId: "hanno-pays-marcus", description: "Pay a smaller tribute instead.", requiredResource: { accountId: "hanno-purse", minAmount: 100 } } }] },
        { toolCalls: [{ name: "spread_belief", arguments: { actorId: "hanno", targetCharacterId: PLAYER, subjectEntityId: "rome", claim: "Carthage is reinforcing its Sicilian garrisons.", kind: "rumour" } }] },
        finish({
          directiveOutcomes: [{ directiveId: "directive-0", outcome: "unsupported", reason: "Not attempted this turn.", factRefs: [] }],
          events: [
            { factRefs: ["fact-1-1"], summary: "Hanno proposes smaller tribute.", participantCharacterIds: ["hanno"], provinceId: null, visibility: "public", salience: 4, directiveRef: null, chainPosition: "reaction" },
            { factRefs: ["fact-1-2"], summary: "Hanno tells Marcus what he knows.", participantCharacterIds: ["hanno", PLAYER], provinceId: null, visibility: "public", salience: 3, directiveRef: null, chainPosition: "reaction" },
          ],
          openThreads: [],
          turnSummary: "Hanno renegotiates and shares what he knows.",
        }),
      ],
      { world: withCommitment },
    );

    expect(outcome.termination).toBe("reported");
    const commitment = outcome.world.commitments.find((c) => c.id === "hanno-pays-marcus");
    expect(commitment?.status).toBe("pending");
    expect(commitment?.requiredResource).toEqual({ accountId: "hanno-purse", minAmount: 100 });
    const marcusBelief = outcome.world.characterBeliefs.find((b) => b.holderCharacterId === PLAYER && b.claim === "Carthage is reinforcing its Sicilian garrisons.");
    expect(marcusBelief).toBeDefined();
    expect(marcusBelief?.kind).toBe("rumour");
  });

  it("fights a started battle deterministically and hands the result back before the next decision", async () => {
    const base = world();
    const attacker = base.material.forces[0];
    expect(attacker).toBeDefined();
    // A second, opposing force standing where the first one is, so the two can
    // actually meet. Built here rather than through a tool so the test is
    // about battle resolution, not about levying.
    const defender = {
      ...structuredClone(attacker!),
      id: "carthaginian-host",
      name: "Carthaginian host",
      polityId: CARTHAGE,
      commanderCharacterId: "hanno",
      controllerCharacterId: "hanno",
      locationId: attacker!.locationId,
    };
    const colocated = WorldStateSchema.parse({
      ...base,
      material: { ...base.material, forces: [...base.material.forces, defender] },
    });

    let seenBattleResult = "";
    const adapter = createMockAdapter("{}", {
      toolSteps: [
        { toolCalls: [{ name: "start_battle", arguments: { actorId: PLAYER, battleId: "battle-1", attackingForceIds: [attacker!.id], defendingForceIds: [defender.id] } }] },
        finish({
          directiveOutcomes: [{ directiveId: "directive-0", outcome: "carried_out", reason: "Battle joined.", factRefs: ["fact-1-1"] }],
          events: [],
          openThreads: [],
          turnSummary: "A battle was fought.",
        }),
      ],
      onConversation: (messages) => {
        for (const message of messages) {
          if (message.role === "tool_results") {
            for (const result of message.results) if (result.name === "start_battle") seenBattleResult = result.content;
          }
        }
      },
    });

    const outcome = await runGameMaster(adapter, {
      world: colocated,
      atStep: 1,
      actorCharacterId: PLAYER,
      directives: [{ id: "directive-0", directive: { kind: "new", text: "Attack." } }],
      selectedCharacters: [],
      playerContext: undefined,
      scenarioGovernment: undefined,
      scenarioChronicle: undefined,
    });

    // The engine resolved the battle inside the same call, so the agent saw a
    // real outcome rather than deciding one.
    expect(outcome.events.some((event) => event.actionId === "resolve_battle")).toBe(true);
    expect(outcome.events.find((event) => event.actionId === "resolve_battle")?.battleBrief).toBeDefined();
    expect(seenBattleResult.split("\n").length).toBeGreaterThan(1);
    expect(outcome.world.conflicts.battles.find((battle) => battle.battleId === "battle-1")).toBeUndefined();
  });

  it("keeps whatever the tools already did when the model never finishes", async () => {
    const outcome = await run([
      { toolCalls: [{ name: "create_force", arguments: { actorId: PLAYER, polityId: ROME, locationProvinceId: LATIUM, name: "Legio IX", size: 4_000, kind: "infantry" } }] },
      { content: "I think that is enough." },
      { content: "Still enough." },
    ]);

    expect(outcome.termination).toBe("model_stopped");
    expect(outcome.report).toBeNull();
    // The levy really happened; it is not rolled back because the report never came.
    expect(outcome.world.material.forces.some((force) => force.name === "Legio IX")).toBe(true);
  });

  it("repairs a placeholder force id end to end without creating a false Chronicle refusal", async () => {
    // This is the full path behind the player-facing card: a model first
    // emits the bad `force-?` placeholder, receives the deterministic lookup
    // failure, then uses the real id it was given. The audit keeps the error
    // for diagnosis, while the persistent-order and Chronicle layers receive
    // only the actual march.
    const outcome = await run([
      { toolCalls: [{ name: "move_force", arguments: { actorId: PLAYER, forceId: "force-?", destinationProvinceId: SICILY_NORTHWEST } }] },
      { toolCalls: [{ name: "move_force", arguments: { actorId: PLAYER, forceId: "legio-i", destinationProvinceId: SICILY_NORTHWEST } }] },
      finish({
        directiveOutcomes: [{ directiveId: "directive-0", outcome: "carried_out", reason: "Legio I marched west.", factRefs: ["fact-1-1"] }],
        events: [],
        openThreads: [],
        turnSummary: "Legio I marched west.",
      }),
      finish({
        directiveOutcomes: [{ directiveId: "directive-0", outcome: "carried_out", reason: "Legio I marched west.", factRefs: ["fact-1-1"] }],
        events: [],
        openThreads: [],
        turnSummary: "Legio I marched west.",
      }),
    ]);

    expect(outcome.report).not.toBeNull();
    expect(outcome.executedInvocations).toEqual([
      { actionId: "move_force", actorId: PLAYER, parameters: { forceId: "legio-i", destinationProvinceId: SICILY_NORTHWEST } },
    ]);

    const projection = projectOrdersAndOperations({
      previousActions: [],
      previousOperations: [],
      candidates: outcome.auditEntries,
      turnIndex: 1,
      atStep: 1,
      isLongRunningAction: (actionId) => actionId === "move_force",
    });
    expect(projection.refusals).toEqual([]);

    const entries = buildChronicleFromFacts({
      world: outcome.world,
      atStep: 1,
      actorCharacterId: PLAYER,
      events: outcome.events,
      report: outcome.report,
      directiveIds: ["directive-0"],
    });
    expect(entries).toHaveLength(1);
    expect(`${entries[0]?.title} ${entries[0]?.body}`).not.toContain("force-?");
    expect(`${entries[0]?.title} ${entries[0]?.body}`).not.toMatch(/refused|nothing in the world answers/i);
  });

  it("survives a provider failure with the stage it had reached", async () => {
    const failing = createMockAdapter("{}");
    failing.callWithTools = () => Promise.reject(new Error("provider exploded"));

    const outcome = await runGameMaster(failing, {
      world: world(),
      atStep: 1,
      actorCharacterId: PLAYER,
      directives: [{ id: "directive-0", directive: { kind: "new", text: "Do something." } }],
      selectedCharacters: [],
      playerContext: undefined,
      scenarioGovernment: undefined,
      scenarioChronicle: undefined,
    });

    expect(outcome.termination).toBe("provider_error");
    expect(outcome.providerError).toContain("provider exploded");
    expect(JSON.stringify(outcome.world)).toBe(JSON.stringify(world()));
    // Nothing was staged, so the pipeline treats this as an outage and refuses
    // to commit an empty turn over it.
    expect(outcome.executedInvocations).toHaveLength(0);
    expect(outcome.capabilityRequests).toHaveLength(0);
  });

  it("keeps the work it completed when the provider dies partway through", async () => {
    let step = 0;
    const flaky = createMockAdapter("{}", {
      toolSteps: [{ toolCalls: [{ name: "create_force", arguments: { actorId: PLAYER, polityId: ROME, locationProvinceId: LATIUM, name: "Legio X", size: 4_000, kind: "infantry" } }] }],
    });
    const scripted = flaky.callWithTools.bind(flaky);
    flaky.callWithTools = (...args: Parameters<typeof scripted>) => {
      step += 1;
      return step === 1 ? scripted(...args) : Promise.reject(new Error("provider exploded"));
    };

    const outcome = await runGameMaster(flaky, {
      world: world(),
      atStep: 1,
      actorCharacterId: PLAYER,
      directives: [{ id: "directive-0", directive: { kind: "new", text: "Raise a legion." } }],
      selectedCharacters: [],
      playerContext: undefined,
      scenarioGovernment: undefined,
      scenarioChronicle: undefined,
    });

    expect(outcome.termination).toBe("provider_error");
    // Real, validated work survives an outage that arrives after it.
    expect(outcome.executedInvocations).toHaveLength(1);
    expect(outcome.world.material.forces.some((force) => force.name === "Legio X")).toBe(true);
  });

  it("executes a formed NPC proposal when the model calls the exact workflow it named", async () => {
    // Regression: a formed NPC intention used to be summarized as loose prose
    // the Game Master could act on only by independently reinventing the
    // same workflow. Handed the exact invocation instead, a model that simply
    // calls it should see the real workflow execute -- proving the proposal
    // reached the session, not just the prompt.
    const outcome = await run(
      [
        { toolCalls: [{ name: "create_force", arguments: { actorId: PLAYER, polityId: ROME, locationProvinceId: LATIUM, name: "Legio I", size: 4_000, kind: "infantry" } }] },
        { toolCalls: [{ name: "remove_gold", arguments: { actorId: "hanno", accountId: "hanno-purse", amount: 50, reason: "Bribes an informant." } }] },
        finish({
          directiveOutcomes: [{ directiveId: "directive-0", outcome: "carried_out", reason: "The levy went through.", factRefs: ["fact-1-1"] }],
          // A directiveRef-less event with real facts satisfies the session's
          // own "the world must act too" check in one pass, since the world
          // (Hanno) already acted on its own here.
          events: [{ factRefs: ["fact-1-2"], summary: "Hanno spends gold on an informant.", participantCharacterIds: ["hanno"], provinceId: null, visibility: "private", salience: 4, directiveRef: null, chainPosition: "spread" }],
          openThreads: [],
          turnSummary: "Rome raised Legio I; Hanno bribed an informant.",
        }),
      ],
      {
        npcProposals: [{
          intentId: "intent-hanno-1",
          actorCharacterId: "hanno",
          actionType: "economic_action",
          rationale: "Hanno manages remaining funds to reduce exposure.",
          workflowIds: ["remove_gold"],
          invocation: { actionId: "remove_gold", actorId: "hanno", parameters: { accountId: "hanno-purse", amount: 50, reason: "Bribes an informant." } },
        }],
      },
    );

    expect(outcome.executedInvocations.some((invocation) => invocation.actionId === "remove_gold" && invocation.actorId === "hanno")).toBe(true);
    const hannoAccount = outcome.world.material.accounts.find((account) => account.id === "hanno-purse");
    expect(hannoAccount?.balance).toBe(850);
  });
});
