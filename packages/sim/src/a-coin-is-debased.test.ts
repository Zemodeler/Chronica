import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import {
  ScenarioDefinitionSchema,
  WorldDeltaSchema,
  coinageById,
  conversionBps,
  economyOf,
  obligationAmountNow,
  polityGrainPriceBps,
  priceLevelBpsOf,
  treasuryOf,
  type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { reviewTheLand } from "./economy";
import { auditMoney, unexplainedTotal } from "./money-audit";
import { createIdFactory } from "./ports";
import { coinageSummary, monthOfCoinage, stepPremium, stepPriceLevel } from "./coinage";
import { opening } from "./trade-test-kit";

/**
 * A coin is debased (phase E of the economy rework).
 *
 * A power's treasurer may have the mint strike its coin with less silver. The
 * treasury gains at once (the same silver makes more coin: seigniorage, a door
 * in the money audit), and prices follow the coin down a few months behind:
 * slowly at first, then faster, until bread costs what the old weight said it
 * should. The coin falls against the others at the money-changers. A reform,
 * striking it up again, is the reverse, and costs the silver to do it.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
let applications = 0;
const as = (characterId: string): ApplyContext => ({
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: characterId },
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory(`coin-${characterId}-${applications++}`),
  gameId: "game-coin",
});
/** The world on a given day: the step and the instant move together. */
const onDay = (world: WorldState, day: number): WorldState => ({ ...world, elapsedStep: day, instant: { ...world.instant, day } });
const apply = (world: WorldState, deltas: readonly unknown[], who = "gaius-genucius") => applyDeltas(world, deltas.map((delta) => WorldDeltaSchema.parse(delta)), as(who));

const ROMAN = "roman_aes_and_silver";
const debase = (stepBps: number) => ({ op: "coinage_debase", coinageId: ROMAN, stepBps, reason: "The war must be paid." });
const silverOf = (world: WorldState, id = ROMAN): number => coinageById(world, id)!.silverBps;
const levelOf = (world: WorldState): number => priceLevelBpsOf(world, "rome");

/** The world run on, a month at a time, from the day it stands at. */
function months(world: WorldState, count: number): WorldState {
  let current = reviewTheLand({ world, toDay: world.elapsedStep }).world;
  for (let month = 1; month <= count; month += 1) current = onDay(reviewTheLand({ world: current, toDay: world.elapsedStep + month * 30 }).world, world.elapsedStep + month * 30);
  return current;
}

describe("a coin is debased", () => {
  it("opens with the age's coins, Rome's the lightest and the Greeks' the Attic standard", () => {
    const world = opening();
    expect(economyOf(world).coinages.map((coinage) => coinage.id)).toEqual(expect.arrayContaining([ROMAN, "carthaginian_shekel", "syracusan_silver", "ptolemaic_silver", "attic_drachma", "foreign_silver"]));
    expect(silverOf(world)).toBe(7_300);
    expect(silverOf(world, "attic_drachma")).toBe(10_000);
    expect(levelOf(world)).toBe(10_000);
  });

  it("earns the treasury a seigniorage at once and raises prices only later, a little at first and then faster", () => {
    const world = opening();
    const treasury = treasuryOf(world, "rome")!;
    const before = world.material.accounts.find((account) => account.id === treasury)!.balance;
    // A fifth off the silver, the most one act may do and a little more.
    const done = apply(world, [debase(-2_000)]);
    expect(done.rejected).toEqual([]);
    expect(silverOf(done.world)).toBe(5_840);
    const gained = done.world.material.accounts.find((account) => account.id === treasury)!.balance - before;
    expect(gained).toBeGreaterThan(0);
    // It is the seigniorage door and nothing else: the books balance.
    const audit = auditMoney(world, done.world);
    expect(audit.doors.seigniorage.in).toBe(gained);
    expect(unexplainedTotal(audit)).toBe(0);
    // The same day nothing has happened to prices.
    expect(levelOf(done.world)).toBe(10_000);
    expect(done.factProposals.some((fact) => fact.kind === "coinage_debased")).toBe(true);

    // A year or two on, prices are higher, and the rise has gathered pace and not stopped.
    const started = { ...done.world, elapsedStep: 0 };
    const at = new Map<number, number>();
    let current = started;
    for (let month = 1; month <= 24; month += 1) {
      current = onDay(reviewTheLand({ world: current, toDay: month * 30 }).world, month * 30);
      at.set(month, levelOf(current));
    }
    expect(at.get(3)!).toBeGreaterThan(10_000);
    expect(at.get(6)!).toBeGreaterThan(at.get(3)!);
    expect(at.get(12)!).toBeGreaterThan(at.get(6)!);
    expect(at.get(24)!).toBeGreaterThan(at.get(12)!);
    // The rise in the first three months is less than a quarter of the rise to come in the next nine.
    expect(at.get(3)! - 10_000).toBeLessThan((at.get(12)! - at.get(3)!) / 2);
    // Where it is heading: the old weight over the new, 7,300 over 5,840 (12,500). Two years does not get all the way there.
    expect(at.get(24)!).toBeLessThan(12_500);
    expect(at.get(24)!).toBeGreaterThan(11_300);
  });

  it("makes bread and an army's keep dearer for the power that debased, and for it alone", () => {
    const world = opening();
    const debased = months(apply(world, [debase(-2_000)]).world, 24);
    const steady = months(world, 24);
    // Rome pays more for its grain; Carthage, whose coin was not touched, pays what the market makes it.
    expect(polityGrainPriceBps(debased, "rome")).toBeGreaterThan(polityGrainPriceBps(steady, "rome") * 1.1);
    expect(priceLevelBpsOf(debased, "carthage")).toBe(10_000);
    // An army's keep is partly bread, so the same legion costs more silver to keep.
    const upkeep = debased.material.obligations.find((obligation) => obligation.kind === "army_upkeep" || obligation.kind === "army_pay" && obligation.active);
    expect(upkeep).toBeDefined();
    expect(obligationAmountNow(debased, upkeep!)).toBeGreaterThan(obligationAmountNow(steady, upkeep!));
  });

  it("lowers what the coin fetches among the money-changers, and so what a sum sent abroad in it comes to", () => {
    const world = opening();
    const debased = months(apply(world, [debase(-2_000)]).world, 24);
    const premium = (state: WorldState): number => coinageById(state, ROMAN)!.premiumBps;
    expect(premium(world)).toBe(0);
    expect(premium(debased)).toBeLessThan(0);
    // Rome to Carthage: the share of a sum that arrives is less after than before, and never more than the sum.
    const before = conversionBps(world, ROMAN, "carthaginian_shekel");
    const after = conversionBps(debased, ROMAN, "carthaginian_shekel");
    expect(after).toBeLessThan(before);
    expect(before).toBeLessThan(10_000);
    // And the other way, Carthage's coin into Rome's, is only the fee: the sound coin loses nothing to the rate.
    expect(conversionBps(debased, "carthaginian_shekel", ROMAN)).toBeGreaterThanOrEqual(9_800);
  });

  it("is reversed by a reform, which costs the treasury the silver and brings prices down only slowly", () => {
    const world = opening();
    const debased = months(apply(world, [debase(-2_000)]).world, 24);
    const high = levelOf(debased);
    const treasury = treasuryOf(debased, "rome")!;
    const rich = debased.material.accounts.find((account) => account.id === treasury)!.balance;
    const reformed = apply(debased, [{ op: "coinage_debase", coinageId: ROMAN, targetSilverBps: 7_300, reason: "Rome will have honest silver again." }]);
    expect(reformed.rejected).toEqual([]);
    expect(silverOf(reformed.world)).toBe(7_300);
    const paid = rich - reformed.world.material.accounts.find((account) => account.id === treasury)!.balance;
    expect(paid).toBeGreaterThan(0);
    expect(reformed.factProposals.some((fact) => fact.kind === "coinage_reformed")).toBe(true);
    expect(unexplainedTotal(auditMoney(debased, reformed.world))).toBe(0);
    // It cost more than the debasement earned: the silver is what had been made of nothing, and then more.
    const gained = apply(world, [debase(-2_000)]);
    const earned = gained.world.material.accounts.find((account) => account.id === treasury)!.balance - world.material.accounts.find((account) => account.id === treasury)!.balance;
    expect(paid).toBeGreaterThan(earned * 0.9);
    // Prices do not fall the day it is done, and a year later they have fallen, but not all the way.
    expect(levelOf(reformed.world)).toBe(high);
    const later = months(reformed.world, 12);
    expect(levelOf(later)).toBeLessThan(high);
    expect(levelOf(later)).toBeGreaterThan(10_000);
  });

  it("is the issuer's own government's to do, a step at a time and within bounds", () => {
    const world = opening();
    // Another power's officer has no mint to change.
    const foreign = apply(world, [{ ...debase(-1_000), coinageId: "carthaginian_shekel" }]);
    expect(foreign.rejected.length).toBeGreaterThan(0);
    expect(silverOf(foreign.world, "carthaginian_shekel")).toBe(9_000);
    // A coin nobody in particular strikes cannot be debased by anyone.
    const attic = apply(world, [{ ...debase(-1_000), coinageId: "attic_drachma" }]);
    expect(attic.rejected.length).toBeGreaterThan(0);
    // A senator with no office over the treasury is not heard.
    const senator = apply(world, [debase(-1_000)], "manius-curius");
    expect(senator.rejected.map((rejection) => rejection.kind)).toEqual(["ignored"]);
    expect(silverOf(senator.world)).toBe(7_300);
    // No act moves it by more than a quarter, even if it asks for the sea.
    const sea = apply(world, [{ op: "coinage_debase", coinageId: ROMAN, targetSilverBps: 1_500, reason: "All of it." }]);
    expect(silverOf(sea.world)).toBe(Math.round(7_300 * 0.75));
    // It cannot be done again for a while...
    const stepped = onDay(sea.world, 10);
    expect(apply(stepped, [debase(-1_000)]).rejected.length).toBeGreaterThan(0);
    // ...and not below four in ten of the standard however many times it is done.
    let current: WorldState = sea.world;
    for (let time = 1; time <= 8; time += 1) current = apply(onDay(current, time * 100), [debase(-2_500)]).world;
    expect(silverOf(current)).toBe(Math.round(7_300 * 0.4));
    // Naming neither a target nor a step is no order.
    const nothing = apply(world, [{ op: "coinage_debase", coinageId: ROMAN, reason: "Something." }]);
    expect(nothing.rejected.length).toBeGreaterThan(0);
  });

  it("tells a ruler of his money only when it is news, and tells the world once a year that a power at war and behind on its debts has a coin under strain, without debasing it", () => {
    const world = opening();
    expect(coinageSummary(world, "rome")).toBeNull();
    expect(coinageSummary(world, "carthage")).toBeNull();
    const debased = months(apply(world, [debase(-2_000)]).world, 24);
    const line = coinageSummary(debased, "rome")!;
    expect(line).toContain("Roman aes and silver");
    expect(line).toContain("80% of its standard silver");
    expect(line).toMatch(/prices at 1[12]\d%/);
    // Carthage's coin is untouched, and its page says nothing of money.
    expect(coinageSummary(debased, "carthage")).toBeNull();

    // Rome is at war from the opening; its treasury goes behind on what it owes.
    const behind: WorldState = {
      ...world,
      material: { ...world.material, obligations: world.material.obligations.map((obligation) => (obligation.id === "rome-legion-pay" ? { ...obligation, arrears: 30_000, missedPeriods: 1 } : obligation)) },
    };
    const first = monthOfCoinage(behind, [30], 30);
    expect(first.facts.filter((fact) => fact.kind === "coinage_strain")).toHaveLength(1);
    expect(first.facts[0]!.affectedRefs).toContainEqual({ kind: "polity", id: "rome" });
    // Nothing is debased for it: that is the rulers' choice, and nothing else's.
    expect(silverOf(first.world)).toBe(7_300);
    // Told once, and not again within the year.
    expect(monthOfCoinage(first.world, [60], 60).facts).toEqual([]);
    expect(monthOfCoinage(first.world, [420], 420).facts.filter((fact) => fact.kind === "coinage_strain")).toHaveLength(1);
    // A power with no arrears hears nothing, whatever its wars.
    expect(monthOfCoinage(world, [30], 30).facts).toEqual([]);
  });

  it("is the same on every run, and its steps are bounded and never overshoot", () => {
    const a = months(apply(opening(), [debase(-1_500)]).world, 18);
    const b = months(apply(opening(), [debase(-1_500)]).world, 18);
    expect(economyOf(a).coinages).toEqual(economyOf(b).coinages);
    const coin = { ...coinageById(opening(), ROMAN)!, standardBps: 7_300 };
    expect(stepPriceLevel({ ...coin, silverBps: 5_000 }, 30)).toBeGreaterThan(10_000);
    expect(stepPriceLevel({ ...coin, silverBps: 5_000 }, 30)).toBeLessThanOrEqual(14_600);
    expect(stepPriceLevel({ ...coin, silverBps: 5_000, priceLevelBps: 14_600 }, 30)).toBe(14_600);
    expect(stepPriceLevel(coin, 30)).toBe(10_000);
    expect(stepPremium(0, -1_500)).toBe(-150);
    expect(stepPremium(-1_499, -1_500)).toBe(-1_500);
  });
});
