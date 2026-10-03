import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, resolveEligibility, type Character, type PoliticalProcedure, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { holdElections } from "./elections";
import { holdVotes, voteDayOf } from "./senate";
import { createIdFactory } from "./ports";

/**
 * A Roman career, rung by rung.
 *
 * The scenario had one Roman office, so the only career there was went from
 * nothing to consul, and a senator, a quaestor or a tribune was a private man.
 * Now the ladder is there -- quaestor, aedile, praetor, consul, censor -- with
 * the ages custom set, the rung below, and the lex Genucia's ten years before
 * a second consulship; and a man who has held any of it sits in the Senate.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const government = { offices: definition.government.offices, successionRules: definition.government.successionRules };
const LUCIUS = "lucius-young";


/**
 * The opening as it stood before v29 seated Blasio: the second consul's chair
 * empty and Blasio not yet in the world. These tests walk an election, and
 * were written round the empty chair.
 */
const withoutBlasio = (world: WorldState): WorldState => ({
  ...world,
  characters: world.characters.filter((character) => character.id !== "gnaeus-cornelius"),
  // His wife and children stay, and are nobody's now: the houses have families since L10.
  familyLinks: world.familyLinks.filter((link) => link.characterId !== "gnaeus-cornelius" && link.relatedCharacterId !== "gnaeus-cornelius"),
  material: {
    ...world.material,
    officeSeats: world.material.officeSeats
      .filter((seat) => seat.holderCharacterId !== "gnaeus-cornelius" || seat.officeId === "roman-consul")
      .map((seat) => (seat.holderCharacterId === "gnaeus-cornelius"
        ? { ...seat, holderCharacterId: null, status: "vacant" as const, vacancyCause: "never_filled" as const, termStartedAtStep: null, termExpiresAtStep: null }
        : seat)),
  },
});
/** The opening, with a young man of no office who means to rise. */
function opening(): WorldState {
  const world = withoutBlasio(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)));
  const curius = world.characters.find((character) => character.id === "manius-curius")!;
  const lucius: Character = {
    ...curius, id: LUCIUS, name: "Lucius Caecilius", ageYearsAtStart: 27, prestigeBps: 3_200, officeId: null,
    officesHeld: [], eligibilityWaivers: [], ambitions: [], relations: [],
  };
  return { ...world, characters: [...world.characters, lucius] };
}

const elect = (world: WorldState, toDay: number, player: string | null = LUCIUS) =>
  holdElections({ world, government, toDay, ids: createIdFactory(`career-${toDay}`), playerCharacterId: player });

const holders = (world: WorldState, officeId: string) =>
  world.material.officeSeats.filter((seat) => seat.officeId === officeId && seat.status === "held").map((seat) => seat.holderCharacterId);

const consulship = definition.government.offices.find((office) => office.id === "roman-consul")!;
const eligibleFor = (world: WorldState, who: string, officeId: string, atStep = 0) => {
  const office = definition.government.offices.find((candidate) => candidate.id === officeId)!;
  return resolveEligibility({ ...world, elapsedStep: atStep }, who, office.eligibilityRequirementIds, office.id);
};

const standsFor = (world: WorldState, who: string, label: string, atStep: number): WorldState => {
  const candidacy: PoliticalProcedure = {
    id: `${who}-stands`, type: "nomination", institutionId: "roman-senate", sponsorCharacterId: who, subjectKind: "character", subjectId: who,
    label, eligibilityRequirementIds: [], eligibleParticipantIds: [], stage: "gathering_support", resolutionMechanism: "vote",
    openedAtStep: atStep, deadlineStep: null, resolvedAtStep: null, visibility: "public", voteRecordId: null, outcome: null,
    outcomeReason: null, sourceEventIds: [], resultingEventIds: [],
  };
  return { ...world, material: { ...world.material, politicalProcedures: [...world.material.politicalProcedures, candidacy] } };
};

describe("a Roman career", () => {
  it("gives the empty consulship to the man the law allows, not the man of most standing", () => {
    // Curius has the most standing in Rome, but he was consul within ten
    // years. With a plebeian, Genucius, in the other chair, the patrician
    // praetor Fabius Pictor may have it -- as he did, in 269.
    const world = elect(opening(), 0).world;
    const fabius = world.characters.find((character) => character.name === "Gaius Fabius Pictor")!;
    expect(holders(world, "roman-consul")).toEqual(["gaius-genucius", fabius.id]);
    expect(eligibleFor(world, "manius-curius", "roman-consul").eligible).toBe(false);
    // His seat in the Senate is untouched by any of it.
    expect(holders(world, "roman-senator")).toContain("manius-curius");
    void consulship;
  });

  it("bars a young man from nothing the law of 270 did not, though he has not the standing yet", () => {
    // The ages and the order of the rungs were custom until the lex Villia of
    // 180: what keeps Lucius from the consulship is that nobody would vote for him.
    const failed = eligibleFor(opening(), LUCIUS, "roman-consul");
    expect(failed.eligible).toBe(false);
    expect(failed.failedReasons.join(" ")).not.toMatch(/younger than|roman-praetor|roman-quaestor/);
    expect(failed.failedReasons.join(" ")).toMatch(/prestige/);
    expect(eligibleFor(opening(), LUCIUS, "roman-quaestor").eligible).toBe(true);
  });

  it("elects him quaestor when he stands, and seats him in the Senate once he has held a curule office", () => {
    // The quaestors' year falls due; he puts himself forward.
    let world = elect(opening(), 0).world;
    world = standsFor(world, LUCIUS, "Lucius Caecilius stands for Roman quaestor", 365);
    // The year's quaestors go out, as the tick sends them.
    world = { ...world, material: { ...world.material, officeSeats: world.material.officeSeats.map((seat) => (seat.officeId === "roman-quaestor" && seat.status === "held" && (seat.termExpiresAtStep ?? Infinity) <= 365
      ? { ...seat, status: "vacant" as const, vacancyCause: "term_expired" as const, holderCharacterId: null }
      : seat)) } };
    world = elect(world, 365).world;
    world = elect(world, 385).world;
    expect(holders(world, "roman-quaestor")).toContain(LUCIUS);
    expect(holders(world, "roman-quaestor").length).toBeLessThanOrEqual(4);
    // Seated with a term; a former consul presiding did not make himself a quaestor.
    expect(holders(world, "roman-quaestor")).not.toContain("manius-curius");
    // A quaestorship gave no seat in the Senate in 270; an aedileship did.
    const lucius = world.characters.find((character) => character.id === LUCIUS)!;
    const asQuaestor = { ...world, characters: world.characters.map((character) => (character.id === LUCIUS ? { ...character, officesHeld: [...lucius.officesHeld, { officeId: "roman-quaestor", lastHeldAtStep: 385 }] } : character)) };
    expect(holders(elect(asQuaestor, 390).world, "roman-senator")).not.toContain(LUCIUS);
    world = { ...world, characters: world.characters.map((character) => (character.id === LUCIUS ? { ...character, officesHeld: [...lucius.officesHeld, { officeId: "roman-aedile", lastHeldAtStep: 385 }] } : character)) };
    const enrolled = elect(world, 390);
    expect(holders(enrolled.world, "roman-senator")).toContain(LUCIUS);
    expect(enrolled.facts.some((fact) => fact.summary.includes("takes his seat as Roman senator"))).toBe(true);
  });

  it("lets the law set the ladder aside for one man", () => {
    const state = opening();
    const context = {
      now: { day: 0, minute: 540 }, actorRef: { kind: "character" as const, id: "gaius-genucius" }, offices: definition.government.offices,
      warfare: definition.warfare, ids: createIdFactory("waiver"), gameId: "game-career",
    };
    const opened = applyDeltas(state, [WorldDeltaSchema.parse({
      op: "political_procedure_open", localId: "law", type: "vote", institutionRef: "roman-senate", sponsorCharacterRef: "gaius-genucius",
      subjectKind: "character", subjectRef: LUCIUS, label: "That Lucius Caecilius may stand for the consulship", resolutionMechanism: "vote",
      enacts: { waiver: { characterRef: LUCIUS, officeId: "roman-consul" } }, reason: "The city wants him.",
    })], context);
    expect(opened.rejected).toEqual([]);
    // Carried on its day, by the count: nobody spoke against it.
    const question = opened.world.material.politicalProcedures.find((procedure) => procedure.id === opened.assignedIds.get("law"))!;
    const passed = holdVotes({ world: opened.world, offices: definition.government.offices, toDay: voteDayOf(question), ids: createIdFactory("waiver-vote") });
    expect(passed.world.material.politicalProcedures.find((procedure) => procedure.id === question.id)!.outcome).toBe("passed");
    // The ladder is waived. Who he is -- a living Roman -- is not.
    expect(eligibleFor(passed.world, LUCIUS, "roman-consul").eligible).toBe(true);
    expect(eligibleFor(passed.world, LUCIUS, "roman-censor").eligible).toBe(false);
  });

  it("says aloud a tribune's veto, and leaves the question open until its day", () => {
    let world = opening();
    world = {
      ...world,
      material: {
        ...world.material,
        // He takes the first tribune's chair; a Caecilius is a plebeian.
        officeSeats: world.material.officeSeats.map((seat) => (seat.officeId === "roman-tribune" && seat.seatIndex === 0 ? { ...seat, holderCharacterId: LUCIUS } : seat)),
      },
    };
    const context = (actor: string) => ({
      now: { day: 0, minute: 540 }, actorRef: { kind: "character" as const, id: actor }, offices: definition.government.offices,
      warfare: definition.warfare, ids: createIdFactory(`veto-${actor}`), gameId: "game-career",
    });
    const opened = applyDeltas(world, [WorldDeltaSchema.parse({
      op: "political_procedure_open", localId: "levy", type: "vote", institutionRef: "roman-senate", sponsorCharacterRef: "gaius-genucius",
      subjectKind: "polity", subjectRef: "rome", label: "A second levy", resolutionMechanism: "vote", reason: "Men for Sicily.",
    })], context("gaius-genucius"));
    const vetoed = applyDeltas(opened.world, [WorldDeltaSchema.parse({
      op: "political_support_set", procedureRef: opened.assignedIds.get("levy"), supporterKind: "character", supporterRef: LUCIUS,
      position: "oppose", influenceWeight: 300, reasonKind: "belief", reasonLabel: "The plebs have given enough.", reason: "He intercedes.",
    })], context(LUCIUS));
    expect(vetoed.rejected).toEqual([]);
    const veto = vetoed.factProposals.find((fact) => fact.kind === "veto");
    expect(veto?.summary).toContain("as Tribune of the plebs, forbade");
    expect(veto?.visibility).toBe("public");
    // Still open: he may relent before the day. If he holds to it, the
    // question is blocked then (senate.test.ts, "a tribune's veto").
    const procedure = vetoed.world.material.politicalProcedures.find((candidate) => candidate.id === opened.assignedIds.get("levy"));
    expect(procedure?.stage).toBe("gathering_support");
  });
});
