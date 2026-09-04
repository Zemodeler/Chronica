import { describe, expect, it } from "vitest";
import { createMockAdapter, type MockToolStep } from "@chronica/ai";
import { firstPunicWarScenario } from "@chronica/db";
import { WorldStateSchema, type WorldState } from "@chronica/shared";
import { runGameMaster } from "./game-master";

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
});
