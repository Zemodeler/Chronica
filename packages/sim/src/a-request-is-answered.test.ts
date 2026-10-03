import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  CharacterKnowledgebaseSchema,
  OrderAttemptSchema,
  ScenarioDefinitionSchema,
  WorldDeltaSchema,
  WorldStateSchema,
  answerDueOf,
  materializePlayerCharacter,
  readService,
  type OrderAttempt,
  type RequestAsk,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { askOf } from "./apply/asking";
import { recordDelegations, type BurstSkip } from "./burst";
import { createIdFactory } from "./ports";
import { answerForTheSilent, answerRequests } from "./requests";
import { runDeterministicTick } from "./tick";

/**
 * Every request is answered (E13, E14, L4, L5, M3).
 *
 * In the play-test a legionary asked his centurion to make him optio and a
 * military tribune asked the consul to take him as legate, and neither ever
 * heard back: only a model call answered a request, and a man whose turn was
 * dropped never answered at all. Asking Ogulnius for anything was refused
 * with the sentence for a motion nobody may put to the Senate.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const PLAYER = "the-asker";
const opening = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

function declare(role: string, socioEconomicClass = "Plebeian", world = opening()): WorldState {
  const knowledgebase = CharacterKnowledgebaseSchema.parse({
    version: 1, characterId: PLAYER, gameId: "game-asks", canonicalName: "Marcus Fabrius", nickname: null, birthYearApprox: -298, deathYearApprox: null,
    origin: "invented", period: "270 BCE", locationProvinceId: PUNIC_IDS.rome, culture: "Roman", faith: null,
    biography: `A Roman of the year 270 before Christ: ${role}.`, notableEvents: [],
    role, authority: [], socioEconomicClass, startingMoney: 100, ageYearsAtOpening: 28,
    skills: { martial: 50, intrigue: 30, learning: 30, piety: 40, stewardship: 30, diplomacy: 40, body: 60, subSkills: {} },
    skillRationale: {},
    relations: [
      { name: "Fabria", relationship: "mother", historical: false, notes: "Keeps the farm.", kind: "person", category: "family", familyRole: "parent" },
      ...[1, 2, 3].map((n) => ({ name: `Friend ${n}`, relationship: "friend", historical: false, notes: "An old friend.", kind: "person", category: "other", familyRole: null })),
    ],
    confirmedByPlayer: true, confirmationDraft: null,
  });
  return materializePlayerCharacter(world, PLAYER, knowledgebase, definition.government);
}

/** What one man thinks of another, written into his relations. */
const regard = (world: WorldState, holderId: string, ofId: string, score: number): WorldState => ({
  ...world,
  characters: world.characters.map((character) => (character.id === holderId
    ? { ...character, relations: [...character.relations.filter((relation) => relation.subjectCharacterId !== ofId), { subjectCharacterId: ofId, causes: [{ id: `regard-${holderId}-${ofId}`, label: "Known of old.", score, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null }] }] }
    : character)),
});

const ask = (world: WorldState, recipientId: string, instruction: string, request?: RequestAsk) =>
  askOf(world, offices, createIdFactory(`ask-${recipientId}`), { issuerId: PLAYER, recipientId, instruction, ...(request === undefined ? {} : { ask: request }) });
const answer = (world: WorldState, toDay: number) => answerRequests({ world, toDay, offices, ids: createIdFactory(`answer-${toDay}`), playerCharacterId: PLAYER });
const attemptOf = (world: WorldState, id: string): OrderAttempt => world.orderAttempts.find((attempt) => attempt.id === id)!;
const act = (world: WorldState, raw: Record<string, unknown>) => {
  const delta: WorldDelta = WorldDeltaSchema.parse(raw);
  return applyDeltas(world, [delta], {
    now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: PLAYER }, offices, successionRules: definition.government.successionRules,
    warfare: definition.warfare, ids: createIdFactory(`asks-${raw.op as string}`), gameId: "game-asks", playerCharacterId: PLAYER, orderDeltas: new Set([delta]),
  });
};

/** The centurion over the player's maniple. */
function centurionOf(world: WorldState): string {
  const service = readService(world, PLAYER)!;
  return service.officers.find((officer) => /centurio/i.test(officer.rank))!.id;
}

describe("a legionary asks his centurion to make him optio", () => {
  it("is answered by the day it is due, and made optio on a yes", () => {
    const enlisted = declare("Legionary of the Roman army, a spearman of the hastati");
    const centurion = centurionOf(enlisted);
    const asked = ask(regard(enlisted, centurion, PLAYER, 80), centurion, "Make me your optio.", { kind: "appoint_to_post", ref: "optio" });
    expect(asked.attempt.answerDueByStep).toBe(enlisted.elapsedStep + 14);
    // Not before it is due: he may yet answer it himself.
    const early = answer(asked.world, asked.attempt.answerDueByStep! - 1);
    expect(attemptOf(early.world, asked.attempt.id).status).toBe("issued");
    const due = answer(asked.world, asked.attempt.answerDueByStep!);
    expect(attemptOf(due.world, asked.attempt.id).status).toBe("carried_out");
    expect(due.world.characters.find((character) => character.id === PLAYER)!.service!.rankId).toBe("optio");
    expect(due.facts.find((fact) => fact.kind === "request_accepted")?.summary).toMatch(/made Marcus Fabrius Optio/);
    expect(due.facts[0]!.knownToRefs).toContainEqual({ kind: "character", id: PLAYER });
  });

  it("is answered by the passing of the days, with no model call", () => {
    const enlisted = declare("Legionary of the Roman army, a spearman of the hastati");
    const centurion = centurionOf(enlisted);
    const asked = ask(regard(enlisted, centurion, PLAYER, 80), centurion, "Make me your optio.", { kind: "appoint_to_post", ref: "optio" });
    const ticked = runDeterministicTick({
      world: asked.world, toDay: asked.attempt.answerDueByStep!, ids: createIdFactory("tick"), warfare: definition.warfare,
      government: definition.government, playerCharacterId: PLAYER,
    });
    expect(attemptOf(ticked.world, asked.attempt.id).status).toBe("carried_out");
    expect(ticked.factProposals.some((fact) => fact.kind === "request_accepted")).toBe(true);
  });

  it("is refused with the reason when the centurion will not", () => {
    const enlisted = declare("Legionary of the Roman army, a spearman of the hastati");
    const centurion = centurionOf(enlisted);
    const asked = ask(regard(enlisted, centurion, PLAYER, -70), centurion, "Make me your optio.");
    const due = answer(asked.world, answerDueOf(asked.attempt));
    const answered = attemptOf(due.world, asked.attempt.id);
    expect(answered.status).toBe("refused");
    expect(answered.recipientDecisionReason).toMatch(/no love for Marcus Fabrius/);
    expect(due.facts[0]!.summary).toMatch(/would not make Marcus Fabrius Optio: he has no love for Marcus Fabrius/);
  });

  it("is told whose it is to give when he asks a man who cannot give it", () => {
    const enlisted = declare("Legionary of the Roman army, a spearman of the hastati");
    const comrade = readService(enlisted, PLAYER)!.comrades[0]!.id;
    const asked = ask(regard(enlisted, comrade, PLAYER, 80), comrade, "Make me optio.", { kind: "appoint_to_post", ref: "optio" });
    const due = answer(asked.world, answerDueOf(asked.attempt));
    expect(attemptOf(due.world, asked.attempt.id).recipientDecisionReason).toMatch(/^It is not mine to give; it lies with .*Gaius Genucius/);
    expect(due.facts[0]!.summary).toMatch(/it is not his to give; it lies with/);
  });
});

describe("a military tribune asks the consul to take him as legate", () => {
  it("is taken on, with command delegated over the consul's army, by a consul who values him", () => {
    const tribune = declare("A military tribune of the Roman army", "Equestrian");
    const asked = ask(regard(tribune, "gaius-genucius", PLAYER, 80), "gaius-genucius", "Take me as your legate.", { kind: "take_as_legate" });
    const due = answer(asked.world, answerDueOf(asked.attempt));
    expect(attemptOf(due.world, asked.attempt.id).status).toBe("carried_out");
    expect(due.world.authorityGrants.some((grant) => grant.holder.id === PLAYER && grant.scope.kind === "force" && grant.scope.id === "roman-field-army" && grant.powers.includes("command"))).toBe(true);
    expect(due.world.material.forces.find((force) => force.id === "roman-field-army")!.posts?.some((post) => post.characterId === PLAYER && post.rankId === "legate")).toBe(true);
  });

  it("is refused with a reason by a consul who does not", () => {
    const tribune = declare("A military tribune of the Roman army", "Equestrian");
    const asked = ask(regard(tribune, "gaius-genucius", PLAYER, -60), "gaius-genucius", "Take me as your legate.");
    const due = answer(asked.world, answerDueOf(asked.attempt));
    expect(attemptOf(due.world, asked.attempt.id).status).toBe("refused");
    expect(due.facts[0]!.summary).toMatch(/would not take Marcus Fabrius as his legate: he has no love for Marcus Fabrius/);
  });

  it("is told the consul has legates enough", () => {
    const tribune = declare("A military tribune of the Roman army", "Equestrian");
    const army = tribune.material.forces.find((force) => force.id === "roman-field-army")!;
    const formationId = army.formations![0]!.id;
    const staffed: WorldState = {
      ...tribune,
      material: { ...tribune.material, forces: tribune.material.forces.map((force) => (force.id === army.id
        ? { ...force, posts: [...(force.posts ?? []), { formationId, unitIndex: null, rankId: "legate", characterId: "quintus-ogulnius" }, { formationId, unitIndex: null, rankId: "legate", characterId: "manius-curius" }] }
        : force)) },
    };
    const asked = ask(regard(staffed, "gaius-genucius", PLAYER, 80), "gaius-genucius", "Take me as your legate.", { kind: "take_as_legate" });
    const due = answer(asked.world, answerDueOf(asked.attempt));
    expect(due.facts[0]!.summary).toBe("Gaius Genucius Clepsina would not take Marcus Fabrius as his legate: he has legates enough.");
  });
});

describe("a request to a man is a request, not a motion", () => {
  const senate = "roman-senate";
  const question = (type: string, sponsor: string, label: string, extra: Record<string, unknown> = {}) => ({
    op: "political_procedure_open", localId: "q", type, institutionRef: senate, sponsorCharacterRef: sponsor, subjectKind: "character", subjectRef: PLAYER,
    label, resolutionMechanism: "vote", deadlineInDays: 20, reason: "He asks.", ...extra,
  });

  it("never refuses a request to Ogulnius with the Senate-floor sentence", () => {
    const tribune = declare("A military tribune of the Roman army", "Equestrian");
    for (const type of ["appointment", "command_assignment", "petition", "endorsement"]) {
      const result = act(tribune, question(type, "quintus-ogulnius", "Quintus Ogulnius takes Marcus Fabrius as his legate"));
      expect(result.rejected.map((rejection) => rejection.reason).join(" "), type).not.toMatch(/may put a question to the Senate/);
      const attempt = result.world.orderAttempts.find((candidate) => candidate.issuerRef.id === PLAYER && candidate.recipientRef.id === "quintus-ogulnius");
      expect(attempt, type).toBeDefined();
      expect(attempt!.answerDueByStep, type).toBeDefined();
      expect(result.breaches, type).toEqual([]);
    }
    const legate = act(tribune, question("appointment", "quintus-ogulnius", "Quintus Ogulnius takes Marcus Fabrius as his legate"));
    expect(legate.world.orderAttempts.at(-1)!.ask).toEqual({ kind: "take_as_legate" });
  });

  it("asks a tribune to speak for him, rather than refusing him the floor", () => {
    const tribune = declare("A military tribune of the Roman army", "Equestrian");
    const result = act(tribune, question("endorsement", PLAYER, "The tribunes speak for Marcus Fabrius"));
    expect(result.rejected).toEqual([]);
    const attempt = result.world.orderAttempts.at(-1)!;
    expect(attempt.issuerRef.id).toBe(PLAYER);
    expect(attempt.ask).toEqual({ kind: "speak_for" });
  });

  it("does not refuse an aedile's games with the Senate-floor sentence", () => {
    const aedile = declare("Curule aedile of Rome", "Patrician");
    const result = act(aedile, { ...question("petition", PLAYER, "Hold the Roman games at the state's expense"), subjectKind: "polity", subjectRef: "rome" });
    expect(result.rejected.map((rejection) => rejection.reason).join(" ")).not.toMatch(/may put a question to the Senate/);
    expect(result.world.orderAttempts.at(-1)?.ask).toEqual({ kind: "put_question", ref: senate });
  });

  it("puts a motion naming no chamber to the convener's rule, as it will be put to the Senate", () => {
    const senator = declare("Roman senator", "Patrician");
    const conveners = senator.material.officeSeats.filter((seat) => seat.status === "held" && ["roman-consul", "roman-praetor", "roman-dictator", "roman-tribune"].includes(seat.officeId)).map((seat) => seat.holderCharacterId!);
    const shunned = conveners.reduce((world, id) => regard(world, id, PLAYER, -80), senator);
    const result = act(shunned, { ...question("vote", PLAYER, "A law on the price of grain"), institutionRef: null, subjectKind: "polity", subjectRef: "rome" });
    expect(result.applied).toHaveLength(0);
    expect(result.rejected[0]!.reason).toMatch(/Nobody who may put a question to the Senate would put/);
  });
});

describe("requests nobody answers", () => {
  it("are answered for a man whose owed turn was dropped, whatever their day", () => {
    const enlisted = declare("Legionary of the Roman army, a spearman of the hastati");
    const centurion = centurionOf(enlisted);
    const asked = ask(enlisted, centurion, "Make me your optio.", { kind: "appoint_to_post", ref: "optio" });
    const silent = answerForTheSilent(asked.world, [centurion], { toDay: 1, offices, ids: createIdFactory("silent"), playerCharacterId: PLAYER });
    expect(["carried_out", "refused"]).toContain(attemptOf(silent.world, asked.attempt.id).status);
    expect(silent.facts).toHaveLength(1);
  });

  it("closes a yes with nothing to read it by: abandoned when nothing came of it, carried out when the promise was kept", () => {
    const enlisted = declare("Legionary of the Roman army, a spearman of the hastati");
    const centurion = centurionOf(enlisted);
    const asked = ask(enlisted, centurion, "See that my brother is fed.");
    const accepted: WorldState = { ...asked.world, orderAttempts: asked.world.orderAttempts.map((attempt) => (attempt.id === asked.attempt.id ? { ...attempt, status: "accepted" as const, decidedAtStep: 0 } : attempt)) };
    expect(attemptOf(answer(accepted, 29).world, asked.attempt.id).status).toBe("accepted");
    const lapsed = answer(accepted, 30);
    expect(attemptOf(lapsed.world, asked.attempt.id).status).toBe("abandoned");
    expect(lapsed.facts[0]!.summary).toMatch(/nothing came of it/);
    const kept: WorldState = { ...accepted, commitments: [...accepted.commitments, {
      id: "kept-promise", promisorCharacterId: centurion, beneficiaryCharacterId: PLAYER, actionKind: "other", description: "Feed his brother.", conditions: "",
      requiredOfficeId: null, requiredResource: null, visibility: "private", sourceEventId: null, breachPressureKind: "humiliation", status: "fulfilled",
      createdAtStep: 0, reviewAtStep: 20, resolvedAtStep: 10, resolutionReason: "Fed.",
    }] };
    expect(attemptOf(answer(kept, 30).world, asked.attempt.id).status).toBe("carried_out");
  });

  it("carries out a structured ask the man himself said yes to", () => {
    const tribune = declare("A military tribune of the Roman army", "Equestrian");
    const asked = ask(tribune, "gaius-genucius", "Take me as your legate.", { kind: "take_as_legate" });
    const accepted: WorldState = { ...asked.world, orderAttempts: asked.world.orderAttempts.map((attempt) => (attempt.id === asked.attempt.id ? { ...attempt, status: "accepted" as const, decidedAtStep: 0 } : attempt)) };
    const done = answer(accepted, 1);
    expect(attemptOf(done.world, asked.attempt.id).status).toBe("carried_out");
    expect(done.world.authorityGrants.some((grant) => grant.holder.id === PLAYER && grant.scope.id === "roman-field-army")).toBe(true);
  });

  it("reads the day an answer is owed by for an attempt saved before the day was kept", () => {
    const saved = OrderAttemptSchema.parse({
      id: "old", actionId: "old-action", issuerRef: { kind: "character", id: PLAYER }, recipientRef: { kind: "character", id: "gaius-genucius" },
      authorityCheck: { authorized: false, grant: null, standing: null, reason: "Asking." }, status: "issued", issuedAtStep: 100,
    });
    expect(saved.answerDueByStep).toBeUndefined();
    expect(answerDueOf(saved)).toBe(114);
    expect(answerDueOf({ ...saved, standing: "binding" })).toBe(107);
    expect(answerDueOf({ ...saved, status: "delayed" })).toBe(128);
  });
});

describe("delegations in an answer", () => {
  it("are the answering man's orders, never a man's to himself, and carry what they ask and when they are due", () => {
    const world = declare("A military tribune of the Roman army", "Equestrian");
    const skipped: BurstSkip[] = [];
    const recorded = recordDelegations(world, [
      { localId: "a", issuerRef: { kind: "character", id: "gnaeus-cornelius" }, recipientRef: { kind: "character", id: "gaius-genucius" }, claimedAuthorityGrantRef: null, instruction: "Take me as your legate.", part: null, ask: { kind: "take_as_legate" } },
      { localId: "b", issuerRef: { kind: "character", id: PLAYER }, recipientRef: { kind: "character", id: PLAYER }, claimedAuthorityGrantRef: null, instruction: "I shall march.", part: null },
    ], createIdFactory("delegations"), new Map(), offices, { kind: "character", id: PLAYER }, skipped);
    const added = recorded.orderAttempts.slice(world.orderAttempts.length);
    expect(added).toHaveLength(1);
    expect(added[0]!.issuerRef).toEqual({ kind: "character", id: PLAYER });
    expect(added[0]!.ask).toEqual({ kind: "take_as_legate" });
    expect(added[0]!.answerDueByStep).toBe(world.elapsedStep + 14);
    expect(skipped.map((skip) => skip.stage)).toEqual(["delegation"]);
  });

  it("leaves an order passed between two men of another power as theirs", () => {
    const world = declare("A military tribune of the Roman army", "Equestrian");
    const [general, captain] = world.characters.filter((character) => character.alive && character.polityId === "carthage");
    const recorded = recordDelegations(world, [
      { localId: "c", issuerRef: { kind: "character", id: general!.id }, recipientRef: { kind: "character", id: captain!.id }, claimedAuthorityGrantRef: null, instruction: "Hold Lilybaeum.", part: null },
    ], createIdFactory("theirs"), new Map(), offices, { kind: "character", id: PLAYER });
    expect(recorded.orderAttempts.at(-1)!.issuerRef).toEqual({ kind: "character", id: general!.id });
  });
});
