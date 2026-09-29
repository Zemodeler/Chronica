import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, type ScenarioClock, type WorldState } from "@chronica/shared";
import { buildWorldSlice, renderWorldSlice } from "./slice";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const clock: ScenarioClock = definition.clock;
const offices = definition.government.offices;
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

const slice = (state: WorldState = world()) =>
  buildWorldSlice({
    world: state,
    clock,
    offices,
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

  it("never tells the model another power's true count, only what the actor could guess", () => {
    const state = world();
    const carthage = slice(state).foreignPowers.find((power) => power.id === "carthage")!;
    const exact = state.material.forces
      .filter((force) => force.polityId === "carthage")
      .map((force) => `${force.personnel.reduce((sum, category) => sum + category.fit, 0)} men`);
    for (const line of carthage.forces) for (const figure of exact) expect(line).not.toContain(`— ${figure}`);
    expect(carthage.forces.join(" ")).toMatch(/strength unknown|between|about/);
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
    //
    // Moved 12k -> 13k for the acting person's own portrait: the world knew a
    // minor Carthaginian admiral's temperament, drives and fears, and knew of
    // the person whose order it was answering only a name and an opaque office
    // id. This should come back down once the sections are read by station --
    // a private citizen's slice ought to be markedly shorter than today's.
    //
    // Moved 13k -> 14k for the ids three ops require and the slice never
    // printed: the cities in each province, the ground inside it, and the
    // kinds of soldier there are. `settlement_control_set` exists so that
    // taking Messana can be said, and the settlement id appeared nowhere here
    // -- so the only way to write one was to guess, and Agrigentum's is
    // `settlement-agrigentum-fort`. This is the cheapest kind of growth there
    // is: it is paid once per order and it removes a whole class of refusal.
    //
    // Moved 14k -> 14.5k for the land men own and what the country's taxes
    // cost it. Every holding list was empty until the scenario gave the
    // leading men estates, so LANDS AND HOLDINGS printed nothing; now it prints
    // the estates of our own people with their yields -- which is what makes
    // "improve my estate" a sentence anybody can carry out -- and one line
    // saying how hard our lands are taxed, which is what stops a model
    // tripling a tax it cannot see the cost of.
    //
    // Moved 14.5k -> 14.7k for faith: the scenario's gods are named once
    // (FAITHS), and each person's belief beside their age. Faith was null on
    // every character, so a priest had nothing to serve and a conversion
    // founded a new religion whenever it spelled an old one differently.
    //
    // Moved 14.7k -> 15k for the second consul (v29), Gnaeus Cornelius
    // Blasio, who is one of our own people with a purse and an estate.
    //
    // Moved 15k -> 15.5k for the assemblies (v31): the Centuriate and Tribal
    // Assemblies, not the Senate, elect Rome's magistrates, and a candidate
    // has to be able to see the body he is canvassing.
    //
    // Moved 15.5k -> 16.5k for allied Italy (v32): the peninsula is eleven
    // powers, not one, with their towns and Rome's Latin colonies among them.
    // Their foedera are one line rather than eight, and a city's holder is
    // named only where it is not the province's, which paid back a third.
    //
    // Moved 16.5k -> 17k for constitutions (v33): what sort of government it
    // is and who may change it, and what each bloc wants rather than only
    // whom it speaks for. Powers are named only where a chamber has fewer
    // than all of them.
    //
    // Moved 17k -> 17.5k for seated rulers (v34): the foreign figures a
    // government can see are now real people with offices, not blanks.
    //
    // Moved 17.5k -> 17.75k for the ruler's own wars: his portrait says which
    // war his power is in and whether any of its armies is within reach.
    //
    // Moved 17.75k -> 18.5k for the Senate of 270 (v34): eight consulars of
    // our own people, each with his age, faith and standing, so a vote has men
    // to speak for and against it.
    //
    // Moved 18.5k -> 18.75k for the ancient names of the far ground: the
    // Helvetian cantons and Gaulish departments beyond the frontier are the
    // Tigurini and the Rauraci, and a region cut into several units says which
    // part ("Northern Corsica") -- longer than "Zug", and true in 270.
    //
    // Moved 18.75k -> 19.25k for the choice of places by relevance: the forty
    // are now the ground the order and the armies are about, then the nearest,
    // instead of whatever sorted first, and the nearer ground has more towns.
    // The section is still forty lines.
    expect(text.length).toBeLessThan(19_250);
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
    // The scenario now opens with every power's aims already written, so an
    // empty world has to be built deliberately to test the empty case.
    expect(renderWorldSlice(slice({ ...world(), polityOutlooks: [] }))).not.toContain("STANDING AIMS");
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

  it("names the blocs inside a body, because a Senate cannot hold an opinion", () => {
    // Found live: shown only the institution, the model recorded the Senate
    // itself as a supporter, and the act was discarded.
    const text = renderWorldSlice(slice());
    const institution = world().material.institutions[0];
    if (institution === undefined || institution.votingBlocs.length === 0) return;
    expect(text).toContain(`[${institution.id}]`);
    expect(text).toContain(`[${institution.votingBlocs[0]!.id}]`);
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

describe("what the treasury owes and depends on", () => {
  const borrowed = (): WorldState => {
    const state = world();
    // Has to be our own government's debt: another power's books are not ours to read.
    const roman = state.characters.find((character) => character.alive && character.polityId === "rome")!;
    const account = state.material.accounts.find((a) => a.owner.kind === "character" && a.owner.id === roman.id)
      ?? { ...state.material.accounts[0]!, id: "roman-purse", owner: { kind: "character" as const, id: roman.id } };
    const lender = state.characters.find((character) => character.alive && character.id !== roman.id)!;
    return {
      ...state,
      material: {
        ...state.material,
        accounts: state.material.accounts.some((a) => a.id === account.id) ? state.material.accounts : [...state.material.accounts, account],
        obligations: [
          ...state.material.obligations,
          { id: "service-1", kind: "debt_service", label: "Interest", payerAccountId: account.id, amount: 24, cadenceSteps: 30, nextDueStep: 30, priority: 400, arrears: 48, missedPeriods: 2, active: true },
        ],
        loans: [
          { id: "loan-1", lenderKind: "character", lenderId: lender.id, borrowerAccountId: account.id, principal: 300, outstanding: 300, interestBps: 800, cadenceSteps: 30, serviceObligationId: "service-1", terms: "Merchant credit", collateralHoldingId: null, status: "active", openedAtStep: 0 },
        ],
        incomeSources: [
          ...state.material.incomeSources,
          { id: "sicilian-grain", kind: "trade", label: "Sicilian grain", beneficiaryAccountId: account.id, originKind: "polity", originId: "rome", amount: 44, cadenceSteps: 30, nextDueStep: 30, collectionRateBps: 10_000, counterpartyPolityId: "carthage", active: true },
        ],
      },
    };
  };

  it("names the creditor, the terms and what is already behind", () => {
    const text = renderWorldSlice(slice(borrowed()));
    expect(text).toContain("DEBTS");
    expect(text).toContain("300 owed to");
    expect(text).toContain("48 in arrears");
    expect(text).toContain("Merchant credit");
  });

  it("names who a trade route depends on, so a war can cut it", () => {
    const text = renderWorldSlice(slice(borrowed()));
    expect(text).toContain("TRADE");
    expect(text).toContain("Sicilian grain [sicilian-grain]");
    expect(text).toContain("from Carthage");
  });

  it("lists as trade only revenue that depends on somebody abroad", () => {
    // At the opening that is the rent of land Rome took from its allies: a
    // Bruttian or Samnite revolt would cut it. The tributum depends on nobody.
    const text = renderWorldSlice(slice());
    expect(text).toContain("from Bruttians");
    expect(text).not.toContain("tributum on Roman citizens [rome-tributum] — ");
  });
});

describe("what the world is following, and what stirs", () => {
  it("lists open threads by id with their stakes, and marks a secret one", () => {
    const state = world();
    const secret = { ...state.storylines[0]!, id: "plot", title: "A Quiet Conspiracy", visibility: "private" as const };
    const text = renderWorldSlice(slice({ ...state, storylines: [...state.storylines, secret] }));
    expect(text).toContain("OPEN THREADS");
    expect(text).toContain("The Messana Crisis [mamertine-syracusan-crisis]");
    expect(text).toContain("A Quiet Conspiracy [plot]");
    expect(text).toContain("(secret — known to its participants alone)");
  });

  it("leaves a closed thread out", () => {
    const state = world();
    const text = renderWorldSlice(slice({ ...state, storylines: state.storylines.map((storyline) => ({ ...storyline, phase: "closed" as const })) }));
    expect(text).not.toContain("OPEN THREADS");
  });

  it("renders the narrator's directive only when there is one, naming its target by id", () => {
    const state = world();
    const quiet = renderWorldSlice(slice(state));
    expect(quiet).not.toContain("THE WORLD STIRS");
    const stirred = renderWorldSlice(
      buildWorldSlice({
        world: state, clock, offices, actorRef: { kind: "character", id: state.characters[0]!.id }, actorPolityId: "rome",
        orderText: "Invade the Boii lands", facts: [], dueEvents: [], pendingEvents: [],
        narratorSeed: {
          key: "seed-abc", kind: "world_event", archetype: "plague", severity: "serious", secret: false, oneShot: false, repeated: false, pressureId: null,
          target: { provinceId: "punic-italy-latium", provinceName: "Latium", polityId: "rome", polityName: "Roman Republic", characterId: null, characterName: null, otherPolityId: null, otherPolityName: null, forceId: null, forceName: null, forceIsNaval: false },
          inPlayerRealm: true, why: "The world has been quiet at home for a while.", brief: "Sickness has come to Latium [punic-italy-latium].",
        },
      }),
    );
    expect(stirred).toContain("(seed seed-abc)");
    expect(stirred).toContain("Latium [punic-italy-latium]");
    expect(stirred).toContain('carrying seedKey "seed-abc"');
    expect(stirred).toContain("It is news");
  });

  it("prints each known fact with its id, so a discovery can name it", () => {
    const state = world();
    const text = renderWorldSlice(
      buildWorldSlice({
        world: state, clock, offices, actorRef: { kind: "character", id: state.characters[0]!.id }, actorPolityId: "rome", orderText: "Wait.",
        facts: [{
          id: "fact-known", time: { day: 0, minute: 0 }, atStep: 0, kind: "event", summary: "Rome hears of the Boii.", affectedEntities: [], resourceChanges: [],
          authorityChange: undefined, visibility: "public", discovery: { state: "public", knowableAtInstant: null, discoveredBy: [] }, evidence: null,
          eligibleReactionScopes: [], sourceEventId: null, sourceActionId: null, causalDepth: 0,
        }],
        dueEvents: [], pendingEvents: [{ kind: "wave", summary: "The sickness spreads.", dueInDays: 20, thread: "The Plague [plague-1]" }],
      }),
    );
    expect(text).toContain("Rome hears of the Boii. [fact-known]");
    expect(text).toContain("(thread: The Plague [plague-1])");
  });
});

/**
 * The opening with one Roman who holds nothing: no seat, no office, no
 * command, a purse of his own. The scenario's three Romans all hold senate
 * seats, so every test below that asked for a private citizen found none and
 * returned before checking anything -- and passed.
 */
function withCitizen(): WorldState {
  // With its provinces' figures, as a game has them: without, THE COUNTRY is
  // empty for everybody and nothing about who may read it can be seen.
  const base = ensureProvinceMaterial(world(), 0);
  const template = base.characters.find((character) => character.id === "quintus-ogulnius")!;
  const purse = base.material.accounts.find((account) => account.id === template.personalAccountId)!;
  return {
    ...base,
    characters: [...base.characters, { ...structuredClone(template), id: "lucius-privatus", name: "Lucius Privatus", officeId: null, relations: [], ambitions: [], personalAccountId: "lucius-privatus-purse" }],
    material: { ...base.material, accounts: [...base.material.accounts, { ...structuredClone(purse), id: "lucius-privatus-purse", owner: { kind: "character" as const, id: "lucius-privatus" }, balance: 400 }] },
  };
}

describe("who the world is told it is speaking for", () => {
  /** Somebody of the same polity holding no office and no command. */
  function privateCitizen(state: WorldState, polityId: string): string | null {
    const seated = new Set(state.material.officeSeats.filter((seat) => seat.status === "held").map((seat) => seat.holderCharacterId));
    const commanders = new Set(state.material.forces.flatMap((force) => [force.commanderCharacterId, force.controllerCharacterId]));
    return state.characters.find(
      (character) => character.alive && character.polityId === polityId && character.officeId === null && !seated.has(character.id) && !commanders.has(character.id),
    )?.id ?? null;
  }

  const forCharacter = (state: WorldState, characterId: string) =>
    renderWorldSlice(buildWorldSlice({
      world: state, clock, offices, actorRef: { kind: "character", id: characterId }, actorPolityId: "rome",
      orderText: "What is happening?", facts: [], dueEvents: [], pendingEvents: [],
    }));

  it("names the office a person holds, rather than handing over its id", () => {
    const state = withCitizen();
    const seat = state.material.officeSeats.find((candidate) => candidate.status === "held" && candidate.holderCharacterId !== null);
    if (seat === undefined) return;
    const office = offices.find((candidate) => candidate.id === seat.officeId);
    if (office === undefined) return;

    const text = forCharacter(state, seat.holderCharacterId!);
    // "roman-consul" is not a thing a person is called.
    expect(text).toContain(office.label);
  });

  it("tells the world what the person it is speaking for is like", () => {
    // The world knew a minor Carthaginian admiral's temperament, drives and
    // fears, and knew of the person whose order it was answering only a name.
    const state = withCitizen();
    const commander = state.material.forces[0]!.commanderCharacterId;
    const text = forCharacter(state, commander);
    expect(text).toContain(`## ${state.characters.find((c) => c.id === commander)!.name}`);
    expect(text).toContain("WHAT THIS PERSON MAY DO:");
  });

  it("tells it what they may do, and that people outside it may refuse", () => {
    const state = withCitizen();
    const force = state.material.forces[0]!;
    const text = forCharacter(state, force.commanderCharacterId);
    expect(text).toContain(force.name);
    expect(text).toContain("may refuse");
  });

  it("does not tell it a private citizen commands anything", () => {
    const state = withCitizen();
    const citizenId = privateCitizen(state, "rome");
    if (citizenId === null) return;

    const citizen = forCharacter(state, citizenId);
    const consulSeat = state.material.officeSeats.find((seat) => seat.status === "held" && seat.holderCharacterId !== null);
    if (consulSeat === null || consulSeat === undefined) return;
    const consul = forCharacter(state, consulSeat.holderCharacterId!);

    const permitted = (text: string): string =>
      text.slice(text.indexOf("WHAT THIS PERSON MAY DO:"), text.indexOf("Nothing beyond this is theirs"));
    // The consul's permissions run over his republic; the citizen's over his purse.
    expect(permitted(consul).length).toBeGreaterThan(permitted(citizen).length);
    expect(permitted(citizen)).not.toContain("military matters");
  });
});

describe("what a person's station lets them read", () => {
  it("has a private citizen to test with, so nothing below returns early", () => {
    const state = withCitizen();
    const seated = new Set(state.material.officeSeats.filter((seat) => seat.status === "held").map((seat) => seat.holderCharacterId));
    expect(state.characters.some((character) => character.id === "lucius-privatus" && character.officeId === null && !seated.has(character.id))).toBe(true);
  });

  it("keeps the government's own figures from a private man and from a senator, and gives them to the consul", () => {
    const state = withCitizen();
    const text = (id: string) => renderWorldSlice(build(state, id));
    const consul = state.material.officeSeats.find((seat) => seat.officeId === "roman-consul" && seat.status === "held")!.holderCharacterId!;
    expect(text(consul)).toContain("men available to raise");
    // A senator may put a question to the whole republic; that does not make
    // him its government (holdsPolityStanding).
    for (const id of ["lucius-privatus", "manius-curius"]) {
      expect(text(id)).not.toContain("men available to raise");
      expect(text(id)).not.toContain("taxable");
    }
  });

  it("names the person it speaks for neutrally, not as the ruler", () => {
    const state = withCitizen();
    const text = renderWorldSlice(buildWorldSlice({
      world: state, clock, offices, actorRef: { kind: "character", id: "lucius-privatus" }, actorPolityId: "rome", orderText: "Wait.",
      facts: [{
        id: "fact-known", time: { day: 0, minute: 0 }, atStep: 0, kind: "event", summary: "Rome hears of the Boii.", affectedEntities: [], resourceChanges: [],
        authorityChange: undefined, visibility: "public", discovery: { state: "public", knowableAtInstant: null, discoveredBy: [] }, evidence: null,
        eligibleReactionScopes: [], sourceEventId: null, sourceActionId: null, causalDepth: 0,
      }],
      dueEvents: [], pendingEvents: [],
    }));
    expect(text).toContain("RECENT HISTORY (only what is known to them)");
    expect(text).not.toContain("known to this government");
  });

  function privateCitizen(state: WorldState, polityId: string): string | null {
    const seated = new Set(state.material.officeSeats.filter((seat) => seat.status === "held").map((seat) => seat.holderCharacterId));
    const commanders = new Set(state.material.forces.flatMap((force) => [force.commanderCharacterId, force.controllerCharacterId]));
    return state.characters.find(
      (character) => character.alive && character.polityId === polityId && character.officeId === null && !seated.has(character.id) && !commanders.has(character.id),
    )?.id ?? null;
  }
  const seatedId = (state: WorldState): string | null =>
    state.material.officeSeats.find((seat) => seat.status === "held" && seat.holderCharacterId !== null)?.holderCharacterId ?? null;

  const build = (state: WorldState, characterId: string) =>
    buildWorldSlice({
      world: state, clock, offices, actorRef: { kind: "character", id: characterId }, actorPolityId: "rome",
      orderText: "What is happening?", facts: [], dueEvents: [], pendingEvents: [],
    });

  it("gives a private citizen materially less of the world than the man who governs it", () => {
    // The measurement this whole branch exists for: the two used to differ by
    // one line out of a hundred and forty-three.
    const state = withCitizen();
    const consulId = seatedId(state);
    const citizenId = privateCitizen(state, "rome");
    if (consulId === null || citizenId === null) return;

    const consul = renderWorldSlice(build(state, consulId));
    const citizen = renderWorldSlice(build(state, citizenId));
    expect(citizen.length).toBeLessThan(consul.length * 0.95);
  });

  it("keeps a commander's own army whole and bands every other", () => {
    const base = world();
    const force = base.material.forces.find((candidate) => candidate.polityId === "rome");
    if (force === undefined) return;

    // A legate, not a consul: someone whose command is a force and not a
    // republic. Where the two are the same man he sees everything, correctly.
    const commanderId = force.commanderCharacterId;
    const state: WorldState = {
      ...base,
      characters: base.characters.map((character) => (character.id === commanderId ? { ...character, officeId: null } : character)),
      material: {
        ...base.material,
        officeSeats: base.material.officeSeats.filter((seat) => seat.holderCharacterId !== commanderId),
        forces: base.material.forces.map((candidate) =>
          candidate.id === force.id || (candidate.commanderCharacterId !== commanderId && candidate.controllerCharacterId !== commanderId)
            ? candidate
            : { ...candidate, commanderCharacterId: base.characters.find((c) => c.id !== commanderId && c.alive)!.id }),
      },
    };
    const other = state.material.forces.find(
      (candidate) => candidate.polityId === "rome" && candidate.id !== force.id
        && candidate.commanderCharacterId !== commanderId && candidate.controllerCharacterId !== commanderId,
    );
    if (other === undefined) return;

    const slice = build(state, commanderId);
    const mine = slice.military.find((entry) => entry.id === force.id)!;
    const theirs = slice.military.find((entry) => entry.id === other.id)!;
    expect(mine.banded).toBe(false);
    expect(mine.morale).not.toBeNull();
    // Another man's legion keeps its name, its id and its place -- and loses
    // the readings only its own commander has.
    expect(theirs.banded).toBe(true);
    expect(theirs.morale).toBeNull();
    expect(theirs.provisions).toBeNull();
    expect(theirs.paperStrength).toBeNull();
  });

  it("never drops a thing an order might have to name", () => {
    // The invariant that stops false insubordination: narrow the readings,
    // never the roster. Take an id away and the orchestrator invents a
    // placeholder for it, the act is discarded, and it reads as overreach.
    const state = withCitizen();
    const consulId = seatedId(state);
    const citizenId = privateCitizen(state, "rome");
    if (consulId === null || citizenId === null) return;

    const consul = build(state, consulId);
    const citizen = build(state, citizenId);
    expect(citizen.military.map((force) => force.id).sort()).toEqual(consul.military.map((force) => force.id).sort());
    expect(citizen.provinces.map((province) => province.id).sort()).toEqual(consul.provinces.map((province) => province.id).sort());
    expect(citizen.politics.map((person) => person.id).sort()).toEqual(consul.politics.map((person) => person.id).sort());
    expect(citizen.institutions.map((institution) => institution.id).sort()).toEqual(consul.institutions.map((institution) => institution.id).sort());
  });

  it("shows a private citizen the question before the council, and not how the room is leaning", () => {
    const state = withCitizen();
    const citizenId = privateCitizen(state, "rome");
    if (citizenId === null || state.material.politicalProcedures.length === 0) return;
    const slice = build(state, citizenId);
    for (const question of slice.council) {
      expect(question.label.length).toBeGreaterThan(0);
      expect(question.supportWeight).toBeNull();
    }
    for (const institution of slice.institutions) expect(institution.blocs).toEqual([]);
  });

  it("keeps the world's own half, and says plainly that the reader has not been told it", () => {
    // Foreign aims and secret threads cannot be filtered away -- the
    // orchestrator is the world and must move Carthage coherently. They are
    // labelled instead.
    const state = withCitizen();
    const citizenId = privateCitizen(state, "rome");
    if (citizenId === null) return;
    const text = renderWorldSlice(build(state, citizenId));
    expect(text).toContain("THE WORLD ITSELF");
    expect(text).toContain("have been told none of what");
  });
});

describe("the rules the actor's arrangements run by", () => {
  it("adds one clause of bounded length per arrangement, and only for the actor's own", () => {
    const base = ensureProvinceMaterial(world(), 0);
    const actor = base.characters.find((character) => character.id === "gaius-genucius")!;
    const rule = {
      trigger: { kind: "monthly" as const }, conditions: [{ kind: "province_level_above" as const, provinceId: actor.locationProvinceId, level: "stability" as const, bps: 3_000 }],
      effects: [{ op: "money_transfer" as const, fromAccountId: "gaius-purse", toAccountId: null, amount: { kind: "band" as const, band: "slight" as const } }],
      end: { kind: "owner_death" as const }, price: { setup: 10, upkeepPerMonth: 1 }, why: "A toll while the province is orderly, and this is a very long explanation meant to test that the clause is cut to length rather than printed whole.",
      attachedAtStep: 0, origin: "written" as const, shapeKey: "abcd1234", debitWarrants: [], nextDueStep: 30, armedReading: null, endArmedReading: null, endsAtStep: null,
      setupPaid: 10, firedCount: 3, changedCount: 3, lastFiredStep: 0, emptyFirings: 0, endedAtStep: null, endedReason: null,
    };
    const entities = Array.from({ length: 9 }, (_, index) => ({
      id: `toll-${index}`, kind: "toll", label: `Toll-house ${index}`, ownerRef: index === 8 ? { kind: "character" as const, id: "hanno-carthage" } : { kind: "character" as const, id: actor.id },
      attributes: {}, linkedEntityIds: [], createdAtStep: 0, provenanceEventIds: [], provinceId: actor.locationProvinceId, effects: [], upkeep: null, mechanic: rule,
    }));
    const ruled: WorldState = { ...base, genericEntities: [...base.genericEntities, ...entities] };
    const plain = renderWorldSlice(slice({ ...ruled, genericEntities: ruled.genericEntities.map((entity) => ({ ...entity, mechanic: undefined })) }));
    const withRules = renderWorldSlice(slice(ruled));
    const own = entities.filter((entity) => entity.ownerRef.id === actor.id).length;
    // Twice per arrangement: once in STANDING ARRANGEMENTS, once in the actor's
    // own portrait, which the slice carries and cognition reads alone.
    expect(withRules.length - plain.length).toBeLessThan(own * 2 * 170);
    expect(withRules).toContain("rule: each month while stability");
    expect(withRules).toContain("fired 3 times");
    // Hanno's rule is his to know, not the consul's.
    const hannoLine = withRules.split("\n").find((line) => line.includes("Toll-house 8"));
    expect(hannoLine === undefined || !hannoLine.includes("rule:")).toBe(true);
  });
});

describe("what a soldier costs", () => {
  const forConsul = (characterId: string) =>
    renderWorldSlice(buildWorldSlice({
      world: world(), clock, offices, actorRef: { kind: "character", id: characterId }, actorPolityId: "rome",
      orderText: "Raise four more legions.", facts: [], dueEvents: [], pendingEvents: [],
    }));

  it("is told to whoever keeps the treasury, so new legions are priced at Rome's rate rather than guessed", () => {
    // Twenty thousand men at 35 a thousand is 700 a month, of an income near 1 800.
    expect(forConsul("gaius-genucius")).toContain("Our soldiers are paid 35/month for every 1,000 men.");
  });
});
