import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  CharacterKnowledgebaseSchema,
  EstablishmentSchema,
  ScenarioDefinitionSchema,
  WorldStateSchema,
  formArmies,
  materializePlayerCharacter,
  pluralOf,
  readService,
  standingEffectiveStrength,
  warfareWith,
  type CharacterKnowledgebase,
  type Doctrine,
  type Force,
  type MilitaryEstablishment,
  type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { bandedShift } from "./apply/army-practice";
import { resolveEngagement } from "./battle";
import { carryOutMilitaryReform } from "./military-reform";
import { createIdFactory } from "./ports";
import { keepTheRanks } from "./ranks";

/**
 * Armies in detail (docs/plans/armies-in-detail.md): a power's establishment
 * draws its armies up, the battle reads their lines, drill and doctrine make
 * them better, a man in the ranks has a place in them, and a law can remake
 * them. Written against an establishment of its own, so it tests the engine
 * and not the scenario's numbers.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const government = definition.government;
const PLAYER = "declared-soldier";

/** Rome's manipular legion and its allies' ala, as Polybius gives them. */
const ROME: MilitaryEstablishment = EstablishmentSchema.parse({
  polityId: "rome",
  label: "The manipular legion",
  bodies: [
    { id: "legion", label: "Legion", naming: "Legio {n}", numerals: "roman", source: "citizen", isDefault: true, matches: ["legion", "legionar", "roman"], formationIds: ["velites", "hastati", "principes", "triarii", "equites"] },
    { id: "ala", label: "Ala", naming: "{n} Ala of the allies", numerals: "ordinal", source: "ally", matches: ["allied", "ally", "socii"], formationIds: ["ala-foot", "ala-horse"] },
  ],
  formations: [
    { id: "velites", label: "Velites", categoryId: "infantry", line: "screen", men: 1_200, units: { label: "band", count: 10 } },
    { id: "hastati", label: "Hastati", categoryId: "infantry", line: "first", men: 1_200, units: { label: "maniple", count: 10, sub: { label: "century", count: 2 } } },
    { id: "principes", label: "Principes", categoryId: "infantry", line: "second", men: 1_200, units: { label: "maniple", count: 10, sub: { label: "century", count: 2 } } },
    { id: "triarii", label: "Triarii", categoryId: "infantry", line: "third", men: 600, units: { label: "maniple", count: 10, sub: { label: "century", count: 2 } } },
    { id: "equites", label: "Equites", categoryId: "cavalry", line: "wing", men: 300, units: { label: "turma", count: 10 } },
    { id: "ala-foot", label: "Allied foot", categoryId: "infantry", line: "first", men: 4_200, units: { label: "cohort", size: 420 } },
    { id: "ala-horse", label: "Allied horse", categoryId: "cavalry", line: "wing", men: 900, units: { label: "turma", size: 30 } },
  ],
  ranks: [
    { id: "miles", label: "legionary", level: "ranks", words: ["legionary", "soldier"] },
    { id: "optio", label: "optio", level: "sub", words: ["optio"] },
    { id: "centurion", label: "centurion", level: "unit", grade: 1, words: ["centurion"] },
    { id: "tribune", label: "military tribune", level: "body", filledBy: "elected", words: ["tribune"] },
    { id: "consul", label: "consul", level: "army", filledBy: "elected", words: ["consul"], officeIds: ["roman-consul"] },
  ],
  honours: [
    { id: "civic-crown", label: "civic crown", kind: "decoration", for: "saving_a_comrade", standing: "great" },
    { id: "phalerae", label: "phalerae", kind: "decoration", for: "valour", standing: "marked" },
    { id: "barley", label: "barley ration", kind: "punishment", for: "flight", standing: "slight" },
  ],
  recruitment: { basis: "property_class", floor: "low" },
  serviceCampaigns: { foot: 16, horse: 10 },
  campaignsForOffice: 10,
});

const TRIPLEX: Doctrine = {
  id: "rome-triplex-acies", label: "Triplex acies", description: "Three lines, the tired relieved by the fresh.", origin: "scenario", polityId: "rome",
  appliesTo: { lines: ["first", "second", "third"] }, effects: [{ lever: "line_relief", direction: "raise", band: "marked" }],
  upkeepAccountId: null, adoptedAtStep: 0, adoptedByCharacterId: null, forceId: null, settledThroughStep: null, lapsedAtStep: null,
};

/** The opening world with only this test's Rome drawn up: other powers' establishments are not this test's business. */
function drawnUp(): WorldState {
  const world = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
  // Rome's opening army as rows the establishment has not yet drawn up.
  const flat: WorldState = {
    ...world,
    establishments: [{ ...ROME, doctrineIds: [TRIPLEX.id] }],
    doctrines: [TRIPLEX],
    material: {
      ...world.material,
      forces: world.material.forces.map((force) => (force.id === "roman-field-army"
        ? { ...force, formations: [], posts: [], personnel: [
          { categoryId: "infantry", label: "Legionaries", fit: 4_200, unavailable: [] },
          { categoryId: "cavalry", label: "Roman horse", fit: 300, unavailable: [] },
          { categoryId: "infantry", label: "Allied infantry", fit: 3_600, unavailable: [] },
        ] }
        : { ...force, formations: [], posts: [], personnel: force.personnel.map(({ formationId: _gone, ...row }) => row) })),
    },
  };
  return WorldStateSchema.parse(formArmies(flat, 0));
}

const forceOf = (world: WorldState, id: string): Force => world.material.forces.find((force) => force.id === id)!;
const rowOf = (force: Force, templateId: string) => {
  const formation = force.formations!.find((candidate) => candidate.templateId === templateId)!;
  return force.personnel.find((row) => row.formationId === formation.id)!;
};

const context = (characterId: string): ApplyContext => ({
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: characterId },
  offices: government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory(`armies-${characterId}`),
  gameId: "game-1",
});

function declared(role: string): CharacterKnowledgebase {
  return CharacterKnowledgebaseSchema.parse({
    version: 1, characterId: PLAYER, gameId: "game-under-test", canonicalName: "Titus Vettius",
    nickname: null, birthYearApprox: -295, deathYearApprox: null, origin: "invented", period: "270 BCE",
    locationProvinceId: PUNIC_IDS.rome, culture: "Roman", faith: null,
    biography: "A farmer's son of the Sabine hills, levied for the year.", notableEvents: [],
    role, authority: [], socioEconomicClass: "Plebeian", startingMoney: 40,
    skills: { martial: 45, intrigue: 20, learning: 15, piety: 40, stewardship: 20, diplomacy: 20, body: 60, subSkills: {} },
    skillRationale: {},
    relations: [
      { name: "Vettia", relationship: "mother", historical: false, notes: "Keeps the farm.", kind: "person", category: "family", familyRole: "parent" },
      { name: "Gnaeus Vettius", relationship: "brother", historical: false, notes: "Too young for the levy.", kind: "person", category: "family", familyRole: "sibling" },
      { name: "Aulus", relationship: "friend", historical: false, notes: "From the next farm.", kind: "person", category: "other", familyRole: null },
      { name: "Publius", relationship: "creditor", historical: false, notes: "Lent him for his kit.", kind: "person", category: "other", familyRole: null },
    ],
    confirmedByPlayer: true, confirmationDraft: null,
  });
}

describe("armies drawn up by their establishment", () => {
  it("draws Rome's men up as a legion of three lines, its horse, and the allies in their own ala", () => {
    const army = forceOf(drawnUp(), "roman-field-army");
    expect(army.personnel.every((row) => row.formationId !== undefined)).toBe(true);
    const labels = army.formations!.map((formation) => `${formation.bodyLabel}:${formation.templateId}`);
    expect(labels).toEqual(expect.arrayContaining(["Legio I:velites", "Legio I:hastati", "Legio I:principes", "Legio I:triarii", "Legio I:equites", "first Ala of the allies:ala-foot"]));
    // The men are all still there: forming moves nobody in or out.
    expect(army.personnel.reduce((sum, row) => sum + row.fit, 0)).toBe(4_200 + 300 + 3_600);
    // Polybius' proportions: as many hastati as principes, half as many triarii.
    expect(rowOf(army, "hastati").fit).toBe(rowOf(army, "principes").fit);
    expect(rowOf(army, "triarii").fit).toBe(rowOf(army, "hastati").fit / 2);
  });

  it("numbers the next legion on from the last, and tops up the one it has before raising another", () => {
    const world = drawnUp();
    const topped = formArmies({
      ...world,
      material: { ...world.material, forces: world.material.forces.map((force) => (force.id === "roman-field-army"
        ? { ...force, personnel: [...force.personnel, { categoryId: "infantry", label: "Legionaries", fit: 4_500, unavailable: [] }, { categoryId: "infantry", label: "Legionaries", fit: 400, unavailable: [] }] }
        : force)) },
    }, 10);
    const bodies = new Set(forceOf(topped, "roman-field-army").formations!.map((formation) => formation.bodyLabel));
    expect(bodies.has("Legio II")).toBe(true);
    expect(bodies.has("Legio III")).toBe(false);
  });

  it("is idempotent: an army already drawn up is left as it is", () => {
    const world = drawnUp();
    expect(formArmies(world, 5)).toBe(world);
  });
});

describe("an army's words", () => {
  it("makes its plurals the way its own language did", () => {
    expect(pluralOf("turma")).toBe("turmae");
    expect(pluralOf("syntagma")).toBe("syntagmata");
    expect(pluralOf("hipparchy")).toBe("hipparchies");
    expect(pluralOf("phalanx")).toBe("phalanxes");
    expect(pluralOf("ala of the allies")).toBe("alae of the allies");
    expect(pluralOf("maniple")).toBe("maniples");
  });
});

describe("the battle reads the lines", () => {
  it("bleeds the first line more than the third", () => {
    const world = drawnUp();
    const roman = { ...forceOf(world, "roman-field-army"), locationId: PUNIC_IDS.messana };
    const placed = { ...world, material: { ...world.material, forces: world.material.forces.map((force) => (force.id === roman.id ? roman : force.id === "carthaginian-garrison" ? { ...force, locationId: PUNIC_IDS.messana } : force)) } };
    const fought = resolveEngagement({
      world: placed, attacker: forceOf(placed, "carthaginian-garrison"), defender: forceOf(placed, roman.id),
      posture: "offer_battle", tactic: null, warfare: definition.warfare, battleId: "battle-lines", seed: "lines",
    }, 0).world;
    const before = forceOf(placed, roman.id);
    const after = forceOf(fought, roman.id);
    const lossRate = (templateId: string) => {
      const was = rowOf(before, templateId);
      const now = rowOf(after, templateId);
      return (was.fit - now.fit) / was.fit;
    };
    expect(lossRate("hastati")).toBeGreaterThan(lossRate("triarii"));
  });

  it("makes drilled, seasoned men worth more per head, but never more than a quarter more", () => {
    const world = drawnUp();
    const rules = warfareWith(world, definition.warfare);
    const raw = forceOf(world, "roman-field-army");
    const veteran: Force = { ...raw, formations: raw.formations!.map((formation) => ({ ...formation, trainingBps: 10_000, experienceBps: 10_000 })) };
    const stacked: WorldState = {
      ...world,
      doctrines: [...world.doctrines, { ...TRIPLEX, id: "rome-push", label: "The push", appliesTo: undefined, effects: [{ lever: "frontal_weight", direction: "raise", band: "great" }] }],
      establishments: world.establishments.map((establishment) => ({ ...establishment, doctrineIds: [...establishment.doctrineIds, "rome-push"] })),
    };
    const base = standingEffectiveStrength(raw, rules);
    const better = standingEffectiveStrength(veteran, rules);
    const capped = standingEffectiveStrength(veteran, warfareWith(stacked, definition.warfare));
    expect(better).toBeGreaterThan(base);
    expect(capped / base).toBeLessThanOrEqual(1.25 + 1e-9);
  });
});

describe("drill", () => {
  it("makes men better each day they drill in camp, paid and fed, and not at all otherwise", () => {
    const world = drawnUp();
    const ready = (drilling: boolean): WorldState => ({
      ...world,
      material: { ...world.material, forces: world.material.forces.map((force) => (force.id === "roman-field-army" ? { ...force, drilling, reckonedToStep: 0 } : force)) },
    });
    const after = (start: WorldState) => keepTheRanks({ world: start, toDay: 30, warfare: definition.warfare, ids: createIdFactory("drill"), playerCharacterId: null }).world;
    const trainingOf = (state: WorldState) => forceOf(state, "roman-field-army").formations!.find((formation) => formation.templateId === "hastati")!.trainingBps;
    expect(trainingOf(after(ready(true)))).toBeGreaterThan(trainingOf(world));
    expect(trainingOf(after(ready(false)))).toBe(trainingOf(world));
  });

  it("reads an order to rouse the men by its size, not its figure", () => {
    expect(bandedShift(9_999)).toBe(2_000);
    expect(bandedShift(300)).toBe(500);
    expect(bandedShift(-1_500)).toBe(-1_200);
  });
});

describe("a man in the ranks", () => {
  it("is put in a unit, with a named officer over him and named men beside him", () => {
    const world = materializePlayerCharacter(drawnUp(), PLAYER, declared("Legionary of the Roman army, a spearman of the hastati"), government);
    const service = readService(world, PLAYER);
    expect(service).not.toBeNull();
    expect(service!.formationLabel).toBe("Hastati");
    expect(service!.unitLabel).toMatch(/maniple/u);
    expect(service!.officers.some((officer) => officer.rank === "centurion")).toBe(true);
    expect(service!.comrades.length).toBeGreaterThanOrEqual(3);
  });

  it("is not made consul for serving in the consul's army, nor anything an office makes a man", () => {
    // Found by hand-play: "a legionary of the hastati in the consul's army" was made Consul.
    const world = materializePlayerCharacter(drawnUp(), PLAYER, declared("A legionary of the hastati in the consul's army"), government);
    const service = readService(world, PLAYER)!;
    expect(service.rank).toBe("legionary");
    expect(service.unitLabel).not.toBeNull();
  });

  it("chooses how he means to bear himself in the next battle", () => {
    const world = materializePlayerCharacter(drawnUp(), PLAYER, declared("Legionary of the Roman army"), government);
    const result = applyDeltas(world, [{ op: "force_membership_set", characterRef: PLAYER, forceRef: "roman-field-army", change: "conduct", conduct: "glory", reason: "He means to be seen." }], context(PLAYER));
    expect(result.rejected).toEqual([]);
    expect(result.world.characters.find((character) => character.id === PLAYER)?.service?.conduct).toBe("glory");
  });

  it("lets a centurion drill his own formation without the army's commander, and nobody else's", () => {
    const world = materializePlayerCharacter(drawnUp(), PLAYER, declared("A centurion of the hastati"), government);
    const service = world.characters.find((character) => character.id === PLAYER)!.service!;
    const drill = { op: "force_modify" as const, forceRef: "roman-field-army", formationRef: service.formationId!, drilling: true, reason: "He drills his men." };
    const result = applyDeltas(world, [drill], context(PLAYER));
    expect(result.rejected).toEqual([]);
    expect(result.breaches).toEqual([]);
    const formation = forceOf(result.world, "roman-field-army").formations!.find((candidate) => candidate.id === service.formationId)!;
    expect(formation.drilling).toBe(true);
    // The whole army is not his to order.
    const overreach = applyDeltas(world, [{ op: "force_modify", forceRef: "roman-field-army", drilling: true, reason: "He drills the army." }], context(PLAYER));
    expect(overreach.breaches.length + overreach.rejected.length).toBeGreaterThan(0);
  });
});

describe("a man in the ranks in battle", () => {
  it("is reported where he stood, counts the battle, and is sometimes decorated for seeking glory", () => {
    const declaredWorld = materializePlayerCharacter(drawnUp(), PLAYER, declared("A legionary of the hastati in the consul's army"), government);
    const bold = {
      ...declaredWorld,
      characters: declaredWorld.characters.map((character) => (character.id === PLAYER && character.service !== undefined ? { ...character, service: { ...character.service, conduct: "glory" as const } } : character)),
      material: { ...declaredWorld.material, forces: declaredWorld.material.forces.map((force) => (force.id === "roman-field-army" || force.id === "carthaginian-garrison" ? { ...force, locationId: PUNIC_IDS.messana } : force)) },
    };
    const outcomes = ["a", "b", "c", "d", "e", "f", "g", "h"].map((seed) => resolveEngagement({
      world: bold, attacker: forceOf(bold, "roman-field-army"), defender: forceOf(bold, "carthaginian-garrison"),
      posture: "offer_battle", tactic: null, warfare: definition.warfare, battleId: `battle-glory-${seed}`, seed, playerCharacterId: PLAYER,
    }, 0));
    for (const outcome of outcomes) {
      const him = outcome.account!.members.find((member) => member.name === "Titus Vettius")!;
      expect(him.place).toMatch(/Hastati of Legio I, in the first line; they lost \d+ dead/u);
      const after = outcome.world.characters.find((character) => character.id === PLAYER)!;
      if (after.alive) expect(after.service?.battles).toBe(1);
    }
    // Seeking glory is rewarded, some days.
    expect(outcomes.some((outcome) => (outcome.world.characters.find((character) => character.id === PLAYER)?.service?.decorations.length ?? 0) > 0)).toBe(true);
  });
});

describe("a law remakes the army", () => {
  it("redraws the legion's maniples as cohorts, keeps the men and their years, and refits them", () => {
    const world = materializePlayerCharacter(drawnUp(), PLAYER, declared("Legionary of the Roman army"), government);
    const before = forceOf(world, "roman-field-army");
    const infantryBefore = before.personnel.filter((row) => row.categoryId === "infantry").reduce((sum, row) => sum + row.fit, 0);
    const { world: after, said } = carryOutMilitaryReform(world, "rome", {
      recruit: "volunteers", stateArms: true, campaigns: 20, discharge: "land",
      redraw: { bodyId: "legion", formations: [{ label: "Cohorts", kind: "infantry", line: "first", men: 4_800, unit: "cohort", size: 480 }] },
      adopt: [{ label: "Gladiatorial drill", description: "Drill-masters from the gladiator schools teach the recruits.", effects: [{ lever: "drill_ceiling", direction: "raise", band: "marked" }, { lever: "levy_cost", direction: "raise", band: "slight" }] }],
    }, 100, null, "procedure-marius");
    const army = forceOf(after, "roman-field-army");
    const establishment = after.establishments.find((candidate) => candidate.polityId === "rome")!;
    expect(establishment.recruitment.basis).toBe("volunteers");
    expect(establishment.equipment).toBe("state");
    expect(establishment.discharge).toBe("land");
    expect(said.length).toBeGreaterThan(3);
    // The legion's foot are now cohorts; its horse, which the new order has no place for, stay as they were.
    const legion = army.formations!.filter((formation) => formation.bodyLabel === "Legio I");
    expect(legion.some((formation) => formation.templateId.includes("cohorts"))).toBe(true);
    expect(legion.some((formation) => formation.templateId === "equites")).toBe(true);
    expect(legion.some((formation) => formation.templateId === "hastati")).toBe(false);
    expect(army.personnel.filter((row) => row.categoryId === "infantry").reduce((sum, row) => sum + row.fit, 0)).toBe(infantryBefore);
    expect(legion.find((formation) => formation.templateId.includes("cohorts"))!.refitUntilStep).toBeGreaterThan(100);
    // And the soldier with them.
    expect(readService(after, PLAYER)?.formationLabel).toBe("Cohorts");
  });

  it("lets a doctrine nobody can pay for fall into disuse", () => {
    const world = drawnUp();
    const costly: Doctrine = { ...TRIPLEX, id: "rome-costly", label: "Costly drill", origin: "reform", effects: [{ lever: "frontal_weight", direction: "raise", band: "great" }], upkeepAccountId: "rome-treasury", adoptedAtStep: 0 };
    const broke: WorldState = {
      ...world,
      doctrines: [...world.doctrines, costly],
      establishments: world.establishments.map((establishment) => ({ ...establishment, doctrineIds: [...establishment.doctrineIds, costly.id] })),
      material: { ...world.material, accounts: world.material.accounts.map((account) => (account.id === "rome-treasury" ? { ...account, balance: 0 } : account)) },
    };
    const after = keepTheRanks({ world: broke, toDay: 31, warfare: definition.warfare, ids: createIdFactory("upkeep"), playerCharacterId: null });
    expect(after.world.doctrines.find((doctrine) => doctrine.id === costly.id)?.lapsedAtStep).toBe(31);
    expect(after.facts.some((fact) => fact.kind === "doctrine_lapsed")).toBe(true);
  });
});
