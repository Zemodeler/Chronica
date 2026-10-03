import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  ScenarioDefinitionSchema,
  WorldStateSchema,
  adjacentTo,
  ensureProvinceMaterial,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { keepCommandTenure, prorogationId } from "./command-tenure";
import { commandTenureOf } from "./constitutions";
import { holdElections } from "./elections";
import { missionDestination } from "./mission-intent";
import { endPolity } from "./polity-end";
import { createIdFactory } from "./ports";
import { settleRatifications } from "./ratification";
import { seatByOutcome } from "./senate";

/**
 * The hand-played run to Sicily under total control (eval-out/hand-conquer,
 * PHASE3_REPORT.md, P3-1 .. P3-40), and what a year's end does to a
 * commander's army now (`command-tenure.ts`).
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const CONSUL = "gaius-genucius";
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const contextFor = (actor: string, ids = "sicily"): ApplyContext => ({
  now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: actor }, offices: definition.government.offices, successionRules: definition.government.successionRules,
  warfare: definition.warfare, terrains: definition.map.terrains, ids: createIdFactory(ids), gameId: "game-sicily", playerCharacterId: CONSUL,
});
const orderOf = (world: WorldState, actor: string, deltas: readonly WorldDelta[]) => applyDeltas(world, deltas, { ...contextFor(actor), orderDeltas: new Set(deltas) });
/** A man with no office: the consul's seat given to somebody else. */
const outOfOffice = (world: WorldState, who: string): WorldState => ({
  ...world,
  material: { ...world.material, officeSeats: world.material.officeSeats.map((seat) => (seat.holderCharacterId === who ? { ...seat, holderCharacterId: "manius-curius" } : seat)) },
});

describe("where an army is sent", () => {
  it("reads the rest of an order for a destination only where something is sent there", () => {
    // T37: "ships at Syracuse" in another part sent a field army to Syracuse.
    const world = opening();
    expect(missionDestination(world, "roman-field-army", "cross with the army", "Keep the ships at Syracuse. Cross with the army.", CONSUL)).toBeNull();
    expect(missionDestination(world, "roman-field-army", "send it with them", "Send the legion to Messana", CONSUL)).toBe(PUNIC_IDS.messana);
  });
});

describe("ground taken by saying so", () => {
  it("does not count ground won in the same answer as ground to take more from", () => {
    // T36: twenty rows flipped nineteen provinces from the one an army stood in.
    const base = opening();
    const army = base.material.forces.find((force) => force.id === "roman-field-army")!;
    const near = (id: string): string[] => adjacentTo(base, id).map((entry) => entry.provinceId);
    const first = near(army.locationId).find((id) => near(id).some((next) => next !== army.locationId && !near(army.locationId).includes(next)))!;
    const second = near(first).find((id) => id !== army.locationId && !near(army.locationId).includes(id))!;
    // Both made nobody's, and nothing of Rome's beside the second but the first.
    const cleared = new Set([first, second, ...near(second).filter((id) => id !== first)]);
    const world = { ...base, map: { ...base.map, provinces: base.map.provinces.map((province) => (cleared.has(province.id) ? { ...province, controllerPolityId: null } : province)) } };
    const result = orderOf(world, CONSUL, [
      { op: "province_control_set", provinceId: first, toPolityRef: "rome", firmnessBps: 3_000, reason: "Claimed." },
      { op: "province_control_set", provinceId: second, toPolityRef: "rome", firmnessBps: 3_000, reason: "Claimed from the first." },
    ]);
    expect(result.world.map.provinces.find((province) => province.id === first)!.controllerPolityId).toBe("rome");
    expect(result.world.map.provinces.find((province) => province.id === second)!.controllerPolityId).toBeNull();
  });

  it("takes another power's ground only with an army in it or next to it", () => {
    const world = opening();
    const romanIds = new Set(world.map.provinces.filter((province) => province.controllerPolityId === "rome").map((province) => province.id));
    const armies = new Set(world.material.forces.filter((force) => force.polityId === "rome").map((force) => force.locationId));
    const target = world.map.provinces.find((province) => province.controllerPolityId !== null && province.controllerPolityId !== "rome"
      && adjacentTo(world, province.id).some((entry) => romanIds.has(entry.provinceId))
      && !armies.has(province.id) && !adjacentTo(world, province.id).some((entry) => armies.has(entry.provinceId)));
    if (target === undefined) return;
    const result = orderOf(world, CONSUL, [{ op: "province_control_set", provinceId: target.id, toPolityRef: "rome", firmnessBps: 3_000, reason: "Taken." }]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toContain("taken by men");
  });
});

describe("a kingdom absorbed", () => {
  it("pays its taxes to the victor and stops owing what it owed", () => {
    // P3-29: Syracuse, absorbed on 8 June, went on asking more of its lands than they could bear.
    const world = opening();
    const victim = world.map.polities.find((polity) => world.material.incomeSources.some((source) => world.material.accounts.find((account) => account.id === source.beneficiaryAccountId)?.owner.id === polity.id) && polity.id !== "rome")!;
    const treasury = world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === victim.id)!;
    const rome = world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === "rome")!;
    const ended = endPolity(world, victim.id, "absorbed", "rome", 10).world;
    expect(ended.material.incomeSources.filter((source) => source.active && source.beneficiaryAccountId === treasury.id)).toEqual([]);
    expect(ended.material.incomeSources.some((source) => source.active && source.beneficiaryAccountId === rome.id)).toBe(true);
    expect(ended.material.obligations.filter((obligation) => obligation.active && obligation.payerAccountId === treasury.id)).toEqual([]);
  });
});

describe("war and peace in a private man's name", () => {
  it("lays a war he has no power to declare before the Senate, and declares nothing", () => {
    // P3-25: a senator with no office declared war on Carthage for all of Rome.
    const world = outOfOffice(opening(), CONSUL);
    const result = orderOf(world, CONSUL, [{ op: "agreement_open", localId: "war", kind: "war", polityId: "rome", otherPolityId: "carthage", terms: "War.", forDays: null, sourceMessageRef: null, visibility: "public", reason: "He wants Sicily." }]);
    expect(result.world.polityAgreements.some((agreement) => agreement.kind === "war" && agreement.status === "active" && [agreement.polityId, agreement.otherPolityId].includes("carthage"))).toBe(false);
    expect(result.rejected[0]?.kind).toBe("ignored");
    expect(result.world.material.politicalProcedures.some((procedure) => procedure.label.startsWith("Motion of Gaius Genucius") && procedure.label.includes("war on"))).toBe(true);
  });

  it("holds terms he agreed abroad until the Senate ratifies them", () => {
    // P3-22: Hieron accepted a private man's terms, and a kingdom was absorbed on his word.
    let world = outOfOffice(opening(), CONSUL);
    const sent = orderOf(world, CONSUL, [{ op: "diplomatic_message_send", localId: "terms", kind: "alliance_offer", fromPolityId: "rome", fromCharacterRef: CONSUL, toPolityId: "carthage", toCharacterRef: null,
      subject: "An alliance", terms: "Rome and Carthage stand together.", replyWithinDays: 30, inReplyToRef: null, visibility: "polity", proposes: ["alliance"] } as WorldDelta]);
    world = sent.world;
    const letter = world.diplomacy.at(-1)!;
    expect(letter.withoutAuthority).toBe(true);
    const carthaginian = world.characters.find((character) => character.alive && character.polityId === "carthage")!;
    const answered = applyDeltas({ ...world, diplomacy: world.diplomacy.map((message) => (message.id === letter.id ? { ...message, deliveredOnDay: 0 } : message)) },
      [{ op: "diplomatic_message_answer", messageRef: letter.id, answer: "accepted", answerText: "Agreed.", reason: "It suits Carthage." } as WorldDelta], contextFor(carthaginian.id, "answer"));
    const waiting = answered.world.diplomacy.find((message) => message.id === letter.id)!;
    expect(answered.world.polityAgreements.some((agreement) => agreement.kind === "alliance" && agreement.sourceMessageId === letter.id)).toBe(false);
    expect(waiting.ratification?.status).toBe("waiting");
    // The Senate carries it: now it binds.
    const voted: WorldState = { ...answered.world, material: { ...answered.world.material, politicalProcedures: answered.world.material.politicalProcedures.map((procedure) => (procedure.id === waiting.ratification!.procedureId ? { ...procedure, outcome: "passed" as const, stage: "resolved" as const, resolvedAtStep: 5 } : procedure)) } };
    const ratified = settleRatifications(voted, contextFor(CONSUL, "ratify"));
    expect(ratified.world.polityAgreements.some((agreement) => agreement.kind === "alliance" && agreement.sourceMessageId === letter.id && agreement.status === "active")).toBe(true);
    expect(ratified.world.diplomacy.find((message) => message.id === letter.id)!.ratification?.status).toBe("ratified");
  });
});

describe("a peace that already stands", () => {
  it("takes further cessions as additions to it, not as a second peace refused", () => {
    // P3-33: five cession letters "accepted", "already stand in peace", nothing moved.
    const base = opening();
    const world = { ...base, polityAgreements: [...base.polityAgreements, { id: "agreement-peace", kind: "peace" as const, polityId: "rome", otherPolityId: "carthage", terms: "Peace.", sinceStep: 0, untilStep: null, sourceMessageId: null, status: "active" as const, endedAtStep: null, endedReason: null, visibility: "public" as const }] };
    const theirs = world.map.provinces.find((province) => province.controllerPolityId === "carthage")!;
    const more = applyDeltas(world, [{ op: "agreement_open", localId: "peace2", kind: "peace", polityId: "rome", otherPolityId: "carthage", terms: "And a province of theirs.", forDays: null, sourceMessageRef: null, visibility: "public",
      clauses: [{ kind: "cession", provinceId: theirs.id, toPolityId: "rome" }], reason: "Further terms." } as WorldDelta], { ...contextFor(CONSUL), actsForTheWorld: true });
    expect(more.rejected).toEqual([]);
    expect(more.world.map.provinces.find((province) => province.id === theirs.id)!.controllerPolityId).toBe("rome");
    expect(more.world.polityAgreements.filter((agreement) => agreement.kind === "peace" && agreement.status === "active"
      && [agreement.polityId, agreement.otherPolityId].includes("rome") && [agreement.polityId, agreement.otherPolityId].includes("carthage"))).toHaveLength(1);
  });
});

describe("an office the Senate makes for a man", () => {
  it("is his when the motion carries", () => {
    // P3-18: "Gaius Genucius Clepsina, proconsul of Sicily" carried; the consul named Coruncanius.
    const world = opening();
    const procedure = { id: "procedure-proconsul", type: "council_deliberation" as const, institutionId: "roman-senate", sponsorCharacterId: CONSUL, subjectKind: "character" as const, subjectId: CONSUL,
      label: "Gaius Genucius Clepsina, proconsul of Sicily", eligibilityRequirementIds: [], eligibleParticipantIds: [], stage: "resolved" as const, resolutionMechanism: "vote" as const,
      openedAtStep: 0, deadlineStep: 10, resolvedAtStep: 10, visibility: "public" as const, voteRecordId: null, outcome: "passed" as const, outcomeReason: null, sourceEventIds: [], resultingEventIds: [] };
    const office = { id: "rome-proconsul-sicily", label: "Proconsul of Sicily", polityId: "rome", authorisedActionIds: ["force_modify"], sponsorableCategories: [], treasuryAccountId: null, treasuryPermissions: [],
      incomeSourceId: null, expectedBlocId: null, successionRuleId: "roman-election-centuriate", eligibilityRequirementIds: [], termDays: 365, kind: "magistracy" as const };
    const withIt = WorldStateSchema.parse({
      ...world,
      offices: [...world.offices, office],
      material: { ...world.material, politicalProcedures: [...world.material.politicalProcedures, procedure] },
      enactments: [...world.enactments, { procedureId: procedure.id, polityId: "rome", office: { officeId: office.id, officeLabel: office.label, termDays: 365 } }],
    });
    const seated = seatByOutcome(withIt, procedure as never, 10, definition.government.offices);
    expect(seated.material.officeSeats.some((seat) => seat.officeId === office.id && seat.holderCharacterId === CONSUL && seat.status === "held")).toBe(true);
  });
});

describe("the year's end", () => {
  const government = { offices: definition.government.offices, successionRules: definition.government.successionRules };

  it("elects the next consuls before the year runs out, and they take office on its last day", () => {
    // P3-12: no consuls from 3 March to 2 May, mid-war.
    let world = { ...opening(), elapsedStep: 340, instant: { day: 340, minute: 540 } };
    world = holdElections({ world, government, toDay: 340, ids: createIdFactory("e1"), playerCharacterId: CONSUL }).world;
    const called = world.material.politicalProcedures.filter((procedure) => procedure.subjectKind === "office_seat" && procedure.openedAtStep === 340 && procedure.label.includes("consul"));
    expect(called.length).toBeGreaterThan(0);
    const polling = Math.max(...called.map((procedure) => procedure.deadlineStep ?? 0));
    expect(polling).toBeLessThan(365);
    world = { ...world, elapsedStep: polling, instant: { day: polling, minute: 540 } };
    world = holdElections({ world, government, toDay: polling, ids: createIdFactory("e2"), playerCharacterId: CONSUL }).world;
    const seats = world.material.officeSeats.filter((seat) => seat.officeId === "roman-consul");
    expect(seats.every((seat) => seat.status === "held" && seat.designateCharacterId != null)).toBe(true);
  });

  it("asks the Senate whether a consul at war keeps his army, before his year ends", () => {
    const world = { ...opening(), elapsedStep: 335, instant: { day: 335, minute: 540 } };
    const kept = keepCommandTenure({ world, government, toDay: 335, ids: createIdFactory("t1"), endedTerms: [], playerCharacterId: CONSUL });
    const question = kept.world.material.politicalProcedures.find((procedure) => procedure.id === prorogationId(CONSUL, 365));
    expect(question?.type).toBe("command_assignment");
    expect(question?.deadlineStep).toBeLessThanOrEqual(365);
    expect(kept.facts.some((fact) => fact.kind === "prorogation_debated")).toBe(true);
  });

  it("keeps a prorogued consul at the head of his army for another year", () => {
    let world = { ...opening(), elapsedStep: 335, instant: { day: 335, minute: 540 } };
    world = keepCommandTenure({ world, government, toDay: 335, ids: createIdFactory("t2"), endedTerms: [], playerCharacterId: CONSUL }).world;
    world = { ...world, elapsedStep: 365, instant: { day: 365, minute: 540 }, material: { ...world.material, politicalProcedures: world.material.politicalProcedures.map((procedure) => (procedure.id === prorogationId(CONSUL, 365) ? { ...procedure, outcome: "passed" as const, stage: "resolved" as const, resolvedAtStep: 360 } : procedure)) } };
    const ended = keepCommandTenure({ world, government, toDay: 365, ids: createIdFactory("t3"), endedTerms: [{ characterId: CONSUL, officeId: "roman-consul", seatId: "roman-consul:seat:0", endedAtStep: 365 }], playerCharacterId: CONSUL });
    const hold = ended.world.commandHolds.find((candidate) => candidate.characterId === CONSUL && candidate.status === "active");
    expect(hold?.basis).toBe("prorogued");
    expect(hold?.untilStep).toBe(365 + 365);
  });

  it("hands the army to his successor when he arrives, and keeps the player on as legate", () => {
    let world = { ...opening(), elapsedStep: 365, instant: { day: 365, minute: 540 } };
    // The new consul took the seat today.
    world = { ...world, material: { ...world.material, officeSeats: world.material.officeSeats.map((seat) => (seat.id === "roman-consul:seat:0" ? { ...seat, holderCharacterId: "manius-curius", termStartedAtStep: 365, termExpiresAtStep: 730 } : seat)) } };
    const ended = keepCommandTenure({ world, government, toDay: 365, ids: createIdFactory("t4"), endedTerms: [{ characterId: CONSUL, officeId: "roman-consul", seatId: "roman-consul:seat:0", endedAtStep: 365 }], playerCharacterId: CONSUL });
    const waiting = ended.world.commandHolds.find((candidate) => candidate.characterId === CONSUL && candidate.status === "active")!;
    expect(waiting.basis).toBe("awaiting_successor");
    expect(waiting.successorCharacterId).toBe("manius-curius");
    // Still his until then.
    expect(ended.world.material.forces.find((force) => force.id === "roman-field-army")!.commanderCharacterId).toBe(CONSUL);
    const arrival = waiting.untilStep!;
    const later = { ...ended.world, elapsedStep: arrival, instant: { day: arrival, minute: 540 } };
    const handed = keepCommandTenure({ world: later, government, toDay: arrival, ids: createIdFactory("t5"), endedTerms: [], playerCharacterId: CONSUL });
    expect(handed.world.material.forces.find((force) => force.id === "roman-field-army")!.commanderCharacterId).toBe("manius-curius");
    expect(handed.world.commandHolds.some((candidate) => candidate.characterId === CONSUL && candidate.basis === "legate" && candidate.status === "active")).toBe(true);
    expect(handed.world.authorityGrants.some((grant) => grant.holder.id === CONSUL && grant.scope.kind === "force" && grant.revokedAtStep === null)).toBe(true);
  });

  it("brings a man to trial for what he answers for, once his office no longer covers him", () => {
    let world = { ...opening(), elapsedStep: 365, instant: { day: 365, minute: 540 } };
    world = {
      ...world,
      answerable: [{ characterId: CONSUL, polityId: "rome", kind: "defeat", label: "lost the Roman field army at Messana", atStep: 300, weight: 5 }],
      // A man who hates him.
      characters: world.characters.map((character) => (character.id === "lucius-papirius" ? { ...character, relations: [...character.relations.filter((relation) => relation.subjectCharacterId !== CONSUL),
        { subjectCharacterId: CONSUL, causes: [{ id: "cause-hate", label: "He stole my command.", score: -60, occurredAtStep: 300, decayPerYearBps: 0, encounterMemoryId: null }] }] } : character)),
      material: { ...world.material, forces: world.material.forces.filter((force) => force.commanderCharacterId !== CONSUL) },
    };
    const ended = keepCommandTenure({ world, government, toDay: 365, ids: createIdFactory("t6"), endedTerms: [{ characterId: CONSUL, officeId: "roman-consul", seatId: "roman-consul:seat:0", endedAtStep: 365 }], playerCharacterId: CONSUL });
    const trial = ended.world.material.politicalProcedures.find((procedure) => procedure.type === "denunciation" && procedure.subjectId === CONSUL);
    expect(trial?.sponsorCharacterId).toBe("lucius-papirius");
    expect(trial?.sentence).toBe("fine");
    expect(ended.world.answerable.filter((entry) => entry.characterId === CONSUL)).toEqual([]);
  });
});

describe("command tenure as a part of a constitution", () => {
  it("reads Rome's commanders as annual and Carthage's as answerable to a court", () => {
    const world = opening();
    expect(commandTenureOf(world, "rome")).toBe("annual_prorogable");
    expect(commandTenureOf(world, "carthage")).toBe("indefinite_answerable");
  });
});
