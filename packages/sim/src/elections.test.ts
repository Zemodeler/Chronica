import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, seatCharacterInOffice, type PoliticalProcedure, type WorldState } from "@chronica/shared";
import { INTERREGNUM_POLLING_DAYS } from "./elections";
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
/**
 * These are about how an election is run, not who may stand, so the
 * consulship's ladder -- the rung below, the ten-year gap that bars Curius and
 * then Gaius -- is taken off. `a-career.test.ts` is about the ladder.
 */
/**
 * The Senate these were written against: the consuls, Curius and Ogulnius.
 * Since v34 the house has its consulars too (`romanSenators`), and Fabricius
 * outranks Ogulnius at the polls; these pin how an election is counted, not
 * who the house happens to hold.
 */
const V34_SENATORS = new Set(["gaius-fabricius", "tiberius-coruncanius", "lucius-papirius", "spurius-carvilius", "quintus-fabius", "lucius-postumius", "publius-valerius", "gaius-claudius"]);
const opening = (): WorldState => {
  const parsed = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
  const world = withoutBlasio({
    ...parsed,
    characters: parsed.characters.filter((character) => !V34_SENATORS.has(character.id)),
    material: { ...parsed.material, officeSeats: parsed.material.officeSeats.filter((seat) => seat.holderCharacterId === null || !V34_SENATORS.has(seat.holderCharacterId)) },
  });
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
    // The man of most standing the consulship is not beneath: Manius Curius is
    // censor now, above it, so not he. The player (Gaius) already sits.
    const [first, second] = consuls(world);
    expect(first).toBe("gaius-genucius");
    expect(second).not.toBeNull();
    expect(second).not.toBe("manius-curius");
    const seat = world.material.officeSeats.find((candidate) => candidate.id === "roman-consul:seat:1")!;
    expect(seat.termExpiresAtStep).toBe(365);
    expect(world.characters.find((character) => character.id === second)?.officeId).toBe("roman-consul");

    // A player who is that man is not handed the seat: the next man of standing is.
    const asHim = tick(opening(), 0, second).world;
    expect(consuls(asHim)[1]).not.toBe(second);
  });

  it("empties both seats at a year's end nobody was elected for, and calls an interregnum's election at once", () => {
    // The tick here jumps the whole year, so nobody was elected ahead (`ELECTION_LEAD_DAYS`):
    // Rome went two months without consuls waiting on a canvass. Now it waits days.
    const ended = tick(tick(opening(), 0).world, 365);
    expect(consuls(ended.world)).toEqual([null, null]);
    const [called] = elections(ended.world);
    expect(called?.stage).toBe("gathering_support");
    expect(called?.institutionId).toBe("roman-comitia-centuriata");
    expect(called?.deadlineStep).toBe(365 + INTERREGNUM_POLLING_DAYS);
    expect(ended.factProposals.find((fact) => fact.kind === "election_called")?.summary).toContain("the year ran out");
  });

  it("decides the interregnum's election on its day, from the men who stand and the men of standing", () => {
    const pollingDay = tick(yearEnded(), 365 + INTERREGNUM_POLLING_DAYS);
    const decided = elections(pollingDay.world)[0]!;
    expect(decided.outcome).toBe("passed");
    const seated = consuls(pollingDay.world);
    expect(seated.every((id) => id !== null)).toBe(true);
    // Gaius is the player and never stood: the engine does not put a player's name forward for him.
    expect(seated).not.toContain("gaius-genucius");
    const held = pollingDay.world.material.officeSeats.filter((seat) => seat.officeId === "roman-consul");
    expect(held.every((seat) => seat.termExpiresAtStep === 365 + INTERREGNUM_POLLING_DAYS + 365)).toBe(true);
    const account = pollingDay.factProposals.find((fact) => fact.kind === "election_held");
    expect(account?.summary).toContain("Centuriate Assembly elected");
    expect(account?.visibility).toBe("public");
  }, 30_000);

  it("counts who has declared for a man: backing can carry a candidate past one of equal standing", () => {
    const canvassOver = yearEnded();
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
      openedAtStep: 366,
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
          changedAtStep: 366,
        }],
      },
    };
    const decided = tick(backed, 365 + INTERREGNUM_POLLING_DAYS).world;
    expect(consuls(decided)).toContain("quintus-ogulnius");
    expect(decided.material.politicalProcedures.find((procedure) => procedure.id === "ogulnius-stands")?.outcome).toBe("passed");
    expect(decided.material.politicalProcedures.find((procedure) => procedure.id === "gaius-stands")?.outcome).toBe("failed");
  });

  it("elects the player when the player stands and has the standing", () => {
    const canvassOver = yearEnded();
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
          changedAtStep: 366,
        }],
      },
    };
    const decided = tick(stands, 365 + INTERREGNUM_POLLING_DAYS).world;
    expect(consuls(decided)).toContain("gaius-genucius");
  });

  it("treats a man putting himself forward as the election being called", () => {
    // A seat emptied mid-year, by a death, waits on a canvass; the year's end does not.
    const started = tick(opening(), 0).world;
    const vacant: WorldState = { ...started, material: { ...started.material, officeSeats: started.material.officeSeats.map((seat) => (seat.id === "roman-consul:seat:1"
      ? { ...seat, holderCharacterId: null, status: "vacant" as const, vacancyCause: "death" as const, termExpiresAtStep: 360 }
      : seat)) } };
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
    const called = elections(tick(standing, 361).world);
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
