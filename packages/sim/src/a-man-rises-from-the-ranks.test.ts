import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  CharacterKnowledgebaseSchema,
  ScenarioDefinitionSchema,
  WorldDeltaSchema,
  WorldStateSchema,
  appointerKindOf,
  materializePlayerCharacter,
  nextRankUp,
  ranksIn,
  readService,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { createIdFactory } from "./ports";
import { keepTheRanks } from "./ranks";

/**
 * A soldier can rise through the ranks (E15, L6).
 *
 * The optio had no grade, so it stood above the centurio posterior; a post
 * was filled only when the officer over the player's own maniple died, and
 * only with that officer's rank; no field said who gave a post, and no act
 * could set one. A miles could never become anything.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const PLAYER = "a-ranker";
const opening = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
const ESTABLISHMENTS = opening().establishments;
const ROME = ESTABLISHMENTS.find((establishment) => establishment.polityId === "rome")!;

function enlisted(): WorldState {
  return materializePlayerCharacter(opening(), PLAYER, CharacterKnowledgebaseSchema.parse({
    version: 1, characterId: PLAYER, gameId: "game-ranks", canonicalName: "Lucius Nonius", nickname: null, birthYearApprox: -292, deathYearApprox: null,
    origin: "invented", period: "270 BCE", locationProvinceId: PUNIC_IDS.rome, culture: "Roman", faith: null,
    biography: "A farmer's son of the Sabine hills, levied for the year with the legion of the consul.", notableEvents: [],
    role: "Legionary of the Roman army, a spearman of the hastati", authority: [], socioEconomicClass: "Plebeian", startingMoney: 40, ageYearsAtOpening: 22,
    skills: { martial: 55, intrigue: 20, learning: 15, piety: 40, stewardship: 20, diplomacy: 20, body: 65, subSkills: {} }, skillRationale: {},
    relations: [
      { name: "Nonia", relationship: "mother", historical: false, notes: "Keeps the farm.", kind: "person", category: "family", familyRole: "parent" },
      ...[1, 2, 3].map((n) => ({ name: `Friend ${n}`, relationship: "friend", historical: false, notes: "An old friend.", kind: "person", category: "other", familyRole: null })),
    ],
    confirmedByPlayer: true, confirmationDraft: null,
  }), definition.government);
}

const act = (world: WorldState, actor: string, raw: Record<string, unknown>) => {
  const delta: WorldDelta = WorldDeltaSchema.parse(raw);
  return applyDeltas(world, [delta], {
    now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: actor }, offices, successionRules: definition.government.successionRules,
    warfare: definition.warfare, ids: createIdFactory(`ranks-${actor}`), gameId: "game-ranks", playerCharacterId: PLAYER, orderDeltas: new Set([delta]),
  });
};
const serviceOf = (world: WorldState, id: string) => world.characters.find((character) => character.id === id)!.service!;
const army = (world: WorldState) => world.material.forces.find((force) => force.id === "roman-field-army")!;

describe("the ladder of a maniple", () => {
  it("runs miles, optio, signifer, centurio posterior, centurio prior", () => {
    expect(ranksIn(ROME, "hastati").map((rank) => rank.id).slice(0, 5)).toEqual(["miles", "optio", "signifer", "centurio-posterior", "centurio-prior"]);
    expect(nextRankUp(ROME, "hastati", "miles")?.id).toBe("optio");
    expect(nextRankUp(ROME, "hastati", "signifer")?.id).toBe("centurio-posterior");
  });

  it("says who gives every post a man may rise to", () => {
    const given = Object.fromEntries(ROME.ranks.map((rank) => [rank.id, appointerKindOf(rank)]));
    expect(given).toMatchObject({ optio: "unit_officer", signifer: "unit_officer", "centurio-prior": "body_officer", "centurio-posterior": "body_officer", legate: "army_commander", "prefect-of-the-allies": "army_commander" });
    // Every rank of every power has somebody to give it, whether its data says so or not.
    for (const establishment of ESTABLISHMENTS) for (const rank of establishment.ranks) expect(appointerKindOf(rank), `${establishment.polityId}:${rank.id}`).toBeDefined();
  });
});

describe("a post set by whoever gives it", () => {
  it("is set by his centurion, and by nobody in the ranks beside him", () => {
    const world = enlisted();
    const service = readService(world, PLAYER)!;
    const centurion = service.officers.find((officer) => /centurio/i.test(officer.rank))!.id;
    const comrade = service.comrades[0]!.id;
    const made = { op: "force_post_set", forceRef: "roman-field-army", rankId: "optio", characterRef: PLAYER, reason: "He has earned it." };
    const refused = act(world, comrade, made);
    expect(refused.applied).toHaveLength(0);
    expect(refused.rejected[0]!.reason).toMatch(/That post is not his to give/);
    expect(serviceOf(refused.world, PLAYER).rankId).toBe("miles");
    const given = act(world, centurion, made);
    expect(given.rejected).toEqual([]);
    expect(given.breaches).toEqual([]);
    expect(serviceOf(given.world, PLAYER).rankId).toBe("optio");
    expect(army(given.world).posts?.some((post) => post.characterId === PLAYER && post.rankId === "optio" && post.unitIndex === serviceOf(world, PLAYER).unitIndex)).toBe(true);
    // And by the consul over the whole army.
    expect(serviceOf(act(world, "gaius-genucius", made).world, PLAYER).rankId).toBe("optio");
  });
});

describe("a post emptied by death", () => {
  it("goes to the man in the unit whose next rank it is, not only the officer's post over the player", () => {
    const world = enlisted();
    const service = serviceOf(world, PLAYER);
    const comrades = readService(world, PLAYER)!.comrades.map((comrade) => comrade.id);
    // One comrade is the maniple's optio, and dies.
    const optio = comrades[0]!;
    const withOptio: WorldState = {
      ...world,
      characters: world.characters.map((character) => (character.id === optio ? { ...character, service: { ...character.service!, rankId: "optio" } } : character)),
      material: { ...world.material, forces: world.material.forces.map((force) => (force.id === "roman-field-army"
        ? { ...force, posts: [...(force.posts ?? []), { formationId: service.formationId!, unitIndex: service.unitIndex, rankId: "optio", characterId: optio }] }
        : force)) },
    };
    const dead: WorldState = { ...withOptio, characters: withOptio.characters.map((character) => (character.id === optio ? { ...character, alive: false, diedAtStep: 1 } : character)) };
    const ranked = keepTheRanks({ world: dead, toDay: 2, warfare: definition.warfare, ids: createIdFactory("vacancy"), playerCharacterId: PLAYER });
    const holder = army(ranked.world).posts?.find((post) => post.formationId === service.formationId && post.unitIndex === service.unitIndex && post.rankId === "optio");
    expect(holder).toBeDefined();
    expect([PLAYER, ...comrades.slice(1)]).toContain(holder!.characterId);
    expect(serviceOf(ranked.world, holder!.characterId).rankId).toBe("optio");
    expect(ranked.facts.some((fact) => fact.kind === "soldier_promoted")).toBe(true);
  });
});

describe("the army's review at the opening of the campaigning season", () => {
  it("fills the empty posts of its named men's units by merit, the player among them, once a season", () => {
    const world = enlisted();
    // A man decorated four times over has earned his step.
    const decorated: WorldState = {
      ...world,
      characters: world.characters.map((character) => (character.id === PLAYER
        ? { ...character, service: { ...character.service!, battles: 5, decorations: [1, 2, 3, 4].map((n) => ({ label: "Phalerae", atStep: n, reason: "Valour" })) } }
        : character)),
      material: { ...world.material, forces: world.material.forces.map((force) => (force.id === "roman-field-army" ? { ...force, reckonedToStep: 50 } : force)) },
    };
    // Not before the season opens.
    const before = keepTheRanks({ world: decorated, toDay: 59, warfare: definition.warfare, ids: createIdFactory("review"), playerCharacterId: PLAYER });
    expect(serviceOf(before.world, PLAYER).rankId).toBe("miles");
    const reviewed = keepTheRanks({ world: decorated, toDay: 61, warfare: definition.warfare, ids: createIdFactory("review"), playerCharacterId: PLAYER });
    // One step a season: optio, not past it.
    expect(serviceOf(reviewed.world, PLAYER).rankId).toBe("optio");
    expect(reviewed.facts.some((fact) => fact.kind === "soldier_promoted" && fact.summary.includes("Lucius Nonius"))).toBe(true);
  });
});
