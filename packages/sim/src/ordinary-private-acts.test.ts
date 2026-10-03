import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  CharacterKnowledgebaseSchema,
  ScenarioDefinitionSchema,
  WorldDeltaSchema,
  WorldStateSchema,
  materializePlayerCharacter,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { misfiledWorldActs } from "./apply/misfiled";
import { describeBreach } from "./oversight";
import { createIdFactory } from "./ports";

/**
 * Ordinary private acts are not breaches (E12, M4, M5).
 *
 * The play-test's record of a legionary, a military tribune and a candidate
 * filled with insubordination they never committed: "gave orders to Roman
 * field army" for drilling with his comrades, "made Gaius Vibius an officer of
 * the government" for writing him a letter, "laid hands on Samnium's own
 * stores and people" for a consequence the world wrote, and "put a question
 * to a body he had no standing to put it to" for standing for office.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const PLAYER = "a-private-man";
const opening = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

function declare(role: string, socioEconomicClass = "Plebeian"): WorldState {
  return materializePlayerCharacter(opening(), PLAYER, CharacterKnowledgebaseSchema.parse({
    version: 1, characterId: PLAYER, gameId: "game-private", canonicalName: "Titus Vettius", nickname: null, birthYearApprox: -298, deathYearApprox: null,
    origin: "invented", period: "270 BCE", locationProvinceId: PUNIC_IDS.rome, culture: "Roman", faith: null,
    biography: `A Roman of the year 270 before Christ, whose station is this: ${role}.`, notableEvents: [], role, authority: [], socioEconomicClass, startingMoney: 100, ageYearsAtOpening: 30,
    skills: { martial: 50, intrigue: 30, learning: 30, piety: 40, stewardship: 30, diplomacy: 40, body: 60, subSkills: {} }, skillRationale: {},
    relations: [
      { name: "Vettia", relationship: "mother", historical: false, notes: "Keeps the farm.", kind: "person", category: "family", familyRole: "parent" },
      ...[1, 2, 3].map((n) => ({ name: `Friend ${n}`, relationship: "friend", historical: false, notes: "An old friend.", kind: "person", category: "other", familyRole: null })),
    ],
    confirmedByPlayer: true, confirmationDraft: null,
  }), definition.government);
}

/** As the orchestrator's answer is applied: the world speaking, the order's own acts named. */
const order = (world: WorldState, raws: readonly Record<string, unknown>[], ofTheOrder = true) => {
  const deltas: WorldDelta[] = raws.map((raw) => WorldDeltaSchema.parse(raw));
  return applyDeltas(world, deltas, {
    now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: PLAYER }, offices, successionRules: definition.government.successionRules,
    warfare: definition.warfare, ids: createIdFactory("private"), gameId: "game-private", playerCharacterId: PLAYER, actsForTheWorld: true,
    orderDeltas: new Set(ofTheOrder ? deltas : []),
  });
};
const sentences = (world: WorldState, breaches: readonly { delta: WorldDelta }[]) => breaches.map((breach) => describeBreach(breach.delta, world, "Titus Vettius"));
const army = (world: WorldState) => world.material.forces.find((force) => force.id === "roman-field-army")!;

describe("a legionary drilling with his comrades", () => {
  it("is his own business, and drills his own maniple, not the army", () => {
    const world = declare("Legionary of the Roman army, a spearman of the hastati");
    const service = world.characters.find((character) => character.id === PLAYER)!.service!;
    for (const raw of [
      { op: "force_modify", forceRef: "roman-field-army", formationRef: service.formationId, drilling: true, reason: "He drills with his comrades." },
      { op: "force_modify", forceRef: "roman-field-army", drilling: true, reason: "He drills." },
    ]) {
      const result = order(world, [raw]);
      expect(sentences(result.world, result.breaches)).not.toContain("Titus Vettius gave orders to Roman field army");
      expect(result.breaches).toEqual([]);
      expect(result.rejected).toEqual([]);
      const drilled = army(result.world);
      expect(drilled.drilling).not.toBe(true);
      const formation = drilled.formations!.find((candidate) => candidate.id === service.formationId)!;
      expect(formation.drilling).not.toBe(true);
      expect(formation.units.find((unit) => unit.index === service.unitIndex)?.drilling).toBe(true);
    }
  });

  it("cannot set the whole army drilling from no post and no place in it (M4)", () => {
    const senator = declare("Roman senator", "Patrician");
    const result = order(senator, [{ op: "force_modify", forceRef: "roman-field-army", drilling: true, reason: "He orders the army to drill." }]);
    expect(result.applied).toHaveLength(0);
    expect(result.rejected[0]!.reason).toMatch(/Roman field army/);
    expect(army(result.world).drilling).not.toBe(true);
  });
});

describe("writing to a man the world had not yet named", () => {
  it("makes him without making anybody an officer of the government", () => {
    const world = declare("A military tribune of the Roman army", "Equestrian");
    const result = order(world, [
      { op: "character_create", localId: "vibius", name: "Gaius Vibius", polityId: "rome", provinceId: PUNIC_IDS.rome, age: 40, officeLabel: null, officeAuthorises: [], traits: [], standing: "a landowner of Capua", wealth: 200, generatedBecause: "The man the letter is to." },
      { op: "diplomatic_message_send", localId: "letter", kind: "letter", fromPolityId: "rome", toPolityId: "rome", fromCharacterRef: PLAYER, toCharacterRef: "local:vibius", subject: "Greetings", terms: "I write to an old friend.", reason: "Friendship." },
    ]);
    expect(result.rejected.filter((rejection) => rejection.delta.op === "character_create")).toEqual([]);
    expect(sentences(result.world, result.breaches)).not.toContain("Titus Vettius made Gaius Vibius an officer of the government");
    expect(result.breaches.filter((breach) => breach.delta.op === "character_create")).toEqual([]);
  });

  it("finds the man he meant when he already lives, and changes nothing", () => {
    const world = declare("A military tribune of the Roman army", "Equestrian");
    const ogulnius = world.characters.find((character) => character.id === "quintus-ogulnius")!;
    const result = order(world, [{ op: "character_create", localId: "og", name: ogulnius.name, polityId: "rome", provinceId: PUNIC_IDS.rome, age: 47, officeLabel: "Roman consul", officeAuthorises: [], traits: [], standing: null, wealth: 0, generatedBecause: "Named in the letter." }]);
    expect(result.applied[0]!.changed).toBe(false);
    expect(result.breaches).toEqual([]);
    expect(result.world.characters.length).toBe(world.characters.length);
  });

  it("makes a man named to an office not his to give, holding nothing (M5)", () => {
    const world = declare("A military tribune of the Roman army", "Equestrian");
    const consulsBefore = world.material.officeSeats.filter((seat) => seat.officeId === "roman-consul" && seat.status === "held").map((seat) => seat.holderCharacterId);
    const result = order(world, [{ op: "character_create", localId: "vibius", name: "Gaius Vibius Rufus", polityId: "rome", provinceId: PUNIC_IDS.rome, age: 40, officeLabel: "Roman consul", officeAuthorises: [], traits: [], standing: null, wealth: 0, generatedBecause: "Named consul in the letter." }]);
    const made = result.world.characters.find((character) => character.name === "Gaius Vibius Rufus");
    expect(made).toBeDefined();
    expect(result.world.material.officeSeats.some((seat) => seat.holderCharacterId === made!.id && seat.status === "held")).toBe(false);
    expect(result.world.material.officeSeats.filter((seat) => seat.officeId === "roman-consul" && seat.status === "held").map((seat) => seat.holderCharacterId)).toEqual(consulsBefore);
    expect(result.breaches).toEqual([]);
    expect(result.factProposals.find((fact) => fact.kind === "office_not_given")?.summary).toMatch(/Gaius Vibius Rufus is no Roman consul: Roman consul is chosen by election/);
  });
});

describe("what befell a province he has nothing to do with", () => {
  it("is the world's account, not his act", () => {
    const world = declare("A military tribune of the Roman army", "Equestrian");
    const samnium = world.map.provinces.find((province) => /samni/i.test(province.name))!;
    const shift = WorldDeltaSchema.parse({ op: "province_material_shift", provinceId: samnium.id, foodSecurityBpsDelta: -400, reason: "The levy drained its granaries." });
    const misfiled = misfiledWorldActs([shift], world, { kind: "character", id: PLAYER }, offices);
    expect(misfiled.has(shift)).toBe(true);
    // Applied as the world's (not of the order), it is nobody's breach.
    const result = order(world, [shift], false);
    expect(sentences(result.world, result.breaches)).not.toContain(`Titus Vettius laid hands on ${samnium.name}'s own stores and people`);
    expect(result.breaches).toEqual([]);
    // His own army standing there makes it his.
    const there: WorldState = { ...world, material: { ...world.material, forces: world.material.forces.map((force) => (force.id === "roman-field-army" ? { ...force, locationId: samnium.id, commanderCharacterId: PLAYER } : force)) } };
    expect(misfiledWorldActs([shift], there, { kind: "character", id: PLAYER }, offices).has(shift)).toBe(false);
  });
});

describe("standing for office", () => {
  it("is his own candidacy, not a question he had no standing to put", () => {
    const world = declare("A military tribune of the Roman army", "Equestrian");
    const result = order(world, [{
      op: "political_procedure_open", localId: "stand", type: "nomination", institutionRef: "roman-comitia-centuriata", sponsorCharacterRef: PLAYER,
      subjectKind: "character", subjectRef: PLAYER, label: "Titus Vettius stands for Roman praetor", resolutionMechanism: "vote", deadlineInDays: 30, reason: "He stands.",
    }]);
    expect(result.applied).toHaveLength(1);
    expect(sentences(result.world, result.breaches)).not.toContain("Titus Vettius put a question to a body he had no standing to put it to");
    expect(result.breaches).toEqual([]);
  });
});
