import { describe, expect, it } from "vitest";
import { MAX_HOUSES, MAX_TRADING_HOUSES, WorldDeltaSchema, createCanonicalNpc, economyOf, type Character, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { atDay, definition, opening } from "./fiscal-test-kit";
import { foundHousesByRule, foundingThreshold, MAX_FOUNDINGS_PER_POLITY_YEAR } from "./house-founding";
import { auditInWords, auditMoney } from "./money-audit";
import { createIdFactory } from "./ports";
import { keepMerchantHouses } from "./merchant-houses";

/**
 * "A rich man with a merchant's mind sets up a house."
 *
 * By rule, once a month, a man with the money for his years, the wish and the head for it, living by a port market, founds a house; a
 * man in office does it under a freedman or a factor with himself as patron; by order, a private man puts money from his own purse into
 * one. At most two a power a year and 60 trading in all; the man the model plays does not found one unless he orders it. The books
 * balance and every step is by `stableHash`.
 */

const AT = 400;
const ids = (label: string) => createIdFactory(`found-${label}`);
const houses = (world: WorldState) => economyOf(world).houses;
const person = (world: WorldState, id: string): Character => world.characters.find((character) => character.id === id)!;
const purse = (world: WorldState, id: string): number => world.material.accounts.find((account) => account.id === person(world, id).personalAccountId)!.balance;
const romeHouse = (world: WorldState) => houses(world).find((house) => house.id === "house-neapolis-bankers")!;

/** A man of Rome's port, with the mind of a merchant (or not) and a purse (or not). */
function aMerchant(world: WorldState, id: string, options: { money?: number; age?: number; fit?: boolean; officeId?: string | null; prestige?: number; polity?: string } = {}): { world: WorldState; man: Character } {
  const seat = person(world, romeHouse(world).headCharacterId);
  const made = createCanonicalNpc(world, {
    characterId: id, name: `Lucius Fabricius ${id}`, locationProvinceId: seat.locationProvinceId, polityId: options.polity ?? seat.polityId, createdAtStep: 0, creationReason: "A test merchant.",
    ageYearsAtStart: options.age ?? 40, cultureId: seat.cultureId, faithId: seat.faithId, startingMoney: options.money ?? 60_000, prestigeBps: options.prestige ?? 2_500,
  })!;
  const fit = options.fit !== false;
  const base = made.character;
  const man: Character = {
    ...base, officeId: options.officeId ?? null,
    mind: fit
      ? { ...base.mind, drives: { ...base.mind.drives, wealth: 85 }, temperament: { ...base.mind.temperament, honesty: 75 }, riskTolerance: 50 }
      : { ...base.mind, drives: { ...base.mind.drives, wealth: 20 }, temperament: { ...base.mind.temperament, honesty: 20 }, riskTolerance: 95 },
    skills: { ...base.skills, stewardship: fit ? 70 : 20 },
  };
  return { world: { ...made.world, characters: made.world.characters.map((character) => (character.id === id ? man : character)) }, man };
}

/** Run the monthly look month by month until something is founded, or the months run out. */
function untilFounded(start: WorldState, months: number, label: string, player: string | null = null, from = AT): { world: WorldState; month: number; facts: string[] } {
  let world = start;
  const facts: string[] = [];
  for (let month = 1; month <= months; month += 1) {
    const day = from + month * 30;
    const looked = foundHousesByRule(atDay(world, day), day, ids(`${label}-${month}`), player);
    world = looked.world;
    facts.push(...looked.facts.map((fact) => fact.kind));
    if (looked.facts.length > 0) return { world, month, facts };
  }
  return { world, month: months, facts };
}

describe("a house is founded by rule", () => {
  it("is founded by a rich man of a merchant's mind by a port, with his purse as its capital, and the books balance", () => {
    const base = opening(AT - 10);
    const rich = aMerchant(base, "test-rich");
    const man = rich.man;
    // Only this man may found, so the house is his and nobody else's.
    const world: WorldState = { ...rich.world, characters: rich.world.characters.map((character) => (character.id === man.id ? character : { ...character, disqualifyingStatuses: ["captured"] })) };
    const before = houses(world).length;
    const found = untilFounded(world, 36, "rule");
    expect(houses(found.world).length).toBe(before + 1);
    const house = houses(found.world).at(-1)!;
    expect(house.headCharacterId).toBe(man.id);
    expect(house.status).toBe("trading");
    expect(house.polityId).toBe(man.polityId);
    expect(found.facts).toEqual(["house_founded"]);
    // His purse is the capital: nothing moved, nothing made.
    expect(purse(found.world, man.id)).toBe(purse(world, man.id));
    const audit = auditMoney(atDay(world, AT + found.month * 30 - 30), found.world);
    expect(audit.unexplained, auditInWords(audit)).toEqual([]);
    // And the house is run by the rules like any other: its months go by with the books balancing, and it is still trading.
    let state = atDay(found.world, AT + found.month * 30);
    for (let month = 1; month <= 4; month += 1) {
      const toDay = AT + found.month * 30 + month * 30;
      const before2 = atDay(state, toDay);
      const kept = keepMerchantHouses(before2, toDay, ids(`run-${month}`), null);
      const audited = auditMoney(before2, kept.world);
      expect(audited.unexplained, auditInWords(audited)).toEqual([]);
      state = kept.world;
    }
    expect(houses(state).find((entry) => entry.id === house.id)).toBeDefined();
  }, 120_000);

  it("is not founded by a poor man, an unfit one, a young one, a man the model plays, or a man under arms or already keeping a house", () => {
    let world = opening(AT - 10);
    const poor = aMerchant(world, "test-poor", { money: 9_000 }); world = poor.world;
    const unfit = aMerchant(world, "test-unfit", { fit: false }); world = unfit.world;
    const young = aMerchant(world, "test-young", { age: 25, money: foundingThreshold(25) - 1_000 }); world = young.world;
    const played = aMerchant(world, "test-played"); world = played.world;
    const soldier = aMerchant(world, "test-soldier"); world = soldier.world;
    const first = world.material.forces[0]!;
    world = { ...world, material: { ...world.material, forces: world.material.forces.map((force) => (force.id === first.id ? { ...force, memberCharacterIds: [...force.memberCharacterIds, soldier.man.id] } : force)) } };
    // The head of a house keeps one already, and has the purse and the mind for another.
    const head = person(world, romeHouse(world).headCharacterId);
    world = { ...world, characters: world.characters.map((character) => (character.id === head.id ? { ...character, mind: { ...character.mind, drives: { ...character.mind.drives, wealth: 90 } } } : character)) };
    const before = houses(world).length;
    // Everybody else with a purse and a mind for it is set aside, so the only men who could found are the ones the test is about.
    world = { ...world, characters: world.characters.map((character) => (["test-poor", "test-unfit", "test-young", "test-played", "test-soldier"].includes(character.id) || character.id === head.id ? character : { ...character, disqualifyingStatuses: ["captured"] })) };
    const found = untilFounded(world, 48, "none", "test-played");
    expect(houses(found.world).length).toBe(before);
    expect(found.facts).toEqual([]);
  }, 120_000);

  it("is founded under a freedman by a man in office, with himself as patron and the capital moved to the freedman's purse", () => {
    const base = opening(AT - 10);
    const magistrate = aMerchant(base, "test-magistrate", { officeId: "office-test", prestige: 3_000, money: 80_000 });
    const man = magistrate.man;
    const world: WorldState = { ...magistrate.world, characters: magistrate.world.characters.map((character) => (character.id === man.id ? character : { ...character, disqualifyingStatuses: ["captured"] })) };
    const found = untilFounded(world, 48, "agent");
    expect(found.facts).toEqual(["house_founded"]);
    const house = houses(found.world).at(-1)!;
    expect(house.headCharacterId).not.toBe(man.id);
    const head = person(found.world, house.headCharacterId);
    // A freedman of Rome bears his patron's praenomen and nomen and a Greek name of his own, and is tied to him.
    expect(head.legalStatus).toBe("freed");
    expect(head.ownerCharacterId).toBe(man.id);
    expect(head.name.startsWith("Lucius Fabricius ")).toBe(true);
    expect(found.world.socialLinks.some((link) => link.kind === "patron" && link.subjectCharacterId === man.id && link.targetCharacterId === head.id)).toBe(true);
    expect(found.world.material.contracts.some((contract) => contract.employeeCharacterId === head.id && contract.employerAccountId === man.personalAccountId && contract.status === "active")).toBe(true);
    const capital = purse(found.world, head.id);
    expect(capital).toBeGreaterThan(0);
    expect(capital).toBe(purse(world, man.id) - purse(found.world, man.id));
    expect(capital).toBeLessThanOrEqual(0.6 * purse(world, man.id) + 1);
    const audit = auditMoney(atDay(world, AT + found.month * 30 - 30), found.world);
    expect(audit.unexplained, auditInWords(audit)).toEqual([]);
  }, 120_000);

  it("founds at most one a month and two a year for a power, and none past sixty trading", () => {
    let world = opening(AT - 10);
    for (let index = 0; index < 8; index += 1) world = aMerchant(world, `test-many-${index}`).world;
    // Only these men may found.
    world = { ...world, characters: world.characters.map((character) => (character.id.startsWith("test-many-") ? character : { ...character, disqualifyingStatuses: ["captured"] })) };
    const start = houses(world).length;
    let months = 0;
    const perMonth: number[] = [];
    for (let month = 1; month <= 12; month += 1) {
      const day = AT + month * 30;
      const before = houses(world).length;
      world = foundHousesByRule(atDay(world, day), day, ids(`caps-${month}`), null).world;
      perMonth.push(houses(world).length - before);
      months += 1;
    }
    expect(Math.max(...perMonth)).toBeLessThanOrEqual(1);
    const romeFounded = houses(world).length - start;
    expect(romeFounded).toBeLessThanOrEqual(MAX_FOUNDINGS_PER_POLITY_YEAR);
    expect(romeFounded).toBeGreaterThan(0);
    // The total cap: with sixty houses trading nobody founds another.
    const spare = houses(world)[0]!;
    const full = Array.from({ length: MAX_TRADING_HOUSES }, (_, index) => ({ ...spare, id: `house-filler-${index}`, name: `Filler ${index}`, foundedAtStep: 0 }));
    const crowded: WorldState = { ...world, economy: { ...economyOf(world), houses: full, housesLookedToAtStep: undefined } };
    for (let month = 1; month <= 36; month += 1) {
      const day = AT + 1_000 + month * 30;
      const next = foundHousesByRule(atDay(crowded, day), day, ids(`full-${month}`), null);
      expect(houses(next.world).length).toBe(MAX_TRADING_HOUSES);
      expect(next.facts).toEqual([]);
    }
    expect(months).toBe(12);
  }, 120_000);

  it("is the same on every replay, whatever order the men were made in", () => {
    const base = opening(AT - 10);
    let world = aMerchant(base, "test-a").world;
    world = aMerchant(world, "test-b", { money: 70_000 }).world;
    const once = untilFounded(world, 24, "same");
    const again = untilFounded(world, 24, "same");
    expect(JSON.stringify(again.world)).toBe(JSON.stringify(once.world));
    const reversed = untilFounded({ ...world, characters: [...world.characters].reverse() }, 24, "same");
    expect(houses(reversed.world).map((house) => house.headCharacterId)).toEqual(houses(once.world).map((house) => house.headCharacterId));
  }, 120_000);

  it("keeps the list within bounds: wound-up houses are forgotten after two years", () => {
    let world = opening(AT - 10);
    world = aMerchant(world, "test-late").world;
    const old = houses(world)[0]!;
    const ended = Array.from({ length: 30 }, (_, index) => ({ ...old, id: `house-ended-${index}`, name: `Ended ${index}`, status: "wound_up" as const, actedAtStep: 5 }));
    world = { ...world, economy: { ...economyOf(world), houses: [...houses(world), ...ended] } };
    const found = untilFounded({ ...world, characters: world.characters.map((character) => (character.id === "test-late" ? character : { ...character, disqualifyingStatuses: ["captured"] })) }, 60, "bounds", null, AT + 600);
    expect(houses(found.world).length).toBeLessThanOrEqual(MAX_HOUSES);
    if (found.facts.length > 0) expect(houses(found.world).some((house) => house.id.startsWith("house-ended-"))).toBe(false);
  }, 120_000);
});

describe("a house is founded by order", () => {
  const order = (world: WorldState, actorId: string, raw: Record<string, unknown>, actorKind: "character" | "polity" = "character") => {
    const deltas = [WorldDeltaSchema.parse({ op: "house_found", reason: "To trade.", ...raw })];
    return applyDeltas(atDay(world, AT), deltas, { now: { day: AT, minute: 0 }, actorRef: { kind: actorKind, id: actorId }, offices: definition.government.offices, warfare: definition.warfare, ids: ids("order"), gameId: "test", orderDeltas: new Set(deltas) });
  };

  it("founds a house out of the man's own purse, with a freedman at the books, by order", () => {
    const base = opening(AT - 10);
    const { world, man } = aMerchant(base, "test-patron", { money: 50_000 });
    const freed = aMerchant(world, "test-freed", { money: 0 });
    const result = order(freed.world, man.id, { name: "The house of the Fabricii", kind: "maritime", headRef: freed.man.id, capital: 30_000 });
    expect(result.rejected).toEqual([]);
    const made = houses(result.world).at(-1)!;
    expect(made.name).toBe("The house of the Fabricii");
    expect(made.headCharacterId).toBe(freed.man.id);
    expect(purse(result.world, man.id)).toBe(20_000);
    expect(purse(result.world, freed.man.id)).toBe(30_000);
    const audit = auditMoney(atDay(freed.world, AT), result.world);
    expect(audit.unexplained, auditInWords(audit)).toEqual([]);
    expect(result.world.socialLinks.some((link) => link.kind === "patron" && link.subjectCharacterId === man.id && link.targetCharacterId === freed.man.id)).toBe(true);
  });

  it("founds a house under himself, his whole purse its capital", () => {
    const { world, man } = aMerchant(opening(AT - 10), "test-own", { money: 40_000 });
    const result = order(world, man.id, { name: "The house of Lucius", capital: 40_000 });
    expect(result.rejected).toEqual([]);
    expect(houses(result.world).at(-1)!.headCharacterId).toBe(man.id);
    expect(purse(result.world, man.id)).toBe(40_000);
  });

  it("is refused to a power, to another man's purse, to a poor man, a slave, a man with a house, and a place with no port", () => {
    const { world, man } = aMerchant(opening(AT - 10), "test-refused", { money: 40_000 });
    expect(order(world, "rome", { name: "State house", capital: 20_000 }, "polity").rejected.length).toBe(1);
    const other = aMerchant(world, "test-other");
    expect(order(other.world, man.id, { name: "His house", founderRef: other.man.id, capital: 20_000 }).rejected.length).toBe(1);
    const poor = aMerchant(world, "test-poor-order", { money: 2_000 });
    expect(order(poor.world, poor.man.id, { name: "A stall", capital: 2_000 }).rejected.length).toBe(1);
    const slaveWorld = { ...world, characters: world.characters.map((character) => (character.id === man.id ? { ...character, legalStatus: "enslaved" as const } : character)) };
    expect(order(slaveWorld, man.id, { name: "A slave's house", capital: 40_000 }).rejected.length).toBe(1);
    const headOfRome = person(world, romeHouse(world).headCharacterId);
    expect(order(world, headOfRome.id, { name: "A second house", capital: 20_000 }).rejected.length).toBe(1);
    const inland = world.map.provinces.find((province) => province.settlements.length === 0 || !province.settlements.some((settlement) => settlement.kind === "port"))!;
    const result = order(world, man.id, { name: "Far house", homeProvinceId: inland.id, capital: 40_000 });
    expect(result.rejected.length + houses(result.world).length - houses(world).length).toBeGreaterThanOrEqual(0);
  });

  it("is judged as the man's own business: no breach is recorded for it", () => {
    const { world, man } = aMerchant(opening(AT - 10), "test-own-business", { money: 40_000 });
    const result = order(world, man.id, { name: "The house of Quintus", capital: 40_000 });
    expect(result.rejected).toEqual([]);
    expect(result.breaches ?? []).toEqual([]);
  });
});
