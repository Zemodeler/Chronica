import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { FactProposalSchema, ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, type FactProposal, type WorldState } from "@chronica/shared";
import { applyDeltas, sameWork } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { actsBehindFacts } from "./apply/fill-gaps";
import { normalizeRefs } from "./apply/normalize-refs";
import { partOfAct } from "./burst";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";

/**
 * The spring of 270 in the Clepsina run, audited: Hieron's squadron sent into
 * Panormus by an id thirty characters alike to Messana's, and sent there even
 * after it was sent elsewhere; a shipmaster paid before the vote his hiring
 * hung on; a thousand gone from the consul's purse with no line to say where;
 * four surveys of one river; a siege told nine days before there was one; and
 * the Senate's refusal given as the answer to every part of an order.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const as = (actor: string, written: readonly unknown[], state: WorldState = opening(), seed = "honest") => {
  const deltas = written.map((raw) => WorldDeltaSchema.parse(raw));
  const context: ApplyContext = {
    now: { day: state.elapsedStep, minute: 540 }, actorRef: { kind: "character", id: actor }, offices: definition.government.offices, warfare: definition.warfare,
    terrains: definition.map.terrains, ids: createIdFactory(`${seed}-${actor}`), gameId: "game-honest", orderDeltas: new Set(deltas),
  };
  return applyDeltas(state, deltas, context);
};
const MESSANA = PUNIC_IDS.messana;
const PANORMUS = PUNIC_IDS.panormus;
const nameOf = (id: string): string => punicWarsScenario.initialWorld.map.provinces.find((province) => province.id === id)!.name;
const BRUTTIUM = PUNIC_IDS.rhegium;
const force = (state: WorldState, id: string) => state.material.forces.find((candidate) => candidate.id === id)!;
const balance = (state: WorldState, id: string) => state.material.accounts.find((account) => account.id === id)!.balance;

describe("an army goes where it was last sent", () => {
  it("calls off the march under way when it is sent somewhere else", () => {
    const first = as("gaius-genucius", [{ op: "force_modify", forceRef: "roman-field-army", locationId: BRUTTIUM, reason: "March on Rhegium." }]);
    expect(first.rejected).toEqual([]);
    const road = first.world.projects.find((project) => project.completionOutcome?.kind === "force_move")!;
    const second = as("gaius-genucius", [{ op: "force_modify", forceRef: "roman-field-army", locationId: PUNIC_IDS.asculum, reason: "March on Picenum instead." }], first.world, "second");
    expect(second.rejected).toEqual([]);
    expect(second.world.projects.find((project) => project.id === road.id)?.status).toBe("cancelled");
    expect(second.factProposals.map((fact) => fact.kind)).toContain("march_called_off");
    const marches = second.world.projects.filter((project) => project.status === "in_progress" && project.completionOutcome?.kind === "force_move");
    // Picenum is a road away: it is either reached today or marched on, and nowhere else is.
    expect(marches.map((project) => project.completionOutcome?.provinceId).concat(marches.length === 0 ? [force(second.world, "roman-field-army").locationId] : []))
      .toEqual([PUNIC_IDS.asculum]);
    // And the road it left is never walked.
    const due = Math.max(...road.milestones.map((milestone) => road.startedAtStep + milestone.requiredAtElapsedOffset));
    const ticked = runDeterministicTick({ world: { ...second.world, elapsedStep: due }, toDay: due, ids: createIdFactory("honest-tick"), warfare: definition.warfare });
    expect(force(ticked.world, "roman-field-army").locationId).not.toBe(BRUTTIUM);
  });

  it("keeps a march bound where it is sent again, and a name change leaves the road alone", () => {
    const first = as("gaius-genucius", [{ op: "force_modify", forceRef: "roman-field-army", locationId: BRUTTIUM, reason: "March on Rhegium." }]);
    const again = as("gaius-genucius", [
      { op: "force_modify", forceRef: "roman-field-army", locationId: BRUTTIUM, reason: "March on Rhegium." },
      { op: "force_modify", forceRef: "roman-field-army", locationId: PUNIC_IDS.rome, name: "Legio I", reason: "Rename the army." },
    ], first.world, "again");
    expect(again.world.projects.filter((project) => project.status === "in_progress" && project.completionOutcome?.kind === "force_move")).toHaveLength(1);
  });
});

describe("a province named nearly right", () => {
  it("takes the place the act's own words name over a sibling id", () => {
    const delta = WorldDeltaSchema.parse({ op: "force_modify", forceRef: "syracusan-squadron", locationId: PANORMUS, reason: "Sail north to blockade Messana." });
    expect(normalizeRefs(delta, opening())).toMatchObject({ locationId: MESSANA });
  });

  it("leaves an id the words agree with, or that the words do not contradict", () => {
    const agreed = WorldDeltaSchema.parse({ op: "force_modify", forceRef: "syracusan-squadron", locationId: PANORMUS, reason: "Sail from Messana round to Panormus." });
    expect(normalizeRefs(agreed, opening())).toMatchObject({ locationId: PANORMUS });
    const silent = WorldDeltaSchema.parse({ op: "force_modify", forceRef: "syracusan-squadron", locationId: PANORMUS, reason: "Sail north." });
    expect(normalizeRefs(silent, opening())).toMatchObject({ locationId: PANORMUS });
  });

  it("reads a province written by its name or its city's", () => {
    const byCity = WorldDeltaSchema.parse({ op: "force_modify", forceRef: "syracusan-army", locationId: "Messana", reason: "Relieve the city." });
    expect(normalizeRefs(byCity, opening())).toMatchObject({ locationId: MESSANA });
    const byName = WorldDeltaSchema.parse({ op: "force_modify", forceRef: "syracusan-army", locationId: nameOf(PANORMUS), reason: "Go." });
    expect(normalizeRefs(byName, opening())).toMatchObject({ locationId: PANORMUS });
  });
});

describe("every sum is in the books", () => {
  it("writes a line for a payment out of the world, and for a hired man's advance", () => {
    const paid = as("gaius-genucius", [
      { op: "money_transfer", fromAccountRef: "gaius-purse", toAccountRef: null, amount: 100, reason: "Gifts to senators for their votes." },
      {
        op: "service_contract_open", localId: "ships", role: "mercenary", label: "Fifty ships for Rome", employerAccountRef: "gaius-purse",
        employeeRef: "quintus-ogulnius", advance: 90, monthlyPay: 0, termDays: 180, duties: "Hire and assemble fifty ships.",
        company: { categoryId: "warship", strength: 50 }, provinceId: PUNIC_IDS.rome, reason: "Rome needs hulls.",
      },
    ]);
    expect(paid.rejected).toEqual([]);
    expect(balance(paid.world, "gaius-purse")).toBe(1200 - 190);
    const lines = paid.world.material.transactions.filter((transaction) => transaction.sourceAccountId === "gaius-purse");
    expect(lines.map((line) => line.amount).sort((a, b) => a - b)).toEqual([90, 100]);
    expect(lines.every((line) => line.cause.kind === "action" && line.cause.explanation.length > 0)).toBe(true);
    expect(lines.find((line) => line.amount === 90)?.destinationAccountId).toBe("ogulnius-purse");
  });

  it("writes a line for a loan and its repayment", () => {
    const lent = as("gaius-genucius", [{
      op: "loan_open", localId: "loan", borrowerAccountRef: "gaius-purse", lenderKind: "character", lenderRef: "quintus-ogulnius",
      principal: 50, interestBps: 500, cadenceDays: 30, terms: "A friend's loan", collateralHoldingRef: null, reason: "Short of coin.",
    }]);
    expect(lent.rejected).toEqual([]);
    const line = lent.world.material.transactions.at(-1)!;
    expect(line).toMatchObject({ sourceAccountId: "ogulnius-purse", destinationAccountId: "gaius-purse", amount: 50 });
  });
});

describe("a clause that hangs on the vote", () => {
  const fleetAsked = () => as("gaius-genucius", [{
    op: "political_procedure_open", localId: "fleet", type: "council_deliberation", institutionRef: "roman-senate", sponsorCharacterRef: "gaius-genucius",
    subjectKind: "polity", subjectRef: "rome", label: "Authorize a fleet of 150 ships", resolutionMechanism: "vote", deadlineInDays: 10,
    reason: "The consul asks for ships.",
  }]).world;

  it("waits for the vote rather than paying before it", () => {
    const before = fleetAsked();
    const held = as("gaius-genucius", [{
      op: "service_contract_open", localId: "ships", role: "mercenary", label: "Fifty ships for Rome", employerAccountRef: "gaius-purse",
      employeeRef: "quintus-ogulnius", advance: 90, monthlyPay: 0, termDays: 180, duties: "Hire fifty ships; proceed only if the Senate does not vote the fleet.",
      company: { categoryId: "warship", strength: 50 }, provinceId: PUNIC_IDS.rome, reason: "Using the consul's own money if Rome does not support it.",
    }], before, "held");
    expect(held.rejected).toEqual([]);
    expect(held.world.material.contracts).toHaveLength(before.material.contracts.length);
    expect(balance(held.world, "gaius-purse")).toBe(balance(before, "gaius-purse"));
    const plan = held.world.contingencies.at(-1)!;
    const question = before.material.politicalProcedures.at(-1)!;
    expect(plan).toMatchObject({ effect: "stand_to", trigger: { kind: "question_decided", procedureId: question.id, outcome: "failed" } });
    expect(plan.standingOrder).toMatch(/does not support/);
  });

  it("does what an order said plainly, beside a vote it did not hang on", () => {
    const paid = as("gaius-genucius", [{ op: "money_transfer", fromAccountRef: "gaius-purse", toAccountRef: null, amount: 100, reason: "Gifts to senators so the fleet passes." }], fleetAsked(), "plain");
    expect(balance(paid.world, "gaius-purse")).toBe(1100);
    expect(paid.world.contingencies).toHaveLength(opening().contingencies.length);
  });
});

describe("one work ordered twice", () => {
  it("is the work already under way", () => {
    const survey = (localId: string, label: string) => ({
      op: "project_create", localId, kind: "survey", label, sponsorRef: { kind: "character", id: "gaius-genucius" },
      fundingAccountRef: "gaius-purse", milestones: [{ label: "Surveyed", dueInDays: 20, costAmount: 0 }], completionOutcome: null, reason: "Water for Rome.",
    });
    const first = as("gaius-genucius", [survey("anio", "Anio water survey")]);
    const again = as("gaius-genucius", [survey("anio2", "Survey of the Anio water"), survey("tiber", "Tiber flood survey")], first.world, "again");
    expect(again.rejected).toEqual([]);
    const surveys = again.world.projects.filter((project) => project.kind === "survey");
    expect(surveys.map((project) => project.label)).toEqual(["Anio water survey", "Tiber flood survey"]);
    expect(again.assignedIds.get("anio2")).toBe(surveys[0]!.id);
  });

  it("tells works apart by their words", () => {
    expect(sameWork("survey", "Anio water survey", "Survey", "The survey of the Anio water")).toBe(true);
    expect(sameWork("granary", "Granary at Ostia", "granary", "Granary at Capua")).toBe(false);
    expect(sameWork("survey", "Anio water survey", "levy", "Anio water survey")).toBe(false);
  });
});

describe("what only the engine can tell", () => {
  const fact = (kind: string, refs: FactProposal["affectedRefs"]): FactProposal => FactProposalSchema.parse({
    localId: `f_${kind}`, kind, summary: `Something of the kind ${kind}.`, affectedRefs: refs, visibility: "public", discoveryState: "public", significance: 30,
  });

  it("makes a siege told with no siege into the siege, and leaves out a battle nobody fought", () => {
    const behind = actsBehindFacts([
      fact("siege_laid", [{ kind: "force", id: "syracusan-army" }]),
      fact("battle", [{ kind: "force", id: "syracusan-army" }]),
      fact("letter_sent", []),
    ], [], opening(), "gaius-genucius");
    expect(behind.acts).toEqual([expect.objectContaining({ op: "siege_lay", forceRef: "syracusan-army" })]);
    expect(behind.facts.map((kept) => kept.kind)).toEqual(["letter_sent"]);
    expect(behind.dropped).toHaveLength(2);
  });

  it("keeps a fact whose act is in the answer, and never moves the player's own army for him", () => {
    const backed = actsBehindFacts([fact("siege_laid", [{ kind: "force", id: "syracusan-army" }])],
      [WorldDeltaSchema.parse({ op: "siege_lay", localId: "s", forceRef: "syracusan-army", reason: "Invest Messana." })], opening(), "gaius-genucius");
    expect(backed.facts).toHaveLength(1);
    expect(backed.acts).toEqual([]);
    const his = actsBehindFacts([fact("siege_laid", [{ kind: "force", id: "roman-field-army" }])], [], opening(), "gaius-genucius");
    expect(his.acts).toEqual([]);
    expect(his.facts).toEqual([]);
  });
});

describe("each part of an order answered by its own acts", () => {
  const parts = [
    "Argue for a 150-ship fleet and talk with senators to secure passage",
    "Get a shipmaster to hire 50 ships, using personal money if Rome does not support it",
    "Tell Syracuse to leave Messana, which is under Roman protection, or face war",
  ];

  it("finds the part an act belongs to by its words", () => {
    expect(partOfAct(parts, "Marcus Livius, shipmaster, hired to assemble fifty ships for Roman service")).toBe(1);
    expect(partOfAct(parts, "Roman warning concerning Messana: withdraw Syracusan forces or face war")).toBe(2);
    expect(partOfAct(parts, "A dinner for friends")).toBeNull();
  });
});
