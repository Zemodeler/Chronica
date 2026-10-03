import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { DEFAULT_BUDGET, runSimulationBurst } from "./burst";
import { createIdFactory, type SimModelPort } from "./ports";
import { DEBATE_LEAD_DAYS, debatersOf, holdVotes, voteCalendarDays, voteDayOf } from "./senate";

/**
 * "War taxes and a Roman navy", put to the Senate on the first of March, was
 * still gathering support sixty days past its day: only elections were ever
 * counted, and nobody was ever asked to settle anything else. A question
 * before a chamber is now debated by its people in the days before its vote,
 * and counted on its day by the chamber's own blocs and rules.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
/**
 * The count by the house's dispositions alone: what each bloc wants of a
 * question (a tax, a land law) moves it too, and that is tested where it is
 * built, in `constitutions.test.ts`. Here the blocs want nothing in particular.
 */
const opening = (): WorldState => {
  const world = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
  return { ...world, material: { ...world.material, institutions: world.material.institutions.map((institution) => ({ ...institution, votingBlocs: institution.votingBlocs.map((bloc) => ({ ...bloc, interests: [] })) })) } };
};

const context = (actor = "gaius-genucius") => ({
  now: { day: 0, minute: 540 }, actorRef: { kind: "character" as const, id: actor }, offices,
  warfare: definition.warfare, ids: createIdFactory(`senate-${actor}`), gameId: "game-senate",
});

/** The consul puts war taxes to the Senate, to be voted in thirty days, and says what they would do. */
function warTaxes(state: WorldState = opening()) {
  const opened = applyDeltas(state, [WorldDeltaSchema.parse({
    op: "political_procedure_open", localId: "taxes", type: "council_deliberation", institutionRef: "roman-senate", sponsorCharacterRef: "gaius-genucius",
    subjectKind: "polity", subjectRef: "rome", label: "Wartime taxes and a Roman navy", resolutionMechanism: "vote", deadlineInDays: 30,
    enacts: { effects: [{ quantity: "income", band: "slight" }] }, reason: "Carthage is coming.",
  })], context());
  expect(opened.rejected).toEqual([]);
  return { world: opened.world, id: opened.assignedIds.get("taxes")! };
}

const speak = (state: WorldState, procedureId: string, who: { kind: "character" | "group"; id: string }, position: "support" | "oppose") => {
  const result = applyDeltas(state, [WorldDeltaSchema.parse({
    op: "political_support_set", procedureRef: procedureId, supporterKind: who.kind, supporterRef: who.id, position,
    influenceWeight: 50, reasonKind: "material_interest", reasonLabel: "The purse of the Republic.", reason: "He speaks.",
  })], context(who.kind === "character" ? who.id : "gaius-genucius"));
  expect(result.rejected).toEqual([]);
  return result.world;
};

const question = (state: WorldState, id: string) => state.material.politicalProcedures.find((procedure) => procedure.id === id)!;
const vote = (state: WorldState, toDay: number) => holdVotes({ world: state, offices, toDay, ids: createIdFactory("count") });

describe("a question before the Senate", () => {
  it("is not counted before its day", () => {
    const { world, id } = warTaxes();
    const early = vote(world, 29);
    expect(question(early.world, id).stage).toBe("gathering_support");
    expect(early.facts).toEqual([]);
  });

  it("is counted on its day by the blocs, and does what it said it would once carried", () => {
    const { world, id } = warTaxes();
    const counted = vote(world, 30);
    expect(WorldStateSchema.safeParse(counted.world).success).toBe(true);
    const settled = question(counted.world, id);
    // The Patricians lean for the government's business (20, all for at 15);
    // the Populars (-10) sit between their thresholds and divide by their
    // lean: two thirds of the way to their line against, so 27 of their 40
    // vote against and 13 abstain.
    expect(settled.outcome).toBe("passed");
    const record = counted.world.material.voteRecords.find((candidate) => candidate.id === settled.voteRecordId)!;
    expect(record).toMatchObject({ yesWeight: 60, noWeight: 27, abstainWeight: 13, quorumMet: true, thresholdMet: true });
    expect(counted.facts[0]!.summary).toContain("The Senate carried \"Wartime taxes and a Roman navy\", 60 to 27, 13 abstaining");
    expect(counted.facts[0]!.summary).toContain("the plebeian new men 27 against and 13 abstaining");
    expect(counted.world.genericEntities.some((entity) => entity.kind === "law")).toBe(true);
  });

  it("is carried by the votes cast, however many abstain", () => {
    // The fleet for the southern allies: 49 for, the rest undecided or mildly
    // against. Counted over the whole house it failed, as if the undecided had
    // voted no; counted over the votes cast, 49 to 34 carries it.
    const { world, id } = warTaxes();
    const reweighed: WorldState = { ...world, material: { ...world.material, institutions: world.material.institutions.map((institution) => (institution.id !== "roman-senate" ? institution : {
      ...institution,
      votingBlocs: institution.votingBlocs.map((bloc) => ({ ...bloc, weight: bloc.id === "patrician-bloc" ? 49 : 51 })),
    })) } };
    const counted = vote(reweighed, 30);
    const settled = question(counted.world, id);
    const record = counted.world.material.voteRecords.find((candidate) => candidate.id === settled.voteRecordId)!;
    expect(record).toMatchObject({ yesWeight: 49, noWeight: 34, abstainWeight: 17 });
    expect(settled.outcome).toBe("passed");
  });

  it("every chamber of the opening decides by the votes cast", () => {
    expect(opening().material.institutions.map((institution) => [institution.id, institution.denominator]).filter(([, denominator]) => denominator !== "cast")).toEqual([]);
  });

  it("is turned by what its people say", () => {
    const { world, id } = warTaxes();
    // The Populars' leaders come out against it, and two of the first men of
    // the house speak with them: the Patricians' lean falls below their line.
    const vetoOffices = new Set(offices.filter((office) => office.vetoes).map((office) => office.id));
    const senior = [...debatersOf(world, offices, 30 - DEBATE_LEAD_DAYS, ["gaius-genucius"]).keys()].filter((id) => !world.material.officeSeats.some((seat) => seat.holderCharacterId === id && vetoOffices.has(seat.officeId))).slice(0, 2);
    expect(senior).toHaveLength(2);
    let spoken = speak(world, id, { kind: "group", id: "popular-bloc" }, "oppose");
    for (const senator of senior) spoken = speak(spoken, id, { kind: "character", id: senator }, "oppose");

    const counted = vote(spoken, 30);
    expect(question(counted.world, id).outcome).toBe("failed");
    expect(counted.facts[0]!.kind).toBe("motion_failed");
    expect(counted.facts[0]!.summary).toContain("against it");
    expect(counted.world.genericEntities.some((entity) => entity.kind === "law")).toBe(false);
  });

  it("is counted at the first tick that finds it overdue", () => {
    const { world, id } = warTaxes();
    const late = vote(world, 90);
    expect(question(late.world, id).resolvedAtStep).toBe(90);
  });

  it("counts an appointment to a command no election fills", () => {
    // "Assign command of the Sicilian front to Clepsina", filed as a question
    // about a seat: left to the elections, which fill no such seat, it was
    // still gathering support forty days past its vote.
    const opened = applyDeltas(opening(), [WorldDeltaSchema.parse({
      op: "political_procedure_open", localId: "command", type: "appointment", institutionRef: "roman-senate", sponsorCharacterRef: "gaius-genucius",
      subjectKind: "office_seat", subjectRef: null, label: "Assign command of the Sicilian front to Gaius Genucius Clepsina", resolutionMechanism: "vote", deadlineInDays: 15,
      reason: "The consul asks for the Sicilian command.",
    })], context());
    expect(opened.rejected).toEqual([]);
    const id = opened.assignedIds.get("command")!;
    const counted = vote(opened.world, 20);
    expect(question(counted.world, id).resolvedAtStep).toBe(20);
    expect(["passed", "failed"]).toContain(question(counted.world, id).outcome);
  });

  it("cannot be carried by whoever writes the order", () => {
    const { world, id } = warTaxes();
    const result = applyDeltas(world, [WorldDeltaSchema.parse({
      op: "political_procedure_resolve", procedureRef: id, outcome: "passed", outcomeReason: "Carried.", reason: "The consul says so.",
    })], context());
    expect(result.rejected[0]!.reason).toContain("votes on it, in 30 days");
    expect(question(result.world, id).outcome).toBeNull();
  });
});

describe("the debate before the vote", () => {
  it("wants the men who matter to it in its last days, and never the player", () => {
    const { world, id } = warTaxes();
    expect(debatersOf(world, offices, 10, []).size).toBe(0);
    const due = debatersOf(world, offices, 30 - DEBATE_LEAD_DAYS, ["gaius-genucius"]);
    expect(due.size).toBeGreaterThan(0);
    expect(due.has("gaius-genucius")).toBe(false);
    expect([...due.values()][0]).toContain(`[${id}] in ${DEBATE_LEAD_DAYS} days`);
    // Everyone who is wanted is a Roman.
    for (const characterId of due.keys()) expect(world.characters.find((character) => character.id === characterId)?.polityId).toBe("rome");
  });

  it("stops asking a man once he has said where he stands", () => {
    const { world, id } = warTaxes();
    const first = [...debatersOf(world, offices, 26, ["gaius-genucius"]).keys()][0]!;
    const spoken = speak(world, id, { kind: "character", id: first }, "support");
    expect(debatersOf(spoken, offices, 26, ["gaius-genucius"]).has(first)).toBe(false);
  });

  it("puts the debate and the vote on the calendar", () => {
    const { world, id } = warTaxes();
    expect(voteDayOf(question(world, id))).toBe(30);
    expect(voteCalendarDays(world)).toEqual([30 - DEBATE_LEAD_DAYS, 30]);
  });

  it("is heard in a burst, and the vote is counted inside it", { timeout: 30_000 }, async () => {
    const { world } = warTaxes();
    const days: string[] = [];
    const port: SimModelPort = {
      complete(operation, _system, user) {
        if (operation === "simulate_orchestrate") {
          return Promise.resolve(JSON.stringify({ intent: { summary: "Wait.", domains: ["administration"] }, narrativeSummary: "The consul waits.", deltas: [], facts: [], outcome: "continue" }));
        }
        if (operation !== "simulate_cognition") return Promise.resolve("{}");
        days.push(/Today is ([^.]+)\./.exec(user)?.[1] ?? "?");
        return Promise.resolve(JSON.stringify({ actors: [] }));
      },
    };
    const result = await runSimulationBurst({
      world, clock: definition.clock, offices, warfare: definition.warfare,
      successionRules: definition.government.successionRules,
      burstId: "senate", gameId: "game-senate", actorRef: { kind: "character", id: "gaius-genucius" }, actorPolityId: "rome",
      orderText: "Let the Senate sit.", knownFacts: [], queue: [], port, narratorSeeds: [], budget: DEFAULT_BUDGET, spanDays: 40,
    });
    // Asked on the debate's first day, 26 March, whatever else was on the calendar.
    expect(days).toContain("26 March 270 BC");
    expect(result.world.material.politicalProcedures.find((procedure) => procedure.label === "Wartime taxes and a Roman navy")!.stage).toBe("resolved");
  });
});

describe("questions that move an office", () => {
  const put = (state: WorldState, raw: Record<string, unknown>) => {
    const opened = applyDeltas(state, [WorldDeltaSchema.parse({
      op: "political_procedure_open", localId: "q", institutionRef: "roman-senate", sponsorCharacterRef: "gaius-genucius",
      resolutionMechanism: "vote", deadlineInDays: 10, reason: "The consul asks it.", ...raw,
    })], context());
    expect(opened.rejected).toEqual([]);
    return { world: opened.world, id: opened.assignedIds.get("q")! };
  };
  const counted = (state: WorldState, toDay: number) => holdVotes({ world: state, offices, successionRules: definition.government.successionRules, toDay, ids: createIdFactory("seat-count") });

  it("seats the man a carried appointment names", () => {
    const { world, id } = put(opening(), { type: "appointment", subjectKind: "character", subjectRef: "quintus-ogulnius", label: "That Quintus Ogulnius Gallus be named dictator" });
    const result = counted(world, 10);
    expect(WorldStateSchema.safeParse(result.world).success).toBe(true);
    expect(question(result.world, id).outcome).toBe("passed");
    const dictatorship = result.world.material.officeSeats.find((seat) => seat.officeId === "roman-dictator" && seat.status === "held");
    expect(dictatorship?.holderCharacterId).toBe("quintus-ogulnius");
  });

  it("leaves a man standing for an elected office to the election", () => {
    const { world, id } = put(opening(), { type: "nomination", subjectKind: "character", subjectRef: "quintus-ogulnius", label: "Quintus Ogulnius Gallus stands for consul" });
    const result = counted(world, 10);
    expect(question(result.world, id).stage).not.toBe("resolved");
    expect(result.facts.some((fact) => fact.kind === "motion_passed")).toBe(false);
  });
});

describe("a tribune's veto", () => {
  const TRIBUNE = "quintus-ogulnius";
  const withTribune = (): WorldState => {
    const state = opening();
    return {
      ...state,
      material: {
        ...state.material,
        officeSeats: [...state.material.officeSeats.filter((seat) => seat.officeId !== "roman-tribune"), {
          id: "roman-tribune:seat:veto", officeId: "roman-tribune", seatIndex: 0, holderCharacterId: TRIBUNE, status: "held", vacancyCause: "none",
          termStartedAtStep: 0, termExpiresAtStep: 365, appointmentProcedureId: null, removalProcedureId: null, eligibilityRequirementIds: [],
        }],
      },
    };
  };

  it("blocks the question on its day while he holds to it", () => {
    const { world, id } = warTaxes(withTribune());
    const vetoed = speak(world, id, { kind: "character", id: TRIBUNE }, "oppose");
    const result = vote(vetoed, 30);
    expect(WorldStateSchema.safeParse(result.world).success).toBe(true);
    const blocked = question(result.world, id);
    expect(blocked.stage).toBe("blocked");
    expect(blocked.outcome).toBe("blocked");
    expect(result.facts[0]!.kind).toBe("motion_vetoed");
    expect(result.facts[0]!.summary).toContain("as Tribune of the plebs, forbade");
    expect(result.world.genericEntities.some((entity) => entity.kind === "law")).toBe(false);
  });

  it("lets the house vote once he relents", () => {
    const { world, id } = warTaxes(withTribune());
    const vetoed = speak(world, id, { kind: "character", id: TRIBUNE }, "oppose");
    const relented = applyDeltas(vetoed, [WorldDeltaSchema.parse({
      op: "political_support_set", procedureRef: id, supporterKind: "character", supporterRef: TRIBUNE, position: "abstain",
      influenceWeight: 0, reasonKind: "favour", reasonLabel: "The consul met his price.", reason: "He withdraws his veto.",
    })], { ...context(TRIBUNE), now: { day: 5, minute: 540 } });
    expect(relented.rejected).toEqual([]);
    expect(question(vote(relented.world, 30).world, id).outcome).toBe("passed");
  });
});
