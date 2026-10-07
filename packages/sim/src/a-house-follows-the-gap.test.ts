import { describe, expect, it } from "vitest";
import {
  GOODS,
  PolityAgreementSchema,
  economyOf,
  ensureMarkets,
  marketEntry,
  marketGeography,
  priceBpsFrom,
  settleEstate,
  type GoodId,
  type WorldState,
} from "@chronica/shared";
import { PUNIC_IDS } from "@chronica/db";
import { landCargoes } from "./cargoes";
import { dutyOnCargoBps, houseOfVenture, voyageIsLost, voyageLossBps } from "./house-voyages";
import { keepMerchantHouses, pairsFor, purseOfHouse, readTheMonth } from "./merchant-houses";
import { auditInWords, auditMoney } from "./money-audit";
import { createIdFactory } from "./ports";
import { applyDecision, atDay, input, opening, withChest, withIncome, withWar } from "./fiscal-test-kit";
import { decideFiscal } from "./fiscal-officers";

/**
 * "Bread is dear in Syracuse and cheap on the Libyan coast. Fill a ship."
 *
 * The trade between the markets was an aggregate: goods moved because they were dearer in one hub than the next
 * and nobody moved them. A dozen families now do. Each is a head with a purse and a home market; once a month
 * it looks for the gap in prices it can carry goods across and, where one is worth the risk, buys the goods out of one
 * hub's stock and sends them to the other as an ordinary venture with a cargo. The war and the embargo stop it as they stop
 * any merchant, the sea takes some of what it sends, the crew and the customs take their share of what comes in, and
 * a house with money to spare lends to its own power's treasury when the treasury's officer asks.
 */

const geography = (world: WorldState) => marketGeography(world);
const hubOfProvince = (world: WorldState, provinceId: string): string => geography(world).hubOf.get(provinceId)!;
const SYRACUSE = PUNIC_IDS.syracuse;

/** A hub's stock of a good set to a share of its target, and priced as it would be. */
function stocked(world: WorldState, hubId: string, good: GoodId, share: number): WorldState {
  return {
    ...world,
    economy: {
      ...world.economy!,
      markets: world.economy!.markets.map((hub) => (hub.hubId !== hubId ? hub : {
        ...hub,
        goods: hub.goods.map((entry) => {
          if (entry.good !== good) return entry;
          const stock = Math.round(entry.target * share);
          return { ...entry, stock, priceBps: priceBpsFrom(GOODS.find((spec) => spec.id === good)!, stock, entry.target) };
        }),
      })),
    },
  };
}

/** The opening world with its markets reckoned, and the hub of Syracuse short of bread while the Libyan coast has plenty. */
function breadIsDearAtSyracuse(): WorldState {
  const base = ensureMarkets(opening(60));
  const hub = hubOfProvince(base, SYRACUSE);
  let world = stocked(base, hub, "grain", 0.2);
  for (const id of ["afr-0xt4a", "afr-nh05y", "afr-9sdex"]) world = stocked(world, id, "grain", 1.6);
  return world;
}

/**
 * The world with a venture's sailing moved to a day on which the sea lets it through, or takes it: the roll is fixed by the cargo and the
 * day it sailed, so the test picks the day. Returns the world and the day the ship comes in.
 */
function resail(world: WorldState, ventureId: string, lost: boolean): { world: WorldState; arrives: number } {
  const venture = world.material.ventures.find((candidate) => candidate.id === ventureId)!;
  const cargo = venture.cargo!;
  const duration = cargo.arrivesAtStep - cargo.sailedAtStep;
  const lossBps = voyageLossBps(true, duration, 10_000, 10_000);
  let sailed = cargo.sailedAtStep;
  while (voyageIsLost({ id: venture.id, cargo: { ...cargo, sailedAtStep: sailed } }, lossBps) !== lost) sailed += 1;
  return {
    world: { ...world, material: { ...world.material, ventures: world.material.ventures.map((candidate) => (candidate.id === ventureId ? { ...candidate, cargo: { ...cargo, sailedAtStep: sailed, arrivesAtStep: sailed + duration } } : candidate)) } },
    arrives: sailed + duration,
  };
}

const houseNamed = (world: WorldState, slug: string) => economyOf(world).houses.find((house) => house.id === `house-${slug}`)!;
const cargoesOf = (world: WorldState, headId: string) => world.material.ventures.filter((venture) => venture.ownerCharacterId === headId);

describe("a house follows the gap", () => {
  it("is seated in the Punic world: seventeen families, each with a head, an heir and a purse, none of them in a cast or a council", () => {
    const world = opening();
    const houses = economyOf(world).houses;
    expect(houses.length).toBeGreaterThanOrEqual(14);
    expect(houses.length).toBeLessThanOrEqual(20);
    for (const house of houses) {
      const head = world.characters.find((character) => character.id === house.headCharacterId)!;
      expect(head.alive).toBe(true);
      expect(head.officeId).toBeNull();
      expect(world.characters.find((character) => character.id === head.heirCharacterId)?.alive).toBe(true);
      expect(purseOfHouse(world, house)!.balance).toBeGreaterThanOrEqual(80_000);
      expect(world.map.provinces.find((province) => province.id === house.homeProvinceId)?.controllerPolityId).toBe(house.polityId);
    }
    // Each great power's merchants are its own: Carthage's Tyrian-descended families, Rome's publicani.
    expect(houses.filter((house) => house.polityId === "carthage").length).toBeGreaterThanOrEqual(4);
    expect(houses.some((house) => house.kind === "publicani" && house.polityId === "rome")).toBe(true);
    expect(world.cast.members.some((member) => houses.some((house) => house.headCharacterId === member.characterId))).toBe(false);
  });

  it("buys bread where it is cheap and sends it to where it is dear, and the goods leave one stock and reach the other", () => {
    const world = breadIsDearAtSyracuse();
    const dion = houseNamed(world, "dion-syracuse");
    const before = purseOfHouse(world, dion)!.balance;
    const month = keepMerchantHouses(atDay(world, 90), 90, createIdFactory("house-open"));
    const opened = cargoesOf(month.world, dion.headCharacterId);
    expect(opened.length).toBeGreaterThan(0);
    // The best of the pairs is bread into Syracuse, and it is a cargo like any other (`TradeVenture`), by sea, a single sailing.
    const toSyracuse = opened.find((venture) => venture.toProvinceId === hubOfProvince(world, SYRACUSE))!;
    expect(toSyracuse, "a Syracusan house sends bread to its own dear market").toBeDefined();
    expect(toSyracuse.cargo).toMatchObject({ good: "grain", rollsOver: false, voyages: 0 });
    expect(toSyracuse.bySea).toBe(true);
    // What it paid left its purse; what it bought left the far hub's stock, by the units the cargo carries.
    const spent = before - purseOfHouse(month.world, dion)!.balance;
    expect(spent).toBeGreaterThanOrEqual(toSyracuse.cargo!.cost);
    // (The other house of Syracuse may have bought from the same hub: the stock fell by what every cargo from it carries.)
    const drawn = marketEntry(world, toSyracuse.fromProvinceId, "grain")!.stock - marketEntry(month.world, toSyracuse.fromProvinceId, "grain")!.stock;
    const carried = month.world.material.ventures.filter((venture) => venture.fromProvinceId === toSyracuse.fromProvinceId && venture.cargo?.good === "grain").reduce((sum, venture) => sum + (venture.cargo!.units ?? 0), 0);
    expect(drawn).toBe(carried);
    expect(drawn).toBeGreaterThanOrEqual(toSyracuse.cargo!.units!);
    // At most three cargoes are out for a house, and two are opened in a month.
    expect(opened.length).toBeLessThanOrEqual(2);
    // And the books balance: the goods were bought at the market's door and nothing else came or went.
    const audit = auditMoney(world, month.world);
    expect(audit.unexplained, auditInWords(audit)).toEqual([]);
    // It is not opened again in the same month, nor above three in all.
    expect(keepMerchantHouses(month.world, 91, createIdFactory("again")).world).toBe(month.world);
  });

  it("makes a profit when the ship comes in, less the crew and the duty, and puts its goods into the far market", () => {
    const world = breadIsDearAtSyracuse();
    const dion = houseNamed(world, "dion-syracuse");
    const month = keepMerchantHouses(atDay(world, 90), 90, createIdFactory("house-profit"));
    const venture = cargoesOf(month.world, dion.headCharacterId).find((candidate) => candidate.toProvinceId === hubOfProvince(world, SYRACUSE))!;
    // A cargo that is not the one the sea takes: a day it sailed on that the roll lets through.
    const alone = { ...month.world, material: { ...month.world.material, ventures: month.world.material.ventures.filter((candidate) => candidate.ownerCharacterId !== dion.headCharacterId || candidate.id === venture.id) } };
    const { world: safe, arrives } = resail(alone, venture.id, false);
    const purse = (w: WorldState) => purseOfHouse(w, dion)!.balance;
    const landed = landCargoes(safe, arrives, createIdFactory("house-landed"));
    const profit = purse(landed.world) - purse(safe);
    expect(profit, "the cargo sold for more than it cost, less the crew").toBeGreaterThan(venture.cargo!.cost);
    expect(profit).toBeLessThan(venture.cargo!.cost * 1.5);
    const stockBefore = marketEntry(safe, SYRACUSE, "grain")!.stock;
    expect(marketEntry(landed.world, SYRACUSE, "grain")!.stock).toBeGreaterThan(stockBefore);
    expect(landed.world.material.ventures.find((candidate) => candidate.id === venture.id)!.status).toBe("closed");
    // What it paid the crew went to the men nobody names; the sale came in through the market's door.
    const audit = auditMoney(safe, landed.world);
    expect(audit.unexplained, auditInWords(audit)).toEqual([]);
    expect(audit.doors.the_unnamed.out).toBeGreaterThan(0);
    expect(economyOf(landed.world).houses.find((house) => house.id === dion.id)!.voyages).toBe(dion.voyages + 1);
  });

  it("loses the cargo to the sea some of the time, which is a loss and a closed venture and no income", () => {
    const world = breadIsDearAtSyracuse();
    const dion = houseNamed(world, "dion-syracuse");
    const month = keepMerchantHouses(atDay(world, 90), 90, createIdFactory("house-lost"));
    const venture = cargoesOf(month.world, dion.headCharacterId)[0]!;
    // Alone at sea: the house's other cargo would come in the same day and pay.
    const alone = { ...month.world, material: { ...month.world.material, ventures: month.world.material.ventures.filter((candidate) => candidate.ownerCharacterId !== dion.headCharacterId || candidate.id === venture.id) } };
    const { world: doomed, arrives } = resail(alone, venture.id, true);
    const landed = landCargoes(doomed, arrives, createIdFactory("house-sunk"));
    expect(purseOfHouse(landed.world, dion)!.balance).toBe(purseOfHouse(doomed, dion)!.balance);
    expect(landed.world.material.ventures.find((candidate) => candidate.id === venture.id)!.status).toBe("closed");
    expect(economyOf(landed.world).houses.find((house) => house.id === dion.id)!.losses).toBe(dion.losses + 1);
    // Over many cargoes the sea takes a few in a hundred, and war at either end makes it worse.
    const rolls = (bps: number) => Array.from({ length: 2_000 }, (_, index) => voyageIsLost({ id: `cargo-${index}`, cargo: { cost: 1, sailedAtStep: index, arrivesAtStep: index + 20, voyages: 0, rollsOver: false } }, bps)).filter(Boolean).length;
    const peace = voyageLossBps(true, 25, 10_000, 10_000);
    const war = voyageLossBps(true, 25, 3_500, 10_000);
    expect(peace).toBeGreaterThan(100);
    expect(peace).toBeLessThan(500);
    expect(war).toBeGreaterThan(peace);
    expect(rolls(peace)).toBeGreaterThan(2_000 * peace / 10_000 * 0.5);
    expect(rolls(peace)).toBeLessThan(2_000 * peace / 10_000 * 1.6);
    // Only a house's cargo risks it: a stranger's venture is not touched.
    expect(houseOfVenture(world, { ownerCharacterId: "leptines-syracuse" })).toBeUndefined();
    expect(houseOfVenture(world, { ownerCharacterId: dion.headCharacterId })?.id).toBe(dion.id);
  });

  it("will not sail to a power its own is at war with, nor into a port that has laid an embargo on it", () => {
    const base = breadIsDearAtSyracuse();
    const dion = houseNamed(base, "dion-syracuse");
    const polityAt = (world: WorldState, provinceId: string) => world.map.provinces.find((province) => province.id === provinceId)!.controllerPolityId;
    const sails = (world: WorldState) => cargoesOf(keepMerchantHouses(atDay(world, 90), 90, createIdFactory("house-war")).world, dion.headCharacterId)
      .flatMap((venture) => [polityAt(world, venture.fromProvinceId), polityAt(world, venture.toProvinceId)]);
    // In peace the best of the markets is Carthage's own coast of Libya.
    expect(sails(base)).toContain("carthage");
    // At war with Carthage nothing is sent to its ports or bought in them.
    expect(sails(withWar(base, "syracuse", "carthage"))).not.toContain("carthage");
    // Nor into the markets of a power that has shut its trade to Syracuse.
    const embargoed: WorldState = {
      ...base,
      polityAgreements: [...base.polityAgreements, PolityAgreementSchema.parse({ id: "embargo-carthage-syracuse", kind: "embargo", polityId: "carthage", otherPolityId: "syracuse", terms: "No Syracusan ship in our ports.", trade: { goods: [] }, sinceStep: 0, status: "active" })],
    };
    expect(sails(embargoed)).not.toContain("carthage");
    // The pairs a house weighs are the same: no pair across the war is among them.
    const warring = withWar(base, "syracuse", "carthage");
    const reading = pairsFor(warring, dion, readTheMonth(warring), "syracuse", new Set());
    expect(reading.every((pair) => polityAt(base, pair.from) !== "carthage" && polityAt(base, pair.to) !== "carthage")).toBe(true);
  });

  it("charges the duty of the power it lands in, at the pact's cap where there is one", () => {
    const base = breadIsDearAtSyracuse();
    expect(dutyOnCargoBps(base, "syracuse", "syracuse", "grain")).toBe(0);
    const rate = economyOf(base).customsRates.find((entry) => entry.polityId === "carthage")!.rateBps;
    expect(dutyOnCargoBps(base, "syracuse", "carthage", "grain")).toBe(rate);
    const pacted: WorldState = { ...base, polityAgreements: [...base.polityAgreements, PolityAgreementSchema.parse({ id: "pact-s-c", kind: "trade_pact", polityId: "syracuse", otherPolityId: "carthage", terms: "A pact.", trade: { tariffCapBps: 300, mostFavoured: false, exempt: [], goods: [] }, sinceStep: 0, status: "active" })] };
    expect(dutyOnCargoBps(pacted, "syracuse", "carthage", "grain")).toBe(Math.min(rate, 300));
  });

  it("lends to a treasury that is empty in a war, at the rate of the market, and is repaid by the ordinary instalments", () => {
    const needy = withIncome(withChest(withWar(opening(), "carthage", "rome"), "carthage", 1_000, 90_000), "carthage", 0.05);
    const decision = [120, 150, 180, 210, 240, 270, 300].map((day) => decideFiscal(input(atDay(needy, day))).find((found) => found.polityId === "carthage" && found.deltas.some((delta) => delta.op === "loan_open")))
      .find((found) => found !== undefined)!;
    expect(decision, "the officer of the Accounts goes to the houses").toBeDefined();
    const loans = decision.deltas.filter((delta) => delta.op === "loan_open");
    expect(loans.some((delta) => delta.op === "loan_open" && delta.lenderKind === "character")).toBe(true);
    const houses = economyOf(needy).houses.filter((house) => house.polityId === "carthage").map((house) => house.headCharacterId);
    for (const loan of loans) if (loan.op === "loan_open" && loan.lenderKind === "character") expect(houses).toContain(loan.lenderRef);
    const day = needy.instant.day;
    const world = atDay(needy, [120, 150, 180, 210, 240, 270, 300].find((at) => decideFiscal(input(atDay(needy, at))).some((found) => found.polityId === "carthage" && found.deltas.some((delta) => delta.op === "loan_open")))!);
    const done = applyDecision(world, decideFiscal(input(world)).find((found) => found.polityId === "carthage")!);
    expect(done.rejected).toEqual([]);
    const lent = done.world.material.loans.filter((loan) => loan.borrowerAccountId === "carthage-treasury");
    expect(lent.length).toBeGreaterThan(0);
    expect(lent.some((loan) => loan.lenderKind === "character" && houses.includes(loan.lenderId!))).toBe(true);
    // A house lends of what it has, never more than a third of it; a private lender's rate, which is dearer for a power at war.
    for (const loan of lent.filter((candidate) => candidate.lenderKind === "character")) {
      const head = loan.lenderId!;
      const purse = world.material.accounts.find((account) => account.id === world.characters.find((character) => character.id === head)!.personalAccountId)!.balance;
      expect(loan.principal).toBeLessThanOrEqual(Math.floor(purse * 0.3) + 1);
      expect(loan.interestBps).toBeGreaterThanOrEqual(100);
    }
    // Money moved between accounts, or came through the credit door for the part no house could lend.
    const audit = auditMoney(world, done.world);
    expect(audit.unexplained, auditInWords(audit)).toEqual([]);
    expect(done.world.material.accounts.find((account) => account.id === "carthage-treasury")!.balance).toBeGreaterThan(1_000);
    void day;
  });

  it("goes on under the heir when the head dies, and is wound up when the heir is dead too", () => {
    const world = opening();
    const house = houseNamed(world, "bodashtart-carthage");
    const head = world.characters.find((character) => character.id === house.headCharacterId)!;
    const heirId = head.heirCharacterId!;
    const dead = (state: WorldState, id: string): WorldState => ({ ...state, characters: state.characters.map((character) => (character.id === id ? { ...character, alive: false, diedAtStep: 100 } : character)) });
    // The estate is settled by the ordinary rules: the heir has the purse.
    const mourned = settleEstate(dead(world, head.id), head.id, 100).world;
    const month = keepMerchantHouses(atDay(mourned, 150), 150, createIdFactory("house-heir"));
    expect(economyOf(month.world).houses.find((candidate) => candidate.id === house.id)).toMatchObject({ headCharacterId: heirId, status: "trading" });
    expect(purseOfHouse(month.world, economyOf(month.world).houses.find((candidate) => candidate.id === house.id)!)!.balance).toBeGreaterThan(100_000);
    // Both dead: nobody to take the books.
    const wiped = keepMerchantHouses(atDay(dead(mourned, heirId), 150), 150, createIdFactory("house-gone"));
    expect(economyOf(wiped.world).houses.find((candidate) => candidate.id === house.id)!.status).toBe("wound_up");
  });

  it("spends a share of its purse a month on its household, and gives its power's treasury a share of what a cargo clears", () => {
    const world = breadIsDearAtSyracuse();
    const house = houseNamed(world, "dion-syracuse");
    const before = purseOfHouse(world, house)!.balance;
    const month = keepMerchantHouses(atDay(world, 90), 90, createIdFactory("house-liturgy"));
    expect(month.world.material.transactions.some((transaction) => transaction.kind === "upkeep" && transaction.cause.id === house.id && transaction.external === "the_unnamed")).toBe(true);
    // The purse after it, and its cargoes, is still most of what it was.
    expect(purseOfHouse(month.world, house)!.balance + cargoesOf(month.world, house.headCharacterId).reduce((sum, venture) => sum + venture.cargo!.cost, 0)).toBeGreaterThan(before * 0.95);
    // The liturgy: when a cargo lands, a few in a hundred of what it cleared over its cost go to the treasury of the power he lives under.
    const venture = cargoesOf(month.world, house.headCharacterId).find((candidate) => candidate.toProvinceId === hubOfProvince(world, SYRACUSE))!;
    const alone = { ...month.world, material: { ...month.world.material, ventures: month.world.material.ventures.filter((candidate) => candidate.ownerCharacterId !== house.headCharacterId || candidate.id === venture.id) } };
    const { world: safe, arrives } = resail(alone, venture.id, false);
    const landed = landCargoes(safe, arrives, createIdFactory("house-liturgy-landed"));
    const chest = (state: WorldState) => state.material.accounts.find((account) => account.id === "syracuse-treasury")!.balance;
    const liturgy = landed.world.material.transactions.find((transaction) => transaction.kind === "transfer" && transaction.cause.id === house.id && transaction.destinationAccountId === "syracuse-treasury");
    expect(liturgy).toBeDefined();
    expect(chest(landed.world) - chest(safe)).toBeGreaterThanOrEqual(liturgy!.amount);
    expect(liturgy!.amount).toBeLessThan(venture.cargo!.cost * 0.1);
    const audit = auditMoney(safe, landed.world);
    expect(audit.unexplained, auditInWords(audit)).toEqual([]);
  });
});
