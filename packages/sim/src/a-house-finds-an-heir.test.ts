import { describe, expect, it } from "vitest";
import { createCanonicalNpc, economyOf, familyLinksOf, stableHash, treasuryOf, type Character, type WorldState } from "@chronica/shared";
import { atDay, definition, opening } from "./fiscal-test-kit";
import { keepTheLine, newManChanceBps } from "./house-succession";
import { auditInWords, auditMoney } from "./money-audit";
import { killCharacter } from "./mortality";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";

/**
 * "The head is dead, his son is dead, and the house is not."
 *
 * A house outlived its heads by the means any family firm did: a kinsman who was fit, else a man taken as a son (a nephew, a
 * freedman, the steward who had kept the books), and only where there was nobody, and then not always, a new man. With none, the
 * estate went by the ordinary rules and the house was ended. Every step is by rule: the nearest fit kinsman, the man who agrees
 * by his own nature, one throw a year for a new man weighted by the house's capital. Nothing is made but the endowment of a man
 * who arrives in the world, and the books balance.
 */

const DAY = 400;
const house = (world: WorldState, slug: string) => economyOf(world).houses.find((entry) => entry.id === `house-${slug}`)!;
const person = (world: WorldState, id: string): Character => world.characters.find((character) => character.id === id)!;
const headOf = (world: WorldState, slug: string): Character => person(world, house(world, slug).headCharacterId);
/** The man the head has named, if he lives (a dead heir is nobody). */
const named = (world: WorldState, headId: string): Character | null => {
  const heirId = person(world, headId).heirCharacterId;
  const heir = heirId === null ? undefined : world.characters.find((character) => character.id === heirId);
  return heir !== undefined && heir.alive ? heir : null;
};
const purseOf = (world: WorldState, id: string): number => world.material.accounts.find((account) => account.id === person(world, id).personalAccountId)!.balance;

/** Everybody but the named is barred (as men taken prisoner are), so the test controls who the house can look to. */
function onlyThese(world: WorldState, ...ids: string[]): WorldState {
  const keep = new Set(ids);
  return { ...world, characters: world.characters.map((character) => (keep.has(character.id) || character.disqualifyingStatuses.length > 0 ? character : { ...character, disqualifyingStatuses: ["captured"] })) };
}

/** A man of the house's city, fit for the books and willing, or the reverse. */
function aMan(world: WorldState, head: Character, id: string, name: string, how: "fit" | "unfit" | "unwilling", age = 30): { world: WorldState; man: Character } {
  const made = createCanonicalNpc(world, {
    characterId: id, name, locationProvinceId: head.locationProvinceId, polityId: head.polityId, createdAtStep: 0, creationReason: `A test man, ${how}.`,
    ageYearsAtStart: age, cultureId: head.cultureId, faithId: head.faithId, startingMoney: 500,
  })!;
  const base = made.character;
  const mind = how === "fit"
    ? { ...base.mind, drives: { ...base.mind.drives, wealth: 90, status: 80, family: 70, duty: 70 }, temperament: { ...base.mind.temperament, honesty: 80 }, riskTolerance: 30 }
    : how === "unfit"
      ? { ...base.mind, drives: { ...base.mind.drives, wealth: 20 }, temperament: { ...base.mind.temperament, honesty: 10 }, riskTolerance: 90 }
      // Honest and able, and wanting nothing of what the head has.
      : { ...base.mind, drives: { security: 50, status: 0, wealth: 60, family: 0, faith: 50, duty: 0, revenge: 50 }, temperament: { ...base.mind.temperament, honesty: 80 }, riskTolerance: 30 };
  const man: Character = { ...base, mind, skills: { ...base.skills, stewardship: how === "unfit" ? 20 : 75 } };
  return { world: { ...made.world, characters: made.world.characters.map((character) => (character.id === id ? man : character)) }, man };
}

const kinOf = (world: WorldState, head: Character, man: Character, kind: "parent" | "other_relative"): WorldState => ({
  ...world,
  familyLinks: [...world.familyLinks, { id: `family-${man.id}`, characterId: head.id, relatedCharacterId: man.id, kind, startedAtStep: 0, endedAtStep: null, visibility: "public", provenanceEventId: null }],
});

/** The head's steward: a contract of service paid from his purse. */
const stewardOf = (world: WorldState, head: Character, man: Character): WorldState => ({
  ...world,
  material: {
    ...world.material,
    contracts: [...world.material.contracts, {
      id: `contract-${man.id}`, role: "steward", label: "Keeps the books of the house", employerAccountId: head.personalAccountId, employeeCharacterId: man.id,
      obligationId: null, incomeSourceId: null, grantId: null, advance: 0, monthlyPay: 300, duties: "Keeps the books and the factors.", openedAtStep: 0, endsAtStep: null,
      forceId: null, forceWas: null, provinceId: null, counterpartPolityId: null, status: "active",
    }],
  },
});

const slug = "publicani-rome";
const ids = (label: string) => createIdFactory(`heir-${label}`);
const looked = (world: WorldState, label: string, at = DAY) => keepTheLine(atDay(world, at), at, ids(label), new Set([house(world, slug).id]));

/** The opening world with the publicani's head named, his son dead, and the men the test wants about him. */
function withoutAnHeir(): { world: WorldState; head: Character } {
  const start = opening(DAY - 20);
  const head = headOf(start, slug);
  const dead = killCharacter(start, head.heirCharacterId!, "Of a fever.", DAY - 10).world;
  return { world: dead, head: person(dead, head.id) };
}

describe("a house finds an heir", () => {
  it("names a kinsman first, the nearest who is fit, and does not go outside the family while one is", () => {
    const { world: bare, head } = withoutAnHeir();
    const son = aMan(bare, head, "test-son", "Marcus Sicinius Rufus", "fit", 28);
    const cousin = aMan(son.world, head, "test-cousin", "Lucius Sicinius Naso", "fit", 40);
    const steward = aMan(cousin.world, head, "test-steward", "Hermes", "fit", 33);
    let world = kinOf(kinOf(steward.world, head, son.man, "parent"), head, cousin.man, "other_relative");
    world = onlyThese(stewardOf(world, head, steward.man), head.id, son.man.id, cousin.man.id, steward.man.id);
    const before = world;
    const found = looked(world, "kin");
    expect(person(found.world, head.id).heirCharacterId).toBe(son.man.id);
    // A kinsman is named, not adopted: nothing changes of his name, nothing is recorded as an adoption and no gift is made.
    expect(person(found.world, son.man.id).name).toBe("Marcus Sicinius Rufus");
    expect(found.world.lifeContracts.length).toBe(before.lifeContracts.length);
    expect(purseOf(found.world, head.id)).toBe(purseOf(before, head.id));
    expect(found.facts.map((fact) => fact.kind)).toEqual(["house_heir_kin"]);
    expect(found.facts[0]!.summary).toMatch(/Marcus Sicinius Rufus/);
    // The steward is still the steward.
    expect(found.world.material.contracts.find((contract) => contract.employeeCharacterId === steward.man.id)!.status).toBe("active");
  });

  it("passes over a kinsman who is not fit, and a head who thinks ill of one", () => {
    const { world: bare, head } = withoutAnHeir();
    const feckless = aMan(bare, head, "test-feckless", "Gaius Sicinius Piso", "unfit", 26);
    const hated = aMan(feckless.world, head, "test-hated", "Quintus Sicinius Cato", "fit", 31);
    let world = kinOf(kinOf(hated.world, head, feckless.man, "parent"), head, hated.man, "parent");
    world = { ...world, characters: world.characters.map((character) => (character.id === head.id ? { ...character, relations: [{ subjectCharacterId: hated.man.id, causes: [{ id: "feud", label: "A quarrel over the will.", score: -60, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null }] }] } : character)) };
    const found = looked(onlyThese(world, head.id, feckless.man.id, hated.man.id), "unfit");
    expect(named(found.world, head.id)).toBeNull();
    expect(found.facts).toEqual([]);
    expect(economyOf(found.world).houses.find((entry) => entry.id === `house-${slug}`)!.heirSoughtAtStep).toBe(DAY);
  });

  it("adopts the man who kept its books when there is no kin: he is made a son, takes the name, and is paid for it out of the head's purse", () => {
    const { world: bare, head } = withoutAnHeir();
    const steward = aMan(bare, head, "test-steward", "Hermes", "fit", 33);
    const nephew = aMan(steward.world, head, "test-nephew", "Gaius Sicinius Piso", "unfit", 26);
    const world = onlyThese(kinOf(stewardOf(nephew.world, head, steward.man), head, nephew.man, "other_relative"), head.id, steward.man.id, nephew.man.id);
    const found = looked(world, "adopt");
    const adopted = person(found.world, steward.man.id);
    expect(person(found.world, head.id).heirCharacterId).toBe(steward.man.id);
    // Rome: his own praenomen, the head's nomen and cognomen.
    expect(adopted.name).toBe(`Hermes ${head.name.split(" ").slice(1).join(" ")}`);
    expect(adopted.ordo).toBeDefined();
    // A real member of the family, in the graph, in the social links, and in a contract of adoption.
    expect(familyLinksOf(found.world, head.id).some((view) => view.kind === "parent" && view.counterpartCharacterId === adopted.id)).toBe(true);
    expect(found.world.socialLinks.some((link) => link.subjectCharacterId === head.id && link.targetCharacterId === adopted.id && link.kind === "kin")).toBe(true);
    const contract = found.world.lifeContracts.find((entry) => entry.type === "adoption_or_heir_designation")!;
    expect(contract.partyCharacterIds).toEqual([head.id, adopted.id]);
    expect(contract.status).toBe("active");
    // His service is done, and he is paid a gift of the head's money, which is a transfer and no making of money.
    expect(found.world.material.contracts.find((entry) => entry.employeeCharacterId === adopted.id)!.status).toBe("ended");
    const gift = purseOf(found.world, adopted.id) - purseOf(world, adopted.id);
    expect(gift).toBeGreaterThanOrEqual(400);
    expect(gift).toBeLessThanOrEqual(6_000);
    expect(purseOf(world, head.id) - purseOf(found.world, head.id)).toBe(gift);
    const audit = auditMoney(atDay(world, DAY), found.world);
    expect(audit.unexplained, auditInWords(audit)).toEqual([]);
    expect(found.facts.map((fact) => fact.kind)).toEqual(["house_heir_adopted"]);
  });

  it("asks a man who will not, and he refuses by his own nature: the house is left with nobody named", () => {
    const { world: bare, head } = withoutAnHeir();
    const steward = aMan(bare, head, "test-steward", "Hermes", "unwilling", 33);
    const world = onlyThese(stewardOf(steward.world, head, steward.man), head.id, steward.man.id);
    const found = looked(world, "refuses");
    expect(named(found.world, head.id)).toBeNull();
    expect(person(found.world, steward.man.id).name).toBe("Hermes");
    expect(found.world.lifeContracts.some((entry) => entry.type === "adoption_or_heir_designation")).toBe(false);
  });

  it("keeps the estate in the family tree: the adopted heir takes the purse and the cargoes when the head dies, and follows him", () => {
    const { world: bare, head } = withoutAnHeir();
    const steward = aMan(bare, head, "test-steward", "Hermes", "fit", 33);
    let world = onlyThese(stewardOf(steward.world, head, steward.man), head.id, steward.man.id);
    const adopted = looked(world, "estate").world;
    const venture = {
      id: "venture-test", title: "The publicani: grain from Ostia to Puteoli", ownerCharacterId: head.id, fromProvinceId: head.locationProvinceId, toProvinceId: head.locationProvinceId, bySea: true,
      incomeSourceId: "income-test", openedAtStep: DAY - 5, interruptedBy: null, status: "running" as const,
      cargo: { cost: 9_000, good: "grain" as const, units: 300, sailedAtStep: DAY - 5, arrivesAtStep: DAY + 20, voyages: 0, rollsOver: false },
    };
    world = { ...adopted, material: { ...adopted.material, ventures: [...adopted.material.ventures, venture] } };
    const purse = purseOf(world, head.id);
    const successor = person(world, steward.man.id);
    const before = purseOf(world, successor.id);
    const dead = killCharacter(atDay(world, DAY + 5), head.id, "Of a fever.", DAY + 5);
    expect(purseOf(dead.world, successor.id)).toBe(before + purse);
    expect(purseOf(dead.world, head.id)).toBe(0);
    expect(dead.world.material.ventures.find((entry) => entry.id === "venture-test")!.ownerCharacterId).toBe(successor.id);
    const audit = auditMoney(atDay(world, DAY + 5), dead.world);
    expect(audit.unexplained, auditInWords(audit)).toEqual([]);
    // And the house is his, the same month.
    const followed = keepTheLine(atDay(dead.world, DAY + 6), DAY + 6, ids("follows"), new Set([house(world, slug).id]));
    expect(house(followed.world, slug)).toMatchObject({ headCharacterId: successor.id, status: "trading" });
    expect(followed.facts.some((fact) => fact.kind === "house_succeeds")).toBe(true);
    // He has no heir of his own, and the line is looked to again at once (a man of the city, or nobody, but never a dead name).
    expect(person(followed.world, successor.id).heirCharacterId === null || person(followed.world, person(followed.world, successor.id).heirCharacterId!).alive).toBe(true);
  });

  it("brings in a new man only when there is nobody, after half a year, and by one throw a year: not always", () => {
    const { world: bare, head } = withoutAnHeir();
    const alone = onlyThese(bare, head.id);
    const houseId = house(alone, slug).id;
    const capital = purseOf(alone, head.id);
    const chance = newManChanceBps(capital, head);
    expect(chance).toBeGreaterThan(1_500);
    expect(chance).toBeLessThan(5_000);
    // The first look finds nobody and marks the day; the next month finds nobody; the throw is not made before half a year.
    const first = looked(alone, "none-1");
    expect(named(first.world, head.id)).toBeNull();
    expect(economyOf(first.world).houses.find((entry) => entry.id === houseId)!.heirSoughtAtStep).toBe(DAY);
    const soon = keepTheLine(atDay(first.world, DAY + 90), DAY + 90, ids("none-2"), new Set([houseId]));
    expect(named(soon.world, head.id)).toBeNull();
    // A year when the throw passes, and one when it does not.
    const passes = (year: number): boolean => stableHash([houseId, head.id, "new-man", year]) % 10_000 < chance;
    const lucky = [...Array(20).keys()].map((year) => year + 2).find(passes)!;
    const unlucky = [...Array(20).keys()].map((year) => year + 2).find((year) => !passes(year))!;
    const at = (year: number): number => year * 365 + 100;
    const marked = { ...first.world, economy: { ...economyOf(first.world), houses: economyOf(first.world).houses.map((entry) => (entry.id === houseId ? { ...entry, heirSoughtAtStep: at(unlucky) - 400 } : entry)) } };
    const missed = keepTheLine(atDay(marked, at(unlucky)), at(unlucky), ids("unlucky"), new Set([houseId]));
    expect(named(missed.world, head.id)).toBeNull();
    const markedLucky = { ...first.world, economy: { ...economyOf(first.world), houses: economyOf(first.world).houses.map((entry) => (entry.id === houseId ? { ...entry, heirSoughtAtStep: at(lucky) - 400 } : entry)) } };
    const found = keepTheLine(atDay(markedLucky, at(lucky)), at(lucky), ids("lucky"), new Set([houseId]));
    const heirId = person(found.world, head.id).heirCharacterId;
    expect(heirId).not.toBeNull();
    const heir = person(found.world, heirId!);
    expect(heir.alive).toBe(true);
    expect(heir.createdByDirector).toBe(true);
    expect(found.facts.map((fact) => fact.kind)).toEqual(["house_heir_found"]);
    expect(economyOf(found.world).houses.find((entry) => entry.id === houseId)!.heirSoughtAtStep).toBeNull();
    // A man who arrives in the world brings his means with him, which the books know as an endowment, and nothing else is made.
    const audit = auditMoney(atDay(markedLucky, at(lucky)), found.world);
    expect(audit.unexplained, auditInWords(audit)).toEqual([]);
  });

  it("winds the house up when the head dies with nobody: the coin goes to his power's treasury, the cargoes are closed", () => {
    const { world: bare, head } = withoutAnHeir();
    const alone = onlyThese(bare, head.id);
    const venture = {
      id: "venture-test", title: "The publicani: oil", ownerCharacterId: head.id, fromProvinceId: head.locationProvinceId, toProvinceId: head.locationProvinceId, bySea: true,
      incomeSourceId: "income-test", openedAtStep: DAY - 5, interruptedBy: null, status: "running" as const,
      cargo: { cost: 9_000, good: "grain" as const, units: 300, sailedAtStep: DAY - 5, arrivesAtStep: DAY + 20, voyages: 0, rollsOver: false },
    };
    const world = { ...alone, material: { ...alone.material, ventures: [...alone.material.ventures, venture] } };
    const treasury = treasuryOf(world, "rome")!;
    const purse = purseOf(world, head.id);
    const dead = killCharacter(atDay(world, DAY + 5), head.id, "Of a fever.", DAY + 5);
    const ended = keepTheLine(atDay(dead.world, DAY + 6), DAY + 6, ids("wound"), new Set([house(world, slug).id]));
    expect(house(ended.world, slug).status).toBe("wound_up");
    expect(ended.world.material.ventures.find((entry) => entry.id === "venture-test")!.status).toBe("closed");
    const chest = (state: WorldState): number => state.material.accounts.find((account) => account.id === treasury)!.balance;
    expect(chest(ended.world) - chest(world)).toBeGreaterThanOrEqual(purse);
    expect(ended.facts.map((fact) => fact.kind)).toEqual(["house_ends"]);
    const audit = auditMoney(atDay(world, DAY + 5), ended.world);
    expect(audit.unexplained, auditInWords(audit)).toEqual([]);
  });

  it("is the same on every replay, whoever looks and in whatever order the men were made", () => {
    const { world: bare, head } = withoutAnHeir();
    const steward = aMan(bare, head, "test-steward", "Hermes", "fit", 33);
    const other = aMan(steward.world, head, "test-other", "Lucius Aurelius", "fit", 36);
    const world = onlyThese(stewardOf(other.world, head, steward.man), head.id, steward.man.id, other.man.id);
    const once = looked(world, "same-a");
    const again = looked(world, "same-a");
    expect(JSON.stringify(again.world)).toBe(JSON.stringify(once.world));
    expect(again.facts).toEqual(once.facts);
    const reversed = { ...world, characters: [...world.characters].reverse() };
    expect(person(looked(reversed, "same-a").world, head.id).heirCharacterId).toBe(person(once.world, head.id).heirCharacterId);
  });
});

describe("every house keeps its line over a year", { timeout: 300_000 }, () => {
  it("makes good the heirs of seventeen houses that all die in the second month, month by month, with the books balancing", () => {
    let world: WorldState = opening(0);
    for (const entry of economyOf(world).houses) world = killCharacter(world, headOf(world, entry.id.replace("house-", "")).heirCharacterId!, "Of a fever.", 20).world;
    const kinds = new Map<string, number>();
    for (let month = 1; month <= 10; month += 1) {
      const toDay = month * 30;
      const before: WorldState = { ...world, elapsedStep: toDay, instant: { day: toDay, minute: 0 } };
      const ticked = runDeterministicTick({ world: before, toDay, ids: createIdFactory(`line-${month}`), warfare: definition.warfare, clock: definition.clock, life: definition.life });
      const audit = auditMoney(before, ticked.world);
      expect(audit.unexplained, `month ${month}:
${auditInWords(audit)}`).toEqual([]);
      for (const fact of ticked.factProposals) if (fact.kind.startsWith("house_heir")) kinds.set(fact.kind, (kinds.get(fact.kind) ?? 0) + 1);
      world = { ...ticked.world, instant: { day: toDay, minute: 0 }, elapsedStep: toDay };
    }
    const trading = economyOf(world).houses.filter((entry) => entry.status === "trading");
    expect(trading.length).toBe(17);
    // Many have an heir again, and not all (a new man is not found for every house); where the throw missed the head goes on with nobody named and the line is looked to again.
    const followed = trading.filter((entry) => named(world, entry.headCharacterId) !== null);
    expect(followed.length).toBeGreaterThanOrEqual(5);
    expect(followed.length).toBeLessThan(17);
    // A new man is the way of last resort: where it was needed it was found, and it was not the way of every house.
    const found = kinds.get("house_heir_found") ?? 0;
    expect(found).toBeGreaterThan(0);
    expect(found).toBeLessThan(17);
    expect((kinds.get("house_heir_adopted") ?? 0) + found + (kinds.get("house_heir_kin") ?? 0)).toBe(followed.length);
  });
});
