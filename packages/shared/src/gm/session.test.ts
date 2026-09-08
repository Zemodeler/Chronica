import { describe, expect, it } from "vitest";
import { firstPunicWarScenario, punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, type WorldState } from "../world/world-state";
import { createGameMasterSession } from "./session";
import { FINISH_TURN_TOOL, RECORD_REFUSAL_AFTERMATH_TOOL, REQUEST_CAPABILITY_TOOL, buildGameMasterTools } from "./tools";

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

function punicWorld(): WorldState {
  return structuredClone(punicWarsScenario.initialWorld);
}

function punicSession() {
  return createGameMasterSession({
    world: punicWorld(),
    atStep: 1,
    actorCharacterId: "gaius-genucius",
    directiveIds: [],
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
    expect(names.has(RECORD_REFUSAL_AFTERMATH_TOOL)).toBe(true);

    // No generic mutation surface exists for the model to reach for.
    for (const forbidden of ["apply_patch", "set_state", "invent_workflow", "create_workflow", "write_world"]) {
      expect(names.has(forbidden)).toBe(false);
    }
    // The deterministic engine's own entry point is not offered at all.
    expect(names.has("resolve_battle")).toBe(false);
  });
});

describe("director-created characters", () => {
  it("returns a created id and lets that new character use a workflow in the same turn", () => {
    const gm = createGameMasterSession({
      world: world(),
      atStep: 1,
      actorCharacterId: PLAYER,
      directiveIds: [],
    });
    const first = gm.invoke(call("create_world_character", {
      actorId: PLAYER,
      characterId: "char-director-first",
      name: "Aulus Fabius",
      polityId: ROME,
      locationProvinceId: LATIUM,
      officeId: null,
      provenance: { reason: "The director needs a named envoy.", storylineId: null, createdByDirector: true },
    }));
    expect(first.ok).toBe(true);
    expect(first.factual).toContain("char-director-first");

    const second = gm.invoke(call("create_world_character", {
      actorId: "char-director-first",
      characterId: "char-director-second",
      name: "Lucius Fabius",
      polityId: ROME,
      locationProvinceId: LATIUM,
      officeId: null,
      provenance: { reason: "The new envoy appoints a named assistant.", storylineId: null, createdByDirector: true },
    }));
    expect(second.ok).toBe(true);
    expect(gm.stagedWorld.characters.some((character) => character.id === "char-director-second")).toBe(true);
  });
});

describe("a named refusal aftermath", () => {
  it("gives a real refusal a named voice and records the relationship damage", () => {
    const gm = session();
    const refusal = gm.invoke(call("remove_gold", {
      actorId: PLAYER,
      accountId: "hanno-purse",
      amount: 100,
      reason: "A confiscation ordered without Carthaginian consent.",
    }));

    expect(refusal.ok).toBe(false);
    expect(refusal.refusalId).toBeDefined();
    expect(refusal.factual).toContain(RECORD_REFUSAL_AFTERMATH_TOOL);

    const aftermath = gm.invoke(call(RECORD_REFUSAL_AFTERMATH_TOOL, {
      refusalId: refusal.refusalId,
      refuserCharacterId: "quintus-fabius",
      reason: "The Senate will not fund a commander's private quarrel.",
      quote: "ROME NON REGEM HABET.",
    }));

    expect(aftermath.ok).toBe(true);
    expect(aftermath.factId).toBeDefined();
    expect(aftermath.factual).toContain("ROME NON REGEM HABET");
    const marcus = gm.stagedWorld.characters.find((character) => character.id === PLAYER)!;
    const cause = marcus.relations.find((relation) => relation.subjectCharacterId === "quintus-fabius")?.causes[0];
    expect(cause?.label).toContain("private quarrel");
    expect(cause?.dimensions).toMatchObject({ trust: -8, respect: -12 });
    expect(gm.result().events.find((event) => event.id === aftermath.factId)?.materialConsequence).toBe(false);
  });

  it("never allows a bad id to acquire a fictional speaker", () => {
    const gm = session();
    const mistaken = gm.invoke(call("create_force", {
      actorId: PLAYER,
      polityId: "atlantis",
      locationProvinceId: LATIUM,
      name: "Phantom Legion",
      size: 4_000,
      kind: "infantry",
    }));

    expect(mistaken.refusalId).toBeUndefined();
    const fabricated = gm.invoke(call(RECORD_REFUSAL_AFTERMATH_TOOL, {
      refusalId: "refusal-1-1",
      refuserCharacterId: "quintus-fabius",
      reason: "Because no one trusted the maps.",
      quote: "Not even Neptune keeps accounts in Atlantis.",
    }));
    expect(fabricated.ok).toBe(false);
    expect(JSON.stringify(gm.stagedWorld)).toContain("marcus-atilius");
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
    // An internal audit record: it never becomes player-facing history.
    expect(gap?.summary).toContain("requested an unsupported capability");
    expect(gap?.summary).toContain("No world change was applied");
  });

  it("requires one validated repair attempt before the turn can finish", () => {
    const gm = session();
    const capability = gm.invoke(call(REQUEST_CAPABILITY_TOOL, {
      requestedIntent: "Gaius wants to establish a veteran colony on Roman land.",
      whyNoRegisteredToolFits: "The requested colony mechanics are not yet modelled.",
      actorId: PLAYER,
      targetEntityIds: [LATIUM],
      proposedToolName: "found_veteran_colony",
      proposedParameters: [],
      expectedStateEffect: "A permanent colony is established.",
      safetyConstraints: [],
      scenarioContext: "Rome is rewarding veterans.",
    }));
    expect(capability.ok).toBe(true);

    const blocked = gm.invoke(call(FINISH_TURN_TOOL, {
      report: { directiveOutcomes: [], events: [], openThreads: [], turnSummary: "The turn ends." },
    }));
    expect(blocked.ok).toBe(false);
    expect(blocked.factual).toContain("repair these unsupported attempts");

    const repair = gm.invoke(call("create_force", {
      actorId: PLAYER,
      polityId: ROME,
      locationProvinceId: LATIUM,
      name: "Veteran Levy",
      size: 4_000,
      kind: "infantry",
    }));
    expect(repair.ok).toBe(true);

    const afterRepair = gm.invoke(call(FINISH_TURN_TOOL, {
      report: { directiveOutcomes: [], events: [], openThreads: [], turnSummary: "The turn ends." },
    }));
    expect(afterRepair.factual).not.toContain("repair these unsupported attempts");
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

// Regression: a siege attempted with the display name "messana" was refused
// because the authoritative id is "settlement-messana", and that refusal
// reached the player as history -- "the siege was refused" -- when nothing
// about the world had actually said no. A bad/missing id or invalid call
// arguments must never be reported as a real refusal without at least one
// corrected retry.
describe("a recoverable lookup failure (start_siege named the wrong settlement id)", () => {
  it("is refused, naming the real id, when start_siege is called with the display name instead of the authoritative id", () => {
    const gm = punicSession();
    const outcome = gm.invoke(call("start_siege", {
      actorId: "hieron-ii",
      settlementId: "messana",
      invadingForceIds: ["syracusan-army"],
    }));

    expect(outcome.ok).toBe(false);
    expect(outcome.factual).toContain('No settlement exists with the id "messana"');
    expect(outcome.factual).toContain("settlement-messana");
  });

  it("refuses to finish the turn until that recoverable failure is retried", () => {
    const gm = punicSession();
    gm.invoke(call("start_siege", { actorId: "hieron-ii", settlementId: "messana", invadingForceIds: ["syracusan-army"] }));

    const attempted = gm.invoke(call(FINISH_TURN_TOOL, {
      report: { directiveOutcomes: [], events: [], openThreads: [], turnSummary: "Nothing happened." },
    }));

    expect(attempted.ok).toBe(false);
    expect(attempted.factual).toContain("start_siege by hieron-ii");
    expect(attempted.factual).toMatch(/bad or missing id/);
    expect(gm.isFinished).toBe(false);
  });

  it("recovers via inspect_province, retries with the id it returned, and the retry succeeds", () => {
    const gm = punicSession();
    // The besieging force must actually stand at the target before a siege
    // is a siege rather than a claim (see the "route and target are valid"
    // requirement this covers alongside the id-recovery bug).
    gm.invoke(call("move_force", { actorId: "hieron-ii", forceId: "syracusan-army", destinationProvinceId: "ita-72843720b81376294924159-sicily-northeast" }));
    gm.invoke(call("start_siege", { actorId: "hieron-ii", settlementId: "messana", invadingForceIds: ["syracusan-army"] }));

    const inspected = gm.invoke(call("inspect_province", { provinceId: "ita-72843720b81376294924159-sicily-northeast" }));
    expect(inspected.ok).toBe(true);
    expect(inspected.factual).toContain("settlement-messana");

    const retried = gm.invoke(call("start_siege", {
      actorId: "hieron-ii",
      settlementId: "settlement-messana",
      invadingForceIds: ["syracusan-army"],
      defendingForceIds: ["mamertine-garrison"],
    }));

    expect(retried.ok).toBe(true);
    expect(gm.stagedWorld.conflicts.sieges.some((siege) => siege.settlementId === "settlement-messana")).toBe(true);

    // The debt is cleared: nothing blocks finishing the turn now.
    const finished = gm.invoke(call(FINISH_TURN_TOOL, {
      report: {
        directiveOutcomes: [],
        events: [{
          factRefs: [retried.factId!],
          summary: "Syracuse besieges Messana.",
          participantCharacterIds: ["hieron-ii"],
          provinceId: "ita-72843720b81376294924159-sicily-northeast",
          visibility: "public",
          salience: 8,
          directiveRef: null,
          chainPosition: "root",
        }],
        openThreads: [],
        turnSummary: "Syracuse lays siege to Messana.",
      },
    }));

    expect(finished.ok).toBe(true);
    expect(gm.isFinished).toBe(true);
  });
});

// Regression: nothing stopped the Game Master from calling
// answer_diplomatic_message with the player's own character as the answerer
// -- the player's character is alive, belongs to the recipient polity, and
// is a perfectly legal answerer by every other rule, so a message addressed
// to the player could be accepted, refused, or countered without the player
// ever having chosen anything.
describe("a diplomatic message addressed to the player", () => {
  it("refuses answer_diplomatic_message outright when the player's own character is named as the answerer", () => {
    const gm = session();
    const sent = gm.invoke(call("send_diplomatic_message", {
      actorId: "hanno",
      messageId: "msg-1",
      kind: "ultimatum",
      fromPolityId: "carthage",
      fromCharacterId: "hanno",
      toPolityId: ROME,
      toCharacterId: null,
      subject: "Withdraw from Sicily",
      terms: "Carthage demands Rome withdraw from Sicily.",
    }));
    expect(sent.ok).toBe(true);

    const answered = gm.invoke(call("answer_diplomatic_message", {
      actorId: PLAYER,
      messageId: "msg-1",
      answer: "accepted",
      answeredByCharacterId: PLAYER,
      answerText: "Marcus accepts the terms.",
    }));

    expect(answered.ok).toBe(false);
    expect(answered.factual).toContain("cannot be called with the player's own character");
    const message = gm.stagedWorld.diplomacy.find((candidate) => candidate.id === "msg-1");
    expect(message?.status).toBe("awaiting_reply");
    expect(message?.answer).toBeNull();
  });

  it("still lets another character of the player's own polity answer on the polity's behalf", () => {
    const gm = session();
    const sent = gm.invoke(call("send_diplomatic_message", {
      actorId: "hanno",
      messageId: "msg-1",
      kind: "ultimatum",
      fromPolityId: "carthage",
      fromCharacterId: "hanno",
      toPolityId: ROME,
      toCharacterId: null,
      subject: "Withdraw from Sicily",
      terms: "Carthage demands Rome withdraw from Sicily.",
    }));
    expect(sent.ok).toBe(true);

    // quintus-fabius belongs to Rome too, but is not the player's own character.
    const answered = gm.invoke(call("answer_diplomatic_message", {
      actorId: "quintus-fabius",
      messageId: "msg-1",
      answer: "refused",
      answeredByCharacterId: "quintus-fabius",
      answerText: "Rome will not be dictated to.",
    }));

    expect(answered.ok).toBe(true);
    const message = gm.stagedWorld.diplomacy.find((candidate) => candidate.id === "msg-1");
    expect(message?.status).toBe("answered");
    expect(message?.answer).toBe("refused");
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
