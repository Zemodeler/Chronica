import { describe, expect, it } from "vitest";
import {
  WorldDeltaSchema,
  economyOf,
  fitStrengthOf,
  isNavalForce,
  modernWordsIn,
  stableHash,
  type Convoy,
  type Force,
  type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { housesFor, keepVictualling, MARGIN_BPS, monthlyBill, priceOfBread, victuallerOf } from "./army-victualling";
import { keepContracts } from "./contracts";
import { deliverConvoys, grainPrice } from "./grain";
import { auditMoney } from "./money-audit";
import { purseOfHouse } from "./merchant-houses";
import { createIdFactory } from "./ports";
import { decideTheMonth } from "./government-test-kit";
import { definition, government, withChest, withWar } from "./fiscal-test-kit";
import { stockedWorld } from "./grain-test-kit";
import { auditInWords } from "./money-audit";
import { runDeterministicTick } from "./tick";

/**
 * A house victuals the army (v58).
 *
 * An army at war draws bread by contract with a trading house of its own power: for a term of months, at the market's price and a margin, paid for what
 * reaches it. The house buys the grain out of the hubs it can reach (the market door, the hubs' prices rising), sends it as a convoy, and takes the loss
 * if it is taken or drowned; the treasury pays it by an obligation reckoned on what arrived, and a house that goes unpaid walks out of the contract.
 */

const ARMY = "roman-field-army";
const army = (world: WorldState): Force => world.material.forces.find((force) => force.id === ARMY)!;
const treasuryOf = (world: WorldState): string => world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === "rome")!.id;

const atWarWorld = (): WorldState => withWar(stockedWorld(150, 2.2, [], 3_000_000), "rome", "carthage");

function letTheContract(world: WorldState, days = 180) {
  const consul = world.material.officeSeats.find((seat) => /consul/.test(seat.officeId) && seat.holderCharacterId !== null)!.holderCharacterId!;
  const delta = WorldDeltaSchema.parse({ op: "force_provision", forceRef: ARMY, how: "contract", days, fromProvinceId: null, payAccountRef: treasuryOf(world), reason: "The consul lets the feeding of the army to a house." });
  return applyDeltas(world, [delta], {
    now: { day: world.instant.day, minute: 540 }, actorRef: { kind: "character", id: consul }, offices: government.offices, successionRules: government.successionRules,
    warfare: definition.warfare, ids: createIdFactory("victual"), gameId: "game-victual", actsForTheWorld: true,
  });
}

describe("a house victuals the army", () => {
  it("is let for a term at the market's price and a margin, to a house of the army's own power that has the means", () => {
    const world = atWarWorld();
    expect(housesFor(world, "rome").length).toBeGreaterThan(0);
    const result = letTheContract(world);
    expect(result.rejected).toEqual([]);
    const contract = victuallerOf(result.world, ARMY)!;
    expect(contract.role).toBe("victualler");
    expect(contract.victuals!.pricePerThousand).toBe(priceOfBread(world, "rome", army(world).locationId));
    // The market's price (what a thousand men's bread costs where the army stands) and the margin over it.
    expect(contract.victuals!.pricePerThousand).toBe(Math.round((grainPrice(world, "rome", army(world).locationId) * (10_000 + MARGIN_BPS)) / 10_000));
    expect(contract.endsAtStep! - contract.openedAtStep).toBe(180);
    // The employer is the chest, the man hired the head of a house of Rome, and his pay a monthly obligation to his purse.
    expect(contract.employerAccountId).toBe(treasuryOf(world));
    const house = economyOf(result.world).houses.find((candidate) => candidate.id === contract.victuals!.houseId)!;
    expect(house.headCharacterId).toBe(contract.employeeCharacterId);
    expect(housesFor(world, "rome").map((candidate) => candidate.id)).toContain(house.id);
    const obligation = result.world.material.obligations.find((row) => row.id === contract.obligationId)!;
    expect(obligation.payerAccountId).toBe(treasuryOf(world));
    expect(obligation.recipientAccountId).toBe(purseOfHouse(world, house)!.id);
    expect(result.factProposals.some((fact) => fact.kind === "army_victualled")).toBe(true);
    // One house, one army: a second contract for the same army is refused.
    expect(letTheContract(result.world).rejected.length).toBe(1);
  });

  it("buys the month's bread out of the hubs, through the market door, and sends it as a convoy of the contract", () => {
    const world = atWarWorld();
    const result = letTheContract(world);
    const contract = victuallerOf(result.world, ARMY)!;
    const convoy = result.world.convoys.find((candidate) => candidate.contractId === contract.id)!;
    expect(convoy.status).toBe("on_the_road");
    expect(convoy.forceId).toBe(ARMY);
    expect(convoy.toProvinceId).toBe(army(world).locationId);
    expect(convoy.arrivesAtStep).toBeGreaterThan(world.elapsedStep);
    expect(convoy.days).toBeGreaterThanOrEqual(1);
    expect(convoy.men).toBe(fitStrengthOf(army(world)));
    expect(contract.victuals!.sentManDays).toBe(convoy.days * convoy.men);
    // The house paid for it out of its own purse; the chest paid nothing yet.
    const house = economyOf(world).houses.find((candidate) => candidate.id === contract.victuals!.houseId)!;
    expect(purseOfHouse(result.world, house)!.balance).toBeLessThan(purseOfHouse(world, house)!.balance);
    const chest = (state: WorldState): number => state.material.accounts.find((account) => account.id === treasuryOf(world))!.balance;
    expect(chest(result.world)).toBe(chest(world));
    const audit = auditMoney(world, result.world);
    expect(audit.unexplained).toEqual([]);
    expect(audit.doors.market.out).toBeGreaterThan(0);
  });

  it("feeds the army when the convoy comes, and counts the bread to the contract for the next reckoning", () => {
    const world = atWarWorld();
    const sent = letTheContract(world).world;
    const contract = victuallerOf(sent, ARMY)!;
    const convoy = sent.convoys.find((candidate) => candidate.contractId === contract.id)!;
    const arrived = deliverConvoys(sent, convoy.arrivesAtStep, definition.warfare);
    const after = arrived.world.convoys.find((candidate) => candidate.id === convoy.id)!;
    if (after.status === "delivered") {
      expect(army(arrived.world).provisionedThroughStep).toBeGreaterThan(army(sent).provisionedThroughStep - 1);
      expect(victuallerOf(arrived.world, ARMY)!.victuals!.deliveredManDays).toBe(convoy.days * convoy.men);
      // The pay is reckoned on what arrived, once a month, and the next month's bread is sent.
      const month = keepVictualling(arrived.world, contract.victuals!.passedAtStep + 31, createIdFactory("month"));
      const reckoned = victuallerOf(month.world, ARMY)!;
      const owed = Math.round((reckoned.victuals!.pricePerThousand * convoy.days * convoy.men) / 1_000);
      expect(reckoned.monthlyPay).toBe(owed);
      expect(month.world.material.obligations.find((row) => row.id === reckoned.obligationId)!.amount).toBe(owed);
      expect(reckoned.victuals!.deliveredManDays).toBe(0);
      expect(month.world.convoys.filter((candidate) => candidate.contractId === contract.id).length).toBeGreaterThanOrEqual(2);
    } else {
      // Lost at sea this time: not paid for.
      expect(after.status).toBe("lost");
      expect(victuallerOf(arrived.world, ARMY)!.victuals!.deliveredManDays).toBe(0);
      expect(victuallerOf(arrived.world, ARMY)!.victuals!.lostManDays).toBe(convoy.days * convoy.men);
    }
  });

  it("is the house's loss when an enemy takes the convoy: not paid for, and written against the house", () => {
    const world = atWarWorld();
    const sent = letTheContract(world).world;
    const contract = victuallerOf(sent, ARMY)!;
    const real = sent.convoys.find((candidate) => candidate.contractId === contract.id)!;
    // A convoy whose own rolls say the enemy takes it and the sea does not (found by the same rolls the delivery reads), and an enemy at the army's door.
    let id = "";
    for (let n = 0; n < 5_000; n += 1) {
      const candidate = `convoy-seed-${n}`;
      if (stableHash([candidate, "at-sea"]) % 10_000 >= 2_500 && stableHash([candidate, "intercept"]) % 10_000 < 1_500) { id = candidate; break; }
    }
    expect(id).not.toBe("");
    const taken: Convoy = { ...real, id };
    const enemy = world.material.forces.filter((force) => force.polityId === "carthage" && fitStrengthOf(force) > 0 && !isNavalForce(force, definition.warfare)).sort((a, b) => fitStrengthOf(b) - fitStrengthOf(a))[0]!;
    const besieged: WorldState = {
      ...sent,
      convoys: sent.convoys.map((candidate) => (candidate.id === real.id ? taken : candidate)),
      material: { ...sent.material, forces: sent.material.forces.map((force) => (force.id === enemy.id ? { ...force, locationId: real.toProvinceId } : force)) },
    };
    const result = deliverConvoys(besieged, taken.arrivesAtStep, definition.warfare);
    expect(result.world.convoys.find((candidate) => candidate.id === id)!.status).toBe("taken");
    const after = victuallerOf(result.world, ARMY)!;
    expect(after.victuals!.deliveredManDays).toBe(0);
    expect(after.victuals!.lostManDays).toBe(taken.days * taken.men);
    const house = economyOf(result.world).houses.find((candidate) => candidate.id === after.victuals!.houseId)!;
    expect(house.losses).toBe(economyOf(sent).houses.find((candidate) => candidate.id === house.id)!.losses + 1);
    expect(result.facts.some((fact) => fact.kind === "convoy_taken")).toBe(true);
  });

  it("lapses when the treasury stops paying, and the house is out of what it laid out", () => {
    const world = atWarWorld();
    const sent = letTheContract(world).world;
    const contract = victuallerOf(sent, ARMY)!;
    // The chest has missed the pay three periods running (the grace of a company in sound silver is two).
    const unpaid: WorldState = {
      ...sent,
      material: { ...sent.material, obligations: sent.material.obligations.map((row) => (row.id === contract.obligationId ? { ...row, missedPeriods: 3, arrears: 9_000 } : row)) },
    };
    const lapsed = keepContracts(unpaid, 400);
    const ended = lapsed.world.material.contracts.find((row) => row.id === contract.id)!;
    expect(ended.status).toBe("lapsed");
    expect(victuallerOf(lapsed.world, ARMY)).toBeUndefined();
    expect(lapsed.world.material.obligations.find((row) => row.id === contract.obligationId)!.active).toBe(false);
    const house = economyOf(lapsed.world).houses.find((candidate) => candidate.id === contract.victuals!.houseId)!;
    expect(house.losses).toBe(economyOf(sent).houses.find((candidate) => candidate.id === house.id)!.losses + 1);
    const fact = lapsed.facts.find((candidate) => candidate.kind === "contract_lapsed")!;
    expect(fact.summary).toMatch(/without being paid for the bread/);
    expect(modernWordsIn(fact.summary)).toEqual([]);
    // A contract the chest keeps paying is not lapsed.
    expect(keepContracts(sent, 200).world.material.contracts.find((row) => row.id === contract.id)!.status).toBe("active");
  });

  it("ends when the army is gone, and the house is not asked to feed a dead one", () => {
    const world = atWarWorld();
    const sent = letTheContract(world).world;
    const contract = victuallerOf(sent, ARMY)!;
    const gone: WorldState = { ...sent, material: { ...sent.material, forces: sent.material.forces.filter((force) => force.id !== ARMY) } };
    const month = keepVictualling(gone, contract.openedAtStep + 40, createIdFactory("gone"));
    expect(victuallerOf(month.world, ARMY)).toBeUndefined();
    expect(month.facts.some((fact) => fact.kind === "army_victualling_ended")).toBe(true);
  });

  it("is let by the officer who feeds the armies, when an army is hungry and a house has the means, and is gated as spending", () => {
    let world = withChest(atWarWorld(), "rome", 6_000_000);
    world = { ...world, material: { ...world.material, forces: world.material.forces.map((force) => (force.id === ARMY ? { ...force, provisionStatus: "critical" as const, provisionedThroughStep: 0 } : force)) } };
    const found = [150, 180, 210, 240, 270].flatMap((day) => decideTheMonth(world, day)).find((decision) => /^supply:/.test(decision.why));
    expect(found, "the officer of supply acts for a hungry army within the first months").toBeDefined();
    const delta = found!.deltas.find((candidate) => candidate.op === "force_provision");
    if (delta !== undefined && delta.op === "force_provision" && delta.how === "contract") {
      expect(found!.why).toMatch(/by contract/);
      expect(delta.days).toBe(180);
    }
    // A small army is fed by the chest's purchase: no contract.
    const small: WorldState = { ...world, material: { ...world.material, forces: world.material.forces.map((force) => (force.id === ARMY ? { ...force, personnel: force.personnel.map((group) => ({ ...group, fit: Math.min(group.fit, 100) })) } : force)) } };
    const smallOne = [150, 180, 210].flatMap((day) => decideTheMonth(small, day)).find((decision) => /^supply:/.test(decision.why));
    if (smallOne !== undefined) expect(smallOne.deltas.every((candidate) => candidate.op !== "force_provision" || candidate.how !== "contract")).toBe(true);
    expect(monthlyBill(world, army(world))).toBeGreaterThan(0);
  });

  it("is refused for a fleet, and for a power with no house of its own to take it", () => {
    const world = atWarWorld();
    const none: WorldState = { ...world, economy: { ...economyOf(world), houses: economyOf(world).houses.filter((house) => (house.seatPolityId ?? house.polityId) !== "rome") } };
    expect(letTheContract(none).rejected.length).toBe(1);
    const fleet = world.material.forces.find((force) => force.id === "allied-greek-hulls")!;
    const consul = world.material.officeSeats.find((seat) => /consul/.test(seat.officeId) && seat.holderCharacterId !== null)!.holderCharacterId!;
    const delta = WorldDeltaSchema.parse({ op: "force_provision", forceRef: fleet.id, how: "contract", days: 180, fromProvinceId: null, payAccountRef: treasuryOf(world), reason: "Feed the fleet." });
    const result = applyDeltas(world, [delta], { now: world.instant, actorRef: { kind: "character", id: consul }, offices: government.offices, successionRules: government.successionRules, warfare: definition.warfare, ids: createIdFactory("fleet"), gameId: "g", actsForTheWorld: true });
    expect(result.rejected.length).toBe(1);
  });

  it("is paid by the chest for what arrived, month by month, and the money audit finds every drachma across the term", { timeout: 300_000 }, () => {
    let world: WorldState = letTheContract(atWarWorld()).world;
    const contractId = victuallerOf(world, ARMY)!.id;
    const houseId = victuallerOf(world, ARMY)!.victuals!.houseId;
    const purse = (state: WorldState): number => purseOfHouse(state, economyOf(state).houses.find((house) => house.id === houseId)!)!.balance;
    const startedWith = purse(world);
    let paid = 0;
    for (let month = 6; month <= 14; month += 1) {
      const toDay = month * 30;
      const before: WorldState = { ...world, elapsedStep: toDay, instant: { day: toDay, minute: 0 } };
      const ticked = runDeterministicTick({ world: before, toDay, ids: createIdFactory(`victual-tick-${month}`), warfare: definition.warfare, clock: definition.clock, life: definition.life });
      const audit = auditMoney(before, ticked.world);
      expect(audit.unexplained, `month ${month}:
${auditInWords(audit)}`).toEqual([]);
      paid += ticked.world.material.transactions.filter((line) => !before.material.transactions.some((known) => known.id === line.id) && line.cause.id === victuallerOf(ticked.world, ARMY)?.obligationId).reduce((sum, line) => sum + line.amount, 0);
      world = { ...ticked.world, elapsedStep: toDay, instant: { day: toDay, minute: 0 } };
    }
    const contract = world.material.contracts.find((row) => row.id === contractId)!;
    // The house sent bread, month after month, and was paid for what reached the army.
    expect(contract.victuals!.sentManDays).toBeGreaterThan(fitStrengthOf(army(world)) * 30);
    expect(paid).toBeGreaterThan(0);
    expect(purse(world)).toBeGreaterThan(startedWith - 150_000);
    expect(["active", "lapsed", "ended"]).toContain(contract.status);
  });

  it("is the same on every run", () => {
    const a = letTheContract(atWarWorld()).world;
    const b = letTheContract(atWarWorld()).world;
    expect(JSON.stringify(a.convoys)).toBe(JSON.stringify(b.convoys));
    expect(JSON.stringify(a.material.contracts)).toBe(JSON.stringify(b.material.contracts));
  });
});
