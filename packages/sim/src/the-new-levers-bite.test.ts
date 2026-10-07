import { describe, expect, it } from "vitest";
import {
  DepartmentSchema,
  ECONOMIC_LEVERS,
  NEUTRAL_MIND,
  economyOf,
  marketsOf,
  readDepartments,
  taxBurdens,
  tradeAddresseeFinder,
  WorldDeltaSchema,
  type WorldState,
} from "@chronica/shared";
import { createIdFactory } from "./ports";
import { payCustoms } from "./customs";
import { premiumTarget } from "./coinage";
import { coinsBadName, priceSwing } from "./levers";
import { reviewTheLand } from "./economy";
import { actCarried, chestOf, government, holdersOf, opening } from "./competence-test-kit";

/**
 * The new charges bite.
 *
 * Five levers a department may be given, each with a number it moves: the harbour dues that reach the chest (customs), the gain
 * of a coin struck lighter and the name it keeps (mint), how far a market's prices stray (markets), what the state pays to
 * borrow (credit), and how many of the people the rolls count (census). Each is read for the men who keep it, and is exactly
 * the middling run where nobody has been given the charge: a power that has set nobody to these works runs as it always did.
 */

/** The quaestors set to a charge, as skilled as asked: every skill the lever reads, written as one number, and a mind that adds nothing. */
function kept(world: WorldState, lever: (typeof ECONOMIC_LEVERS)[number], skill: number): WorldState {
  const holders = new Set(holdersOf(world, "roman-quaestor"));
  const department = DepartmentSchema.parse({
    id: `rome-${lever}`, scope: { kind: "polity", id: "rome" }, name: `The ${lever} of Rome`, levers: [lever], officeIds: ["roman-quaestor"],
    foundedAtStep: 0, formsAtStep: 0, experienceDays: 0, origin: "scenario",
  });
  return {
    ...world,
    departments: [...world.departments, department],
    characters: world.characters.map((character) => (holders.has(character.id)
      ? { ...character, mind: NEUTRAL_MIND, skills: { ...character.skills, stewardship: skill, diplomacy: skill, intrigue: skill, martial: skill, learning: skill, piety: skill, body: skill, subSkills: {} } }
      : character)),
  };
}

const reader = (world: WorldState) => readDepartments(world);
const skillOf = (world: WorldState, lever: (typeof ECONOMIC_LEVERS)[number]) => reader(world).skill({ kind: "polity", id: "rome" }, lever);

describe("the new levers bite", () => {
  it("are all charges a department may be given, and read as the middling run where nobody has been", () => {
    const world = opening();
    expect([...ECONOMIC_LEVERS]).toEqual(["customs", "mint", "markets", "credit", "census"]);
    expect(priceSwing(reader(world), "rome")).toBe(1);
    expect(coinsBadName(reader(world), "rome")).toBe(1);
    const skilled = kept(world, "markets", 90);
    expect(skillOf(skilled, "markets")).toBe(90);
    expect(priceSwing(reader(skilled), "rome")).toBeLessThan(1);
    expect(priceSwing(reader(kept(world, "markets", 10)), "rome")).toBeGreaterThan(1);
  });

  it("customs: a harbour well kept brings more of the duty into the chest, and a lax one loses it", () => {
    const base = opening();
    const due = { ...base, economy: { ...economyOf(base), customsDue: [{ polityId: "rome", amount: 100_000 }] } };
    const paid = (world: WorldState) => chestOf(payCustoms(world, 200, createIdFactory("customs")), "rome").balance - chestOf(world, "rome").balance;
    const good = paid(kept(due, "customs", 90));
    const poor = paid(kept(due, "customs", 10));
    const nobody = paid(due);
    expect(nobody).toBe(100_000);
    expect(good).toBeGreaterThan(nobody);
    expect(poor).toBeLessThan(nobody);
    expect(good).toBe(Math.round(100_000 * (1 + 0.2 * 0.8)));
    expect(poor).toBe(Math.round(100_000 * (1 - 0.2 * 0.8)));
  });

  it("customs: a letter about a pact goes to the man who keeps the customs, where there is one, and to the head of the state where there is not", () => {
    const base = opening();
    const find = (world: WorldState) => tradeAddresseeFinder(world, government.offices)("rome");
    expect(find(base)).toMatchObject({ basis: "ruler" });
    expect(holdersOf(base, "roman-consul")).toContain(find(base)!.characterId);
    const keeper = find(kept(base, "customs", 60))!;
    expect(holdersOf(base, "roman-quaestor")).toContain(keeper.characterId);
    expect(keeper.why).toMatch(/pacts and embargoes are in the charge of his office, Roman quaestor/);
    expect(keeper.basis).toBe("department");
  });

  it("mint: a good master of the mint gets more from a coin struck lighter, and its bad name sticks less to the premium", () => {
    const base = opening();
    const strike = { op: "coinage_debase", coinageId: "roman_aes_and_silver", targetSilverBps: null, stepBps: -1_500, reason: "The war must be paid for." };
    const consul = holdersOf(base, "roman-consul")[0]!;
    const gain = (world: WorldState) => {
      const parsed = WorldDeltaSchema.parse(strike);
      const done = actCarried(world, consul, parsed);
      expect(done.rejected).toEqual([]);
      return chestOf(done.world, "rome").balance - chestOf(world, "rome").balance;
    };
    const good = gain(kept(base, "mint", 90));
    const poor = gain(kept(base, "mint", 10));
    expect(good).toBeGreaterThan(gain(base));
    expect(poor).toBeLessThan(gain(base));
    // And of the premium: a coin at war and in arrears loses less of what it fetches under a good master.
    const coin = economyOf(base).coinages.find((coinage) => coinage.id === "roman_aes_and_silver")!;
    const target = (world: WorldState) => premiumTarget(coin, { exports: 0, imports: 0 }, true, true, coinsBadName(reader(world), "rome"));
    expect(target(kept(base, "mint", 90))).toBeGreaterThan(target(base));
    expect(target(kept(base, "mint", 10))).toBeLessThan(target(base));
  });

  it("markets: a hub's prices stray less from the base price under a good clerk of the markets", () => {
    const base = opening();
    const stray = (world: WorldState): number => {
      let current = reviewTheLand({ world, toDay: 200 }).world;
      for (let month = 1; month <= 3; month += 1) current = reviewTheLand({ world: current, toDay: 200 + month * 30 }).world;
      return marketsOf(current).filter((hub) => hub.hubId.length > 0).reduce((sum, hub) => sum + hub.goods.reduce((inner, good) => inner + Math.abs(good.priceBps - 10_000), 0), 0);
    };
    const calm = stray(kept(base, "markets", 95));
    const wild = stray(kept(base, "markets", 5));
    expect(calm).toBeLessThan(wild);
  });

  it("credit: the state is asked less interest by lenders who think well of its credit", () => {
    const base = opening();
    const consul = holdersOf(base, "roman-consul")[0]!;
    const loan = WorldDeltaSchema.parse({
      op: "loan_open", localId: "the_loan", lenderKind: "foreign", lenderRef: null, borrowerAccountRef: "rome-treasury", principal: 300_000, interestBps: 200,
      cadenceDays: 30, terms: "Silver of the bankers abroad, for the war.", reason: "The war must be paid for.",
    });
    const rate = (world: WorldState): number => {
      const done = actCarried(world, consul, loan);
      expect(done.rejected).toEqual([]);
      return done.world.material.loans.at(-1)!.interestBps;
    };
    expect(rate(base)).toBe(200);
    expect(rate(kept(base, "credit", 90))).toBeLessThan(200);
    expect(rate(kept(base, "credit", 10))).toBeGreaterThan(200);
  });

  it("census: a roll that counts more of the people can raise more of what is asked of them", () => {
    const base = opening();
    // A power that asks a great deal of its land: the roll's count is what is left to bear it.
    const pressed = {
      ...base,
      material: { ...base.material, incomeSources: base.material.incomeSources.map((source) => (source.beneficiaryAccountId === "rome-treasury" ? { ...source, amount: source.amount * 6 } : source)) },
    };
    const bearable = (world: WorldState): number => taxBurdens(world).get("rome")!.bearable;
    const none = bearable(pressed);
    expect(bearable(kept(pressed, "census", 90))).toBeGreaterThan(none);
    expect(bearable(kept(pressed, "census", 10))).toBeLessThan(none);
  });
});
