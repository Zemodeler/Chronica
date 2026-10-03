import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  CharacterKnowledgebaseSchema,
  ScenarioDefinitionSchema,
  WorldStateSchema,
  buildStation,
  materializePlayerCharacter,
  type Character,
  type CharacterKnowledgebase,
  type Force,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { resolveEngagement } from "./battle";
import { killCharacter } from "./mortality";
import { createIdFactory } from "./ports";
import { routeAttention } from "./attention";
import { materializeFacts } from "./facts";

/**
 * "I am a legionary in the consul's army."
 *
 * A force was a commander and headcounts, so a man could command an army or be
 * nowhere in it. A player who declared himself a soldier was handed four
 * hundred retainers and made their commander; only commanders rolled for
 * their fate in battle; nobody near him had any reason to notice him; and
 * there was nothing to desert. Now he serves in an army's ranks, shares its
 * fortune in the field by a roll of his own, sees it as his own business, is
 * noticed by the men beside him, and can walk away -- which his commander hears of.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const government = definition.government;
const PLAYER = "declared-legionary";
const LATIUM = PUNIC_IDS.rome;
const MESSANA = PUNIC_IDS.messana;

const opening = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

function declared(role: string, overrides: Partial<CharacterKnowledgebase> = {}): CharacterKnowledgebase {
  return CharacterKnowledgebaseSchema.parse({
    version: 1, characterId: PLAYER, gameId: "game-under-test", canonicalName: "Titus Vettius",
    nickname: null, birthYearApprox: -295, deathYearApprox: null, origin: "invented", period: "270 BCE",
    locationProvinceId: LATIUM, culture: "Roman", faith: null,
    biography: "A farmer's son of the Sabine hills, levied for the year.", notableEvents: [],
    role, authority: [], socioEconomicClass: "Plebeian", startingMoney: 40,
    skills: { martial: 45, intrigue: 20, learning: 15, piety: 40, stewardship: 20, diplomacy: 20, body: 60, subSkills: {} },
    skillRationale: {},
    relations: [
      { name: "Vettia", relationship: "mother", historical: false, notes: "Keeps the farm.", kind: "person", category: "family", familyRole: "parent" },
      { name: "Gnaeus Vettius", relationship: "brother", historical: false, notes: "Too young for the levy.", kind: "person", category: "family", familyRole: "sibling" },
      { name: "Aulus", relationship: "tent-mate", historical: false, notes: "Serves beside him.", kind: "person", category: "other", familyRole: null },
      { name: "The centurion", relationship: "his officer", historical: false, notes: "Hard, but fair.", kind: "person", category: "other", familyRole: null },
    ],
    confirmedByPlayer: true, confirmationDraft: null,
    ...overrides,
  });
}

const context = (characterId: string): ApplyContext => ({
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: characterId },
  offices: government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory(`ranks-${characterId}`),
  gameId: "game-1",
});

const forceOf = (world: WorldState, id: string): Force => world.material.forces.find((force) => force.id === id)!;

/** Forty named men in the Mamertine garrison, so a battle's losses fall on some of them. */
function aGarrisonOfNamedMen(): WorldState {
  const world = opening();
  const template = world.characters.find((character) => character.id === "mamertine-spokesman")!;
  const men: Character[] = Array.from({ length: 40 }, (_, index) => ({
    ...template,
    id: `mamertine-soldier-${index}`,
    name: `Mamertine soldier ${index}`,
    officeId: null,
    personalAccountId: `mamertine-soldier-${index}-purse`,
    heirCharacterId: null,
    relations: [],
    ambitions: [],
    mind: { ...template.mind, currentPressures: [] },
  }));
  return {
    ...world,
    characters: [...world.characters, ...men],
    material: {
      ...world.material,
      forces: world.material.forces.map((force) => {
        if (force.id === "syracusan-army") return { ...force, locationId: MESSANA };
        if (force.id === "mamertine-garrison") return { ...force, memberCharacterIds: men.map((man) => man.id) };
        return force;
      }),
    },
  };
}

describe("a man in the ranks", () => {
  it("enlists a declared legionary in his power's army, not at the head of a retinue", () => {
    const world = materializePlayerCharacter(opening(), PLAYER, declared("Legionary of the Roman army, a spearman of the hastati"), government);
    const army = forceOf(world, "roman-field-army");
    expect(army.memberCharacterIds).toContain(PLAYER);
    expect(world.material.forces.some((force) => force.commanderCharacterId === PLAYER)).toBe(false);
    // He stands where his army stands.
    expect(world.characters.find((character) => character.id === PLAYER)?.locationProvinceId).toBe(army.locationId);
  });

  it("puts a centurion in the legion as its officer, not over men of his own", () => {
    // A centurion led a century of the consul's army; he did not bring one.
    const world = materializePlayerCharacter(opening(), PLAYER, declared("A veteran centurion of the Roman legions"), government);
    expect(world.material.forces.some((force) => force.commanderCharacterId === PLAYER)).toBe(false);
    expect(world.material.forces.some((force) => force.memberCharacterIds.includes(PLAYER))).toBe(true);
  });

  it("still gives a man whose role names a band of his own its command", () => {
    const world = materializePlayerCharacter(opening(), PLAYER, declared("A captain of mercenaries with a company of his own"), government);
    expect(world.material.forces.some((force) => force.commanderCharacterId === PLAYER)).toBe(true);
  });

  it("lets him see his own army as his business, but not reach its chest", () => {
    const world = materializePlayerCharacter(opening(), PLAYER, declared("Legionary of the Roman army"), government);
    const station = buildStation({ world, characterId: PLAYER, offices: government.offices });
    expect(station.forceIds.has("roman-field-army")).toBe(true);
    expect(station.accountIds.has("roman-field-army-chest")).toBe(false);
  });

  it("gives each named man in a fight his own fate, in proportion to his army's losses, and the same fate every replay", () => {
    const world = aGarrisonOfNamedMen();
    const fight = (seed: string) => resolveEngagement({
      world, attacker: forceOf(world, "syracusan-army"), defender: forceOf(world, "mamertine-garrison"),
      posture: "offer_battle", tactic: null, warfare: definition.warfare, battleId: `battle-${seed}`, seed,
    }, 0);
    const outcomes = ["a", "b", "c", "d"].map((seed) => fight(seed));
    const hurt = outcomes.flatMap((outcome) => outcome.account!.members.filter((member) => member.outcome !== "unharmed"));
    expect(hurt.length).toBeGreaterThan(0);
    // Some came through: a man in the ranks faces his army's losses, not certain death.
    expect(outcomes.some((outcome) => outcome.account!.members.some((member) => member.outcome === "unharmed"))).toBe(true);

    const first = outcomes[0]!;
    const dead = first.account!.members.filter((member) => member.outcome === "killed").map((member) => member.name);
    for (const name of dead) {
      const man = first.world.characters.find((character) => character.name === name)!;
      expect(man.alive).toBe(false);
      // A dead man serves nowhere.
      expect(forceOf(first.world, "mamertine-garrison").memberCharacterIds).not.toContain(man.id);
    }
    // The record says what happened to him, to his own side.
    expect(first.facts.some((fact) => String(fact.kind).startsWith("soldier_") || fact.kind === "character_death")).toBe(hurt.length === 0 ? false : true);
    // A replay is the same battle.
    expect(fight("a").account!.members).toEqual(first.account!.members);
  });

  it("rolls only for the named men in the ranks, never for the commander or the dead", () => {
    const base = aGarrisonOfNamedMen();
    // The commander listed among his own ranks, and one man already dead.
    const world: WorldState = {
      ...base,
      characters: base.characters.map((character) => (character.id === "mamertine-soldier-0" ? { ...character, alive: false } : character)),
      material: { ...base.material, forces: base.material.forces.map((force) => (force.id === "mamertine-garrison" ? { ...force, memberCharacterIds: [...force.memberCharacterIds, "mamertine-spokesman"] } : force)) },
    };
    const result = resolveEngagement({
      world, attacker: forceOf(world, "syracusan-army"), defender: forceOf(world, "mamertine-garrison"),
      posture: "offer_battle", tactic: null, warfare: definition.warfare, battleId: "battle-x", seed: "x",
    }, 0);
    const rolled = result.account!.members.map((member) => member.name);
    expect(rolled).not.toContain("Mamertine spokesman");
    expect(rolled).not.toContain("Mamertine soldier 0");
    expect(rolled).toHaveLength(39);
  });

  it("promotes a man from the ranks when his commander falls", () => {
    const world = aGarrisonOfNamedMen();
    const promoted = killCharacter(world, "mamertine-spokesman", "Killed in the field.", 0).world;
    const garrison = forceOf(promoted, "mamertine-garrison");
    expect(garrison.commanderCharacterId.startsWith("mamertine-soldier-")).toBe(true);
    expect(garrison.memberCharacterIds).not.toContain(garrison.commanderCharacterId);
  });

  it("brings his comrades to what happens to him", () => {
    const withPlayer = materializePlayerCharacter(opening(), PLAYER, declared("Legionary of the Roman army"), government);
    const template = withPlayer.characters.find((character) => character.id === "quintus-ogulnius")!;
    const comrade: Character = { ...template, id: "lucius-comrade", name: "Lucius the Comrade", officeId: null, personalAccountId: "lucius-comrade-purse", prestigeBps: 1_000, relations: [], ambitions: [], mind: { ...template.mind, currentPressures: [] } };
    const world: WorldState = {
      ...withPlayer,
      characters: [...withPlayer.characters, { ...comrade, locationProvinceId: forceOf(withPlayer, "roman-field-army").locationId }],
      material: { ...withPlayer.material, forces: withPlayer.material.forces.map((force) => (force.id === "roman-field-army" ? { ...force, memberCharacterIds: [...force.memberCharacterIds, comrade.id] } : force)) },
    };
    const { facts } = materializeFacts({
      proposals: [{ localId: "wounded", kind: "soldier_wounded", summary: "Titus Vettius was wounded.", affectedRefs: [{ kind: "character", id: PLAYER }, { kind: "polity", id: "rome" }], visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance: 50 }],
      now: world.instant, atStep: world.elapsedStep, ids: createIdFactory("comrade"), causalDepth: 0, assignedIds: new Map(),
    });
    const routed = routeAttention({ world, facts, offices: government.offices, excludeCharacterIds: [PLAYER], maxFocused: 10, maxCausalDepth: 3 });
    const him = [...routed.focused, ...routed.active].find((actor) => actor.characterId === comrade.id);
    expect(him?.why).toContain("it touches a comrade in the same army");
  });

  it("lets a free man enlist without anybody's leave", () => {
    const world = opening();
    const enlist: WorldDelta = { op: "force_membership_set", characterRef: "manius-curius", forceRef: "roman-field-army", change: "enlist", reason: "The old man takes service again." };
    const result = applyDeltas(world, [enlist], context("manius-curius"));
    expect(result.rejected).toEqual([]);
    expect(result.breaches).toEqual([]);
    expect(forceOf(result.world, "roman-field-army").memberCharacterIds).toContain("manius-curius");
  });

  it("records a desertion as the deserter's breach, marks him, and tells his side", () => {
    const enlisted = applyDeltas(opening(), [{ op: "force_membership_set", characterRef: "manius-curius", forceRef: "roman-field-army", change: "enlist", reason: "He takes service." }], context("manius-curius")).world;
    const desert: WorldDelta = { op: "force_membership_set", characterRef: "manius-curius", forceRef: "roman-field-army", change: "desert", reason: "He goes home to his farm." };
    const result = applyDeltas(enlisted, [desert], context("manius-curius"));
    expect(result.rejected).toEqual([]);
    expect(result.breaches).toHaveLength(1);
    expect(forceOf(result.world, "roman-field-army").memberCharacterIds).not.toContain("manius-curius");
    expect(result.world.characters.find((character) => character.id === "manius-curius")?.disqualifyingStatuses).toContain("deserter");
    // His side hears of it: the fact names Rome, so a Roman can know it.
    const deserted = result.factProposals.find((fact) => fact.kind === "desertion");
    expect(deserted?.affectedRefs).toContainEqual({ kind: "polity", id: "rome" });

    // Somebody else's desertion, told by whoever is telling the story, is not the teller's breach.
    const told = applyDeltas(enlisted, [desert], context("gaius-genucius"));
    expect(told.breaches).toEqual([]);
  });
});
