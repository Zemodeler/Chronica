import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  ORDER_PART_STATUSES,
  ORDER_PART_STATUS_LABEL,
  ScenarioDefinitionSchema,
  WorldDeltaSchema,
  WorldStateSchema,
  ensureProvinceMaterial,
  orderPartLabel,
  orderPartStatus,
  ordersUnderWay,
  spentForOrderPart,
  type Force,
  type Office,
  type OrderPart,
  type OrderRecord,
  type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { runSimulationBurst, type BurstInput } from "./burst";
import { lineOf, orderOutcomeLines, withOrderOutcomes } from "./order-outcomes";
import { mergeGoals } from "./order-goals";
import { dedupeStages } from "./order-stages";
import { settleOverdueSteps } from "./plans";
import { createIdFactory, type SimModelPort, type SimOperation } from "./ports";
import { buildWorldSlice, renderWorldSlice } from "./slice";
import type { ChronicleEntry } from "./chronicle";

/**
 * The order ledger, held to what the Codex hand-mode play-test found it
 * doing wrong (triage E1-E11, M1-M3): a save that would not load, money
 * spent and never counted, parts that read refused or done when they were
 * neither, orders that never lapsed, parts nobody gave, outcomes dated before
 * what they reported, held acts that named nothing, and the engine's own
 * refusals told to the player.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices: readonly Office[] = definition.government.offices;
const { rome: ROME, messana: MESSANA } = PUNIC_IDS;
const CONSUL = "gaius-genucius";
const CURIUS = "manius-curius";
const OGULNIUS = "quintus-ogulnius";
/** Campania on the Volturnus: a march from Rome, not a crossing. */
const CAMPANIA = "it-c20bo";

function opening(): WorldState {
  return ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
}

function world(): WorldState {
  const first = opening();
  return {
    ...first,
    material: {
      ...first.material,
      forces: first.material.forces.map((force): Force => force.id === "roman-field-army"
        ? { ...force, locationId: ROME, personnel: [{ categoryId: "infantry", label: "Legionaries", fit: 7_100, unavailable: [] }] }
        : force),
    },
  };
}

function scripted(script: Partial<Record<SimOperation, string[]>>): SimModelPort {
  const remaining = { ...script };
  return {
    complete(operation) {
      const next = remaining[operation]?.shift();
      return next === undefined ? Promise.resolve(JSON.stringify({ actors: [] })) : Promise.resolve(next);
    },
  };
}

/** An orchestrator's answer: the parts as it read them, and the acts. */
function answer(parts: readonly Record<string, unknown>[], deltas: readonly Record<string, unknown>[], summary = "The order is carried out."): string {
  return JSON.stringify({
    intent: { summary, domains: ["military"], parts },
    narrativeSummary: summary,
    frictions: [],
    deltas,
    facts: [], delegations: [], schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null,
  });
}

function input(port: SimModelPort, orderText: string | null, state: WorldState = world(), actor = CONSUL, spanDays = 1): BurstInput {
  return {
    world: state, clock: definition.clock, offices, warfare: definition.warfare, burstId: "ledger", gameId: "game-ledger",
    actorRef: { kind: "character", id: actor }, actorPolityId: "rome",
    orderText, knownFacts: [], queue: [], port, narratorSeeds: [], spanDays,
  };
}

const context = (actor: string): ApplyContext => ({
  now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: actor }, offices, warfare: definition.warfare,
  terrains: definition.map.terrains, ids: createIdFactory(`ledger-${actor}`), gameId: "game-ledger",
});

const part = (change: Partial<OrderPart>): OrderPart => ({
  said: "Carry Legio I to Campania", goals: [], workRefs: [], refusal: null, refusedAtStep: null, note: null, whyNot: null, factIds: [],
  stages: [], spend: null, attribution: "tagged", closedAtStep: null, actsCarried: 0, actsRefused: 0, ...change,
});

const record = (parts: readonly OrderPart[], givenAtStep = 0): OrderRecord => ({ id: "rec", actorCharacterId: CONSUL, text: "An order.", givenAtStep, parts: [...parts] });

const loads = (state: WorldState): boolean => WorldStateSchema.safeParse(state).success;

describe("E1: a save that will not load", () => {
  it("misses a step slipped three times, however long its owner is owed his turn", () => {
    let state: WorldState = {
      ...opening(),
      owed: [{ characterId: "hieron-ii", why: "his plan", sinceStep: 0, bursts: 0 }],
      characters: opening().characters.map((character) => character.id !== "hieron-ii" ? character : {
        ...character,
        ambitions: [{
          id: "ambition-1", label: "Take Messana", kind: "office", targetId: null, status: "active",
          steps: [{ id: "step-1", act: "Send envoys", dueDay: 10, laidOnDay: 0, waitsOn: null, armedReading: null, status: "pending", wokenOnDay: 0, settledOnDay: null }],
        }],
      }),
    };
    for (let day = 11; day < 800; day += 20) {
      state = settleOverdueSteps({ ...state, instant: { day, minute: 0 }, elapsedStep: day }, definition.clock, (prefix) => `${prefix}_${day}`).world;
      const step = state.characters.find((character) => character.id === "hieron-ii")!.ambitions[0]!.steps[0]!;
      expect(step.slips ?? 0).toBeLessThanOrEqual(3);
      expect(loads(state)).toBe(true);
    }
    expect(state.characters.find((character) => character.id === "hieron-ii")!.ambitions[0]!.steps[0]!.status).toBe("missed");
  });

  it("does not blame a batch for a fault the world already had", () => {
    const broken: WorldState = {
      ...opening(),
      characters: opening().characters.map((character) => character.id !== "hieron-ii" ? character : {
        ...character,
        ambitions: [{ id: "ambition-1", label: "Take Messana", kind: "office", targetId: null, status: "active",
          steps: [{ id: "step-1", act: "Send envoys", dueDay: 10, laidOnDay: 0, waitsOn: null, armedReading: null, status: "pending", wokenOnDay: 0, settledOnDay: null, slips: 4 }] }],
      }),
    };
    expect(loads(broken)).toBe(false);
    const paid = applyDeltas(broken, [WorldDeltaSchema.parse({ op: "money_transfer", fromAccountRef: "gaius-purse", toAccountRef: null, amount: 10, reason: "Bread." })], context(CONSUL));
    expect(paid.rejected).toEqual([]);
    expect(paid.applied).toHaveLength(1);
  });
});

describe("E2 / M1: a payment of nothing", () => {
  it("is refused as nothing to pay, and leaves no goal that would break the ledger", async () => {
    const order = "Pay the treasury what I owe it.";
    const port = scripted({ simulate_orchestrate: [answer(
      [{ said: "Pay the treasury what I owe it", acts: [0] }],
      [{ op: "money_transfer", fromAccountRef: "gaius-purse", toAccountRef: "rome-treasury", amount: 0, reason: "What he owes." }],
    )] });
    const result = await runSimulationBurst(input(port, order));
    expect(loads(result.world)).toBe(true);
    const ledger = result.world.orders.find((candidate) => candidate.id === result.orderRecordId)!;
    expect(ledger.parts[0]!.goals.some((goal) => goal.kind === "paid")).toBe(false);
    expect(result.audit.some((entry) => entry.kind === "reference" && entry.reason.startsWith("Nothing to pay"))).toBe(true);
  });

  it("keeps only goals the ledger can hold", () => {
    const merged = mergeGoals([{ kind: "paid", toAccountId: "rome-treasury", fromAccountId: null, amount: 0, sinceStep: 0 }], []);
    expect(merged.goals).toEqual([]);
  });
});

describe("E3: what an order spends", () => {
  it("counts a hire's advance and its wages as the part's spending", async () => {
    const order = "Hire Quintus Ogulnius as physician to my house, up to 2,000 from my own purse.";
    const port = scripted({ simulate_orchestrate: [answer(
      [{ said: "Hire Quintus Ogulnius as physician to my house", acts: [0], spend: { payerAccountRef: "curius-purse", cap: 2_000 } }],
      [{
        op: "service_contract_open", localId: "doctor", role: "physician", label: "Physician to the house of Curius",
        employerAccountRef: "curius-purse", employeeRef: OGULNIUS, advance: 20, monthlyPay: 30, duties: "Keep the old man alive.", reason: "His health is failing.",
      }],
    )] });
    const result = await runSimulationBurst(input(port, order, world(), CURIUS, 40));
    const ledger = result.world.orders.find((candidate) => candidate.id === result.orderRecordId)!;
    const hired = ledger.parts[0]!;
    // The advance, and at least the first month's wage paid by the tick.
    expect(spentForOrderPart(result.world, hired)).toBeGreaterThanOrEqual(50);
    expect(lineOf(result.world, hired, CURIUS)).not.toMatch(/ 0 spent/);
  });
});

describe("E4: eight letters", () => {
  const letters = (answers: readonly ("accepted" | "refused" | "ignored")[]): WorldState => {
    const first = world();
    const diplomacy = answers.map((given, index) => ({
      ...first.diplomacy[0],
      id: `letter-${index}`, kind: "letter" as const, fromPolityId: "rome", fromCharacterId: CONSUL, toPolityId: "syracuse", toCharacterId: null,
      subject: `Letter ${index}`, terms: "Stand with Rome.", sentAtStep: 0, deliveredOnDay: 0, replyDueByStep: null,
      status: "answered" as const, answer: given, answerText: null, answeredAtStep: 1, inReplyToMessageId: null,
      negotiationId: `letter-${index}`, negotiationOwnerCharacterId: CONSUL, visibility: "polity" as const, proposes: [], agreementId: null,
    }));
    return WorldStateSchema.parse({ ...first, diplomacy });
  };
  const sent = (count: number): OrderPart => part({
    said: "Write to the Italian allies",
    workRefs: Array.from({ length: count }, (_, index) => ({ kind: "message" as const, id: `letter-${index}` })),
    goals: Array.from({ length: count }, (_, index) => ({ kind: "answer_from" as const, messageId: `letter-${index}` })),
    actsCarried: count,
  });

  it("reads as the mix, not as refused because one was ignored", () => {
    const state = letters(["accepted", "accepted", "accepted", "accepted", "accepted", "accepted", "refused", "ignored"]);
    const eight = sent(8);
    expect(orderPartStatus(state, eight)).toBe("partly_done");
    const line = lineOf(state, eight, CONSUL);
    expect(line).toContain("8 letters: 6 accepted, 1 refused, 1 unanswered");
    expect(line).not.toMatch(/-- refused/);
  });

  it("keeps the goal of every letter, not the first four", () => {
    const merged = mergeGoals(Array.from({ length: 8 }, (_, index) => ({ kind: "answer_from" as const, messageId: `letter-${index}` })), []);
    expect(merged.goals).toHaveLength(8);
  });

  it("is not refused when one act could not be done and the others were", async () => {
    const poor: WorldState = { ...world(), material: { ...world().material, accounts: world().material.accounts.map((account) => account.id === "gaius-purse" ? { ...account, balance: 0 } : account) } };
    const port = scripted({ simulate_orchestrate: [answer(
      [{ said: "Write to Hiero and pay his envoy", acts: [0, 1] }],
      [
        { op: "diplomatic_message_send", localId: "to-hiero", kind: "letter", fromPolityId: "rome", fromCharacterRef: CONSUL, toPolityId: "syracuse", toCharacterRef: null,
          subject: "Friendship", terms: "Stand with Rome.", replyWithinDays: null, inReplyToRef: null, visibility: "polity", reason: "The consul writes." },
        { op: "money_transfer", fromAccountRef: "gaius-purse", toAccountRef: null, amount: 50, reason: "A gift for the envoy." },
      ],
    )] });
    const result = await runSimulationBurst(input(port, "Write to Hiero and pay his envoy.", poor));
    const written = result.world.orders.find((candidate) => candidate.id === result.orderRecordId)!.parts[0]!;
    expect(written.refusal).toBeNull();
    expect(written.note).toMatch(/^Not all of it/);
    expect(orderPartStatus(result.world, written)).not.toBe("refused");
  });

  it("keeps a letter written again as the work of the part that wrote it", async () => {
    const letter = { op: "diplomatic_message_send", localId: "to-hiero", kind: "letter", fromPolityId: "rome", fromCharacterRef: CONSUL, toPolityId: "syracuse", toCharacterRef: null,
      subject: "Consultation on Messana", terms: "Rome asks Syracuse for consultation on Messana.", replyWithinDays: null, inReplyToRef: null, visibility: "polity", reason: "The consul writes." };
    const first = await runSimulationBurst(input(scripted({ simulate_orchestrate: [answer([{ said: "Write to Hiero", acts: [0] }], [letter])] }), "Write to Hiero."));
    const again = await runSimulationBurst({ ...input(scripted({ simulate_orchestrate: [answer([{ said: "Write to Hiero", acts: [0] }], [letter])] }), "Write to Hiero."), burstId: "ledger-2", world: first.world });
    const sent = first.world.orders.find((candidate) => candidate.id === first.orderRecordId)!.parts[0]!.workRefs.find((ref) => ref.kind === "message");
    expect(sent).toBeDefined();
    const resent = again.world.orders.find((candidate) => candidate.id === again.orderRecordId)!.parts[0]!;
    expect(resent.workRefs).toContainEqual(sent);
  });
});

describe("E5: leave the army and travel to Rome", () => {
  const inTheRanks = (): WorldState => {
    const first = world();
    return {
      ...first,
      characters: first.characters.map((character) => character.id !== OGULNIUS ? character : {
        ...character, locationProvinceId: CAMPANIA,
        service: { forceId: "roman-field-army", formationId: null, unitIndex: null, rankId: "miles", enlistedAtStep: 0, campaigns: 0, priorCampaigns: 0, battles: 0, wounds: 0, decorations: [], punishments: [], conduct: "steady" as const },
      }),
      material: { ...first.material, forces: first.material.forces.map((force) => force.id === "roman-field-army" ? { ...force, locationId: CAMPANIA, memberCharacterIds: [...force.memberCharacterIds, OGULNIUS] } : force) },
    };
  };

  it("strikes him from his service record, not only from the roll", () => {
    const discharged = applyDeltas(inTheRanks(), [WorldDeltaSchema.parse({ op: "force_membership_set", characterRef: OGULNIUS, forceRef: "roman-field-army", change: "discharge", reason: "His time is served." })], context(CONSUL));
    expect(discharged.rejected).toEqual([]);
    const man = discharged.world.characters.find((character) => character.id === OGULNIUS)!;
    expect(man.service?.forceId).toBeNull();
    expect(man.service?.dischargedAtStep).toBe(0);
  });

  const order = "Discharge Quintus Ogulnius and send him home to Rome.";
  const acts = (to: string) => [
    { op: "force_membership_set", characterRef: OGULNIUS, forceRef: "roman-field-army", change: "discharge", reason: "His time is served." },
    { op: "character_state_set", characterRef: OGULNIUS, moveToProvinceId: to, reason: "He goes home." },
  ];

  it("is done only when he is out of service and in Rome", async () => {
    const port = scripted({ simulate_orchestrate: [answer([{ said: "Discharge Quintus Ogulnius and send him home to Rome", acts: [0, 1] }], acts(ROME))] });
    const result = await runSimulationBurst(input(port, order, inTheRanks()));
    const done = result.world.orders.find((candidate) => candidate.id === result.orderRecordId)!.parts[0]!;
    expect(done.goals.map((goal) => goal.kind).sort()).toEqual(["character_at", "out_of_service"]);
    expect(orderPartStatus(result.world, done)).toBe("achieved");
    const man = result.world.characters.find((character) => character.id === OGULNIUS)!;
    expect(man.locationProvinceId).toBe(ROME);
    expect(man.service?.forceId).toBeNull();
    // And while he is still in the ranks, it is not done.
    const stillServing = { ...result.world, characters: result.world.characters.map((character) => character.id !== OGULNIUS ? character : { ...character, service: { ...character.service!, forceId: "roman-field-army" } }) };
    expect(orderPartStatus(stillServing, done)).not.toBe("achieved");
  });

  it("is not done when the journey could not be made", async () => {
    const port = scripted({ simulate_orchestrate: [answer([{ said: "Discharge Quintus Ogulnius and send him home to Rome", acts: [0, 1] }], acts("punic-egypt"))] });
    const result = await runSimulationBurst(input(port, order, inTheRanks()));
    const done = result.world.orders.find((candidate) => candidate.id === result.orderRecordId)!.parts[0]!;
    expect(orderPartStatus(result.world, done)).toBe("partly_done");
  });
});

describe("E6: orders that never lapse", () => {
  it("answers an order already answered with nothing, and refuses nothing", () => {
    const state: WorldState = { ...world(), orderAttempts: [{
      id: "attempt-1", actionId: "action-1", issuerRef: { kind: "character", id: CONSUL }, recipientRef: { kind: "character", id: CURIUS },
      claimedAuthorityGrantId: null, authorityCheck: { authorized: true, grant: null, standing: null, reason: "Ordered." }, instruction: "Raise the fleet.",
      standing: "binding", status: "accepted", recipientDecisionReason: "Yes.", issuedAtStep: 0, decidedAtStep: 0, consequenceFactRefs: [], servesRef: null,
    }] };
    const again = applyDeltas(state, [WorldDeltaSchema.parse({ op: "order_attempt_decide", orderAttemptRef: "attempt-1", decision: "refuse", reason: "No." })], context(CURIUS));
    expect(again.rejected).toEqual([]);
    expect(again.applied[0]?.changed).toBe(false);
    expect(again.world.orderAttempts[0]!.status).toBe("accepted");
    // And the world tells the next answer which orders are done deciding.
    const sliced = renderWorldSlice(buildWorldSlice({ world: state, clock: definition.clock, offices, actorRef: { kind: "character", id: CONSUL }, actorPolityId: "rome", orderText: null, facts: [], dueEvents: [], pendingEvents: [] }));
    expect(sliced).toMatch(/ORDERS ALREADY ANSWERED, NOT TO DECIDE AGAIN[\s\S]*attempt-1/);
    expect(sliced).not.toMatch(/ORDERS AWAITING AN ANSWER[^\n]*\n[^\n]*attempt-1/);
  });

  it("lapses a part nothing has moved for in two months", async () => {
    const state: WorldState = {
      ...world(), instant: { day: 70, minute: 540 }, elapsedStep: 70,
      orderAttempts: [{
        id: "attempt-1", actionId: "action-1", issuerRef: { kind: "character", id: CONSUL }, recipientRef: { kind: "character", id: CURIUS },
        claimedAuthorityGrantId: null, authorityCheck: { authorized: true, grant: null, standing: null, reason: "Ordered." }, instruction: "Raise the fleet.",
        standing: "binding", status: "accepted", recipientDecisionReason: "Yes.", issuedAtStep: 0, decidedAtStep: 0, consequenceFactRefs: [], servesRef: "rec-p0",
      }],
      orders: [record([part({ said: "Raise the fleet", workRefs: [{ kind: "order_attempt", id: "attempt-1" }] })])],
    };
    expect(ordersUnderWay(state, CONSUL, offices).some((item) => item.label === "Raise the fleet")).toBe(false);
    const result = await runSimulationBurst(input(scripted({}), null, state));
    const lapsed = result.world.orders[0]!.parts[0]!;
    expect(lapsed.closedAtStep).not.toBeNull();
    expect(lapsed.note).toMatch(/^Lapsed/);
  });

  it("retires every pursuit he has gone on from, his power's old ones too", async () => {
    const first = world();
    const pursuit = (id: string, owner: { kind: "character" | "polity"; id: string }) => ({
      id, kind: "pursuit", label: `Pursuit ${id}`, ownerRef: owner, attributes: { order: "Something.", sinceDay: 0 }, provinceId: ROME, createdAtStep: 0,
    });
    const state = WorldStateSchema.parse({
      ...first, instant: { day: 70, minute: 540 }, elapsedStep: 70,
      genericEntities: [...first.genericEntities, pursuit("pursuit-mine", { kind: "character", id: CONSUL }), pursuit("pursuit-rome", { kind: "polity", id: "rome" })],
    });
    const port = scripted({ simulate_orchestrate: [answer([{ said: "March the legion into Campania", acts: [0] }], [{ op: "force_modify", forceRef: "roman-field-army", locationId: CAMPANIA, reason: "Into Campania." }])] });
    const result = await runSimulationBurst(input(port, "March the legion into Campania.", state));
    const standing = result.world.genericEntities.filter((entity) => entity.kind === "pursuit" && !("retiredAtStep" in entity.attributes)).map((entity) => entity.id);
    expect(standing).not.toContain("pursuit-mine");
    expect(standing).not.toContain("pursuit-rome");
  });
});

describe("E7 / M2: parts nobody gave", () => {
  it("refiles the world's business written as parts of the order", async () => {
    const port = scripted({ simulate_orchestrate: [answer(
      [
        { said: "March the legion into Campania", acts: [0] },
        { said: "Give the Umbrians their own ruler", acts: [1] },
        { said: "Resolve the world's price movement in Vaspurakan", acts: [] },
      ],
      [
        { op: "force_modify", forceRef: "roman-field-army", locationId: CAMPANIA, reason: "Into Campania." },
        { op: "character_create", localId: "umbrian-chief", name: "Vibius of Iguvium", polityId: "umbrians", provinceId: null, age: 45, officeLabel: null, officeAuthorises: [], traits: [], standing: null, wealth: 0, generatedBecause: "The Umbrians had nobody." },
      ],
    )] });
    const result = await runSimulationBurst(input(port, "March the legion into Campania."));
    const ledger = result.world.orders.find((candidate) => candidate.id === result.orderRecordId)!;
    expect(ledger.parts.map((entry) => entry.said)).toEqual(["March the legion into Campania"]);
    const refiled = result.audit.filter((entry) => entry.kind === "refiled" && entry.op === "order_part").map((entry) => entry.reason);
    expect(refiled.some((reason) => reason.includes("Give the Umbrians their own ruler"))).toBe(true);
    expect(refiled.some((reason) => reason.includes("Vaspurakan"))).toBe(true);
  });
});

describe("E8: an outcome dated before what it reports", () => {
  const passage = (at: number): ChronicleEntry => ({
    kind: "narrated", title: "The order is given", body: "The consul gave his order.", factIds: ["fact-1"], subjects: [], tags: [], changes: [], quote: null,
    fromInstantSortKey: at, toInstantSortKey: at,
  });

  it("sets the lines under a passage of the day they were read, or in one of their own then", () => {
    const end = 40 * 1440;
    const [early, closing] = withOrderOutcomes([passage(0)], ["\"Petition the Senate\" -- refused."], ["fact-1"], end);
    expect(early!.body).not.toContain("What came of the order");
    expect(closing!.body).toContain("What came of the order");
    expect(closing!.fromInstantSortKey).toBe(end);
    const [same] = withOrderOutcomes([passage(end)], ["\"Petition the Senate\" -- refused."], ["fact-1"], end);
    expect(same!.body).toContain("What came of the order");
  });

  it("says on what day a part was refused", () => {
    const state = { ...world(), orders: [record([part({ said: "Petition the Senate", refusal: "The Senate would not hear it.", refusedAtStep: 12, actsRefused: 1 })])] };
    const [line] = orderOutcomeLines(state, "rec", definition.clock);
    expect(line).toMatch(/refused on /);
  });
});

describe("E9: held acts that named nothing", () => {
  it("holds an act with the ids its own answer gave its handles", async () => {
    const port = scripted({ simulate_orchestrate: [answer(
      [
        { said: "Write to Hiero and lay the fleet question before the Senate", acts: [0, 1] },
        { said: "Once Hiero answers, speak for the fleet", afterParts: [0], acts: [], deferredActs: [
          { op: "political_support_set", procedureRef: "local:fleet-question", supporterKind: "character", supporterRef: CONSUL, position: "support", influenceWeight: 300, reasonKind: "belief", reasonLabel: "Rome needs ships.", reason: "He speaks." },
        ] },
      ],
      [
        { op: "diplomatic_message_send", localId: "to-hiero", kind: "letter", fromPolityId: "rome", fromCharacterRef: CONSUL, toPolityId: "syracuse", toCharacterRef: null,
          subject: "Ships", terms: "Lend Rome ships.", replyWithinDays: null, inReplyToRef: null, visibility: "polity", reason: "The consul writes." },
        { op: "political_procedure_open", localId: "fleet-question", type: "decree", institutionRef: null, sponsorCharacterRef: CONSUL, subjectKind: "polity", subjectRef: "rome",
          label: "A fleet for Rome", resolutionMechanism: "appointment_authority", deadlineInDays: null, reason: "The fleet." },
      ],
    )] });
    const result = await runSimulationBurst(input(port, "Write to Hiero and put the fleet to the Senate; once Hiero answers, speak for the fleet."));
    const ledger = result.world.orders.find((candidate) => candidate.id === result.orderRecordId)!;
    const held = ledger.parts.flatMap((entry) => entry.stages);
    expect(held.length).toBeGreaterThan(0);
    expect(JSON.stringify(held.map((stage) => stage.held))).not.toContain("local:fleet-question");
  });

  it("reads a part whose goal is met but whose held act failed as partly done", () => {
    const state = world();
    const done = part({
      goals: [{ kind: "force_at", forceId: "roman-field-army", provinceId: ROME }],
      stages: [{ held: { op: "force_modify" }, waitsOn: [{ kind: "force_at", forceId: "roman-field-army", provinceId: ROME }], status: "failed", reason: "It could not be carried out as written.", heldSinceStep: 0, failedAtStep: 1 }],
    });
    expect(orderPartStatus(state, done)).toBe("partly_done");
  });
});

describe("E10: the consul's own crossing", () => {
  it("is waiting until what it needs is so, not handed on", () => {
    const state = world();
    const held = part({ stages: [{ held: { op: "resume_instruction", instruction: "Carry the legion over" }, waitsOn: [{ kind: "force_at", forceId: "roman-field-army", provinceId: MESSANA }], status: "waiting", reason: null, heldSinceStep: 0, failedAtStep: null }] });
    const status = orderPartStatus(state, held);
    expect(status).toBe("awaiting_condition");
    expect(orderPartLabel(status, held, state)).toMatch(/^waiting until .* reaches /);
  });

  it("is done by the man who gave it, when it is his army, and handed to nobody", async () => {
    const state: WorldState = { ...world(), instant: { day: 1, minute: 540 }, elapsedStep: 1, orders: [record([part({
      said: "March the legion into Campania once it is mustered",
      goals: [{ kind: "force_at", forceId: "roman-field-army", provinceId: CAMPANIA }],
      stages: [{ held: { op: "resume_instruction", instruction: "March the legion into Campania" }, waitsOn: [{ kind: "force_at", forceId: "roman-field-army", provinceId: ROME }], status: "waiting", reason: null, heldSinceStep: 0, failedAtStep: null }],
    })])] };
    const result = await runSimulationBurst(input(scripted({}), null, state));
    const resumed = result.world.orders[0]!.parts[0]!;
    expect(resumed.stages[0]!.status).toBe("resumed");
    expect(result.world.orderAttempts.some((attempt) => attempt.issuerRef.id === CONSUL)).toBe(false);
    expect(["achieved", "under_way"]).toContain(orderPartStatus(result.world, resumed));
  });

  it("gives up waiting for ships that have not come in two months", async () => {
    const first = world();
    const ashore: WorldState = {
      ...first, instant: { day: 70, minute: 540 }, elapsedStep: 70,
      material: { ...first.material, forces: first.material.forces.map((force) => force.polityId !== "rome" || force.id === "roman-field-army" ? force : { ...force, personnel: force.personnel.map((category) => ({ ...category, fit: 0 })) }) },
      orders: [record([part({
        said: "Carry Legio I to Messana",
        goals: [{ kind: "force_at", forceId: "roman-field-army", provinceId: MESSANA }],
        stages: [{ held: { op: "force_modify", forceRef: "roman-field-army", locationId: MESSANA, reason: "Over." }, waitsOn: [{ kind: "transport_capacity", forceId: "roman-field-army", provinceId: MESSANA }], status: "waiting", reason: null, heldSinceStep: 5, failedAtStep: null }],
      })])],
    };
    const result = await runSimulationBurst(input(scripted({}), null, ashore));
    const given = result.world.orders[0]!.parts[0]!;
    expect(given.stages[0]!.status).toBe("failed");
    expect(given.refusal).toMatch(/no ships enough to carry the army came in \d+ days/);
  });

  it("holds the same act on the same conditions once, however many orders held it", () => {
    const held = { held: { op: "force_modify", forceRef: "roman-field-army", locationId: MESSANA, reason: "Over." }, waitsOn: [{ kind: "transport_capacity" as const, forceId: "roman-field-army", provinceId: MESSANA }], status: "waiting" as const, reason: null, heldSinceStep: 0, failedAtStep: null };
    expect(dedupeStages([held, { ...held, heldSinceStep: 3 }, { ...held, status: "failed" as const }])).toHaveLength(2);
  });

  it("has a word for every status", () => {
    const state = world();
    for (const status of ORDER_PART_STATUSES) {
      expect(ORDER_PART_STATUS_LABEL[status].length).toBeGreaterThan(0);
      expect(orderPartLabel(status, part({}), state).length).toBeGreaterThan(0);
    }
  });
});

describe("E11: the engine's refusals", () => {
  it("never reach the part a held act failed for", async () => {
    const state: WorldState = { ...world(), instant: { day: 1, minute: 540 }, elapsedStep: 1, orders: [record([part({
      said: "Bring up the phantom legion",
      stages: [{ held: { op: "force_modify", forceRef: "legio-phantasma", locationId: CAMPANIA, reason: "Up." }, waitsOn: [{ kind: "force_at", forceId: "roman-field-army", provinceId: ROME }], status: "waiting", reason: null, heldSinceStep: 0, failedAtStep: null }],
    })])] };
    const result = await runSimulationBurst(input(scripted({}), null, state));
    const failed = result.world.orders[0]!.parts[0]!;
    expect(failed.stages[0]!.status).toBe("failed");
    expect(failed.refusal).toBeNull();
    expect(failed.whyNot).toBe("It could not be carried out as written.");
    expect(lineOf(result.world, failed, CONSUL)).not.toContain("phantasma");
    expect(ordersUnderWay(result.world, CONSUL, offices).map((item) => item.detail).join(" ")).not.toContain("phantasma");
  });
});
