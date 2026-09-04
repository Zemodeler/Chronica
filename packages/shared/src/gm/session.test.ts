import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { WorldStateSchema, type WorldState } from "../world/world-state";
import { createGameMasterSession } from "./session";
import { FINISH_TURN_TOOL, REQUEST_CAPABILITY_TOOL, buildGameMasterTools } from "./tools";

// The staged tool loop is the whole safety story of the Game Master
// architecture, so these tests are written from the outside: give the session
// what a model might send it, and check what the world looks like afterwards.

const PLAYER = "marcus-atilius";
const ROME = "rome";
const LATIUM = "ita-local-23120603B86473916475875";

function world(): WorldState {
  return structuredClone(firstPunicWarScenario.initialWorld);
}

function session(overrides: { directiveIds?: string[] } = {}) {
  return createGameMasterSession({
    world: world(),
    atStep: 1,
    actorCharacterId: PLAYER,
    directiveIds: overrides.directiveIds ?? [],
  });
}

let callCounter = 0;
function call(name: string, args: Record<string, unknown>) {
  callCounter += 1;
  return { id: `call-${callCounter}`, name, arguments: args };
}

describe("game master tool surface", () => {
  it("exposes read tools, registered workflows, the capability safeguard, and nothing else", () => {
    const names = new Set(buildGameMasterTools().map((tool) => tool.name));

    expect(names.has("inspect_world")).toBe(true);
    expect(names.has("inspect_actor_memory")).toBe(true);
    expect(names.has("create_force")).toBe(true);
    expect(names.has(REQUEST_CAPABILITY_TOOL)).toBe(true);
    expect(names.has(FINISH_TURN_TOOL)).toBe(true);

    // No generic mutation surface exists for the model to reach for.
    for (const forbidden of ["apply_patch", "set_state", "invent_workflow", "create_workflow", "write_world"]) {
      expect(names.has(forbidden)).toBe(false);
    }
    // The deterministic engine's own entry point is not offered at all.
    expect(names.has("resolve_battle")).toBe(false);
  });
});

describe("a valid levy", () => {
  it("produces a force that is named, commanded, located, and usable at once", () => {
    const gm = session();
    const outcome = gm.invoke(call("create_force", {
      actorId: PLAYER,
      polityId: ROME,
      locationProvinceId: LATIUM,
      name: "Legio II",
      size: 4_000,
      kind: "infantry",
    }));

    expect(outcome.ok).toBe(true);
    const force = gm.stagedWorld.material.forces.find((candidate) => candidate.name === "Legio II");
    expect(force).toBeDefined();
    expect(force?.commanderCharacterId).toBe(PLAYER);
    expect(force?.controllerCharacterId).toBe(PLAYER);
    expect(force?.locationId).toBe(LATIUM);
    expect(force?.personnel.reduce((sum, category) => sum + category.fit, 0)).toBe(4_000);
    // Usable immediately: the very next tool call can order it somewhere.
    const moved = gm.invoke(call("move_force", {
      actorId: PLAYER,
      forceId: force!.id,
      destinationProvinceId: "ita-72843720b81376294924159-sicily-west",
    }));
    expect(moved.ok).toBe(true);
    expect(gm.stagedWorld.material.forces.find((candidate) => candidate.id === force!.id)?.locationId)
      .toBe("ita-72843720b81376294924159-sicily-west");
  });
});

describe("an invalid levy", () => {
  it("is refused with the exact deterministic reason, not an institutional story", () => {
    const gm = session();
    const outcome = gm.invoke(call("create_force", {
      actorId: PLAYER,
      polityId: "atlantis",
      locationProvinceId: LATIUM,
      name: "Phantom Legion",
      size: 4_000,
      kind: "infantry",
    }));

    expect(outcome.ok).toBe(false);
    expect(outcome.factual).toContain("create_force");
    // The refusal names the thing that does not exist, so the caller can fix
    // it rather than merely report that the levy failed.
    expect(outcome.factual).toContain('polityId "atlantis"');
    expect(outcome.factual).toMatch(/inspect/i);
    // No invented explanation: the reason names the mechanism, not the Senate.
    expect(outcome.factual).not.toMatch(/senate|treasury exhausted|the levy was refused by/i);
    expect(gm.stagedWorld.material.forces.some((force) => force.name === "Phantom Legion")).toBe(false);
  });

  it("reports a schema violation exactly rather than silently clamping it", () => {
    const gm = session();
    const outcome = gm.invoke(call("create_force", {
      actorId: PLAYER,
      polityId: ROME,
      locationProvinceId: LATIUM,
      name: "Too Few",
      size: 3,
      kind: "infantry",
    }));

    expect(outcome.ok).toBe(false);
    expect(outcome.factual).toContain("Invalid parameters");
    expect(gm.stagedWorld.material.forces.some((force) => force.name === "Too Few")).toBe(false);
  });

  it("refuses an action attributed to a character who does not exist", () => {
    const gm = session();
    const outcome = gm.invoke(call("create_force", {
      actorId: "nobody-at-all",
      polityId: ROME,
      locationProvinceId: LATIUM,
      name: "Ghost Legion",
      size: 4_000,
      kind: "infantry",
    }));

    expect(outcome.ok).toBe(false);
    expect(outcome.factual).toContain("does not exist in world state");
  });

  it("refuses an action attributed to a dead character", () => {
    const base = world();
    const dead = { ...base, characters: base.characters.map((character) => character.id === PLAYER ? { ...character, alive: false, diedAtStep: 0 } : character) };
    const gm = createGameMasterSession({ world: WorldStateSchema.parse(dead), atStep: 1, actorCharacterId: PLAYER, directiveIds: [] });

    const outcome = gm.invoke(call("create_force", {
      actorId: PLAYER, polityId: ROME, locationProvinceId: LATIUM, name: "Legio Mortis", size: 4_000, kind: "infantry",
    }));

    expect(outcome.ok).toBe(false);
    expect(outcome.factual).toMatch(/is dead and cannot invoke workflows/);
  });
});

describe("the routes that used to let a model write state", () => {
  it("changes nothing when the model only writes prose", () => {
    const gm = session();
    const before = JSON.stringify(gm.stagedWorld);

    // Prose never reaches the session at all -- the loop only forwards tool
    // calls -- but a model naming a tool that does not exist is the closest
    // thing to it, and that is refused rather than interpreted.
    const outcome = gm.invoke(call("narrate", { text: "Rome raises four fresh legions and marches on Messana." }));

    expect(outcome.ok).toBe(false);
    expect(outcome.factual).toContain("There is no tool named");
    expect(JSON.stringify(gm.stagedWorld)).toBe(before);
  });

  it("cannot mutate through an invented workflow", () => {
    const gm = session();
    const before = JSON.stringify(gm.stagedWorld);

    const outcome = gm.invoke(call("levy_sacred_band", {
      actorId: PLAYER,
      operations: [{ op: "add", path: "/material/forces/-", value: { name: "Sacred Band" } }],
    }));

    expect(outcome.ok).toBe(false);
    expect(outcome.factual).toContain("There is no tool named");
    expect(JSON.stringify(gm.stagedWorld)).toBe(before);
  });

  it("cannot mutate through a JSON patch smuggled into a capability request", () => {
    const gm = session();
    const before = JSON.stringify(gm.stagedWorld);

    const outcome = gm.invoke(call(REQUEST_CAPABILITY_TOOL, {
      requestedIntent: "Apply {\"op\":\"replace\",\"path\":\"/characters[id=hieron-ii]/healthBps\",\"value\":0}",
      whyNoRegisteredToolFits: "No tool kills by decree.",
      actorId: PLAYER,
      targetEntityIds: ["hieron-ii"],
      proposedToolName: "decree_death",
      proposedParameters: [],
      expectedStateEffect: "Sets healthBps to 0.",
      safetyConstraints: [],
      scenarioContext: "Rome wishes Hieron gone.",
    }));

    expect(outcome.ok).toBe(false);
    expect(outcome.factual).toMatch(/capability request/i);
    expect(JSON.stringify(gm.stagedWorld)).toBe(before);
    expect(gm.result().capabilityRequests).toHaveLength(0);
  });
});

describe("the capability-gap safeguard", () => {
  it("records an unsupported attempt without changing anything", () => {
    const gm = session();
    const before = JSON.stringify(gm.stagedWorld);

    const outcome = gm.invoke(call(REQUEST_CAPABILITY_TOOL, {
      requestedIntent: "Gaius wants to found a colony of veterans on captured land, granting them citizenship.",
      whyNoRegisteredToolFits: "found_settlement places a settlement but models neither land grants nor citizenship.",
      actorId: PLAYER,
      targetEntityIds: [LATIUM],
      proposedToolName: "found_veteran_colony",
      proposedParameters: [
        { name: "provinceId", type: "entity_id", required: true, purpose: "Where the colony is planted." },
        { name: "settlers", type: "number", required: true, purpose: "How many veterans are settled." },
      ],
      expectedStateEffect: "A new settlement whose population is drawn from a disbanded force, with a standing claim on the province.",
      safetyConstraints: ["Only on land the founding polity actually controls."],
      scenarioContext: "Rome traditionally settles veterans to hold newly taken ground.",
    }));

    expect(outcome.ok).toBe(true);
    expect(outcome.factual).toContain("Nothing changed in the world");
    expect(JSON.stringify(gm.stagedWorld)).toBe(before);

    const result = gm.result();
    expect(result.capabilityRequests).toHaveLength(1);
    expect(result.capabilityRequests[0]?.resolution).toBe("unsupported");
    expect(result.capabilityRequests[0]?.request.proposedToolName).toBe("found_veteran_colony");
    // It is on the factual record as an attempt with no material consequence.
    const gap = result.events.find((event) => event.kind === "capability_gap");
    expect(gap?.materialConsequence).toBe(false);
    // Recorded as history: the attempt was made and went nowhere. The reader
    // is never told about the machine that failed to model it.
    expect(gap?.summary).toContain("It went no further");
    expect(gap?.summary).not.toMatch(/simulation|model|workflow|world change/i);
  });
});

describe("the turn report", () => {
  it("is rejected when it claims a fact that never happened", () => {
    const gm = session({ directiveIds: ["directive-0"] });
    const outcome = gm.invoke(call(FINISH_TURN_TOOL, {
      report: {
        directiveOutcomes: [{ directiveId: "directive-0", outcome: "carried_out", reason: "Done.", factRefs: ["fact-1-99"] }],
        events: [],
        openThreads: [],
        turnSummary: "Rome raised a legion.",
      },
    }));

    expect(outcome.ok).toBe(false);
    expect(outcome.finished).toBe(false);
    expect(outcome.factual).toContain("references facts that never happened");
    expect(gm.result().report).toBeNull();
  });

  it("is rejected when a submitted directive is left unaccounted for", () => {
    const gm = session({ directiveIds: ["directive-0", "directive-1"] });
    const outcome = gm.invoke(call(FINISH_TURN_TOOL, {
      report: {
        directiveOutcomes: [{ directiveId: "directive-0", outcome: "refused", reason: "No authority.", factRefs: [] }],
        events: [],
        openThreads: [],
        turnSummary: "Nothing happened.",
      },
    }));

    expect(outcome.ok).toBe(false);
    expect(outcome.factual).toContain("directive-1");
  });

  it("is accepted when every fact it cites is one the engine produced", () => {
    const gm = session({ directiveIds: ["directive-0"] });
    const levy = gm.invoke(call("create_force", {
      actorId: PLAYER, polityId: ROME, locationProvinceId: LATIUM, name: "Legio III", size: 4_000, kind: "infantry",
    }));
    expect(levy.factId).toBeDefined();

    const playerOnly = {
      directiveOutcomes: [{ directiveId: "directive-0", outcome: "carried_out", reason: "The levy went through.", factRefs: [levy.factId!] }],
      events: [{ factRefs: [levy.factId!], summary: "Rome raises a legion.", participantCharacterIds: [PLAYER], provinceId: LATIUM, visibility: "public", salience: 7, directiveRef: "directive-0", chainPosition: "root" }],
      openThreads: [],
      turnSummary: "Rome raised Legio III in Latium.",
    };

    // A turn in which only the player acted is pushed back once: the rest of
    // the world was not waiting on him.
    const pushedBack = gm.invoke(call(FINISH_TURN_TOOL, { report: playerOnly }));
    expect(pushedBack.ok).toBe(false);
    expect(pushedBack.factual).toContain("nothing but the player's own orders");
    expect(gm.isFinished).toBe(false);

    // ...and only once. A second look that finds nothing still ends the turn.
    const finished = gm.invoke(call(FINISH_TURN_TOOL, { report: playerOnly }));

    expect(finished.ok).toBe(true);
    expect(gm.isFinished).toBe(true);
    expect(gm.result().report?.turnSummary).toContain("Legio III");
    // A finished turn accepts nothing further.
    expect(gm.invoke(call("create_force", { actorId: PLAYER, polityId: ROME, locationProvinceId: LATIUM, name: "Late Legion", size: 4_000, kind: "infantry" })).ok).toBe(false);
    expect(gm.stagedWorld.material.forces.some((force) => force.name === "Late Legion")).toBe(false);
  });
});

describe("reads", () => {
  it("answer factually and change nothing", () => {
    const gm = session();
    const before = JSON.stringify(gm.stagedWorld);

    const overview = gm.invoke(call("inspect_world", {}));
    expect(overview.ok).toBe(true);
    expect(overview.factual).toContain("Roman Republic");

    const actor = gm.invoke(call("inspect_character", { characterId: PLAYER }));
    expect(actor.ok).toBe(true);
    expect(actor.factual).toContain("is alive");

    const missing = gm.invoke(call("inspect_force", { forceId: "no-such-force" }));
    expect(missing.ok).toBe(false);
    expect(missing.factual).toContain("No force with id");

    expect(JSON.stringify(gm.stagedWorld)).toBe(before);
    expect(gm.result().events).toHaveLength(0);
  });

  it("withhold private records unless the scenario allows them", () => {
    const secret = "Hanno privately doubts Carthage can hold Sicily.";
    const withSecret = WorldStateSchema.parse({
      ...world(),
      characterBeliefs: [{
        id: "hanno-private-doubt",
        holderCharacterId: "hanno",
        subjectEntityId: "carthage",
        claim: secret,
        kind: "suspicion",
        sourceCharacterId: null,
        sourceEventId: null,
        confidence: 60,
        visibility: "private",
        learnedAtStep: 0,
        expiresAtStep: null,
        supersedesBeliefIds: [],
        status: "active",
      }],
    });

    const withheld = createGameMasterSession({ world: withSecret, atStep: 1, actorCharacterId: PLAYER, directiveIds: [] })
      .invoke(call("inspect_actor_memory", { characterId: "hanno" }));
    expect(withheld.factual).toContain("Private-visibility records are withheld");
    expect(withheld.factual).not.toContain(secret);

    const allowed = createGameMasterSession({ world: withSecret, atStep: 1, actorCharacterId: PLAYER, directiveIds: [], privateInformation: "allow" })
      .invoke(call("inspect_actor_memory", { characterId: "hanno" }));
    expect(allowed.factual).toContain(secret);
  });
});

describe("the audit and the stage", () => {
  it("records every call with its exact outcome and leaves the stage clean after a failure", () => {
    const gm = session();
    gm.invoke(call("create_force", { actorId: PLAYER, polityId: ROME, locationProvinceId: LATIUM, name: "Legio IV", size: 4_000, kind: "infantry" }));
    const stageAfterSuccess = JSON.stringify(gm.stagedWorld);
    gm.invoke(call("move_force", { actorId: PLAYER, forceId: "not-a-force", destinationProvinceId: LATIUM }));

    expect(JSON.stringify(gm.stagedWorld)).toBe(stageAfterSuccess);
    const audit = gm.result().auditEntries;
    expect(audit).toHaveLength(2);
    expect(audit[0]?.executionOk).toBe(true);
    expect(audit[1]?.executionOk).toBe(false);
    expect(audit[1]?.executionReason).toContain("move_force");
  });

  it("refuses an exact repeat of an action already carried out this turn", () => {
    const gm = session();
    const args = { actorId: PLAYER, polityId: ROME, locationProvinceId: LATIUM, name: "Legio V", size: 4_000, kind: "infantry" };
    expect(gm.invoke(call("create_force", args)).ok).toBe(true);
    const repeat = gm.invoke(call("create_force", args));
    expect(repeat.ok).toBe(false);
    expect(repeat.factual).toContain("already been carried out this turn");
    expect(gm.stagedWorld.material.forces.filter((force) => force.name === "Legio V")).toHaveLength(1);
  });

  it("stops accepting world changes once the action budget is spent", () => {
    const gm = createGameMasterSession({ world: world(), atStep: 1, actorCharacterId: PLAYER, directiveIds: [], maxActions: 1 });
    expect(gm.invoke(call("create_force", { actorId: PLAYER, polityId: ROME, locationProvinceId: LATIUM, name: "Legio VI", size: 4_000, kind: "infantry" })).ok).toBe(true);
    const second = gm.invoke(call("create_force", { actorId: PLAYER, polityId: ROME, locationProvinceId: LATIUM, name: "Legio VII", size: 4_000, kind: "infantry" }));
    expect(second.ok).toBe(false);
    expect(second.factual).toContain("action budget");
    expect(gm.stagedWorld.material.forces.some((force) => force.name === "Legio VII")).toBe(false);
  });
});

describe("existing saves", () => {
  it("parse safely without the campaign memory this refactor added", () => {
    const legacy = structuredClone(firstPunicWarScenario.initialWorld) as Record<string, unknown>;
    delete legacy["campaignMemory"];

    const parsed = WorldStateSchema.safeParse(legacy);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.campaignMemory.recentTurns).toEqual([]);
    expect(parsed.data.campaignMemory.durableSummary).toBe("");
  });
});
