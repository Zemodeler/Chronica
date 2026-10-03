import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, deriveRelationDimension, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { createIdFactory } from "./ports";
import { DEBT_LAW_STANDING_BPS, LAND_LAW_STANDING_BPS } from "./reform-laws";
import { holdVotes, MOTION_VOTING_DAYS, splitOfBloc } from "./senate";
import { SECESSION_UNREST_BPS } from "./tribunes";

/**
 * The reformer: a tribune of the plebs who means to pass laws that do
 * something, forbid the consuls' measures, and take the plebs out of the city
 * when the Senate will not listen. In the play-test his plebiscite "passed" and
 * did nothing, said so to nobody; his veto and his secession were told back to
 * him as done, and nothing happened at all.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const successionRules = definition.government.successionRules;
const TRIBUNE = "quintus-ogulnius";
const CONSUL = "gaius-genucius";

/** Rome at the opening, with Ogulnius sitting as a tribune of the plebs. */
const opening = (): WorldState => {
  const world = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
  return {
    ...world,
    material: {
      ...world.material,
      officeSeats: [...world.material.officeSeats.filter((seat) => seat.officeId !== "roman-tribune"), {
        id: "roman-tribune:seat:reformer", officeId: "roman-tribune", seatIndex: 0, holderCharacterId: TRIBUNE, status: "held", vacancyCause: "none",
        termStartedAtStep: 0, termExpiresAtStep: 365, appointmentProcedureId: null, removalProcedureId: null, eligibilityRequirementIds: [],
      }],
    },
  };
};

const context = (actor: string, day = 0) => ({
  now: { day, minute: 540 }, actorRef: { kind: "character" as const, id: actor }, offices, successionRules,
  warfare: definition.warfare, ids: createIdFactory(`reformer-${actor}-${day}`), gameId: "game-reformer",
});

const apply = (world: WorldState, raw: Record<string, unknown>, actor: string, day = 0) => {
  const result = applyDeltas(world, [WorldDeltaSchema.parse(raw)], context(actor, day));
  expect(result.rejected).toEqual([]);
  return result;
};

/** The tribune puts a question to the Council of the Plebs, to be voted in ten days. */
function plebiscite(world: WorldState, label: string, enacts: Record<string, unknown> | null, subjectKind = "polity") {
  const opened = apply(world, {
    op: "political_procedure_open", localId: "rogatio", type: "vote", institutionRef: "roman-concilium-plebis", sponsorCharacterRef: TRIBUNE,
    subjectKind, subjectRef: subjectKind === "polity" ? "rome" : null, label, resolutionMechanism: "vote", deadlineInDays: 10, enacts, reason: "The plebs ask it.",
  }, TRIBUNE);
  return { world: opened.world, id: opened.assignedIds.get("rogatio")! };
}

const question = (world: WorldState, id: string) => world.material.politicalProcedures.find((procedure) => procedure.id === id)!;
const count = (world: WorldState, toDay: number) => holdVotes({ world, offices, successionRules, toDay, ids: createIdFactory(`count-${toDay}`) });
const prestigeOf = (world: WorldState, id: string) => world.characters.find((character) => character.id === id)!.prestigeBps;

describe("a plebiscite", () => {
  it("that enacts nothing is told, when carried, that it begins nothing", () => {
    // About the plebs rather than the whole state: the warning used to be
    // given only for a question about a polity.
    const { world, id } = plebiscite(opening(), "That the public land be shared among the plebs", null, "group");
    const counted = count(world, 10);
    expect(question(counted.world, id).outcome).toBe("passed");
    const fact = counted.facts.find((candidate) => candidate.kind === "motion_passed")!;
    expect(fact.summary).toContain("begins nothing by itself");
    expect(counted.world.material.holdings).toHaveLength(world.material.holdings.length);
  });

  it("that is an agrarian law gives the landless land, and earns its sponsor standing and the landholders' hatred", () => {
    const before = opening();
    const { world, id } = plebiscite(before, "The agrarian law of Ogulnius", { land: null });
    const counted = count(world, 10);
    expect(WorldStateSchema.safeParse(counted.world).success).toBe(true);
    expect(question(counted.world, id).outcome).toBe("passed");
    const allotments = counted.world.material.holdings.filter((holding) => holding.title.startsWith("An allotment of public land"));
    expect(allotments.length).toBeGreaterThan(0);
    for (const holding of allotments) {
      const holder = counted.world.characters.find((character) => character.id === holding.legalHolderCharacterId)!;
      expect(holder.polityId).toBe("rome");
      expect(holder.ordo).not.toBe("patrician");
      expect(holder.id).not.toBe(TRIBUNE);
      // Paid like any estate: a yield into the man's own purse.
      expect(counted.world.material.incomeSources.find((source) => source.id === holding.incomeSourceId)?.beneficiaryAccountId).toBe(holder.personalAccountId);
      expect(deriveRelationDimension(holder, TRIBUNE, "affection")).toBeGreaterThan(0);
    }
    expect(prestigeOf(counted.world, TRIBUNE)).toBe(Math.min(10_000, prestigeOf(before, TRIBUNE) + LAND_LAW_STANDING_BPS));
    // The Genucian estates lie on Roman land: their holder loses a tenth and resents it.
    const genucian = (state: WorldState) => state.material.incomeSources.find((source) => source.id === "genucian-estates-yield")!.amount;
    expect(genucian(counted.world)).toBeLessThan(genucian(before));
    const genucius = counted.world.characters.find((character) => character.id === CONSUL)!;
    expect(deriveRelationDimension(genucius, TRIBUNE, "affection")).toBeLessThan(0);
    expect(counted.facts.find((fact) => fact.kind === "law_enacted")!.summary).toContain("allotments");
  });

  it("that is a debt law caps the interest on private loans and forgives a share of them", () => {
    const base = opening();
    const debtor = base.characters.find((character) => character.id === "manius-curius")!;
    const withLoan: WorldState = {
      ...base,
      material: {
        ...base.material,
        loans: [...base.material.loans, {
          id: "curius-debt", lenderKind: "character", lenderId: "gnaeus-cornelius", borrowerAccountId: debtor.personalAccountId,
          principal: 1_000, outstanding: 1_000, interestBps: 200, cadenceSteps: 30, serviceObligationId: null, terms: "A thousand at two in the hundred a month",
          collateralHoldingId: null, status: "active", openedAtStep: 0,
        }],
      },
    };
    const { world, id } = plebiscite(withLoan, "The debt law of Ogulnius", { debt: 5_000 });
    const counted = count(world, 10);
    expect(question(counted.world, id).outcome).toBe("passed");
    const loan = counted.world.material.loans.find((candidate) => candidate.id === "curius-debt")!;
    expect(loan.outstanding).toBe(500);
    // A twelfth a year, as the month it is charged by: 833 * 30 / 365.
    expect(loan.interestBps).toBe(68);
    expect(prestigeOf(counted.world, TRIBUNE)).toBe(Math.min(10_000, prestigeOf(withLoan, TRIBUNE) + DEBT_LAW_STANDING_BPS));
    const lender = counted.world.characters.find((character) => character.id === "gnaeus-cornelius")!;
    expect(deriveRelationDimension(lender, TRIBUNE, "trust")).toBeLessThan(0);
  });
});

describe("a house that cannot make up its mind", () => {
  it("divides each bloc by its lean rather than voting it whole", () => {
    const bloc = { weight: 60, yesThreshold: 15, noThreshold: -15 };
    expect(splitOfBloc(bloc, 20)).toEqual({ yes: 60, no: 0, abstain: 0 });
    expect(splitOfBloc(bloc, 10)).toEqual({ yes: 40, no: 0, abstain: 20 });
    expect(splitOfBloc(bloc, 0)).toEqual({ yes: 0, no: 0, abstain: 60 });
    expect(splitOfBloc(bloc, -5)).toEqual({ yes: 0, no: 20, abstain: 40 });
    expect(splitOfBloc(bloc, -15)).toEqual({ yes: 0, no: 60, abstain: 0 });
  });

  it("puts a question off rather than rejecting it on the word of one small bloc", () => {
    // The rural tribes do not care (0); the four urban tribes are against (-16).
    // Voted whole, that was rejected 0 to 4 with twenty-nine tribes silent.
    const base = opening();
    const indifferent: WorldState = { ...base, material: { ...base.material, institutions: base.material.institutions.map((institution) => (institution.id !== "roman-concilium-plebis" ? institution : {
      ...institution,
      votingBlocs: institution.votingBlocs.map((bloc) => ({ ...bloc, interests: [], baseSupport: bloc.id === "plebeian-urban" ? -16 : 0 })),
    })) } };
    const { world, id } = plebiscite(indifferent, "A vote of thanks to the people of Rome", null);
    const first = count(world, 10);
    expect(question(first.world, id).outcome).toBeNull();
    expect(question(first.world, id).adjournments).toBe(1);
    expect(question(first.world, id).deadlineStep).toBe(10 + MOTION_VOTING_DAYS);
    expect(first.facts.map((fact) => fact.kind)).toContain("motion_adjourned");
    expect(first.world.material.voteRecords).toHaveLength(world.material.voteRecords.length);
    // Put again, and still undecided: the count stands.
    const second = count(first.world, 10 + MOTION_VOTING_DAYS);
    expect(question(second.world, id).outcome).toBe("failed");
    expect(WorldStateSchema.safeParse(second.world).success).toBe(true);
  });
});

describe("a tribune's veto", () => {
  /** The consul puts war taxes to the Senate, to be voted in thirty days. */
  const warTaxes = (world: WorldState) => {
    const opened = apply(world, {
      op: "political_procedure_open", localId: "taxes", type: "council_deliberation", institutionRef: "roman-senate", sponsorCharacterRef: CONSUL,
      subjectKind: "polity", subjectRef: "rome", label: "Wartime taxes", resolutionMechanism: "vote", deadlineInDays: 30,
      enacts: { effects: [{ quantity: "income", band: "slight" }] }, reason: "Carthage is coming.",
    }, CONSUL);
    return { world: opened.world, id: opened.assignedIds.get("taxes")! };
  };

  it("stops a pending question the moment he interposes it", () => {
    const { world, id } = warTaxes(opening());
    const vetoed = apply(world, { op: "political_procedure_resolve", procedureRef: id, outcome: "blocked", outcomeReason: "The tribune forbids it.", reason: "He vetoes it." }, TRIBUNE, 3);
    expect(question(vetoed.world, id).stage).toBe("blocked");
    expect(vetoed.factProposals.some((fact) => fact.kind === "motion_vetoed" && fact.summary.includes("Tribune of the plebs"))).toBe(true);
    // And the house never counts it.
    const counted = count(vetoed.world, 30);
    expect(counted.world.genericEntities.some((entity) => entity.kind === "law")).toBe(false);
  });

  it("is nobody else's to interpose", () => {
    const { world, id } = warTaxes(opening());
    const result = applyDeltas(world, [WorldDeltaSchema.parse({ op: "political_procedure_resolve", procedureRef: id, outcome: "blocked", outcomeReason: "Forbidden.", reason: "He says so." })], context("manius-curius", 3));
    expect(question(result.world, id).stage).not.toBe("blocked");
  });

  it("by intercession stops the motions the magistrate already has before the house", () => {
    const { world, id } = warTaxes(opening());
    const interceded = apply(world, {
      op: "generic_entity_create", localId: "intercessio", kind: "intercession", label: "Ogulnius intercedes against the consul's motions",
      ownerRef: { kind: "character", id: TRIBUNE }, attributes: { against: CONSUL, act: "motion" }, reason: "He interposes himself.",
    }, TRIBUNE, 2);
    const counted = count(interceded.world, 30);
    expect(question(counted.world, id).outcome).toBe("blocked");
    expect(counted.facts[0]!.kind).toBe("motion_vetoed");
  });
});

describe("the secession of the plebs", () => {
  const secede = (world: WorldState, demandId: string) => apply(world, {
    op: "generic_entity_create", localId: "secessio", kind: "secession", label: "The plebs withdraw to the Sacred Mount",
    ownerRef: { kind: "character", id: TRIBUNE }, attributes: { demand: demandId }, reason: "The Senate will not hear the plebs.",
  }, TRIBUNE, 1).world;

  /** A Senate disposed against the plebs by so much. */
  const senateAt = (world: WorldState, baseSupport: number): WorldState => ({ ...world, material: { ...world.material, institutions: world.material.institutions.map((institution) => (institution.id !== "roman-senate" ? institution : {
    ...institution, votingBlocs: institution.votingBlocs.map((bloc) => ({ ...bloc, baseSupport })),
  })) } });

  it("stops the city's business until the house gives way, and then carries the demand", () => {
    // Rome is at war and Ogulnius is a man of standing, but the Senate is set
    // against a land law (-40, weighed by its blocs): it holds out a month.
    const { world, id } = plebiscite(senateAt(opening(), -30), "The agrarian law of Ogulnius", { land: null });
    const out = secede(world, id);
    const first = count(out, 1);
    expect(first.facts.map((fact) => fact.kind)).toContain("secession_begun");
    expect(question(first.world, id).outcome).toBeNull();
    // Its day comes, and no chamber sits while the plebs are out.
    const onItsDay = count(first.world, 10);
    expect(question(onItsDay.world, id).outcome).toBeNull();
    // A month out, and the Senate gives way: the demand is carried and does what it says.
    const conceded = count(onItsDay.world, 31);
    expect(question(conceded.world, id).outcome).toBe("passed");
    expect(conceded.facts.map((fact) => fact.kind)).toContain("secession_ended");
    expect(conceded.world.material.holdings.some((holding) => holding.title.startsWith("An allotment of public land"))).toBe(true);
    expect(conceded.world.genericEntities.find((entity) => entity.kind === "secession")!.attributes.retiredAtStep).toBe(31);
    expect(WorldStateSchema.safeParse(conceded.world).success).toBe(true);
  });

  it("makes the city restless each month the house holds out", () => {
    // A Senate set hard against anything the plebs could ask.
    const { world, id } = plebiscite(senateAt(opening(), -100), "The agrarian law of Ogulnius", { land: null });
    const begun = count(secede(world, id), 1);
    const stability = (state: WorldState) => state.material.provinceMaterial.find((entry) => entry.provinceId === state.map.provinces.find((province) => province.settlements.some((settlement) => settlement.id === state.map.polities.find((polity) => polity.id === "rome")!.capitalSettlementId))!.id)!.stabilityBps;
    const month = count(begun.world, 31);
    expect(question(month.world, id).outcome).toBeNull();
    expect(stability(month.world)).toBe(Math.max(0, stability(begun.world) - SECESSION_UNREST_BPS));
    expect(month.facts.map((fact) => fact.kind)).toContain("secession_toll");
  });
});

describe("a dictator", () => {
  it("is named by a consul, and seated", () => {
    const named = apply(opening(), {
      op: "office_seat_set", officeId: "roman-dictator", seatId: null, holderCharacterRef: "manius-curius", cause: "none", termDays: null, reason: "The state is in danger.",
    }, CONSUL);
    const seat = named.world.material.officeSeats.find((candidate) => candidate.officeId === "roman-dictator" && candidate.status === "held");
    expect(seat?.holderCharacterId).toBe("manius-curius");
  });

  it("is named by a consul's nomination, settled on his own authority", () => {
    const opened = apply(opening(), {
      op: "political_procedure_open", localId: "dictio", type: "nomination", institutionRef: null, sponsorCharacterRef: CONSUL,
      subjectKind: "character", subjectRef: "manius-curius", label: "Manius Curius Dentatus named dictator", resolutionMechanism: "appointment_authority",
      deadlineInDays: null, reason: "The state is in danger.",
    }, CONSUL);
    const id = opened.assignedIds.get("dictio")!;
    const named = apply(opened.world, { op: "political_procedure_resolve", procedureRef: id, outcome: "passed", outcomeReason: "The consul names him.", reason: "He is named." }, CONSUL);
    expect(named.world.material.officeSeats.find((candidate) => candidate.officeId === "roman-dictator" && candidate.status === "held")?.holderCharacterId).toBe("manius-curius");
  });
});
