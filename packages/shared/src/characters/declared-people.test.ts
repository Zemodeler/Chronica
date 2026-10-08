import { describe, expect, it } from "vitest";
import { PUNIC_IDS, punicWarsScenario } from "@chronica/db";
import type { WorldState } from "../world/world-state";
import { CharacterKnowledgebaseSchema, type CharacterKnowledgebase } from "./knowledgebase";
import { ageWhereNoneWasSaid, declaredKinId, nameNotTaken } from "./declared-kin";
import { materializePlayerCharacter } from "./player-materialization";
import { currentAgeYears } from "./age";

/**
 * The wife, the son, the patron and the friend a man declares were made only by
 * the web page's confirmation; a player begun any other way had them in his
 * history and nowhere in the world. A man of the line was thirty-five for want
 * of a number, and a second Gaius Genucius was nobody's namesake.
 */

const PLAYER = "declared-4cee71cf";
const government = punicWarsScenario.definition.government;
const world = (): WorldState => structuredClone(punicWarsScenario.initialWorld);

function declared(overrides: Partial<CharacterKnowledgebase> = {}): CharacterKnowledgebase {
  return CharacterKnowledgebaseSchema.parse({
    version: 1, characterId: PLAYER, gameId: "game-under-test", canonicalName: "Titus Vettius", nickname: null, birthYearApprox: -296, deathYearApprox: null, origin: "invented",
    period: "270 BCE", locationProvinceId: PUNIC_IDS.rome, culture: "Roman", faith: null,
    biography: "A young man of the sixth maniple of the hastati, of a small farm in the Sabine hills, with a cousin in debt and a mother who keeps the farm.",
    notableEvents: ["Enlisted at seventeen."], role: "Legionary of the hastati in the consul's army", authority: [], socioEconomicClass: "Plebeian smallholder", startingMoney: 600,
    skills: { martial: 50, intrigue: 30, learning: 30, piety: 40, stewardship: 40, diplomacy: 35, body: 55, subSkills: {} }, skillRationale: { martial: "Trained." },
    relations: [
      { name: "Vettia", relationship: "wife", historical: false, notes: "Keeps the farm.", kind: "person", category: "family", familyRole: "partner" },
      { name: "Sextus Vettius", relationship: "son", historical: false, notes: "A boy.", kind: "person", category: "family", familyRole: "child" },
      { name: "Manius Curius", relationship: "patron", historical: false, notes: "A man of standing who spoke for the family.", kind: "person", category: "other", familyRole: null },
      { name: "Lucius Minucius", relationship: "friend", historical: false, notes: "A comrade.", kind: "person", category: "other", familyRole: null },
    ],
    confirmedByPlayer: true, confirmationDraft: null, ...overrides,
  });
}

describe("a declared man's people", () => {
  it("are made where he is made, with the kin as kin", () => {
    const made = materializePlayerCharacter(world(), PLAYER, declared(), government);
    const wife = made.characters.find((c) => c.id === declaredKinId(PLAYER, "Vettia"));
    const son = made.characters.find((c) => c.id === declaredKinId(PLAYER, "Sextus Vettius"));
    const patron = made.characters.find((c) => c.id === declaredKinId(PLAYER, "Manius Curius"));
    expect(wife?.gender).toBe("female");
    expect(son).toBeDefined();
    expect(son!.ageYearsAtStart).toBeLessThan(made.characters.find((c) => c.id === PLAYER)!.ageYearsAtStart);
    expect(patron).toBeDefined();
    // The family graph says so, and the feeling goes both ways.
    expect(made.familyLinks.filter((link) => link.relatedCharacterId === PLAYER).map((link) => link.kind).sort()).toEqual(["child", "spouse_or_partner"]);
    const player = made.characters.find((c) => c.id === PLAYER)!;
    expect(player.relations.some((relation) => relation.subjectCharacterId === wife!.id)).toBe(true);
    expect(wife!.relations.some((relation) => relation.subjectCharacterId === PLAYER)).toBe(true);
  });

  it("are the same people if he is placed again, and a man the world already has is that man", () => {
    const once = materializePlayerCharacter(world(), PLAYER, declared(), government);
    const again = materializePlayerCharacter(once, PLAYER, declared(), government);
    expect(again).toBe(once);
    const a = materializePlayerCharacter(world(), PLAYER, declared(), government);
    const b = materializePlayerCharacter(world(), PLAYER, declared(), government);
    expect(JSON.stringify(a.characters.map((c) => c.id))).toBe(JSON.stringify(b.characters.map((c) => c.id)));
    const known = materializePlayerCharacter(world(), PLAYER, declared({ relations: [
      { name: "Gaius Genucius", relationship: "patron", historical: true, notes: "The consul.", kind: "person", category: "other", familyRole: null },
      { name: "Vettia", relationship: "wife", historical: false, notes: "Keeps the farm.", kind: "person", category: "family", familyRole: "partner" },
      { name: "Lucius Minucius", relationship: "friend", historical: false, notes: "A comrade.", kind: "person", category: "other", familyRole: null },
      { name: "Quintus Fabius", relationship: "friend", historical: false, notes: "A friend.", kind: "person", category: "other", familyRole: null },
    ] }), government);
    expect(known.characters.filter((c) => c.name === "Gaius Genucius")).toHaveLength(1);
  });

  it("tell a man of the line from a man over it by his years, where none was said", () => {
    const made = materializePlayerCharacter(world(), PLAYER, declared(), government);
    const age = currentAgeYears(made.characters.find((c) => c.id === PLAYER)!, made.elapsedStep);
    expect(age).toBeGreaterThanOrEqual(17);
    expect(age).toBeLessThanOrEqual(25);
    expect(ageWhereNoneWasSaid("Centurion of the hastati", "x")).toBe(35);
    expect(ageWhereNoneWasSaid("Consul of the Roman Republic", "x")).toBe(35);
  });

  it("do not give a namesake the name of a man the world has", () => {
    const base = world();
    const consul = base.characters.find((c) => c.id === "gaius-genucius")!;
    const named = nameNotTaken(base, consul.name, PLAYER);
    expect(named).not.toBe(consul.name);
    expect(named.startsWith(consul.name)).toBe(true);
    const made = materializePlayerCharacter(base, PLAYER, declared({ canonicalName: consul.name }), government);
    expect(made.characters.filter((c) => c.name === consul.name)).toHaveLength(1);
  });
});
