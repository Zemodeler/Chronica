import { describe, expect, it } from "vitest";
import { createCanonicalNpc, economyOf, estateWasSoldUp, treasuryOf, type Character, type Loan, type WorldState } from "@chronica/shared";
import { atDay, opening } from "./fiscal-test-kit";
import { keepTheLine } from "./house-succession";
import { auditInWords, auditMoney } from "./money-audit";
import { killCharacter } from "./mortality";
import { createIdFactory } from "./ports";

/**
 * "A man's creditors are paid before his heirs have anything."
 *
 * A dead man's debts died with a house that was wound up, and went whole to the heir, whatever the estate held, when there was one. Now the
 * estate pays them first, in the order the age's law kept: the secured (a pledge was the creditor's before anyone's), then the public
 * debts (the fiscus ahead of other creditors), then the private loans in proportion. An heir whose estate covers its debts takes what is
 * left of them with it (the universal successor); an heir who faces more debt than estate may abstain, and the estate is sold up to the
 * creditors, a debt beyond it being lost to them. Money only moves between purses: the audit stays green.
 */

const DAY = 400;
const person = (world: WorldState, id: string): Character => world.characters.find((character) => character.id === id)!;
const account = (world: WorldState, id: string) => world.material.accounts.find((entry) => entry.id === id)!;
const purse = (world: WorldState, id: string): number => account(world, person(world, id).personalAccountId).balance;
const loan = (world: WorldState, id: string): Loan => world.material.loans.find((entry) => entry.id === id)!;

/** A man of Rome with a purse, a named heir and the age to have died. */
function aMan(world: WorldState, id: string, money: number, heirId: string | null = null): { world: WorldState; man: Character } {
  const seat = world.characters.find((character) => character.polityId === "rome" && character.alive)!;
  const made = createCanonicalNpc(world, {
    characterId: id, name: `Gaius Testius ${id}`, locationProvinceId: seat.locationProvinceId, polityId: "rome", createdAtStep: 0, creationReason: "A test man.",
    ageYearsAtStart: 55, cultureId: "roman", faithId: seat.faithId, startingMoney: money,
  })!;
  const man: Character = { ...made.character, heirCharacterId: heirId };
  return { world: { ...made.world, characters: made.world.characters.map((character) => (character.id === id ? man : character)) }, man };
}

interface Debt { id: string; lender: { kind: "character" | "polity" | "foreign"; id: string | null }; owed: number; pledge?: string }

/** Loans on the man's purse, each with the obligation that services it. */
function owing(world: WorldState, debtor: Character, debts: readonly Debt[]): WorldState {
  const loans: Loan[] = [];
  const obligations = [...world.material.obligations];
  for (const debt of debts) {
    const lenderAccount = debt.lender.kind === "foreign" ? undefined : world.material.accounts.find((entry) => entry.owner.kind === debt.lender.kind && entry.owner.id === debt.lender.id);
    obligations.push({
      id: `obligation-${debt.id}`, kind: "debt_service", label: `Repayment of ${debt.id}`, payerAccountId: debtor.personalAccountId, ...(lenderAccount === undefined ? {} : { recipientAccountId: lenderAccount.id }),
      amount: Math.round(debt.owed / 12) + 1, cadenceSteps: 30, nextDueStep: DAY + 30, priority: 400, arrears: 0, missedPeriods: 0, active: true, remainingPeriods: 12,
    });
    loans.push({
      id: debt.id, lenderKind: debt.lender.kind, lenderId: debt.lender.id, borrowerAccountId: debtor.personalAccountId, principal: debt.owed, outstanding: debt.owed, interestBps: 100,
      cadenceSteps: 30, serviceObligationId: `obligation-${debt.id}`, terms: `the loan ${debt.id}`, collateralHoldingId: debt.pledge ?? null, status: "active", openedAtStep: DAY - 100,
    });
  }
  return { ...world, material: { ...world.material, loans: [...world.material.loans, ...loans], obligations } };
}

/** A farm in the man's name, paying 100 a month (worth about 12,000: ten years' rent). */
function withFarm(world: WorldState, holderId: string, id: string): WorldState {
  const holder = person(world, holderId);
  const province = holder.locationProvinceId;
  return {
    ...world,
    material: {
      ...world.material,
      incomeSources: [...world.material.incomeSources, { id: `income-${id}`, kind: "land", label: `The farm ${id}`, beneficiaryAccountId: holder.personalAccountId, originKind: "holding", originId: id, amount: 100, cadenceSteps: 30, nextDueStep: DAY + 30, collectionRateBps: 10_000, counterpartyPolityId: null, active: true }],
      holdings: [...world.material.holdings, { id, title: `The farm ${id}`, territoryId: province, legalHolderCharacterId: holderId, incomeSourceId: `income-${id}`, successionRuleId: "customary", physicalControlBps: 10_000 }],
    },
  };
}

/** The heir, two private lenders, and the man himself, with `coin` in his purse. */
function scene(coin: number): { world: WorldState; dead: Character; heir: Character; lenderA: Character; lenderB: Character } {
  let world = atDay(opening(DAY - 10), DAY);
  const heir = aMan(world, "test-heir", 1_000); world = heir.world;
  const lenderA = aMan(world, "test-lender-a", 5_000); world = lenderA.world;
  const lenderB = aMan(world, "test-lender-b", 5_000); world = lenderB.world;
  const dead = aMan(world, "test-debtor", coin, heir.man.id); world = dead.world;
  return { world, dead: dead.man, heir: heir.man, lenderA: lenderA.man, lenderB: lenderB.man };
}

const die = (world: WorldState, id: string) => killCharacter(world, id, "Of a fever.", DAY + 5);

describe("the creditors are paid first", () => {
  it("pays the debts out of the estate before the heir has any of it, and the heir has what is left", () => {
    const s = scene(30_000);
    const debts: Debt[] = [
      { id: "loan-a", lender: { kind: "character", id: s.lenderA.id }, owed: 5_000 },
      { id: "loan-public", lender: { kind: "polity", id: "rome" }, owed: 3_000 },
    ];
    const world = owing(s.world, s.dead, debts);
    const chest = treasuryOf(world, "rome")!;
    const dead = die(world, s.dead.id);
    expect(purse(dead.world, s.lenderA.id) - purse(world, s.lenderA.id)).toBe(5_000);
    expect(account(dead.world, chest).balance - account(world, chest).balance).toBe(3_000);
    expect(purse(dead.world, s.heir.id) - purse(world, s.heir.id)).toBe(22_000);
    expect(loan(dead.world, "loan-a").status).toBe("repaid");
    expect(loan(dead.world, "loan-public").status).toBe("repaid");
    expect(dead.world.material.obligations.find((entry) => entry.id === "obligation-loan-a")!.active).toBe(false);
    expect(dead.facts.map((fact) => fact.kind)).toContain("estate_creditors");
    const audit = auditMoney(world, dead.world);
    expect(audit.unexplained, auditInWords(audit)).toEqual([]);
  });

  it("pays the secured first, then the public debt, then the private loans, and an heir who takes the estate takes the rest of the debt with it", () => {
    let s = scene(6_000);
    s = { ...s, world: withFarm(s.world, s.dead.id, "farm-pledged") };
    const world = owing(s.world, s.dead, [
      { id: "loan-private", lender: { kind: "character", id: s.lenderB.id }, owed: 4_000 },
      { id: "loan-public", lender: { kind: "polity", id: "rome" }, owed: 3_000 },
      { id: "loan-secured", lender: { kind: "character", id: s.lenderA.id }, owed: 4_000, pledge: "farm-pledged" },
    ]);
    const chest = treasuryOf(world, "rome")!;
    const dead = die(world, s.dead.id);
    // The farm is worth some 12,000: the estate covers its debts (11,000), so the heir takes it, and the coin goes by the order.
    expect(purse(dead.world, s.lenderA.id) - purse(world, s.lenderA.id)).toBe(4_000);
    expect(account(dead.world, chest).balance - account(world, chest).balance).toBe(2_000);
    expect(purse(dead.world, s.lenderB.id) - purse(world, s.lenderB.id)).toBe(0);
    expect(loan(dead.world, "loan-secured").status).toBe("repaid");
    expect(loan(dead.world, "loan-public").outstanding).toBe(1_000);
    expect(loan(dead.world, "loan-public").borrowerAccountId).toBe(s.heir.personalAccountId);
    expect(loan(dead.world, "loan-private").outstanding).toBe(4_000);
    expect(loan(dead.world, "loan-private").borrowerAccountId).toBe(s.heir.personalAccountId);
    expect(dead.world.material.holdings.find((entry) => entry.id === "farm-pledged")!.legalHolderCharacterId).toBe(s.heir.id);
    expect(estateWasSoldUp(dead.world, s.dead.id)).toBe(false);
    const audit = auditMoney(world, dead.world);
    expect(audit.unexplained, auditInWords(audit)).toEqual([]);
  });

  it("shares what is left among the private loans in proportion to what each is owed", () => {
    const s = scene(6_000);
    const world = owing(s.world, s.dead, [
      { id: "loan-a", lender: { kind: "character", id: s.lenderA.id }, owed: 3_000 },
      { id: "loan-b", lender: { kind: "character", id: s.lenderB.id }, owed: 6_000 },
    ]);
    // 9,000 owed against 6,000: the heir abstains and the creditors share the coin by what they are owed.
    const dead = die(world, s.dead.id);
    expect(purse(dead.world, s.lenderA.id) - purse(world, s.lenderA.id)).toBe(2_000);
    expect(purse(dead.world, s.lenderB.id) - purse(world, s.lenderB.id)).toBe(4_000);
    const audit = auditMoney(world, dead.world);
    expect(audit.unexplained, auditInWords(audit)).toEqual([]);
  });

  it("lets an heir abstain from an estate that owes more than it holds: the creditors have it sold up, a debt beyond it is lost to them, the heir has nothing", () => {
    const s = scene(6_000);
    const world = owing(s.world, s.dead, [
      { id: "loan-public", lender: { kind: "polity", id: "rome" }, owed: 3_000 },
      { id: "loan-a", lender: { kind: "character", id: s.lenderA.id }, owed: 3_000 },
      { id: "loan-b", lender: { kind: "character", id: s.lenderB.id }, owed: 6_000 },
    ]);
    const chest = treasuryOf(world, "rome")!;
    const dead = die(world, s.dead.id);
    // The treasury first, in full; what is left (3,000) between the two private lenders as 1 to 2.
    expect(account(dead.world, chest).balance - account(world, chest).balance).toBe(3_000);
    expect(purse(dead.world, s.lenderA.id) - purse(world, s.lenderA.id)).toBe(1_000);
    expect(purse(dead.world, s.lenderB.id) - purse(world, s.lenderB.id)).toBe(2_000);
    expect(purse(dead.world, s.heir.id)).toBe(purse(world, s.heir.id));
    for (const id of ["loan-a", "loan-b"]) {
      expect(loan(dead.world, id).status).toBe("defaulted");
      expect(loan(dead.world, id).outstanding).toBe(0);
      expect(dead.world.material.obligations.find((entry) => entry.id === `obligation-${id}`)!.active).toBe(false);
    }
    expect(estateWasSoldUp(dead.world, s.dead.id)).toBe(true);
    const fact = dead.facts.find((entry) => entry.kind === "estate_creditors")!;
    expect(fact.summary).toMatch(/refused the estate/);
    expect(fact.summary).toMatch(/6000 is lost/);
    const audit = auditMoney(world, dead.world);
    expect(audit.unexplained, auditInWords(audit)).toEqual([]);
  });

  it("gives a pledged farm to the man it was pledged to when the estate is sold up, and land and cargoes to the creditors still owed", () => {
    let s = scene(1_000);
    s = { ...s, world: withFarm(withFarm(s.world, s.dead.id, "farm-pledged"), s.dead.id, "farm-free") };
    const world = owing(s.world, s.dead, [
      { id: "loan-secured", lender: { kind: "character", id: s.lenderA.id }, owed: 9_000, pledge: "farm-pledged" },
      { id: "loan-b", lender: { kind: "character", id: s.lenderB.id }, owed: 30_000 },
    ]);
    const dead = die(world, s.dead.id);
    expect(estateWasSoldUp(dead.world, s.dead.id)).toBe(true);
    const farm = (id: string) => dead.world.material.holdings.find((entry) => entry.id === id)!;
    expect(farm("farm-pledged").legalHolderCharacterId).toBe(s.lenderA.id);
    expect(dead.world.material.incomeSources.find((entry) => entry.id === "income-farm-pledged")!.beneficiaryAccountId).toBe(s.lenderA.personalAccountId);
    // The free farm goes to the creditor still owed (the secured one is satisfied).
    expect(farm("farm-free").legalHolderCharacterId).toBe(s.lenderB.id);
    expect(person(dead.world, s.heir.id).id).toBe(s.heir.id);
    expect(dead.world.material.holdings.filter((entry) => entry.legalHolderCharacterId === s.heir.id).length).toBe(0);
    const audit = auditMoney(world, dead.world);
    expect(audit.unexplained, auditInWords(audit)).toEqual([]);
  });

  it("pays a foreign banker out through the credit door, and still balances", () => {
    const s = scene(8_000);
    const world = owing(s.world, s.dead, [{ id: "loan-abroad", lender: { kind: "foreign", id: null }, owed: 5_000 }]);
    const dead = die(world, s.dead.id);
    expect(loan(dead.world, "loan-abroad").status).toBe("repaid");
    expect(purse(dead.world, s.heir.id) - purse(world, s.heir.id)).toBe(3_000);
    expect(dead.world.material.transactions.some((entry) => entry.external === "credit" && entry.amount === 5_000 && entry.sourceAccountId === s.dead.personalAccountId)).toBe(true);
    const audit = auditMoney(world, dead.world);
    expect(audit.unexplained, auditInWords(audit)).toEqual([]);
  });

  it("pays the creditors of a man with no heir before the treasury has the rest", () => {
    let s = scene(10_000);
    s = { ...s, world: { ...s.world, characters: s.world.characters.map((character) => (character.id === s.dead.id ? { ...character, heirCharacterId: null } : character)) } };
    const world = owing(s.world, s.dead, [{ id: "loan-a", lender: { kind: "character", id: s.lenderA.id }, owed: 4_000 }]);
    const chest = treasuryOf(world, "rome")!;
    const dead = die(world, s.dead.id);
    expect(purse(dead.world, s.lenderA.id) - purse(world, s.lenderA.id)).toBe(4_000);
    expect(account(dead.world, chest).balance - account(world, chest).balance).toBe(6_000);
    const audit = auditMoney(world, dead.world);
    expect(audit.unexplained, auditInWords(audit)).toEqual([]);
  });

  it("is the same on every replay, whatever order the men were made in", () => {
    const s = scene(6_000);
    const world = owing(s.world, s.dead, [
      { id: "loan-a", lender: { kind: "character", id: s.lenderA.id }, owed: 3_000 },
      { id: "loan-b", lender: { kind: "character", id: s.lenderB.id }, owed: 6_000 },
    ]);
    const once = die(world, s.dead.id);
    const again = die(world, s.dead.id);
    expect(JSON.stringify(again.world)).toBe(JSON.stringify(once.world));
    const reversed = die({ ...world, characters: [...world.characters].reverse() }, s.dead.id);
    expect(reversed.world.material.loans.map((entry) => [entry.id, entry.status, entry.outstanding]).sort()).toEqual(once.world.material.loans.map((entry) => [entry.id, entry.status, entry.outstanding]).sort());
  });

  it("winds up a house whose head's heir abstained: the house is not the heir's to take up with nothing", () => {
    let world = atDay(opening(DAY - 10), DAY);
    const house = economyOf(world).houses.find((entry) => entry.id === "house-publicani-rome")!;
    const head = person(world, house.headCharacterId);
    const lender = aMan(world, "test-banker", 5_000); world = lender.world;
    // The head owes more than the house is worth, so the son who was to follow him refuses it.
    world = owing(world, head, [{ id: "loan-huge", lender: { kind: "character", id: lender.man.id }, owed: 900_000 }]);
    const dead = die(world, head.id);
    expect(estateWasSoldUp(dead.world, head.id)).toBe(true);
    const looked = keepTheLine(atDay(dead.world, DAY + 6), DAY + 6, createIdFactory("abstained"), new Set([house.id]));
    expect(economyOf(looked.world).houses.find((entry) => entry.id === house.id)!.status).toBe("wound_up");
    const audit = auditMoney(atDay(world, DAY), looked.world);
    expect(audit.unexplained, auditInWords(audit)).toEqual([]);
  });
});
