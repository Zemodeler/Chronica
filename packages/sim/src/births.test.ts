import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { DAYS_PER_YEAR, ScenarioDefinitionSchema, WorldStateSchema, childrenOf, createCanonicalNpc, ensureProvinceMaterial, type ScenarioLifeRules, type WorldState } from "@chronica/shared";
import { MIN_DAYS_BETWEEN_BIRTHS, birthChance } from "./births";
import { reviewLives } from "./mortality";
import { createIdFactory } from "./ports";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const life: ScenarioLifeRules = definition.life;
const base = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const run = (world: WorldState, toDay: number) => reviewLives({ world, life, toDay, ids: createIdFactory(`burst-${toDay}`), playerCharacterId: null });

const HUSBAND = "hieron-ii";
const WIFE = "test-wife";

/** Hieron and a wife of twenty, married and under one roof. */
function married(options: { wifeAge?: number; apart?: boolean } = {}): WorldState {
  const world = base();
  const husband = world.characters.find((character) => character.id === HUSBAND)!;
  const elsewhere = world.map.provinces.find((province) => province.id !== husband.locationProvinceId)!.id;
  const created = createCanonicalNpc(world, {
    characterId: WIFE,
    name: "Philistis",
    locationProvinceId: options.apart === true ? elsewhere : husband.locationProvinceId,
    polityId: husband.polityId,
    createdAtStep: 0,
    creationReason: "Married to Hieron.",
    ageYearsAtStart: options.wifeAge ?? 20,
    gender: "female",
    cultureId: husband.cultureId,
  })!;
  return {
    ...created.world,
    familyLinks: [...created.world.familyLinks, {
      id: "family-hieron-marriage", characterId: WIFE, relatedCharacterId: HUSBAND, kind: "spouse_or_partner",
      startedAtStep: 0, endedAtStep: null, visibility: "public", provenanceEventId: null,
    }],
  };
}

const TEN_YEARS = 10 * DAYS_PER_YEAR;

/**
 * Ten years a year at a time. A tick never spans more than the scenario's
 * `maxSpanDays`, and `reviewLives` catches up at most 24 reviews per tick, so
 * a single ten-year jump is not something play can produce.
 */
function tenYears(world: WorldState): ReturnType<typeof run> {
  let result = run(world, 1);
  const facts = [...result.facts];
  for (let year = 1; year <= 10; year += 1) {
    result = run(result.world, year * DAYS_PER_YEAR);
    facts.push(...result.facts);
  }
  return { ...result, facts };
}

describe("a married couple under one roof", () => {
  it("has children, recorded as both parents' children, of the father's power and house", () => {
    const after = tenYears(married());
    const children = childrenOf(after.world, WIFE);
    expect(children.length).toBeGreaterThan(0);

    const husband = after.world.characters.find((character) => character.id === HUSBAND)!;
    for (const id of children) {
      const child = after.world.characters.find((character) => character.id === id)!;
      expect(childrenOf(after.world, HUSBAND)).toContain(id);
      expect(child.polityId).toBe(husband.polityId);
      expect(child.cultureId).toBe(husband.cultureId);
      expect(child.ageYearsAtStart).toBe(0);
      expect(child.prestigeBps).toBeLessThan(husband.prestigeBps);
    }
    expect(after.facts.some((fact) => fact.kind === "birth")).toBe(true);
  });

  it("names the eldest son for his father", () => {
    const after = tenYears(married()).world;
    const sons = childrenOf(after, WIFE)
      .map((id) => after.characters.find((character) => character.id === id)!)
      .filter((child) => child.gender === "male")
      .sort((a, b) => (a.birthStep ?? 0) - (b.birthStep ?? 0));
    if (sons.length > 0) expect(sons[0]!.name).toBe("Hieron II the Younger");
  });

  it("never bears twice inside the time it takes to carry and nurse a child", () => {
    const after = tenYears(married()).world;
    const births = childrenOf(after, WIFE)
      .map((id) => after.characters.find((character) => character.id === id)!.birthStep ?? 0)
      .sort((a, b) => a - b);
    for (let index = 1; index < births.length; index += 1) {
      expect(births[index]! - births[index - 1]!).toBeGreaterThanOrEqual(MIN_DAYS_BETWEEN_BIRTHS);
    }
  });

  it("gives the same children however the span was cut into hops", () => {
    const whole = tenYears(married()).world;
    let stepwise = run(married(), 1).world;
    for (let day = 200; day <= TEN_YEARS; day += 200) stepwise = run(stepwise, day).world;
    stepwise = run(stepwise, TEN_YEARS).world;

    const summary = (world: WorldState): string => childrenOf(world, WIFE)
      .map((id) => world.characters.find((character) => character.id === id)!)
      .map((child) => `${child.birthStep}:${child.gender}:${child.name}`)
      .sort()
      .join("|");
    expect(summary(stepwise)).toBe(summary(whole));
  });
});

describe("who cannot have a child", () => {
  it("a wife whose husband is in another province", () => {
    const world = married({ apart: true });
    const wife = world.characters.find((character) => character.id === WIFE)!;
    expect(birthChance(world, wife, 100, 30)).toBe(0);
  });

  it("a woman past her childbearing years", () => {
    const world = married({ wifeAge: 50 });
    const wife = world.characters.find((character) => character.id === WIFE)!;
    expect(birthChance(world, wife, 100, 30)).toBe(0);
  });

  it("a man, whoever he is married to", () => {
    const world = married();
    const husband = world.characters.find((character) => character.id === HUSBAND)!;
    expect(birthChance(world, husband, 100, 30)).toBe(0);
  });

  it("anybody unmarried: the opening world has no couples, and bears nobody", () => {
    const after = tenYears(base());
    expect(after.facts.some((fact) => fact.kind === "birth")).toBe(false);
  });
});
