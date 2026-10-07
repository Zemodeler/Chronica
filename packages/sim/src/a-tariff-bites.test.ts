import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, economyOf, goodIndex, treasuryOf, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { auditMoney, unexplainedTotal } from "./money-audit";
import { payCustoms } from "./customs";
import { reviewTheLand } from "./economy";
import { createIdFactory } from "./ports";
import { HUBS, POWERS, bookOf, flow, inflowOf, opening, priceOf, setStock, withCustoms } from "./trade-test-kit";
import type { ApplyContext } from "./apply/context";

/**
 * A tariff bites (phase D of the economy rework).
 *
 * A power may lay customs on the goods that enter its markets from another
 * power's. The duty is part of what it costs to land them, so it does two
 * things at once: it earns the treasury a share of what still comes, and it
 * keeps out the goods whose margin it eats. A light one is nearly all revenue;
 * a steep one is nearly all prohibition, and what is kept out is dearer at home.
 * The same duty on trade between two powers that have agreed a cap is only
 * what the cap allows (`a-trade-pact-lowers-tariffs`).
 */

const { syracuse, agrigentum } = HUBS;
const GRAIN = goodIndex("grain");
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const as = (characterId: string): ApplyContext => ({
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: characterId },
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory(`customs-${characterId}`),
  gameId: "game-1",
});
const apply = (world: WorldState, deltas: readonly unknown[]) => applyDeltas(world, deltas.map((delta) => WorldDeltaSchema.parse(delta)), as("gaius-genucius"));

/** One month of Syracuse buying Carthaginian grain at a given customs rate: what came in, what the treasury earned, what grain costs at the quay after. */
function month(rateBps: number, buyerShare = 0.6) {
  const world = withCustoms(opening(), POWERS.syracuse, rateBps);
  const book = bookOf(world);
  setStock(book, syracuse, "grain", buyerShare);
  const before = priceOf(book, syracuse, "grain");
  const result = flow(world, book);
  return {
    before,
    inflow: inflowOf(book, syracuse, "grain"),
    duty: result.duties.get(POWERS.syracuse) ?? 0,
    after: priceOf(book, syracuse, "grain"),
    book,
  };
}

describe("a tariff bites", () => {
  it("brings in nothing where there is none, and something at a moderate rate", () => {
    expect(month(0).duty).toBe(0);
    expect(month(0).inflow).toBeGreaterThan(0);
    expect(month(500).duty).toBeGreaterThan(0);
    // Syracuse buys, and Carthage is not the power that is paid.
    const world = withCustoms(opening(), POWERS.syracuse, 500);
    const book = bookOf(world);
    setStock(book, syracuse, "grain", 0.6);
    expect(flow(world, book).duties.has(POWERS.carthage)).toBe(false);
  });

  it("earns the treasury more at a moderate rate than at a light one, and less again at a steep one", () => {
    const rates = [0, 200, 500, 1_000, 1_500, 2_000, 3_000, 5_000];
    const takes = rates.map((rate) => month(rate).duty);
    const peak = Math.max(...takes);
    // A rising take as the rate rises from nothing...
    expect(takes[1]!).toBeGreaterThan(takes[0]!);
    expect(takes[2]!).toBeGreaterThan(takes[1]!);
    // ...to a peak that is neither the lightest nor the steepest...
    expect(peak).toBeGreaterThan(takes[1]!);
    expect(peak).toBeGreaterThan(takes.at(-1)!);
    // ...and a steep tariff that earns next to nothing because next to nothing comes.
    expect(takes.at(-1)!).toBeLessThan(peak * 0.2);
  });

  it("shrinks the trade as it steepens, and the grain it keeps out is dearer at home", () => {
    const light = month(200);
    const heavy = month(1_800);
    const shut = month(5_000);
    expect(heavy.inflow).toBeLessThan(light.inflow);
    expect(shut.inflow).toBeLessThan(heavy.inflow);
    expect(shut.inflow).toBe(0);
    expect(heavy.after).toBeGreaterThan(light.after);
    expect(shut.after).toBeGreaterThanOrEqual(heavy.after);
    expect(shut.after).toBe(shut.before);
  });

  it("is paid by the one that buys: a power's own goods from its own hubs are charged none of it", () => {
    const world = withCustoms(opening(), POWERS.carthage, 3_000);
    const book = bookOf(world);
    // Agrigentum, a Carthaginian hub, short, with Carthaginian hubs to send it.
    setStock(book, agrigentum, "grain", 0.3);
    const result = flow(world, book);
    // Grain moved between Carthage's own hubs; what Carthage took customs on is only what crossed its border,
    // at the rate it laid, to the drachma: the grain from Utica and Lilybaeum to Agrigentum was free.
    expect(inflowOf(book, agrigentum, "grain")).toBeGreaterThan(0);
    const intoCarthage = [...result.lanes.entries()].filter(([key]) => key.endsWith(`>${POWERS.carthage}`)).reduce((sum, [, value]) => sum + value, 0);
    expect(intoCarthage).toBeGreaterThan(0);
    expect(result.duties.get(POWERS.carthage) ?? 0).toBeCloseTo(intoCarthage * 0.3, 3);
  });

  it("keeps out the goods from one power only: the tariff is on foreign goods, not on Syracuse's own hubs' trade", () => {
    const world = withCustoms(opening(), POWERS.syracuse, 5_000);
    const book = bookOf(world);
    setStock(book, agrigentum, "grain", 0.3);
    // Carthage is short and Syracuse's tariff does not stand in the way of Syracuse's own sales of grain to it (its rate is on what comes in).
    flow(world, book);
    expect(inflowOf(book, agrigentum, "grain")).toBeGreaterThan(0);
  });

  it("accrues in the month's pass, and is paid into the treasury as an inflow of the market's, with the books balancing", () => {
    // Syracuse short of grain for a few months, with a tariff on what it buys.
    const base = withCustoms(opening(), POWERS.syracuse, 500);
    const book = bookOf(base);
    setStock(book, syracuse, "grain", 0.35);
    const hub = book.get(syracuse)!;
    const world: WorldState = {
      ...base,
      economy: {
        ...economyOf(base),
        markets: economyOf(base).markets.map((entry) => (entry.hubId !== syracuse
          ? entry
          : { ...entry, goods: entry.goods.map((good) => (good.good === "grain" ? { ...good, stock: Math.round(hub.stock[GRAIN]!) } : good)) })),
      },
    };
    let current = reviewTheLand({ world, toDay: 0 }).world;
    for (let step = 1; step <= 3; step += 1) current = reviewTheLand({ world: current, toDay: step * 30 }).world;
    const due = economyOf(current).customsDue.find((entry) => entry.polityId === POWERS.syracuse)?.amount ?? 0;
    expect(due).toBeGreaterThan(0);
    expect(economyOf(current).customsDue.some((entry) => entry.polityId === POWERS.carthage)).toBe(false);

    const treasury = treasuryOf(current, POWERS.syracuse)!;
    const paid = payCustoms(current, 90, createIdFactory("customs"));
    expect(economyOf(paid).customsDue).toEqual([]);
    const balance = (w: WorldState): number => w.material.accounts.find((account) => account.id === treasury)!.balance;
    expect(balance(paid) - balance(current)).toBe(due);
    // A single credit through the market's door, nothing unexplained.
    const audit = auditMoney(current, paid);
    expect(unexplainedTotal(audit)).toBe(0);
    expect(audit.doors.market.in).toBe(due);
  });

  it("can be set by the power's own officers, with the customs scope of tax_policy_set, and is clamped", () => {
    const world = opening();
    const set = apply(world, [{ op: "tax_policy_set", scope: "customs", polityId: "rome", rateBps: 700, reason: "A tariff on foreign grain." }]);
    expect(economyOf(set.world).customsRates).toEqual([{ polityId: "rome", rateBps: 700 }]);
    const steep = apply(set.world, [{ op: "tax_policy_set", scope: "customs", polityId: "rome", rateBps: 9_999, reason: "Everything." }]);
    expect(economyOf(steep.world).customsRates[0]!.rateBps).toBe(5_000);
    const none = apply(steep.world, [{ op: "tax_policy_set", scope: "customs", polityId: "rome", rateBps: 0, reason: "Free ports." }]);
    expect(economyOf(none.world).customsRates).toEqual([]);
    // Nobody lays customs for a power that is not his.
    const foreign = apply(world, [{ op: "tax_policy_set", scope: "customs", polityId: "carthage", rateBps: 700, reason: "A tariff." }]);
    expect(economyOf(foreign.world).customsRates).toEqual([]);
  });
});
