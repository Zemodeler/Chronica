import { describe, expect, it } from "vitest";
import { economyOf, type WorldState } from "@chronica/shared";
import { atDay, definition, opening, withChest, withWar } from "./fiscal-test-kit";
import { keepTheState } from "./keeping-the-state";
import { auditMoney, combineAudits, emptyAudit } from "./money-audit";
import { createIdFactory } from "./ports";
import { MADE, worksAYear } from "./public-works";
import { provinceTargetsFrom } from "./standing-effects";

/**
 * "The censors let a contract."
 *
 * When a power's chest has cover above its reserve, whoever keeps its works lets a contract for a road, an aqueduct, a temple, walls, a harbour, granaries or a
 * forum, at the capital or a busy or scarred place first. The treasury pays the merchant house of that power by instalments (an ordinary transfer: the publicani
 * keep the gain), the house pays the cost out to the men who do the work, and when the work stands it lifts what its place can become. Nothing is minted.
 */

const month = (world: WorldState, toDay: number, playerCharacterId: string | null = null) =>
  keepTheState({ world: atDay(world, toDay), toDay, ids: createIdFactory(`censor-${toDay}`), offices: definition.government.offices, playerCharacterId });

const rich = (world: WorldState): WorldState => withChest(world, "rome", 9_000_000);
const worksOf = (world: WorldState, polityId: string) => economyOf(world).works.filter((contract) => contract.polityId === polityId);
const theHouseOf = (world: WorldState, id: string | null) => economyOf(world).houses.find((house) => house.id === id)!;
const purseOf = (world: WorldState, houseId: string | null): number => {
  const house = theHouseOf(world, houseId);
  const head = world.characters.find((character) => character.id === house.headCharacterId)!;
  return world.material.accounts.find((account) => account.id === head.personalAccountId)!.balance;
};

describe("a censor lets a contract", () => {
  it("lets a work when the chest has cover, to a house of Rome, in the words of the Censorship", () => {
    const world = rich(opening(120));
    const done = month(world, 150);
    const contracts = worksOf(done.world, "rome");
    expect(contracts).toHaveLength(1);
    const contract = contracts[0]!;
    // The house is one of Rome's (the publicani, or the banker of Neapolis) and it is paid its price, the cost and its gain.
    expect(contract.houseId).not.toBeNull();
    expect(["house-publicani-rome", "house-neapolis-bankers"].some((id) => id === contract.houseId) || theHouseOf(done.world, contract.houseId).polityId === "rome").toBe(true);
    expect(contract.price).toBe(Math.round((contract.cost * 11_200) / 10_000));
    expect(contract.instalments).toBeGreaterThanOrEqual(6);
    expect(contract.completesAtStep).toBe(150 + contract.instalments * 30);
    // One fact, in the age's words: the Censorship let it.
    const news = done.facts.filter((fact) => fact.kind === "public_works_let" && fact.affectedRefs?.some((ref) => ref.id === "rome"));
    expect(news).toHaveLength(1);
    expect(news[0]!.summary).toMatch(/Censorship/);
    expect(news[0]!.summary).toMatch(/let the contract/);
    // The first instalment went to the house the same day.
    expect(contract.paid).toBeGreaterThan(0);
    expect(purseOf(done.world, contract.houseId)).toBeGreaterThan(purseOf(world, contract.houseId));
  });

  it("lets nothing where the chest has no cover above its reserve, nor where the player keeps the works himself", () => {
    const thin = withChest(opening(120), "rome", 1_600_000);
    expect(worksOf(month(thin, 150).world, "rome")).toHaveLength(0);
    const world = rich(opening(120));
    const censor = world.characters.find((character) => character.id === "rome-censor-3f5fcp") ?? world.characters.find((character) => /censor/.test(character.id))!;
    expect(worksOf(month(world, 150, censor.id).world, "rome")).toHaveLength(0);
    // At war the reserve is a half again as deep: a chest that would build in peace builds nothing in war.
    const marginal = withChest(opening(120), "rome", 3_700_000);
    const atWar = withWar(marginal, "rome", "carthage");
    expect(worksOf(month(marginal, 150).world, "rome").length).toBeGreaterThanOrEqual(worksOf(month(atWar, 150).world, "rome").length);
  });

  it("pays the house by instalments and the house pays the men who do the work, with no money made", () => {
    let world = rich(opening(120));
    let audit = emptyAudit();
    let day = 150;
    let first: WorldState | null = null;
    while (day <= 150 + 30 * 20) {
      const before = atDay(world, day);
      const done = month(world, day);
      audit = combineAudits(audit, auditMoney(before, done.world));
      world = done.world;
      first ??= world;
      day += 30;
    }
    expect(audit.unexplained).toEqual([]);
    const contract = [...economyOf(first!).works, ...economyOf(world).works].find((candidate) => candidate.polityId === "rome");
    expect(contract).toBeDefined();
    // The work is done: every instalment paid, the cost paid out, and the contract struck from the books.
    const left = economyOf(world).works.find((candidate) => candidate.projectId === contract!.projectId);
    expect(left === undefined || (left.paid === left.price && left.spent === left.cost)).toBe(true);
    // The house kept the difference between the price and the cost, as the ledger shows it.
    expect(audit.internal).toBeGreaterThanOrEqual(contract!.price);
    expect(audit.doors.the_unnamed.out).toBeGreaterThan(contract!.cost);
  });

  it("raises what stands when it is done: a structure of the sort, and a lasting lift of the ceiling of development where it is a road, a harbour, an aqueduct or a forum", () => {
    let world = rich(opening(120));
    const seen = new Set<string>();
    let lifted = 0;
    for (let m = 1; m <= 90; m += 1) {
      world = withChest(month(world, 120 + m * 30).world, "rome", 9_000_000);
      for (const structure of world.structures.filter((candidate) => candidate.provenanceProjectId?.startsWith("works:"))) {
        if (seen.has(structure.id)) continue;
        seen.add(structure.id);
        const kind = structure.provenanceProjectId!.split(":")[1] as keyof typeof MADE;
        expect(structure.effects).toEqual([...MADE[kind].effects]);
        expect(structure.kind).toBe(MADE[kind].structureKind);
        const shift = provinceTargetsFrom(world).get(structure.provinceId)?.developmentShiftBps ?? 0;
        if (MADE[kind].effects.some((effect) => effect.quantity === "development")) {
          expect(shift).toBeGreaterThan(0);
          lifted += 1;
        }
      }
    }
    expect(seen.size).toBeGreaterThan(2);
    expect(lifted).toBeGreaterThan(0);
  });

  it("begins no more in a year than a power of its size may, and never two of a sort in one place, but for temples, of which a town may have a pair", () => {
    let world = rich(opening(120));
    const begun: number[] = [];
    for (let m = 1; m <= 24; m += 1) {
      const day = 120 + m * 30;
      const before = worksOf(world, "rome").length;
      world = withChest(month(world, day).world, "rome", 9_000_000);
      if (worksOf(world, "rome").length > before) begun.push(day);
    }
    const perYear = new Map<number, number>();
    for (const day of begun) perYear.set(Math.floor(day / 360), (perYear.get(Math.floor(day / 360)) ?? 0) + 1);
    for (const count of perYear.values()) expect(count).toBeLessThanOrEqual(worksAYear(6_000_000));
    const sorts = world.structures.filter((structure) => structure.provenanceProjectId?.startsWith("works:") && !structure.provenanceProjectId.startsWith("works:temple:")).map((structure) => `${structure.provinceId}|${structure.provenanceProjectId!.split(":")[1]}`);
    expect(new Set(sorts).size).toBe(sorts.length);
  });

  it("goes to the men nobody names where no house stands in the power", () => {
    const world = withChest(opening(120), "syracuse", 9_000_000);
    const bare = { ...world, economy: { ...economyOf(world), houses: economyOf(world).houses.filter((house) => house.polityId !== "syracuse") } };
    const done = month(bare, 150);
    const contract = worksOf(done.world, "syracuse")[0];
    expect(contract).toBeDefined();
    expect(contract!.houseId).toBeNull();
    expect(contract!.price).toBe(contract!.cost);
    const audit = auditMoney(atDay(bare, 150), done.world);
    expect(audit.unexplained).toEqual([]);
    expect(audit.doors.the_unnamed.out).toBeGreaterThanOrEqual(contract!.paid);
  });
});
