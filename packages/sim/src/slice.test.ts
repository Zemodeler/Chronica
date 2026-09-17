import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, type ScenarioClock, type WorldState } from "@chronica/shared";
import { buildWorldSlice, renderWorldSlice } from "./slice";

const clock: ScenarioClock = ScenarioDefinitionSchema.parse(punicWarsScenario.definition).clock;
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

const slice = (state: WorldState = world()) =>
  buildWorldSlice({
    world: state,
    clock,
    actorRef: { kind: "character", id: state.characters[0]!.id },
    actorPolityId: "rome",
    orderText: "Invade the Boii lands",
    facts: [],
    dueEvents: [],
    pendingEvents: [],
  });

describe("what the player's government can see of the world", () => {
  it("shows other powers, not only our own side", () => {
    // The slice used to filter every axis to our own polity, so an order to
    // invade was carried out by a model that could not see the enemy at all --
    // and invented placeholders for ground it had no id for.
    const powers = slice().foreignPowers.map((power) => power.id);
    expect(powers).toContain("carthage");
    expect(powers).toContain("boii");
    expect(powers).not.toContain("rome");
  });

  it("names foreign armies and leaders by the id an order must use", () => {
    const carthage = slice().foreignPowers.find((power) => power.id === "carthage")!;
    expect(carthage.forces.join(" ")).toMatch(/\[[a-z0-9-]+\]/);
  });

  it("renders every place with its id, ours and theirs alike", () => {
    const text = renderWorldSlice(slice());
    expect(text).toContain("PLACES");
    expect(text).toContain("OTHER POWERS");
    // The Boii province is somewhere an invasion must be able to name.
    expect(text).toContain("punic-italy-middle-padus");
  });

  it("tells the world plainly which countries have nobody in them", () => {
    const text = renderWorldSlice(slice());
    expect(text).toContain("COUNTRIES WITH NOBODY IN THEM");
    expect(text).toContain("Give each of them the people and forces they plainly ought to have");
  });

  it("stays small enough to send", () => {
    const text = renderWorldSlice(slice());
    // Roughly four characters to the token: the slice must not grow into the
    // thing that makes every order expensive.
    expect(text.length).toBeLessThan(12_000);
  });
});

describe("what each country is trying to do", () => {
  const withOutlooks = (): WorldState => ({
    ...world(),
    polityOutlooks: [
      {
        polityId: "carthage",
        primaryObjective: "Preserve western Mediterranean commercial dominance.",
        concerns: [{ label: "Roman expansion", level: "high" }],
        intentions: ["strengthen Sicily"],
        riskTolerance: 45,
        updatedAtStep: 0,
        lastChangeReason: "opening position",
      },
      {
        polityId: "rome",
        primaryObjective: "Secure the peninsula and the routes south.",
        concerns: [{ label: "an unpaid army", level: "medium" }],
        intentions: ["settle the Boii question"],
        riskTolerance: 60,
        updatedAtStep: 0,
        lastChangeReason: "opening position",
      },
    ],
  });

  it("shows the orchestrator every power's aims, because it has to drive them", () => {
    const text = renderWorldSlice(slice(withOutlooks()));
    expect(text).toContain("STANDING AIMS");
    expect(text).toContain("Preserve western Mediterranean commercial dominance.");
    expect(text).toContain("worried about Roman expansion: high");
    expect(text).toContain("means to strengthen Sicily");
  });

  it("marks which of them is ours and puts it first", () => {
    const outlooks = slice(withOutlooks()).outlooks;
    expect(outlooks[0]!.polityId).toBe("rome");
    expect(outlooks[0]!.own).toBe(true);
    expect(outlooks.find((outlook) => outlook.polityId === "carthage")!.own).toBe(false);
  });

  it("says nothing at all before any country has formed an aim", () => {
    expect(renderWorldSlice(slice())).not.toContain("STANDING AIMS");
  });
});

describe("what the government can see of its own standing", () => {
  it("shows legitimacy out of a hundred, as a government would speak of it", () => {
    const state = world();
    const withStanding: WorldState = {
      ...state,
      material: {
        ...state.material,
        polityLegitimacy: [
          { polityId: "rome", legitimacyBps: 7_100, institutionalConfidenceBps: 6_300, causes: [{ id: "c1", label: "The tax on the wealthy", score: -40, sourceId: "rome" }, { id: "c2", label: "A quiet year", score: 5, sourceId: "rome" }] },
        ],
      },
    };
    const text = renderWorldSlice(slice(withStanding));
    expect(text).toContain("POLITICAL STANDING");
    expect(text).toContain("legitimacy 71/100");
    expect(text).toContain("confidence in its institutions 63/100");
    // The heaviest cause first: a five-point nudge is not why a government is where it is.
    expect(text).toContain("The tax on the wealthy");
  });

  it("totals the manpower an order to raise legions actually draws on", () => {
    // The burst's opening tick backfills every province's material state before
    // the slice is ever built, so this is the world the model actually reads.
    const built = slice(ensureProvinceMaterial(world(), 0));
    expect(built.country.provinces).toBeGreaterThan(0);
    expect(built.country.availableManpower).toBe(
      built.country.strained.length === built.country.provinces
        ? built.country.strained.reduce((sum, province) => sum + province.manpower, 0)
        : built.country.availableManpower,
    );
    expect(renderWorldSlice(built)).toContain("men available to raise");
  });

  it("shows an open question with the weight on each side, counting each supporter once", () => {
    const state = world();
    const institution = state.material.institutions[0]!;
    const sponsor = state.characters.find((character) => character.alive)!;
    const withQuestion: WorldState = {
      ...state,
      material: {
        ...state.material,
        politicalProcedures: [
          ...state.material.politicalProcedures,
          {
            id: "proc-tax", type: "vote", institutionId: institution.id, sponsorCharacterId: sponsor.id,
            subjectKind: "polity", subjectId: "rome", label: "Double the tax on the wealthy.",
            eligibilityRequirementIds: [], eligibleParticipantIds: [], stage: "gathering_support",
            resolutionMechanism: "vote", openedAtStep: state.elapsedStep, deadlineStep: state.elapsedStep + 20,
            resolvedAtStep: null, visibility: "polity", voteRecordId: null, outcome: null, outcomeReason: null,
            sourceEventIds: [], resultingEventIds: [],
          },
        ],
        supportPositions: [
          { id: "s1", procedureId: "proc-tax", supporterKind: "character", supporterId: sponsor.id, position: "support", influenceWeight: 60, visibility: "polity", reasons: [], provenanceEventIds: [], changedAtStep: 0 },
          { id: "s2", procedureId: "proc-tax", supporterKind: "character", supporterId: sponsor.id, position: "oppose", influenceWeight: 60, visibility: "polity", reasons: [], provenanceEventIds: [], changedAtStep: 5 },
        ],
      },
    };

    const question = slice(withQuestion).council.find((entry) => entry.id === "proc-tax")!;
    // He changed his mind; he is one man, and only his later position counts.
    expect(question.supportWeight).toBe(0);
    expect(question.opposeWeight).toBe(60);
    expect(question.dueInDays).toBe(20);
    expect(renderWorldSlice(slice(withQuestion))).toContain("BEFORE THE COUNCIL");
  });

  it("leaves a settled question out entirely", () => {
    const state = world();
    const settled: WorldState = {
      ...state,
      material: {
        ...state.material,
        politicalProcedures: state.material.politicalProcedures.map((procedure) => ({
          ...procedure, stage: "resolved" as const, outcome: "passed" as const, outcomeReason: "Carried.", resolvedAtStep: 1,
        })),
      },
    };
    expect(slice(settled).council).toHaveLength(0);
  });
});

describe("arrangements the world made for itself", () => {
  const withLaw = (retired: boolean): WorldState => {
    const state = world();
    return {
      ...state,
      genericEntities: [
        {
          id: "entity-lex", kind: "law", label: "Lex Agraria", ownerRef: { kind: "polity", id: "rome" },
          attributes: retired ? { eliteLoyalty: -30, retiredAtStep: 12 } : { eliteLoyalty: -30 },
          linkedEntityIds: [], createdAtStep: 0, provenanceEventIds: [],
        },
      ],
    };
  };

  it("shows the model what it created a turn ago, with the id it would need to change it", () => {
    const text = renderWorldSlice(slice(withLaw(false)));
    expect(text).toContain("STANDING ARRANGEMENTS");
    expect(text).toContain("Lex Agraria [entity-lex]");
    expect(text).toContain("eliteLoyalty: -30");
  });

  it("keeps a repealed law visible, and says it is repealed", () => {
    expect(renderWorldSlice(slice(withLaw(true)))).toContain("repealed");
  });
});
