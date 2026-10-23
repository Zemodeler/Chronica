import { describe, expect, it } from "vitest";
import { atWar, economyOf, isOccupied, treasuryOf, type Character, type WorldState } from "@chronica/shared";
import { decideFiscal } from "./fiscal-officers";
import { applyDecision, atDay, input, opening, withChest, withIncome, withWar } from "./fiscal-test-kit";
import { keepTheSeats, nearestSeatOf, PLUNDER_BPS, REMOVAL_BPS } from "./house-seat";
import { auditInWords, auditMoney } from "./money-audit";
import { createIdFactory } from "./ports";

/**
 * "Syracuse is Carthage's now. Whose house is the house of Philistion?"
 *
 * A house was given its power and its home market at the seeding and kept them: when its city changed hands it went on lending to the
 * power that had lost it. A house is its head's. Its power is the power the head belongs to; its seat is the market it trades from, and
 * where that city is taken by a power at war with the head's the head flees to a market of his own power, at a cost, or if his power
 * has none the house is plundered and ended; where the new holder is no enemy the house stays and the head's allegiance goes with the
 * city (unless he is a man whose duty is to his own city, who goes). Lending, the liturgy and the customs follow the head's power.
 */

const DAY = 400;
const slug = "philistion-syracuse";
const PUNIC = "bodashtart-carthage";
const houseOf = (world: WorldState, which = slug) => economyOf(world).houses.find((entry) => entry.id === `house-${which}`)!;
const person = (world: WorldState, id: string): Character => world.characters.find((character) => character.id === id)!;
const headOf = (world: WorldState, which = slug): Character => person(world, houseOf(world, which).headCharacterId);
const purseOf = (world: WorldState, id: string): number => world.material.accounts.find((account) => account.id === person(world, id).personalAccountId)!.balance;
const controller = (world: WorldState, id: string): string | null => world.map.provinces.find((province) => province.id === id)!.controllerPolityId;

/** A province taken by a power: held by it, and owned by it unless it is only occupied. */
function taken(world: WorldState, provinceId: string, by: string, occupation = false): WorldState {
  return {
    ...world,
    map: {
      ...world.map,
      provinces: world.map.provinces.map((province) => (province.id !== provinceId ? province : {
        ...province, controllerPolityId: by, ownerPolityId: occupation ? province.ownerPolityId ?? province.controllerPolityId : by,
        settlements: province.settlements.map((settlement) => ({ ...settlement, controllerPolityId: by })),
      })),
    },
  };
}

const withDuty = (world: WorldState, id: string, duty: number): WorldState => ({
  ...world, characters: world.characters.map((character) => (character.id === id ? { ...character, mind: { ...character.mind, drives: { ...character.mind.drives, duty } } } : character)),
});

const kept = (world: WorldState, label: string, which = slug, at = DAY) => keepTheSeats(atDay(world, at), at, createIdFactory(`seat-${label}`), new Set([houseOf(world, which).id]));

describe("a house follows its city", () => {
  const start = opening(DAY);
  const house = houseOf(start);
  const head = headOf(start);
  const home = house.homeProvinceId;

  it("starts under the power its head belongs to, in the market where he lives", () => {
    expect(house.polityId).toBe("syracuse");
    expect(head.polityId).toBe("syracuse");
    expect(controller(start, home)).toBe("syracuse");
    const quiet = kept(start, "quiet");
    expect(houseOf(quiet.world)).toMatchObject({ polityId: "syracuse", homeProvinceId: home, status: "trading" });
    expect(quiet.facts).toEqual([]);
  });

  it("follows its head when he changes his allegiance, and lends to the treasury of the power he is now of", () => {
    // The richest house of Carthage: its head goes over to Syracuse, whose treasury is empty in a war.
    const carthaginian = houseOf(start, PUNIC);
    const lender = carthaginian.headCharacterId;
    const moved: WorldState = { ...start, characters: start.characters.map((character) => (character.id === lender ? { ...character, polityId: "syracuse" } : character)) };
    expect(houseOf(moved, PUNIC).polityId).toBe("carthage");
    const seen = kept(moved, "allegiance", PUNIC);
    expect(houseOf(seen.world, PUNIC)).toMatchObject({ polityId: "syracuse", homeProvinceId: carthaginian.homeProvinceId });
    expect(person(seen.world, lender).polityId).toBe("syracuse");
    const needy = (world: WorldState): WorldState => withIncome(withChest(withWar(world, "syracuse", "rome"), "syracuse", 1_000, 60_000), "syracuse", 0.05);
    const lenders = (world: WorldState): string[] => decideFiscal(input(atDay(needy(world), 400)))
      .filter((found) => found.polityId === "syracuse").flatMap((found) => found.deltas.flatMap((delta) => (delta.op === "loan_open" && delta.lenderKind === "character" ? [delta.lenderRef!] : [])));
    // Before the house followed its head, Syracuse's officer could not ask it; after, he asks it first, for it is the richest purse he can ask.
    expect(lenders(moved)).not.toContain(lender);
    expect(lenders(seen.world)[0]).toBe(lender);
    const world = atDay(needy(seen.world), 400);
    const done = applyDecision(world, decideFiscal(input(world)).find((found) => found.polityId === "syracuse")!);
    expect(done.rejected).toEqual([]);
    expect(done.world.material.loans.some((loan) => loan.borrowerAccountId === "syracuse-treasury" && loan.lenderId === lender)).toBe(true);
    const audit = auditMoney(world, done.world);
    expect(audit.unexplained, auditInWords(audit)).toEqual([]);
  });

  it("flees a city taken by a power at war with its own, to the nearest market of its own power, at a cost", () => {
    const carthaginian = houseOf(start, PUNIC);
    const head = headOf(start, PUNIC);
    const warred = taken(withWar(start, "carthage", "rome"), carthaginian.homeProvinceId, "rome");
    expect(atWar(warred.polityAgreements, "carthage", "rome")).toBe(true);
    const seat = nearestSeatOf(warred, carthaginian.homeProvinceId, "carthage");
    expect(seat).not.toBeNull();
    expect(controller(warred, seat!)).toBe("carthage");
    const before = purseOf(warred, head.id);
    const fled = kept(warred, "flees", PUNIC);
    const after = houseOf(fled.world, PUNIC);
    expect(after).toMatchObject({ polityId: "carthage", homeProvinceId: seat, status: "trading" });
    expect(person(fled.world, head.id).locationProvinceId).toBe(seat);
    expect(person(fled.world, head.heirCharacterId!).locationProvinceId).toBe(seat);
    // A part of his purse is lost in the going, through the door of the men nobody names, and nothing else is made or lost.
    expect(before - purseOf(fled.world, head.id)).toBe(Math.round((before * REMOVAL_BPS) / 10_000));
    const audit = auditMoney(atDay(warred, DAY), fled.world);
    expect(audit.unexplained, auditInWords(audit)).toEqual([]);
    expect(audit.doors.the_unnamed.out).toBeGreaterThan(0);
    expect(fled.facts.map((fact) => fact.kind)).toEqual(["house_removes"]);
    // Its power's trade is still its own: it stays Syracuse's house.
    expect(person(fled.world, head.id).polityId).toBe("carthage");
    // The next look finds it where it is, in a city that is its own power's, and does nothing.
    const later = keepTheSeats(atDay(fled.world, DAY + 30), DAY + 30, createIdFactory("seat-later"), new Set([after.id]));
    expect(houseOf(later.world, PUNIC)).toMatchObject({ homeProvinceId: seat, polityId: "carthage" });
    expect(later.facts).toEqual([]);
  });

  it("is plundered and ended where its power has no market left, and half of the purse goes to the power that took the city", () => {
    let world = withWar(start, "syracuse", "carthage");
    for (const province of start.map.provinces) if (province.controllerPolityId === "syracuse") world = taken(world, province.id, "carthage");
    expect(nearestSeatOf(world, home, "syracuse")).toBeNull();
    const venture = {
      id: "venture-test", title: "The house of Philistion: grain", ownerCharacterId: head.id, fromProvinceId: home, toProvinceId: home, bySea: true,
      incomeSourceId: "income-test", openedAtStep: DAY - 5, interruptedBy: null, status: "running" as const,
      cargo: { cost: 9_000, good: "grain" as const, units: 300, sailedAtStep: DAY - 5, arrivesAtStep: DAY + 20, voyages: 0, rollsOver: false },
    };
    world = { ...world, material: { ...world.material, ventures: [...world.material.ventures, venture] } };
    const chest = treasuryOf(world, "carthage")!;
    const balance = (state: WorldState): number => state.material.accounts.find((account) => account.id === chest)!.balance;
    const purse = purseOf(world, head.id);
    const ended = kept(world, "plundered");
    expect(houseOf(ended.world).status).toBe("wound_up");
    expect(purse - purseOf(ended.world, head.id)).toBe(Math.round((purse * PLUNDER_BPS) / 10_000));
    expect(balance(ended.world) - balance(world)).toBe(purse - purseOf(ended.world, head.id));
    expect(ended.world.material.ventures.find((entry) => entry.id === "venture-test")!.status).toBe("closed");
    expect(ended.facts.map((fact) => fact.kind)).toEqual(["house_ends"]);
    const audit = auditMoney(atDay(world, DAY), ended.world);
    expect(audit.unexplained, auditInWords(audit)).toEqual([]);
  });

  it("stays in a city that passes to a power it is not at war with, and its head's allegiance goes with the city", () => {
    expect(atWar(start.polityAgreements, "syracuse", "rome")).toBe(false);
    const ceded = taken(withDuty(start, head.id, 30), home, "rome");
    const after = kept(ceded, "ceded");
    expect(houseOf(after.world)).toMatchObject({ polityId: "rome", homeProvinceId: home, status: "trading" });
    expect(person(after.world, head.id).polityId).toBe("rome");
    expect(person(after.world, head.heirCharacterId!).polityId).toBe("rome");
    expect(purseOf(after.world, head.id)).toBe(purseOf(ceded, head.id));
    expect(after.facts.map((fact) => fact.kind)).toEqual(["house_changes_power"]);
    // The liturgy and the customs it pays are the new holder's: the owner of the cargo is of Rome.
    const audit = auditMoney(atDay(ceded, DAY), after.world);
    expect(audit.unexplained, auditInWords(audit)).toEqual([]);
  });

  it("goes, when the head's duty is to his own city, to a market of his own power instead of changing it", () => {
    expect(atWar(start.polityAgreements, "carthage", "rome")).toBe(false);
    const carthaginian = houseOf(start, PUNIC);
    const ceded = taken(withDuty(start, carthaginian.headCharacterId, 90), carthaginian.homeProvinceId, "rome");
    const after = kept(ceded, "faithful", PUNIC);
    expect(person(after.world, carthaginian.headCharacterId).polityId).toBe("carthage");
    expect(houseOf(after.world, PUNIC).polityId).toBe("carthage");
    expect(houseOf(after.world, PUNIC).homeProvinceId).not.toBe(carthaginian.homeProvinceId);
    expect(controller(after.world, houseOf(after.world, PUNIC).homeProvinceId)).toBe("carthage");
    expect(after.facts.map((fact) => fact.kind)).toEqual(["house_removes"]);
  });

  it("is not moved by a garrison of a friend in a city that is still its own power's", () => {
    const garrisoned = taken(start, home, "rome", true);
    expect(isOccupied(garrisoned.map.provinces.find((province) => province.id === home)!)).toBe(true);
    const after = kept(garrisoned, "garrison");
    expect(houseOf(after.world)).toMatchObject({ polityId: "syracuse", homeProvinceId: home });
    expect(person(after.world, head.id).polityId).toBe("syracuse");
    expect(after.facts).toEqual([]);
  });

  it("is the same on every replay", () => {
    const warred = taken(withWar(start, "syracuse", "carthage"), home, "carthage");
    expect(JSON.stringify(kept(warred, "same").world)).toBe(JSON.stringify(kept(warred, "same").world));
  });
});
