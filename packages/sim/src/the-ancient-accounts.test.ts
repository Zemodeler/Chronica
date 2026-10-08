import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  DRACHMAE_PER_TALENT,
  ESTATE_LAND_PRICE_MONTHS,
  LEGIONARY_PAY_GROSS,
  SOLDIER_PAY_PER_THOUSAND,
  WorldStateSchema,
  ensureProvinceMaterial,
  drawStock,
  ensureMarkets,
  provinceGrainPriceBps,
  grainPriceFor,
  inTalents,
  taxBurdens,
  type WorldState,
} from "@chronica/shared";
import { grainPrice } from "./grain";
import { meansOf, INDEMNITY_MEANS_FLOOR } from "./peace";
import { termPrice } from "./peace-table";
import { soldierPayShares } from "./money";
import { withTheConsularArmyOnceDrawn } from "./the-opening-as-it-was";

/**
 * "What does a legion cost?"
 *
 * Every figure of the state was a hundredth of what it was in the ancient
 * world, and the treasury paid its army at 35 a thousand men a month while the
 * named men in that army were owed ten each: 180 times apart, so that the pool
 * their shares were carved from could not have paid them. These pin the
 * opening's money to the scale of the ancient accounts: a legionary draws ten
 * a month, and everything else is counted in the same drachmae, 6 000 to the
 * talent.
 */

const opening = (): WorldState => withTheConsularArmyOnceDrawn(ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0));
const monthly = (world: WorldState, accountId: string, kinds: readonly string[] = ["tax", "land", "tribute", "trade"]): number =>
  world.material.incomeSources
    .filter((source) => source.active && source.beneficiaryAccountId === accountId && kinds.includes(source.kind))
    .reduce((sum, source) => sum + (source.amount * source.collectionRateBps) / 10_000, 0);
const owed = (world: WorldState, accountId: string): number =>
  world.material.obligations.filter((obligation) => obligation.active && obligation.payerAccountId === accountId).reduce((sum, obligation) => sum + obligation.amount, 0);
const balance = (world: WorldState, accountId: string): number => world.material.accounts.find((account) => account.id === accountId)!.balance;
const menOf = (world: WorldState, forceId: string, which: (group: { readonly categoryId: string; readonly formationId?: string | undefined }) => boolean): number =>
  world.material.forces.find((force) => force.id === forceId)!.personnel.filter(which).reduce((sum, group) => sum + group.fit, 0);

describe("the treasury pays an army what its men are owed", () => {
  it("counts Rome's legion at ten a foot soldier and thirty a horseman, from the one rate", () => {
    const world = opening();
    expect(SOLDIER_PAY_PER_THOUSAND).toBe(LEGIONARY_PAY_GROSS * 1_000);
    expect(world.map.polities.find((polity) => polity.id === "rome")!.soldierPayPerThousand).toBe(SOLDIER_PAY_PER_THOUSAND);
    // The legion's own: its hastati, principes, triarii and velites on foot, and its equites; the ala is the allies'.
    const ofTheLegion = (group: { readonly formationId?: string | undefined }) => group.formationId?.startsWith("rome:legion:") === true;
    const foot = menOf(world, "roman-field-army", (group) => ofTheLegion(group) && group.categoryId !== "cavalry");
    const horse = menOf(world, "roman-field-army", (group) => ofTheLegion(group) && group.categoryId === "cavalry");
    expect([foot, horse]).toEqual([4_200, 300]);
    const wages = (foot * LEGIONARY_PAY_GROSS) + (horse * LEGIONARY_PAY_GROSS * 3);
    // The allies draw only their grain from the treasury: what is left of the obligation after the Romans' wages.
    const pay = world.material.obligations.find((obligation) => obligation.id === "rome-legion-pay")!;
    expect(wages).toBe(51_000);
    expect(pay.amount - wages).toBeGreaterThan(0);
    expect(pay.amount - wages).toBeLessThanOrEqual(0.3 * wages);
  });

  it("can afford the pay of the named men in the army out of that pool, each at his full share", () => {
    const world = opening();
    const pay = world.material.obligations.find((obligation) => obligation.id === "rome-legion-pay")!;
    const named = soldierPayShares(world, pay, pay.amount);
    const total = named.reduce((sum, share) => sum + share.amount, 0);
    expect(total).toBeLessThan(pay.amount);
    // A month's pay of a man in the ranks is seven: his ten less the third stopped for his grain and his kit.
    for (const share of named) expect(share.amount % Math.round(LEGIONARY_PAY_GROSS * (2 / 3))).toBeLessThanOrEqual(1);
    // And the rest -- nearly all of it -- is the thousands nobody names.
    expect(pay.amount - total).toBeGreaterThan(0.9 * pay.amount);
  });

  it("prices bread at the one price grain has: the power's rate at the market's price, dearer as its granary runs low", () => {
    // The price is the price of the market the province trades in (`world/markets.ts`), which is what its
    // granary holds against what it ought: not, as it was, a reading off how fed the province is.
    const world = ensureMarkets(opening());
    const latium = PUNIC_IDS.rome;
    const ordinary = SOLDIER_PAY_PER_THOUSAND / 60;
    expect(grainPrice(world, "rome", latium)).toBeCloseTo((ordinary * provinceGrainPriceBps(world, latium)) / 10_000, 6);
    expect(grainPriceFor(null, 10_000)).toBeCloseTo(ordinary, 6);
    // The granary emptied: four times the ordinary price at the dearest, the market's ceiling.
    const starving = drawStock(world, latium, "grain", Number.MAX_SAFE_INTEGER).world;
    expect(grainPrice(starving, "rome", latium)).toBeCloseTo(4 * ordinary, 6);
    // A power that states no rate of its own pays the world's.
    expect(grainPrice(world, "syracuse", PUNIC_IDS.syracuse)).toBeCloseTo(ordinary * provinceGrainPriceBps(world, PUNIC_IDS.syracuse) / 10_000, 6);
  });
});

describe("the powers open at the scale of the ancient accounts", () => {
  it("has Rome taking in a thousand talents a year (v52: the rule that 10,000 men cost a fifth of it), and its legion costing an eighth of it", () => {
    const world = opening();
    const income = monthly(world, "rome-treasury");
    // 500,000 a month: the figure the rule `N men cost N/500 per cent` fixes (an-army-costs-its-share.test.ts).
    expect(income).toBe(500_000);
    expect(income * 12 / DRACHMAE_PER_TALENT).toBeGreaterThan(620);
    expect(income * 12 / DRACHMAE_PER_TALENT).toBeLessThan(1_550);
    // The legion's 4,500 with the allies' grain: 65,000 against 500,000 -- thirteen in a hundred.
    const army = world.material.obligations.find((obligation) => obligation.id === "rome-legion-pay")!.amount;
    expect(army / income).toBeGreaterThan(0.12);
    expect(army / income).toBeLessThan(0.14);
    // Solvent: what it owes each month is less than it takes in.
    expect(owed(world, "rome-treasury")).toBeLessThan(income);
    expect(balance(world, "rome-treasury")).toBeGreaterThan(3 * (income - owed(world, "rome-treasury")) / 2);
  });

  it("has Carthage the richest, over twenty-eight hundred talents a year and three thousand in its chest (nine hundred and a thousand before v52's factor of 3.1)", () => {
    const world = opening();
    const income = monthly(world, "carthage-treasury");
    expect(income * 12 / DRACHMAE_PER_TALENT).toBeGreaterThan(2_790);
    expect(balance(world, "carthage-treasury") / DRACHMAE_PER_TALENT).toBeGreaterThanOrEqual(3_100);
    expect(income).toBeGreaterThan(2 * monthly(world, "rome-treasury"));
    expect(owed(world, "carthage-treasury")).toBeLessThan(income / 3);
  });

  it("has Syracuse and the Mamertines paying their standing men out of what they take in, a fifth and a quarter of it (v52)", () => {
    const world = opening();
    // Every authored revenue rose by the same factor as Rome's; the men they pay did not.
    expect(monthly(world, "syracuse-treasury")).toBe(192_000);
    expect(owed(world, "syracuse-treasury") / monthly(world, "syracuse-treasury")).toBeGreaterThan(0.2);
    expect(owed(world, "syracuse-treasury") / monthly(world, "syracuse-treasury")).toBeLessThan(0.25);
    expect(monthly(world, "mamertine-treasury")).toBe(54_250);
    expect(owed(world, "mamertine-treasury")).toBe(14_000);
  });

  it("leaves every power asking less of its land than the customary share of what it can bear", () => {
    const burdens = taxBurdens(opening());
    for (const polityId of ["rome", "carthage", "syracuse", "mamertines"]) {
      const burden = burdens.get(polityId)!;
      expect(burden.asked / burden.bearable, polityId).toBeLessThan(0.5);
    }
    // A million Romans bear some 2,200 talents a year (700 before v52's factor of 3.1), a calm province twelve drachmae a head.
    const rome = burdens.get("rome")!;
    expect(rome.bearable * 12 / DRACHMAE_PER_TALENT).toBeGreaterThan(1_550);
    expect(rome.bearable * 12 / DRACHMAE_PER_TALENT).toBeLessThan(2_790);
  });

  it("makes a senator worth about a hundred thousand, as the census had him, and a legionary's year 120", () => {
    const world = opening();
    const estate = world.material.incomeSources.find((source) => source.id === "genucian-estates-yield")!.amount;
    const worth = balance(world, "gaius-purse") + estate * ESTATE_LAND_PRICE_MONTHS;
    expect(worth).toBeGreaterThan(80_000);
    expect(worth).toBeLessThan(140_000);
    expect(LEGIONARY_PAY_GROSS * 12).toBe(120);
  });
});

describe("an indemnity is counted in talents", () => {
  it("asks a tenth of what the loser could pay, a chest and a year's revenue, which for Carthage is hundreds of talents a year", () => {
    const world = opening();
    const means = meansOf(world, "carthage");
    // Its chest, and a year of its harbour dues and what its African subjects pay.
    expect(Math.abs(means - (18_600_000 + (930_000 + 620_000 * 0.85) * (365 / 30)))).toBeLessThanOrEqual(1);
    expect(means / DRACHMAE_PER_TALENT).toBeGreaterThan(4_650);
    const asked = Math.round(means * 0.1);
    expect(asked / DRACHMAE_PER_TALENT).toBeGreaterThan(465);
    expect(asked / DRACHMAE_PER_TALENT).toBeLessThan(1_240);
    expect(inTalents(asked)).toMatch(/talents$/);
    // Priced by the share of what the payer can bear, as before: a tenth of its means, three times over, is 7.5 points of the war going badly.
    expect([7, 8]).toContain(termPrice(world, { kind: "indemnity", amount: asked, periods: 3 }, "carthage", "rome"));
    // A pauper's means are counted at a floor, so a small sum owed is not a great price.
    expect(INDEMNITY_MEANS_FLOOR).toBe(50_000);
    expect(termPrice(world, { kind: "indemnity", amount: 100, periods: 1 }, "mamertines", "rome")).toBe(0);
  });
});
