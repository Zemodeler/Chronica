import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, SOLDIER_PAY_PER_THOUSAND, WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";
import { withMiddlingManagers } from "./middling-managers";

/**
 * "A 20,000-man army should cost 40% of Rome's income; a 10,000-man army 20%."
 *
 * The rule of the game, which scenario v52 meets by raising the income and not
 * by cutting the pay: N men in the field cost N/500 per cent of what the
 * Republic takes in a month. Pay stays the Polybian ten a man (a thousand men
 * at `SOLDIER_PAY_PER_THOUSAND`, the rate `tick.ts` gives any army a project
 * raises); the tribute, the tributum and the public land were raised about
 * threefold (`REVENUE_SCALE`) so that the sums come out. These put the whole
 * Roman treasury through the real monthly tick with an army of each size on
 * its books, and read what share of the month's takings the payroll took.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = (): WorldState => withMiddlingManagers(ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0));

/** Rome's opening with its other charges laid by, and the legions' pay counted from the headcount at the rate its own map states. */
function romeKeeping(men: number): WorldState {
  const world = opening();
  const rate = world.map.polities.find((polity) => polity.id === "rome")!.soldierPayPerThousand ?? SOLDIER_PAY_PER_THOUSAND;
  return {
    ...world,
    material: {
      ...world.material,
      obligations: world.material.obligations.map((obligation) => {
        if (obligation.payerAccountId !== "rome-treasury") return obligation;
        return obligation.id === "rome-legion-pay" ? { ...obligation, amount: Math.round((men * rate) / 1_000) } : { ...obligation, active: false };
      }),
    },
  };
}

/** One month: what the treasury took in, what it paid out to the army, and what was left of the chest. */
function aMonthWith(men: number) {
  const before = romeKeeping(men);
  const chest = (world: WorldState): number => world.material.accounts.find((account) => account.id === "rome-treasury")!.balance;
  const pay = before.material.obligations.find((obligation) => obligation.id === "rome-legion-pay")!.amount;
  const after = runDeterministicTick({ world: before, toDay: 30, ids: createIdFactory(`army-${men}`), warfare: definition.warfare }).world;
  return { pay, income: chest(after) - chest(before) + pay, chest: chest(after), opened: chest(before) };
}

describe("an army costs its share", () => {
  it("opens Rome at 500,000 a month, as the rule requires", () => {
    const nominal = opening().material.incomeSources
      .filter((source) => source.active && source.beneficiaryAccountId === "rome-treasury")
      .reduce((sum, source) => sum + (source.amount * source.collectionRateBps) / 10_000, 0);
    expect(nominal).toBe(500_000);
  });

  it("takes a fifth of Rome's income to keep ten thousand men, and two fifths for twenty thousand", () => {
    const ten = aMonthWith(10_000);
    const twenty = aMonthWith(20_000);
    expect(ten.pay).toBe(100_000);
    expect(twenty.pay).toBe(200_000);
    // Of the takings as they stood the month the army was paid (the Treasury's officers and the Campanians' Rhegium shift them a few in a hundred).
    expect(ten.pay / ten.income).toBeGreaterThan(0.19);
    expect(ten.pay / ten.income).toBeLessThan(0.215);
    expect(twenty.pay / twenty.income).toBeGreaterThan(0.38);
    expect(twenty.pay / twenty.income).toBeLessThan(0.43);
    // N men cost N / 500 per cent, whatever N is: the share is linear in the men.
    expect((twenty.pay / twenty.income) / (ten.pay / ten.income)).toBeCloseTo(2, 5);
  });

  it("can keep twenty thousand in the field for a year and be the poorer for it, but not ruined", () => {
    let world = romeKeeping(20_000);
    const chest = (state: WorldState): number => state.material.accounts.find((account) => account.id === "rome-treasury")!.balance;
    const opened = chest(world);
    for (let month = 1; month <= 12; month += 1) world = runDeterministicTick({ world, toDay: month * 30, ids: createIdFactory(`year-${month}`), warfare: definition.warfare }).world;
    // It pays: the chest grows and the army is never in arrears.
    expect(chest(world)).toBeGreaterThan(opened);
    expect(world.material.obligations.find((obligation) => obligation.id === "rome-legion-pay")!.arrears).toBe(0);
  });

  it("is ruin at a hundred thousand men: an army that costs twice what the Republic takes in eats the chest in half a year and falls into arrears", () => {
    let world = romeKeeping(100_000);
    for (let month = 1; month <= 12; month += 1) world = runDeterministicTick({ world, toDay: month * 30, ids: createIdFactory(`ruin-${month}`), warfare: definition.warfare }).world;
    expect(world.material.obligations.find((obligation) => obligation.id === "rome-legion-pay")!.arrears).toBeGreaterThan(0);
  });
});
