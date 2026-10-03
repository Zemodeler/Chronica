import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  ScenarioDefinitionSchema,
  WorldDeltaSchema,
  WorldStateSchema,
  buildAuthorityIndex,
  checkAuthority,
  describeFerry,
  ensureProvinceMaterial,
  maxFerryLoads,
  openWar,
  passageFor,
  passagePlanFor,
  vacateOfficeOf,
  warfareWith,
  type ScenarioClock,
  type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext, ApplyResult } from "./apply/context";
import { keepCommandTenure, prorogationId } from "./command-tenure";
import { carryOutEnactment } from "./enact";
import { reviewPowers } from "./polity-end";
import { createIdFactory } from "./ports";
import { buildWorldSlice, renderWorldSlice } from "./slice";
import { settleUnionOffers, unionScore } from "./submission";
import { runDeterministicTick } from "./tick";

/**
 * Workstream 4 of the Codex hand-mode play-test (docs/reports/
 * 2026-10-03-codex-hand-playtest-triage.md): a consul who could not cross to
 * Sicily, spend what the Senate voted, act as proconsul, leave a garrison, or
 * take an ally into the state.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const clock: ScenarioClock = definition.clock;
const CONSUL = "gaius-genucius";
const PRAETOR = "rome-praetor-4d5r44";
const { messana: MESSANA, rhegium: RHEGIUM } = PUNIC_IDS;

const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const contextFor = (actor: string, tag: string, world: WorldState, orderDeltas?: ReadonlySet<unknown>): ApplyContext => ({
  now: world.instant, actorRef: { kind: "character", id: actor }, offices, successionRules: definition.government.successionRules,
  warfare: definition.warfare, terrains: definition.map.terrains, ids: createIdFactory(tag), gameId: "game-ws4", playerCharacterId: actor,
  ...(orderDeltas === undefined ? {} : { orderDeltas: orderDeltas as ApplyContext["orderDeltas"] }),
});
const order = (world: WorldState, actor: string, raw: readonly Record<string, unknown>[], tag: string): ApplyResult => {
  const deltas = raw.map((delta) => WorldDeltaSchema.parse(delta));
  return applyDeltas(world, deltas, contextFor(actor, tag, world, new Set(deltas)));
};
const fitOf = (world: WorldState, forceId: string): number =>
  world.material.forces.find((force) => force.id === forceId)?.personnel.reduce((sum, group) => sum + group.fit, 0) ?? 0;
/** The consul's army, cut to the 8,772 men of the play-test and standing where it is put. */
const armyAt = (world: WorldState, provinceId: string): WorldState => ({
  ...world,
  material: {
    ...world.material,
    forces: world.material.forces.map((force) => (force.id !== "roman-field-army" ? force : {
      ...force, locationId: provinceId, positionId: null,
      personnel: force.personnel.map((group, at) => (at === 0 ? { ...group, fit: group.fit - (8_860 - 8_772) } : group)),
    })),
  },
});
const hullsAs = (world: WorldState, categoryId: string, polityId = "rome"): WorldState => ({
  ...world,
  material: {
    ...world.material,
    forces: world.material.forces.map((force) => (force.id !== "allied-greek-hulls" ? force : {
      ...force, polityId, personnel: [{ categoryId, label: "Allied transports", fit: 18, unavailable: [] }],
    })),
  },
});

describe("the crossing to Sicily (E22, L12)", () => {
  it("puts 8,772 men over the Messana strait in the 18 allied hulls, even written as warships", () => {
    // 540 a load is seventeen loads: past the old cap of twelve, and a load a
    // day over a strait an hour wide.
    const world = hullsAs(armyAt(opening(), RHEGIUM), "warship");
    expect(fitOf(world, "roman-field-army")).toBe(8_772);
    const passage = passageFor(world, world.material.forces.find((force) => force.id === "roman-field-army")!, MESSANA, warfareWith(world, definition.warfare));
    expect(passage.by).toBe("sea");
    if (passage.by !== "sea") return;
    expect(passage.ferry.trips).toBe(17);
    expect(passage.ferry.trips).toBeLessThanOrEqual(maxFerryLoads(passage.km));
    expect(passage.ferry.daysPerLoad).toBe(1);
  });

  it("carries the army in a few loads when the hulls are transports, as the scenario now writes them", () => {
    const world = armyAt(opening(), RHEGIUM);
    expect(world.material.forces.find((force) => force.id === "allied-greek-hulls")!.personnel[0]!.categoryId).toBe("transport");
    const passage = passageFor(world, world.material.forces.find((force) => force.id === "roman-field-army")!, MESSANA, warfareWith(world, definition.warfare));
    expect(passage.by === "sea" ? passage.ferry.trips : null).toBe(Math.ceil(8_772 / (18 * 120)));
  });

  it("knows transports in a world whose scenario never wrote them down", () => {
    const old = { ...definition.warfare, troopCategories: definition.warfare.troopCategories.filter((category) => category.id !== "transport") };
    expect(warfareWith(opening(), old).troopCategories.some((category) => category.id === "transport" && category.transportPerHead === 120)).toBe(true);
  });

  it("sails in an ally's hulls, and says whose they were", () => {
    // Filed under the Apulian cities -- Tarentum's ships -- the foedus puts them at Rome's call.
    const world = hullsAs(armyAt(opening(), RHEGIUM), "transport", "apulian-cities");
    const army = world.material.forces.find((force) => force.id === "roman-field-army")!;
    const passage = passageFor(world, army, MESSANA, warfareWith(world, definition.warfare));
    expect(passage.by).toBe("sea");
    if (passage.by !== "sea") return;
    expect(passage.ferry.fleets.map((fleet) => fleet.id)).toContain("allied-greek-hulls");
    expect(describeFerry(world, army, passage.ferry)).toMatch(/requisitioned from Apulian cities/);
  });

  it("has the port-holding allies send hulls with their men the day Rome goes to war", () => {
    const seen = runDeterministicTick({ world: opening(), toDay: 1, ids: createIdFactory("levy-1"), warfare: definition.warfare, playerCharacterId: null }).world;
    const atWar = { ...seen, polityAgreements: openWar(seen.polityAgreements, { id: "war-carthage", polityId: "rome", otherPolityId: "carthage", terms: "War.", atStep: 1, sourceMessageId: null, reason: "War." }) };
    const ticked = runDeterministicTick({ world: atWar, toDay: 2, ids: createIdFactory("levy-2"), warfare: definition.warfare, playerCharacterId: null });
    const hulls = ticked.world.material.forces.filter((force) => force.polityId === "apulian-cities" && force.personnel.some((group) => group.categoryId === "transport"));
    expect(hulls.length).toBe(1);
    expect(ticked.factProposals.some((fact) => fact.kind === "allies_levied" && /transports/.test(fact.summary))).toBe(true);
  });

  it("calls for the socii navales on demand: the allies' harbours send hulls the army can cross in", () => {
    let world = armyAt(opening(), RHEGIUM);
    world = { ...world, material: { ...world.material, forces: world.material.forces.filter((force) => force.id !== "allied-greek-hulls"), accounts: world.material.accounts.filter((account) => !(account.owner.kind === "force" && account.owner.id === "allied-greek-hulls")) } };
    const done = order(world, CONSUL, [{ op: "force_create", localId: "socii", name: "Hulls of the Greek allies", polityId: "apulian-cities", commanderCharacterRef: CONSUL, controllerCharacterRef: CONSUL, locationId: PUNIC_IDS.tarentum, authorizedStrength: 40, categoryId: "transport", reason: "Requisition the socii navales." }], "socii");
    expect(done.rejected.map((entry) => entry.reason)).toEqual([]);
    const fleet = done.world.material.forces.find((force) => force.id === done.assignedIds.get("socii"))!;
    expect(fleet.polityId).toBe("apulian-cities");
    expect(fitOf(done.world, fleet.id)).toBeGreaterThan(0);
    expect(done.factProposals.some((fact) => fact.kind === "hulls_requisitioned")).toBe(true);
    const plan = passagePlanFor(done.world, done.world.material.forces.find((force) => force.id === "roman-field-army")!, MESSANA, warfareWith(done.world, definition.warfare));
    expect(plan?.fleets.map((entry) => entry.fleet.id)).toContain(fleet.id);
  });
});

describe("money the Senate voted (L13)", () => {
  const voted = (world: WorldState, holderRef: string | null, amount = 5_000) => {
    const opened = order(world, CONSUL, [{
      op: "political_procedure_open", localId: "transports", type: "council_deliberation", institutionRef: "roman-senate", sponsorCharacterRef: CONSUL,
      subjectKind: "polity", subjectRef: "rome", label: "Money for transports to Sicily", resolutionMechanism: "vote", deadlineInDays: 10,
      enacts: { budget: { accountRef: "rome-treasury", amount, purpose: "Transports for the crossing", ...(holderRef === null ? {} : { holderRef }) } }, reason: "The army must cross.",
    }], "vote");
    const id = opened.assignedIds.get("transports")!;
    return carryOutEnactment(opened.world, id, 10, createIdFactory("carried"), offices).world;
  };
  const hire = { op: "service_contract_open", localId: "ships", role: "mercenary", label: "Forty Tarentine transports", employerAccountRef: "rome-treasury",
    employeeRef: "settlement-tarentum", advance: 500, monthlyPay: 100, termDays: 120, duties: "Carry the consul's army over the strait",
    company: { categoryId: "transport", strength: 40 }, reason: "Hire transports with the money voted." };

  it("refuses a man with no key to the treasury before the vote, and lets him spend once it passes", () => {
    const before = order(opening(), PRAETOR, [hire], "before");
    expect(before.applied.filter((entry) => entry.delta.op === "service_contract_open")).toHaveLength(0);
    const world = voted(opening(), PRAETOR);
    const grant = world.authorityGrants.find((candidate) => candidate.source === "law" && candidate.holder.id === PRAETOR)!;
    expect(grant.scope).toEqual({ kind: "account", id: "rome-treasury" });
    expect(grant.cap).toEqual({ amount: 5_000, spent: 0 });
    expect(grant.expiresAtStep).toBe(10 + 365);
    const index = buildAuthorityIndex(world.material, world.authorityGrants, offices, world.elapsedStep);
    expect(checkAuthority(index, { holder: { kind: "character", id: PRAETOR }, domain: "fiscal", scope: { kind: "account", id: "rome-treasury" }, power: "spend" }).grant?.id).toBe(grant.id);
  });

  it("hires forty transports at Tarentum on the money voted, and the army crosses in them", () => {
    let world = voted(opening(), PRAETOR);
    // No allied hulls: only what the vote buys.
    world = { ...world, material: { ...world.material, forces: world.material.forces.filter((force) => force.id !== "allied-greek-hulls"), accounts: world.material.accounts.filter((account) => !(account.owner.kind === "force" && account.owner.id === "allied-greek-hulls")) } };
    const hired = order(world, PRAETOR, [hire], "hire");
    expect(hired.rejected.map((entry) => entry.reason)).toEqual([]);
    const contract = hired.world.material.contracts.at(-1)!;
    const shipmaster = hired.world.characters.find((character) => character.id === contract.employeeCharacterId)!;
    expect(shipmaster.locationProvinceId).toBe(PUNIC_IDS.tarentum);
    const fleet = hired.world.material.forces.find((force) => force.id === contract.forceId)!;
    expect(fleet.polityId).toBe("rome");
    expect(fleet.personnel[0]).toMatchObject({ categoryId: "transport", fit: 40 });
    // Counted against the vote: 500 down and four months at 100.
    expect(hired.world.authorityGrants.find((grant) => grant.holder.id === PRAETOR && grant.source === "law")!.cap!.spent).toBe(900);
    const army = hired.world.material.forces.find((force) => force.id === "roman-field-army")!;
    const plan = passagePlanFor(hired.world, army, MESSANA, warfareWith(hired.world, definition.warfare));
    expect(plan?.fleets.map((entry) => entry.fleet.id)).toContain(fleet.id);
    expect(plan!.trips).toBe(Math.ceil(fitOf(hired.world, "roman-field-army") / (40 * 120)));
  });

  it("stops at the sum voted", () => {
    const world = voted(opening(), PRAETOR, 600);
    const hired = order(world, PRAETOR, [hire], "over");
    expect(hired.applied.filter((entry) => entry.delta.op === "service_contract_open")).toHaveLength(0);
  });
});

describe("a proconsul (L14)", () => {
  const government = { offices, successionRules: definition.government.successionRules };
  const prorogued = (): WorldState => {
    let world: WorldState = { ...opening(), elapsedStep: 335, instant: { day: 335, minute: 540 } };
    world = keepCommandTenure({ world, government, toDay: 335, ids: createIdFactory("p1"), endedTerms: [], playerCharacterId: CONSUL }).world;
    world = { ...world, elapsedStep: 365, instant: { day: 365, minute: 540 }, material: { ...world.material, politicalProcedures: world.material.politicalProcedures.map((procedure) => (procedure.id === prorogationId(CONSUL, 365) ? { ...procedure, outcome: "passed" as const, stage: "resolved" as const, resolvedAtStep: 360 } : procedure)) } };
    world = keepCommandTenure({ world, government, toDay: 365, ids: createIdFactory("p2"), endedTerms: [{ characterId: CONSUL, officeId: "roman-consul", seatId: "roman-consul:seat:0", endedAtStep: 365 }], playerCharacterId: CONSUL }).world;
    // His year is over: the seat is vacated, as the tick does on the day.
    return vacateOfficeOf(world, CONSUL, "roman-consul", "term_expired", 365);
  };

  it("holds command, a war chest, the treasury to an allowance and the field's diplomacy, by the prorogation", () => {
    const world = prorogued();
    const hold = world.commandHolds.find((candidate) => candidate.characterId === CONSUL && candidate.status === "active")!;
    const grants = world.authorityGrants.filter((grant) => grant.sourceRef === hold.id && grant.revokedAtStep === null);
    expect(grants.map((grant) => grant.domain).sort()).toEqual(expect.arrayContaining(["military", "fiscal", "diplomatic"]));
    expect(grants.every((grant) => grant.source === "law" && grant.expiresAtStep === hold.untilStep)).toBe(true);
    const treasury = grants.find((grant) => grant.scope.id === "rome-treasury")!;
    // A year of what his armies cost: the legion's pay and the hulls' victualling.
    expect(treasury.cap!.amount).toBe((229 + 40) * 12);
  });

  it("leaves a garrison and spends from the treasury out of office, and the slice says what he may do", () => {
    const world = prorogued();
    const done = order(world, CONSUL, [
      { op: "force_create", localId: "garrison", name: "Garrison of Rome", polityId: "rome", commanderCharacterRef: CONSUL, controllerCharacterRef: CONSUL, locationId: PUNIC_IDS.rome, authorizedStrength: 1_000, fromForceRef: "roman-field-army", reason: "Garrison the city." },
      { op: "money_transfer", fromAccountRef: "rome-treasury", toAccountRef: null, amount: 300, reason: "Grain for the army." },
    ], "pro");
    expect(done.rejected.map((entry) => entry.reason)).toEqual([]);
    expect(done.breaches).toEqual([]);
    const slice = renderWorldSlice(buildWorldSlice({ world: done.world, clock, offices, actorRef: { kind: "character", id: CONSUL }, actorPolityId: "rome", orderText: null, facts: [], dueEvents: [], pendingEvents: [] }));
    expect(slice).toMatch(/Proconsul \(prorogued until [^)]+\): may command Roman field army/);
    expect(slice).toMatch(/spend up to \d+ more from rome-treasury/);
    expect(slice).toMatch(/Gaius Genucius[^\n]*Proconsul/);
  });

  it("gives the grants back when the hold ends", () => {
    let world = prorogued();
    const hold = world.commandHolds.find((candidate) => candidate.characterId === CONSUL && candidate.status === "active")!;
    world = { ...world, elapsedStep: hold.untilStep!, instant: { day: hold.untilStep!, minute: 540 } };
    const ended = keepCommandTenure({ world, government, toDay: hold.untilStep!, ids: createIdFactory("p3"), endedTerms: [], playerCharacterId: CONSUL }).world;
    expect(ended.authorityGrants.filter((grant) => grant.sourceRef === hold.id).every((grant) => grant.revokedAtStep !== null)).toBe(true);
  });
});

describe("a garrison from the consul's own army (E25)", () => {
  it("garrisons Rhegium from the army standing there: every kind of man, on the walls, holding", () => {
    const world = armyAt(opening(), RHEGIUM);
    const done = order(world, CONSUL, [{ op: "force_create", localId: "garrison_rhegium", name: "Garrison of Rhegium", polityId: "rome", commanderCharacterRef: CONSUL, controllerCharacterRef: CONSUL, locationId: RHEGIUM, authorizedStrength: 1_000, fromForceRef: "roman-field-army", reason: "Garrison Rhegium." }], "garrison");
    expect(done.rejected.map((entry) => entry.reason)).toEqual([]);
    const garrison = done.world.material.forces.find((force) => force.id === done.assignedIds.get("garrison_rhegium"))!;
    expect(garrison.locationId).toBe(RHEGIUM);
    expect(garrison.hold).toBe(true);
    expect(garrison.positionId).toContain("settlement:");
    const army = world.material.forces.find((force) => force.id === "roman-field-army")!;
    expect(garrison.personnel.length).toBe(army.personnel.length);
    expect(new Set(garrison.personnel.map((group) => group.categoryId))).toEqual(new Set(army.personnel.map((group) => group.categoryId)));
    expect(garrison.personnel.reduce((sum, group) => sum + group.fit, 0)).toBe(1_000);
    expect(fitOf(done.world, "roman-field-army")).toBe(8_772 - 1_000);
    expect(done.factProposals.some((fact) => fact.kind === "garrison_set")).toBe(true);
  });

  it("sends a garrison on to a town the army is not in", () => {
    const world = armyAt(opening(), PUNIC_IDS.rome);
    const done = order(world, CONSUL, [{ op: "force_create", localId: "garrison_rhegium", name: "Garrison of Rhegium", polityId: "rome", commanderCharacterRef: CONSUL, controllerCharacterRef: CONSUL, locationId: RHEGIUM, authorizedStrength: 1_000, fromForceRef: "roman-field-army", reason: "Garrison Rhegium." }], "sent");
    const id = done.assignedIds.get("garrison_rhegium")!;
    expect(done.world.projects.some((project) => project.status === "in_progress" && project.completionOutcome?.kind === "force_move" && project.completionOutcome.forceId === id && project.completionOutcome.provinceId === RHEGIUM)).toBe(true);
  });
});

describe("an ally taken into the state (L15)", () => {
  const offer = (world: WorldState, to: string, clauses: readonly Record<string, unknown>[], terms = "Be one state with Rome.") => order(world, CONSUL, [{
    op: "diplomatic_message_send", localId: "union", kind: "letter", fromPolityId: "rome", fromCharacterRef: CONSUL, toPolityId: to, subject: "Union with Rome",
    terms, replyWithinDays: 30, clauses, reason: "Take them in.",
  }], "offer");
  const citizenship = (to: string) => [{ kind: "submission", polityId: to, toPolityId: "rome" }, { kind: "undertaking", byPolityId: "rome", duty: "other", what: "Full Roman citizenship for every free man", withinDays: 30 }];

  it("accepts by rule an offer of union with citizenship to a weak, loyal ally, and the ally is absorbed", () => {
    const sent = offer(opening(), "marsi-paeligni", citizenship("marsi-paeligni"));
    const letter = sent.world.diplomacy.at(-1)!;
    expect(unionScore(sent.world, "marsi-paeligni", "rome", "citizenship", letter.id).score).toBeGreaterThanOrEqual(35);
    // Nobody answers: the rule does, on the reply date, and not as silence.
    const due = letter.replyDueByStep!;
    const facts: Parameters<typeof settleUnionOffers>[2] = [];
    const settled = settleUnionOffers({ ...sent.world, elapsedStep: due, instant: { day: due, minute: 540 } }, due, facts);
    expect(settled.diplomacy.find((message) => message.id === letter.id)?.answer).toBe("accepted");
    expect(settled.map.polities.find((polity) => polity.id === "marsi-paeligni")?.endedHow).toBe("absorbed");
    expect(facts.some((fact) => fact.kind === "polity_ended" && /by its own consent/.test(fact.summary))).toBe(true);
  });

  it("holds the model's answer to the rule: a refusal of a willing union is carried as acceptance", () => {
    const sent = offer(opening(), "marsi-paeligni", citizenship("marsi-paeligni"));
    const letter = sent.world.diplomacy.at(-1)!;
    const day = letter.deliveredOnDay ?? 0;
    const answerer = letter.toCharacterId ?? sent.world.characters.find((character) => character.polityId === "marsi-paeligni")!.id;
    const at = { ...sent.world, elapsedStep: day, instant: { day, minute: 540 } };
    const answered = order(at, answerer, [{ op: "diplomatic_message_answer", messageRef: letter.id, answer: "refused", answerText: "We keep our own laws.", reason: "Pride." }], "answer");
    expect(answered.world.diplomacy.find((message) => message.id === letter.id)?.answer).toBe("accepted");
    expect(answered.world.map.polities.find((polity) => polity.id === "marsi-paeligni")?.endedHow).toBe("absorbed");
  });

  it("refuses by rule a bare demand on an ally that hates its leader, and Rome remembers it", () => {
    const sent = offer(opening(), "samnites", [{ kind: "submission", polityId: "samnites", toPolityId: "rome" }]);
    const letter = sent.world.diplomacy.at(-1)!;
    const due = letter.replyDueByStep!;
    const settled = settleUnionOffers({ ...sent.world, elapsedStep: due, instant: { day: due, minute: 540 } }, due, []);
    expect(settled.diplomacy.find((message) => message.id === letter.id)?.answer).toBe("refused");
    expect(settled.map.polities.find((polity) => polity.id === "samnites")?.endedAtStep ?? null).toBeNull();
    expect(settled.economy?.grievances.some((grievance) => grievance.polityId === "rome" && grievance.againstPolityId === "samnites")).toBe(true);
  });

  it("takes in the allies a franchise law is offered to, if they will have it", () => {
    const opened = order(opening(), CONSUL, [{
      op: "political_procedure_open", localId: "franchise", type: "council_deliberation", institutionRef: "roman-senate", sponsorCharacterRef: CONSUL,
      subjectKind: "polity", subjectRef: "rome", label: "Citizenship for the Marsi and the Samnites", resolutionMechanism: "vote", deadlineInDays: 10,
      enacts: { franchise: { polityIds: ["marsi-paeligni", "samnites"], status: "citizenship" } }, reason: "Make Italy Roman.",
    }], "franchise");
    const carried = carryOutEnactment(opened.world, opened.assignedIds.get("franchise")!, 10, createIdFactory("fr"), offices);
    expect(carried.world.map.polities.find((polity) => polity.id === "marsi-paeligni")?.endedHow).toBe("absorbed");
    expect(carried.world.map.polities.find((polity) => polity.id === "samnites")?.endedAtStep ?? null).toBeNull();
    expect(carried.facts.some((fact) => fact.kind === "law_enacted" && /Marsi/.test(fact.summary))).toBe(true);
  });

  it("deditio: a power whose last city is taken by the enemy that beat it gives itself up to it", () => {
    let world = opening();
    // The Campanians of Rhegium, at war with Rome, lose Rhegium and their legion.
    world = {
      ...world,
      map: { ...world.map, provinces: world.map.provinces.map((province) => ({ ...province, settlements: province.settlements.map((city) => (city.controllerPolityId === "rhegium-campanians" ? { ...city, controllerPolityId: "rome" } : city)), controllerPolityId: province.controllerPolityId === "rhegium-campanians" ? "rome" : province.controllerPolityId })) },
      material: { ...world.material, forces: world.material.forces.filter((force) => force.polityId !== "rhegium-campanians") },
    };
    const reviewed = reviewPowers(world, 30, createIdFactory("deditio"), "rome");
    expect(reviewed.world.map.polities.find((polity) => polity.id === "rhegium-campanians")?.absorbedByPolityId).toBe("rome");
    expect(reviewed.facts.some((fact) => fact.kind === "deditio")).toBe(true);
  });
});
