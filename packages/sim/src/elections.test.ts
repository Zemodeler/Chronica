import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, seatCharacterInOffice, type PoliticalProcedure, type WorldState } from "@chronica/shared";
import { ELECTION_CANVASS_DAYS, ELECTION_POLLING_DAYS } from "./elections";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";

/**
 * The consulship is kept by the calendar.
 *
 * Rome's consuls served a year. The engine emptied the seat on the day and then
 * nothing followed, so a republic three hundred and sixty-six days into a game
 * had no consul and never would -- nobody had been handed the question. These
 * walk the year: the opening fills the empty chair, the term runs out, the men
 * who could win are told, and if none of them calls the Senate the engine does,
 * and counts the votes itself.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const government = { offices: definition.government.offices, successionRules: definition.government.successionRules };

/**
 * The opening as it stood before v29 seated Blasio: the second consul's chair
 * empty and Blasio not yet in the world. These tests walk an election, and
 * were written round the empty chair.
 */
const withoutBlasio = (world: WorldState): WorldState => ({
  ...world,
  characters: world.characters.filter((character) => character.id !== "gnaeus-cornelius"),
  material: {
    ...world.material,
    officeSeats: world.material.officeSeats
      .filter((seat) => seat.holderCharacterId !== "gnaeus-cornelius" || seat.officeId === "roman-consul")
      .map((seat) => (seat.holderCharacterId === "gnaeus-cornelius"
        ? { ...seat, holderCharacterId: null, status: "vacant" as const, vacancyCause: "never_filled" as const, termStartedAtStep: null, termExpiresAtStep: null }
        : seat)),
  },
});
/**
 * These are about how an election is run, not who may stand, so the
 * consulship's ladder -- the rung below, the ten-year gap that bars Curius and
 * then Gaius -- is taken off. `a-career.test.ts` is about the ladder.
 */
const opening = (): WorldState => {
  const world = withoutBlasio(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)));
  return {
    ...world,
    material: {
      ...world.material,
      officeSeats: world.material.officeSeats.map((seat) => (seat.officeId === "roman-consul"
        ? { ...seat, eligibilityRequirementIds: ["req-alive", "req-roman-polity", "req-not-disqualified"] }
        : seat)),
    },
  };
};

const tick = (world: WorldState, toDay: number, playerCharacterId: string | null = "gaius-genucius") => {
  const result = runDeterministicTick({ world, toDay, ids: createIdFactory(`elections-${toDay}`), warfare: definition.warfare, government, playerCharacterId });
  // Whatever the tick writes has to load again.
  expect(WorldStateSchema.safeParse(result.world).success).toBe(true);
  return result;
};

const consuls = (world: WorldState) =>
  world.material.officeSeats.filter((seat) => seat.officeId === "roman-consul").map((seat) => seat.holderCharacterId);

const elections = (world: WorldState): PoliticalProcedure[] =>
  world.material.politicalProcedures.filter((procedure) => procedure.subjectKind === "office_seat" && (procedure.subjectId?.startsWith("roman-consul") ?? false));

/** The world at the moment both consuls' year has run out. */
function yearEnded(): WorldState {
  const started = tick(opening(), 0).world;
  return tick(started, 365).world;
}

describe("elections to an elective office", () => {
  it("fills the consulship nobody held at the opening, from the men of most standing, never the player", () => {
    const world = tick(opening(), 0).world;
    // Manius Curius has the most standing in Rome; the player (Gaius) already sits.
    expect(consuls(world)).toEqual(["gaius-genucius", "manius-curius"]);
    const seat = world.material.officeSeats.find((candidate) => candidate.id === "roman-consul:seat:1")!;
    expect(seat.termExpiresAtStep).toBe(365);
    expect(world.characters.find((character) => character.id === "manius-curius")?.officeId).toBe("roman-consul");

    // A player who is Curius is not handed the seat: the next man of standing is.
    const asCurius = tick(opening(), 0, "manius-curius").world;
    expect(consuls(asCurius)).toEqual(["gaius-genucius", "quintus-ogulnius"]);
  });

  it("empties both seats at the year's end and tells the men who could win, not the player", () => {
    const world = yearEnded();
    expect(consuls(world)).toEqual([null, null]);
    const told = world.characterPressures.filter((pressure) => pressure.kind === "opportunity" && pressure.label.includes("Roman consul"));
    expect(told.map((pressure) => pressure.characterId).sort()).toEqual(["manius-curius", "quintus-ogulnius"]);
    // Nobody has called it yet, so there is no election.
    expect(elections(world)).toHaveLength(0);
    // Told once, not every tick of the canvass.
    expect(tick(world, 370).world.characterPressures.filter((pressure) => pressure.kind === "opportunity" && pressure.label.includes("Roman consul"))).toHaveLength(told.length);
  });

  it("calls the election itself when nobody has by the end of the canvass, and decides it on its day", () => {
    const canvassOver = tick(yearEnded(), 365 + ELECTION_CANVASS_DAYS);
    const [called] = elections(canvassOver.world);
    expect(called?.stage).toBe("gathering_support");
    expect(called?.institutionId).toBe("roman-comitia-centuriata");
    expect(canvassOver.factProposals.some((fact) => fact.kind === "election_called")).toBe(true);

    const pollingDay = tick(canvassOver.world, 365 + ELECTION_CANVASS_DAYS + ELECTION_POLLING_DAYS);
    const decided = elections(pollingDay.world)[0]!;
    expect(decided.outcome).toBe("passed");
    // Two seats, filled by standing. Gaius has as much standing as Ogulnius,
    // but Gaius is the player and never stood: the engine does not put a
    // player's name forward for him.
    expect(consuls(pollingDay.world).sort()).toEqual(["manius-curius", "quintus-ogulnius"]);
    const held = pollingDay.world.material.officeSeats.filter((seat) => seat.officeId === "roman-consul");
    expect(held.every((seat) => seat.termExpiresAtStep === 365 + ELECTION_CANVASS_DAYS + ELECTION_POLLING_DAYS + 365)).toBe(true);
    const account = pollingDay.factProposals.find((fact) => fact.kind === "election_held");
    expect(account?.summary).toContain("Centuriate Assembly elected");
    expect(account?.visibility).toBe("public");
  });

  it("counts who has declared for a man: backing can carry a candidate past one of equal standing", () => {
    const canvassOver = tick(yearEnded(), 365 + ELECTION_CANVASS_DAYS).world;
    const candidacy: PoliticalProcedure = {
      id: "ogulnius-stands",
      type: "nomination",
      institutionId: "roman-senate",
      sponsorCharacterId: "quintus-ogulnius",
      subjectKind: "character",
      subjectId: "quintus-ogulnius",
      label: "Quintus Ogulnius stands for Roman consul",
      eligibilityRequirementIds: [],
      eligibleParticipantIds: [],
      stage: "gathering_support",
      resolutionMechanism: "vote",
      openedAtStep: 400,
      deadlineStep: null,
      resolvedAtStep: null,
      visibility: "public",
      voteRecordId: null,
      outcome: null,
      outcomeReason: null,
      sourceEventIds: [],
      resultingEventIds: [],
    };
    const backed: WorldState = {
      ...canvassOver,
      material: {
        ...canvassOver.material,
        // Three men for two seats. Gaius (the player) and Ogulnius have equal
        // standing, and on a tie Gaius would carry it -- so only the backing
        // can put Ogulnius ahead.
        politicalProcedures: [...canvassOver.material.politicalProcedures, candidacy, {
          ...candidacy,
          id: "gaius-stands",
          sponsorCharacterId: "gaius-genucius",
          subjectId: "gaius-genucius",
          label: "Gaius Genucius stands again for Roman consul",
        }],
        supportPositions: [...canvassOver.material.supportPositions, {
          id: "patricians-back-ogulnius",
          procedureId: "ogulnius-stands",
          supporterKind: "group",
          supporterId: "patrician-bloc",
          position: "support",
          influenceWeight: 1_500,
          visibility: "public",
          reasons: [],
          provenanceEventIds: [],
          changedAtStep: 401,
        }],
      },
    };
    const decided = tick(backed, 365 + ELECTION_CANVASS_DAYS + ELECTION_POLLING_DAYS).world;
    expect(consuls(decided).sort()).toEqual(["manius-curius", "quintus-ogulnius"]);
    expect(decided.material.politicalProcedures.find((procedure) => procedure.id === "ogulnius-stands")?.outcome).toBe("passed");
    expect(decided.material.politicalProcedures.find((procedure) => procedure.id === "gaius-stands")?.outcome).toBe("failed");
  });

  it("elects the player when the player stands and has the standing", () => {
    const canvassOver = tick(yearEnded(), 365 + ELECTION_CANVASS_DAYS).world;
    const stands: WorldState = {
      ...canvassOver,
      material: {
        ...canvassOver.material,
        politicalProcedures: [...canvassOver.material.politicalProcedures, {
          id: "gaius-stands",
          type: "nomination",
          institutionId: "roman-senate",
          sponsorCharacterId: "gaius-genucius",
          subjectKind: "character",
          subjectId: "gaius-genucius",
          label: "Gaius Genucius stands again for Roman consul",
          eligibilityRequirementIds: [],
          eligibleParticipantIds: [],
          stage: "gathering_support",
          resolutionMechanism: "vote",
          openedAtStep: 396,
          deadlineStep: null,
          resolvedAtStep: null,
          visibility: "public",
          voteRecordId: null,
          outcome: null,
          outcomeReason: null,
          sourceEventIds: [],
          resultingEventIds: [],
        }],
        supportPositions: [...canvassOver.material.supportPositions, {
          id: "popular-bloc-backs-gaius",
          procedureId: "gaius-stands",
          supporterKind: "group",
          supporterId: "popular-bloc",
          position: "support",
          influenceWeight: 500,
          visibility: "public",
          reasons: [],
          provenanceEventIds: [],
          changedAtStep: 397,
        }],
      },
    };
    const decided = tick(stands, 365 + ELECTION_CANVASS_DAYS + ELECTION_POLLING_DAYS).world;
    expect(consuls(decided).sort()).toEqual(["gaius-genucius", "manius-curius"]);
  });

  it("treats a man putting himself forward as the election being called", () => {
    const vacant = yearEnded();
    const standing: WorldState = {
      ...vacant,
      material: {
        ...vacant.material,
        politicalProcedures: [...vacant.material.politicalProcedures, {
          id: "curius-stands",
          type: "appointment",
          institutionId: "roman-senate",
          sponsorCharacterId: "manius-curius",
          subjectKind: "character",
          subjectId: "manius-curius",
          label: "Elect Manius Curius Roman consul for the year",
          eligibilityRequirementIds: [],
          eligibleParticipantIds: [],
          stage: "gathering_support",
          resolutionMechanism: "vote",
          openedAtStep: 366,
          deadlineStep: null,
          resolvedAtStep: null,
          visibility: "public",
          voteRecordId: null,
          outcome: null,
          outcomeReason: null,
          sourceEventIds: [],
          resultingEventIds: [],
        }],
      },
    };
    const called = elections(tick(standing, 367).world);
    expect(called).toHaveLength(1);
    expect(called[0]!.sponsorCharacterId).toBe("manius-curius");
  });

  it("does not unseat, on the next day, a consul the model seated into a seat whose term had run out", () => {
    const vacant = yearEnded();
    const office = definition.government.offices.find((candidate) => candidate.id === "roman-consul")!;
    const seated = seatCharacterInOffice(vacant, "quintus-ogulnius", { office, vacantSeatId: "roman-consul:seat:0" }, 370);
    const next = tick(seated, 371).world;
    const seat = next.material.officeSeats.find((candidate) => candidate.id === "roman-consul:seat:0")!;
    expect(seat.holderCharacterId).toBe("quintus-ogulnius");
    // And he serves the office's year from the day he took it.
    expect(seat.termExpiresAtStep).toBe(370 + 365);
  });

  it("gives a leader acclaimed for life no term", () => {
    const world = tick(tick(opening(), 0).world, 800).world;
    const mamertine = world.material.officeSeats.find((seat) => seat.officeId === "mamertine-leader")!;
    expect(mamertine.holderCharacterId).toBe("mamertine-spokesman");
    expect(mamertine.termExpiresAtStep).toBeNull();
  });
});
