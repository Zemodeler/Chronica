import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, resolveEligibility, type Character, type PoliticalProcedure, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { holdElections } from "./elections";
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

/** The opening, with a young man of no office who means to rise. */
function opening(): WorldState {
  const world = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
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
  it("gives the empty consulship to the man the ladder allows, not the man of most standing", () => {
    // Curius has the most standing in Rome, but he was consul within ten years.
    const world = elect(opening(), 0).world;
    expect(holders(world, "roman-consul")).toEqual(["gaius-genucius", "quintus-ogulnius"]);
    expect(eligibleFor(world, "manius-curius", "roman-consul").eligible).toBe(false);
    // His seat in the Senate is untouched by any of it.
    expect(holders(world, "roman-senator")).toContain("manius-curius");
    void consulship;
  });

  it("will not let a young man skip the rungs", () => {
    const failed = eligibleFor(opening(), LUCIUS, "roman-consul");
    expect(failed.eligible).toBe(false);
    expect(failed.failedReasons.join(" ")).toMatch(/younger than 38/);
    expect(failed.failedReasons.join(" ")).toMatch(/roman-praetor/);
    // But the first rung is his to reach for.
    expect(eligibleFor(opening(), LUCIUS, "roman-quaestor").eligible).toBe(true);
  });

  it("elects him quaestor when he stands, and seats him in the Senate when he has been one", () => {
    // The quaestors' year falls due; he puts himself forward.
    let world = elect(opening(), 0).world;
    world = standsFor(world, LUCIUS, "Lucius Caecilius stands for Roman quaestor", 365);
    world = elect(world, 365).world;
    world = elect(world, 385).world;
    expect(holders(world, "roman-quaestor")).toEqual([LUCIUS]);
    // Seated with a term; a former consul presiding did not make himself a quaestor.
    expect(holders(world, "roman-quaestor")).not.toContain("manius-curius");
    // A magistrate sits in the Senate.
    const lucius = world.characters.find((character) => character.id === LUCIUS)!;
    world = { ...world, characters: world.characters.map((character) => (character.id === LUCIUS ? { ...character, officesHeld: [...lucius.officesHeld, { officeId: "roman-quaestor", lastHeldAtStep: 385 }] } : character)) };
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
    const passed = applyDeltas(opened.world, [WorldDeltaSchema.parse({
      op: "political_procedure_resolve", procedureRef: opened.assignedIds.get("law"), outcome: "passed", outcomeReason: "Carried.", reason: "The Senate votes.",
    })], context);
    expect(passed.rejected).toEqual([]);
    // The ladder is waived. Who he is -- a living Roman -- is not.
    expect(eligibleFor(passed.world, LUCIUS, "roman-consul").eligible).toBe(true);
    expect(eligibleFor(passed.world, LUCIUS, "roman-censor").eligible).toBe(false);
  });

  it("says aloud a tribune's veto, and stops nothing", () => {
    let world = opening();
    world = {
      ...world,
      material: {
        ...world.material,
        officeSeats: [...world.material.officeSeats, {
          id: "roman-tribune:seat:0", officeId: "roman-tribune", seatIndex: 0, holderCharacterId: LUCIUS, status: "held", vacancyCause: "none",
          termStartedAtStep: 0, termExpiresAtStep: 365, appointmentProcedureId: null, removalProcedureId: null, eligibilityRequirementIds: [],
        }],
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
    // The question is still open: the veto is friction, not a lock.
    const procedure = vetoed.world.material.politicalProcedures.find((candidate) => candidate.id === opened.assignedIds.get("levy"));
    expect(procedure?.stage).toBe("gathering_support");
  });
});
