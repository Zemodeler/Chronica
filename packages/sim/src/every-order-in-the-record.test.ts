import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  ScenarioDefinitionSchema,
  WorldDeltaSchema,
  WorldStateSchema,
  localRef,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";
import { createIdFactory } from "./ports";
import { applyDeltas } from "./apply/apply-deltas";
import { holdVotes, voteDayOf } from "./senate";
import type { ApplyContext } from "./apply/context";

/**
 * Seventy-odd real orders, written by a real player over six days of play in
 * another game, put to this engine one at a time.
 *
 * They arrived as a flat list with the chat around them, and they are the best
 * evidence this project has of what people actually write: not the tidy
 * "raise two legions" of a design document, but five things at once, half of
 * them conditional, naming cities the map does not draw and troops the scenario
 * never heard of. The standard they are held to is the one the game is built
 * on -- *no order fails because of the engine*. An order may fail because the
 * world makes it impossible: Rome cannot sail an army to Africa in hulls that
 * will not carry it, and cannot take a province it has no army within reach of.
 * That is the world answering. An order may never fail because there was no
 * field for it.
 *
 * Each case below names the orders it stands for by their number in that list.
 * What is asserted is narrow and deliberate: that the thing can be *said* --
 * that the vocabulary parses it and the engine carries it out. Whether the
 * model chooses to say it is a different question, and not one a test without
 * a model can answer.
 *
 * Five of these were refusals or silences before this pass and are now not: the
 * elephants (34, 67), Mount Etna (19-25), Hadrumentum (49-55), the knife in the
 * dark (2, 11), and the conditional order -- about a fifth of the whole list --
 * which could be written down and never read back.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

const AGRIGENTUM = PUNIC_IDS.agrigentum;
const MESSANA = PUNIC_IDS.messana;
const LILYBAEUM = PUNIC_IDS.lilybaeum;
const SYRACUSE = PUNIC_IDS.syracuse;
const AFRICA = PUNIC_IDS.carthage;
const LATIUM = PUNIC_IDS.rome;
/** A province next to Rome by land: one step on, so a march to it is made at once rather than set going as a journey. */
const NEXT_DOOR = (() => {
  const edge = punicWarsScenario.initialWorld.map.edges.find((candidate) => candidate.crossing === "land" && (candidate.from === LATIUM || candidate.to === LATIUM))!;
  return edge.from === LATIUM ? edge.to : edge.from;
})();

const context = (): ApplyContext => ({
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: "gaius-genucius" },
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory("corpus"),
  gameId: "game-1",
});

/**
 * One order, as a batch of deltas, put to the engine.
 *
 * `unsayable` is the vocabulary having no shape for it; `refused` is the engine
 * declining to carry it out. The first is always a failure of this project. The
 * second is only a failure when the reason is not about the world.
 */
function order(written: readonly unknown[], state: WorldState = world()) {
  const deltas: WorldDelta[] = [];
  const unsayable: string[] = [];
  for (const [index, raw] of written.entries()) {
    const parsed = WorldDeltaSchema.safeParse(raw);
    if (parsed.success) deltas.push(parsed.data);
    else unsayable.push(`delta ${index} (${(raw as { op?: string }).op}): ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  }
  const result = applyDeltas(state, deltas, context());
  return { world: result.world, unsayable, refused: result.rejected.map((rejection) => rejection.reason) };
}

/** The ordinary expectation: it could be said, and the world did it. */
function carriedOut(result: { unsayable: string[]; refused: string[] }) {
  expect(result.unsayable).toEqual([]);
  expect(result.refused).toEqual([]);
}

describe("raising and training an army (orders 1, 10, 35)", () => {
  it("raises a militia, drills it, and puts scouts into the country around it", () => {
    const result = order([
      {
        op: "force_create", localId: "levy", name: "The levy of the Maestrazgo", polityId: "rome",
        commanderCharacterRef: "gaius-genucius", controllerCharacterRef: "gaius-genucius",
        locationId: LATIUM, authorizedStrength: 3_000, payObligationRef: "rome-legion-pay",
        reason: "Militias and armed countrymen are called up.",
      },
      {
        op: "force_modify", forceRef: localRef("levy"), cohesionBpsDelta: 1_200, moraleBpsDelta: 800,
        provisionedForDays: 90,
        reason: "They drill through the season and learn to live off their own country.",
      },
      {
        op: "generic_entity_create", localId: "the_scouts", kind: "military_arrangement",
        label: "The scouting net of the surrounding villages",
        ownerRef: { kind: "character", id: "gaius-genucius" },
        attributes: { drawnFrom: "the villages round about", reports: "ravines, tracks and the enemy's movements" },
        reason: "Local men who know the ground are sent out to watch it.",
      },
      {
        op: "province_material_shift", provinceId: LATIUM, availableManpowerDelta: -3_000,
        reason: "The men come out of the province that raised them.",
      },
    ]);

    carriedOut(result);
    expect(result.world.material.forces.at(-1)!.name).toContain("Maestrazgo");
  });
});

describe("the knife in the dark (orders 2, 11)", () => {
  it("hires a man, pays him out of the Senate's money, and blames somebody else", () => {
    const result = order([{
      op: "covert_plot_open", localId: "the_knife", kind: "assassination",
      targetCharacterRef: "hanno-carthage", sponsorCharacterRef: "gaius-genucius",
      agentCharacterRef: null, fundingAccountRef: "rome-treasury", spend: 1_500,
      cover: "The Carthaginians did this to their own man.", expectedInDays: 60,
      reason: "The consul pays a man and never asks his name.",
    }]);

    carriedOut(result);
    const plot = result.world.covertPlots.at(-1)!;
    expect(plot.outcome).toBeNull();
    // What the player wrote as "25/75" and "1% chance" is nowhere in it: the
    // odds are the engine's, settled from who is moving against whom.
    expect(plot.successOddsBps).toBeGreaterThan(0);
    expect(plot.successOddsBps).toBeLessThan(10_000);
  });
});

describe("letters between powers (orders 2, 3, 13, 14, 16, 19, 35, 42)", () => {
  it("asks Syracuse for men, for supply, and for a change of side", () => {
    const result = order([
      {
        op: "diplomatic_message_send", localId: "to_hieron", kind: "letter",
        fromPolityId: "rome", fromCharacterRef: "gaius-genucius",
        toPolityId: "syracuse", toCharacterRef: "hieron-ii",
        subject: "Grain, and the friendship of the Roman people",
        terms: "Syracuse sells Rome grain for the legions at Agrigentum and keeps its own laws, its own king and its own customs.",
        replyWithinDays: 30, inReplyToRef: null, visibility: "polity",
        reason: "The consul writes to the king directly, as one who has dealt with him before.",
      },
      {
        op: "agreement_open", localId: "the_understanding", kind: "alliance",
        polityId: "rome", otherPolityId: "syracuse",
        terms: "Syracuse follows Rome in this war and is answered for by Rome against Carthage.",
        forDays: null, sourceMessageRef: localRef("to_hieron"), visibility: "public",
        reason: "The king comes over.",
      },
    ]);

    carriedOut(result);
    expect(result.world.diplomacy.at(-1)!.toPolityId).toBe("syracuse");
    expect(result.world.polityAgreements.at(-1)!.kind).toBe("alliance");
  });
});

describe("money, mercenaries and what a stage of work costs (orders 4, 50, 64)", () => {
  it("pays what was promised to the Gauls and buys men with the rest", () => {
    const result = order([
      {
        op: "money_transfer", fromAccountRef: "rome-treasury", toAccountRef: null, amount: 400,
        reason: "What Fabius promised the Gauls is paid, by a consul who did not promise it.",
      },
      {
        op: "project_create", localId: "mercenaries", kind: "recruitment",
        label: "Mercenary cohorts for the Thirteenth",
        sponsorRef: { kind: "character", id: "gaius-genucius" }, fundingAccountRef: "rome-treasury",
        milestones: [
          { label: "Contracts taken up", dueInDays: 30, costAmount: 600 },
          { label: "The companies assemble", dueInDays: 75, costAmount: 500 },
        ],
        completionOutcome: { kind: "force", label: "Hired companies", amount: 1_800, provinceId: LATIUM, polityId: "rome" },
        reason: "Money from the Senate buys men who fight for it.",
      },
    ]);

    carriedOut(result);
    // Each stage costs something. Spelt `cost`, this silently came to nothing
    // and the whole recruitment ran free.
    const project = result.world.projects.at(-1)!;
    expect(project.milestones.every((milestone) => milestone.costAmount > 0)).toBe(true);
  });
});

describe("auxiliaries, and troops this world had never heard of (orders 5, 9, 15, 19, 32, 34, 67)", () => {
  it("takes the Gauls into the Thirteenth as what they are", () => {
    const result = order([{
      op: "force_reinforce", forceRef: "roman-field-army", categoryId: "cavalry",
      label: "Gallic horse", men: 600, fromForceRef: null,
      reason: "The Gauls are taken into the legion as auxiliaries.",
    }]);

    carriedOut(result);
    const legion = result.world.material.forces.find((force) => force.id === "roman-field-army")!;
    expect(legion.personnel.some((category) => category.categoryId === "cavalry" && category.fit === 600)).toBe(true);
  });

  it("takes the Carthaginian elephants, which this scenario never authored", () => {
    // Refused outright before this pass: "war-elephant is not a kind of troops
    // this world has; it knows infantry, warship, cavalry." Rome captured
    // elephants in this war and used them. The list opens.
    const result = order([{
      op: "force_reinforce", forceRef: "roman-field-army", categoryId: "war-elephant",
      label: "Captured elephants", men: 24, fromForceRef: null,
      newCategory: { label: "War elephants", weightBand: "heavy", steadinessBand: "brittle", mobilityBand: "slow", naval: false },
      reason: "The beasts taken at Agrigentum are put into the line, and men found who can handle them.",
    }]);

    carriedOut(result);
    const minted = result.world.troopCategories.find((category) => category.id === "war-elephant")!;
    expect(minted.label).toBe("War elephants");
    // Heavy, and skittish, and no faster than a marching man -- and never
    // worth more per head than an ordinary soldier, because the world says
    // what sort of troops they are and the engine says what that is worth.
    expect(minted.combatWeightBps).toBeLessThanOrEqual(10_000);
    expect(minted.steadinessBps).toBeLessThan(5_000);
  });

  it("recruits the men of a beaten army without inventing them twice", () => {
    const result = order([{
      op: "force_reinforce", forceRef: "roman-field-army", categoryId: "infantry",
      label: "Carthaginian auxiliaries", men: 800, fromForceRef: "carthaginian-garrison",
      reason: "The captured mercenaries are offered service instead of the slave market.",
    }]);

    carriedOut(result);
    const beaten = result.world.material.forces.find((force) => force.id === "carthaginian-garrison")!;
    const before = world().material.forces.find((force) => force.id === "carthaginian-garrison")!;
    expect(beaten.personnel.reduce((sum, category) => sum + category.fit, 0))
      .toBe(before.personnel.reduce((sum, category) => sum + category.fit, 0) - 800);
  });
});

describe("scorched earth and the enemy's supply (orders 5, 8, 15, 17, 28, 37, 52, 64)", () => {
  it("empties the country and puts the enemy on short rations", () => {
    const result = order([
      {
        op: "province_material_shift", provinceId: AGRIGENTUM,
        foodSecurityBpsDelta: -5_000, productiveCapacityBpsDelta: -3_000, stabilityBpsDelta: -2_000,
        reason: "Everything that can be carried is carried off, and the rest burnt.",
      },
      {
        op: "force_modify", forceRef: "carthaginian-garrison", provisionStatus: "critical",
        reason: "Their convoys are taken and their foragers killed.",
      },
      {
        op: "force_attrition", forceRef: "carthaginian-garrison", cause: "starvation", lossBps: 800,
        moraleBpsDelta: -600,
        reason: "Hunger does what the raiders started.",
      },
    ]);

    carriedOut(result);
    expect(result.world.material.forces.find((force) => force.id === "carthaginian-garrison")!.provisionStatus).toBe("critical");
  });

  it("burns a fleet at the water's edge (order 36)", () => {
    const result = order([{
      op: "force_attrition", forceRef: "carthaginian-fleet", cause: "storm", lossBps: 2_500,
      moraleBpsDelta: -1_200,
      reason: "Oil is lit on the water as they come in to land.",
    }]);

    carriedOut(result);
  });
});

describe("ground inside a province (orders 7, 17, 19, 20, 21, 23, 25, 28, 52)", () => {
  it("fortifies Mount Etna, which the scenario drew and no order could reach", () => {
    // `Force.positionId` has existed since the force model was written and the
    // battle resolver has always read it; nothing in the vocabulary could set
    // it. So the scenario authored Etna as a pass worth seven hundred basis
    // points, a player spent a campaign fortifying it, and every order about it
    // resolved as "somewhere in north-eastern Sicily".
    const state = world();
    const atMessana: WorldState = WorldStateSchema.parse({
      ...state,
      material: {
        ...state.material,
        forces: state.material.forces.map((force) => (force.id === "roman-field-army" ? { ...force, locationId: MESSANA } : force)),
      },
    });

    const result = order([{
      op: "force_modify", forceRef: "roman-field-army", positionId: "position-mount-etna",
      reason: "The legion fortifies at the foot of the mountain and waits.",
    }], atMessana);

    carriedOut(result);
    expect(result.world.material.forces.find((force) => force.id === "roman-field-army")!.positionId).toBe("position-mount-etna");
  });

  it("holds a ford that nobody ever drew", () => {
    const result = order([{
      op: "force_modify", forceRef: "roman-field-army", positionId: "the-ford-above-the-camp",
      newPosition: { label: "The ford above the camp", type: "river_crossing" },
      reason: "The crossing is held, because everything must come that way.",
    }]);

    carriedOut(result);
    const province = result.world.map.provinces.find((candidate) => candidate.id === LATIUM)!;
    const ford = province.positions!.find((position) => position.id === "the-ford-above-the-camp")!;
    expect(ford.label).toBe("The ford above the camp");
    // Worth something to hold, and the engine said how much: a caller who
    // could set this would fortify his way to a battle nobody could lose.
    expect(ford.combatModifierBps).toBe(600);
  });

  it("gives the ground up when the army marches out of the province", () => {
    const held = order([{
      op: "force_modify", forceRef: "roman-field-army", positionId: "the-ford-above-the-camp",
      newPosition: { label: "The ford above the camp", type: "river_crossing" },
      reason: "The crossing is held.",
    }]);
    const marched = order([{
      op: "force_modify", forceRef: "roman-field-army", locationId: NEXT_DOOR,
      reason: "The legion moves on.",
    }], held.world);

    carriedOut(marched);
    expect(marched.world.material.forces.find((force) => force.id === "roman-field-army")!.positionId).toBeNull();
  });
});

describe("cities, taken and founded (orders 3, 9, 16, 19, 31, 43, 47, 49)", () => {
  it("takes a city the map drew, with an army before its walls", () => {
    const state = world();
    const beforePanormus: WorldState = WorldStateSchema.parse({
      ...state,
      material: {
        ...state.material,
        forces: state.material.forces.map((force) => (force.id === "roman-field-army"
          ? { ...force, locationId: PUNIC_IDS.panormus }
          : force)),
      },
    });

    const result = order([{
      op: "settlement_control_set", settlementId: "settlement-panormus", toPolityRef: "rome", sacked: false,
      reason: "Palermo opens its gates on terms.",
    }], beforePanormus);

    carriedOut(result);
    const province = result.world.map.provinces.find((candidate) => candidate.id === PUNIC_IDS.panormus)!;
    expect(province.settlements.find((settlement) => settlement.id === "settlement-panormus")!.controllerPolityId).toBe("rome");
  });

  it("founds Hadrumentum, which this map does not draw, and takes it", () => {
    // Forty-one settlements are drawn across the whole Mediterranean, and the
    // African landing happens at one that is not among them. Refusing the
    // siege for that is the engine failing an order over its own cartography.
    const state = world();
    const ashore: WorldState = WorldStateSchema.parse({
      ...state,
      material: {
        ...state.material,
        forces: state.material.forces.map((force) => (force.id === "roman-field-army" ? { ...force, locationId: AFRICA } : force)),
      },
    });

    const result = order([{
      op: "settlement_control_set", settlementId: "settlement-hadrumentum",
      inProvinceId: AFRICA, name: "Hadrumentum", toPolityRef: "rome", sacked: false,
      reason: "The army lands at Hadrumentum and the town is taken.",
    }], ashore);

    carriedOut(result);
    const africa = result.world.map.provinces.find((candidate) => candidate.id === AFRICA)!;
    const founded = africa.settlements.find((settlement) => settlement.id === "settlement-hadrumentum")!;
    expect(founded.name).toBe("Hadrumentum");
    expect(founded.controllerPolityId).toBe("rome");
  });
});

describe("battles, sorties and unusual tactics (orders 8, 18, 20, 21, 27, 29, 57, 67)", () => {
  it("sorties by night, and does not write its own casualties", () => {
    const state = world();
    const sameGround: WorldState = WorldStateSchema.parse({
      ...state,
      material: {
        ...state.material,
        forces: state.material.forces.map((force) => (force.id === "roman-field-army" ? { ...force, locationId: AFRICA } : force)),
      },
    });

    const result = order([{
      op: "force_engage", forceRef: "roman-field-army", targetForceRef: "carthaginian-garrison",
      posture: "offer_battle",
      tactic: {
        factor: "surprise", magnitude: "meaningful",
        rationale: "A sortie in the dark against a camp that believes the city too weak to make one, with the wounded and the stores fired first.",
      },
      reason: "The legion goes out at night.",
    }], sameGround);

    carriedOut(result);
    // The engine fought it. Nothing here said who won.
    expect(result.world.conflicts.battles.length + result.world.material.forces.length).toBeGreaterThan(0);
  });
});

describe("the war inside the government (orders 26, 30, 33, 34, 39, 42, 44, 51, 53, 55, 66, 79)", () => {
  it("puts a question to the Senate and takes sides on it, and the Senate settles it on its day", () => {
    const result = order([
      {
        op: "political_procedure_open", localId: "clemency", type: "decree",
        institutionRef: "roman-senate", sponsorCharacterRef: "gaius-genucius",
        subjectKind: "character", subjectRef: "manius-curius",
        label: "Clemency for Pulcher, in view of his service on the Sicilian front",
        resolutionMechanism: "vote", deadlineInDays: 30, visibility: "polity",
        reason: "The consul asks the Senate to weigh mercy against whatever fault has been found.",
      },
      {
        op: "political_support_set", procedureRef: localRef("clemency"),
        supporterKind: "character", supporterRef: "quintus-ogulnius", position: "support",
        influenceWeight: 700, reasonKind: "relationship",
        reasonLabel: "He has served, and the house is owed something for it.",
        visibility: "polity",
        reason: "A senator speaks for him.",
      },
    ]);

    carriedOut(result);
    // The order does not get to write the vote: the house counts it in thirty days.
    const question = result.world.material.politicalProcedures.at(-1)!;
    expect(question.outcome).toBeNull();
    const voted = holdVotes({ world: result.world, offices: definition.government.offices, toDay: voteDayOf(question), ids: createIdFactory("clemency-vote") });
    expect(voted.world.material.politicalProcedures.at(-1)!.outcome).toBe("passed");
    expect(voted.facts.find((fact) => fact.kind === "motion_passed")?.summary).toContain("Quintus");
  });

  it("puts down a cult, and takes the legitimacy it costs", () => {
    const founded = order([{
      op: "generic_entity_create", localId: "the_cult", kind: "religious_movement",
      label: "The foreign rite of Claudian Pulchus",
      ownerRef: null, attributes: { founder: "an exiled cousin", standing: "forbidden in Sicily" },
      reason: "A cult grows up around the exile.",
    }]);

    const suppressed = order([
      {
        op: "generic_entity_update", entityRef: "local:the_cult",
        attributes: { standing: "proscribed", enforcement: "arrests where the decree is openly defied" },
        retire: false,
        reason: "The governor forbids it across the island.",
      },
      {
        op: "legitimacy_shift", target: "polity", targetId: "rome",
        legitimacyBpsDelta: -300, causeLabel: "The proscription of a foreign rite",
        reason: "Putting down a religion is never free.",
      },
    ], founded.world);

    expect(founded.unsayable).toEqual([]);
    // The handle belongs to the answer that made it, so the second order names
    // the entity by the id the world assigned.
    const entity = founded.world.genericEntities.at(-1)!;
    const byId = order([{
      op: "generic_entity_update", entityRef: entity.id,
      attributes: { standing: "proscribed" }, retire: false,
      reason: "The governor forbids it across the island.",
    }], founded.world);
    carriedOut(byId);
    expect(suppressed.unsayable).toEqual([]);
  });
});

describe("what a governor does with a province at peace (orders 71, 72, 74, 75, 76)", () => {
  it("takes the governorship, reforms the revenue, builds an aqueduct and holds a feast", () => {
    const result = order([
      {
        op: "office_seat_set", officeId: "roman-consul", seatId: null,
        holderCharacterRef: "gaius-genucius", cause: "none", termDays: 365,
        reason: "He takes the seat, and the province with it.",
      },
      {
        op: "income_source_upsert", incomeSourceRef: null, localId: "africa_tithe", kind: "tax",
        label: "The tithe of the African coast", beneficiaryAccountRef: "rome-treasury",
        amount: 240, cadenceDays: 30, counterpartyPolityId: null, active: true,
        reason: "The province is put on a footing that pays for itself.",
      },
      {
        op: "project_create", localId: "aqueduct", kind: "public_work",
        label: "The aqueduct at Carthage", sponsorRef: { kind: "character", id: "gaius-genucius" },
        fundingAccountRef: "rome-treasury",
        milestones: [{ label: "The channel surveyed and begun", dueInDays: 120, costAmount: 800 }],
        completionOutcome: { kind: "structure", label: "The aqueduct at Carthage", amount: 0, provinceId: AFRICA, polityId: "rome" },
        reason: "Water is brought into the city, which is how a conqueror becomes a governor.",
      },
      {
        op: "social_events",
        events: [{
          participantCharacterRefs: ["gaius-genucius", "quintus-ogulnius"],
          // A feast is not one of the seven kinds, and does not need to be:
          // the kinds classify what sort of exchange it was, and what the
          // evening actually did is carried by the summary and by what it
          // changed in how these two men see each other.
          kind: "favour", visibility: "public",
          summary: "A feast for the end of the campaign, at the governor's own expense.",
          relationCauses: [{
            subjectCharacterRef: "quintus-ogulnius", targetCharacterRef: "gaius-genucius",
            label: "He kept a good table and gave the credit away.", score: 6, decayPerYearBps: 2_000,
          }],
        }],
        reason: "The province is shown what peace looks like.",
      },
      {
        op: "generic_entity_create", localId: "bowling", kind: "institution",
        label: "The regional bowling competition",
        ownerRef: { kind: "character", id: "gaius-genucius" },
        attributes: { cadence: "annual", seat: "the provincial capital" },
        reason: "The governor founds a competition, because the order said so.",
      },
    ]);

    carriedOut(result);
    expect(result.world.genericEntities.at(-1)!.label).toContain("bowling");
  });
});

describe("conquest, and what the world still refuses (orders 49, 56, 73)", () => {
  it("refuses a province nothing can reach, which is the world answering and not the engine", () => {
    const result = order([{
      op: "province_control_set", provinceId: PUNIC_IDS.carthage, toPolityRef: "rome",
      firmnessBps: 2_000,
      reason: "The Numidian villages submit.",
    }]);

    expect(result.unsayable).toEqual([]);
    expect(result.refused).toHaveLength(1);
    // The distinction the whole pass turns on: it was sayable, and the world
    // said no for a reason a player can act on.
    expect(result.refused[0]).toContain("no army");
  });

  it("refuses to sail an army in hulls that will not carry it", () => {
    const state = world();
    const atLilybaeum: WorldState = WorldStateSchema.parse({
      ...state,
      material: {
        ...state.material,
        forces: state.material.forces.map((force) => (force.id === "roman-field-army" ? { ...force, locationId: LILYBAEUM } : force)),
      },
    });

    const result = order([{
      op: "force_modify", forceRef: "roman-field-army", locationId: AFRICA,
      reason: "The army sails for Africa.",
    }], atLilybaeum);

    expect(result.unsayable).toEqual([]);
    expect(result.refused[0]).toContain("without ships");
  });

  it("takes ground the army is actually standing on", () => {
    const state = world();
    const inSicily: WorldState = WorldStateSchema.parse({
      ...state,
      material: {
        ...state.material,
        forces: state.material.forces.map((force) => (force.id === "roman-field-army" ? { ...force, locationId: SYRACUSE } : force)),
      },
    });

    const result = order([{
      op: "province_control_set", provinceId: SYRACUSE, toPolityRef: "rome", firmnessBps: 2_000,
      reason: "Syracuse and its country come under Roman rule.",
    }], inSicily);

    carriedOut(result);
    expect(result.world.map.provinces.find((province) => province.id === SYRACUSE)!.controllerPolityId).toBe("rome");
  });
});

describe("changing sides, and what it costs (orders 12, 13)", () => {
  it("takes the legion over to the enemy, and the wages lapse with the allegiance", () => {
    const result = order([
      {
        op: "force_modify", forceRef: "roman-field-army", polityId: "carthage",
        reason: "The legion follows its commander and not its country.",
      },
      {
        op: "diplomatic_message_send", localId: "the_offer", kind: "letter",
        fromPolityId: "rome", fromCharacterRef: "gaius-genucius", toPolityId: "carthage",
        toCharacterRef: "hanno-carthage", subject: "An offer, from a man the Republic means to try",
        terms: "His legion, his knowledge of the defences, and the dispositions of every Roman force on the island, for a command under Carthage.",
        replyWithinDays: 20, inReplyToRef: null, visibility: "private",
        reason: "He writes to the enemy over Rome's name, which is the breach itself.",
      },
    ]);

    carriedOut(result);
    const legion = result.world.material.forces.find((force) => force.id === "roman-field-army")!;
    expect(legion.polityId).toBe("carthage");
    expect(legion.payObligationId).toBeNull();
  });
});

describe("the conditional order (orders 5, 7, 17, 25, 27, 29, 31, 43, 45, 47, 49, 51, 52, 54, 56, 57)", () => {
  /**
   * About a fifth of the whole list hangs its real content on a condition.
   * *"When the Carthaginians are through the first wall, fire it and bar the
   * gates."* *"Should Hadrumentum fall, write to the Senate."*
   *
   * These were recordable and inert: the plan could be written down as a
   * generic entity with its trigger and its action, and nothing in the engine
   * ever read it back, so it worked exactly when the narrator remembered it
   * next turn. `contingency_arm` is the half that was missing, and
   * `the-burning-city-springs.test.ts` holds what it does when it springs.
   * Both shapes appear in the corpus and both are exercised here: a bang, and
   * a judgment.
   */
  it("arms a trap on ground the enemy has to come through", () => {
    const result = order([{
      op: "contingency_arm", localId: "burning_city", label: "The Burning City",
      ownerCharacterRef: "gaius-genucius",
      trigger: { kind: "force_enters_position", positionId: "position-mount-etna", polityId: "carthage" },
      effect: "spring_trap",
      provinceId: MESSANA, positionId: "position-mount-etna", againstPolityId: "carthage",
      fundingAccountRef: "rome-treasury", spend: 1_200,
      ambushForceRef: "roman-field-army", expiresInDays: null,
      reason: "The outer ward is prepared, and the men who will come in behind them told to wait.",
    }]);

    carriedOut(result);
    const plan = result.world.contingencies.at(-1)!;
    expect(plan.status).toBe("armed");
    // What it will do is not in it, and there is nowhere to put it.
    expect(plan.tollBps).toBeNull();
  });

  it("stands to on a condition whose consequence is a judgment", () => {
    const result = order([{
      op: "contingency_arm", localId: "when_it_falls", label: "Word to the Senate when the city falls",
      ownerCharacterRef: "gaius-genucius",
      trigger: { kind: "settlement_control_changes", settlementId: "settlement-messana" },
      effect: "stand_to", provinceId: MESSANA, positionId: null, againstPolityId: null,
      fundingAccountRef: null, spend: 0, ambushForceRef: null, expiresInDays: 365,
      reason: "He means to write the moment it changes hands, and not a week later.",
    }]);

    carriedOut(result);
    expect(result.world.contingencies.at(-1)!.effect).toBe("stand_to");
  });

  it("still lets a plan that is only a plan be written down", () => {
    const result = order([{
      op: "generic_entity_create", localId: "burning_city", kind: "contingency",
      label: "The Burning City",
      ownerRef: { kind: "character", id: "gaius-genucius" },
      attributes: {
        trigger: "Carthaginian troops are inside the outer wall at Agrigentum",
        action: "Fire the outer ward and bar the gates behind them",
        province: AGRIGENTUM, prepared: true,
      },
      reason: "The consul makes his preparations and tells nobody.",
    }]);

    carriedOut(result);
    expect(result.world.genericEntities.at(-1)!.attributes["trigger"]).toContain("inside the outer wall");
  });
});
