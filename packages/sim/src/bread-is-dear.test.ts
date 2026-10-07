import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import {
  ScenarioDefinitionSchema,
  WorldStateSchema,
  drawStock,
  ensureMarkets,
  ensureProvinceMaterial,
  marketGeography,
  obligationAmountNow,
  polityGrainPriceBps,
  tradePremiumBps,
  victualledAmount,
  type WorldState,
} from "@chronica/shared";
import { createIdFactory } from "./ports";
import { buildWorldSlice, renderWorldSlice } from "./slice";
import { runDeterministicTick } from "./tick";

/**
 * The price of grain, which the engine worked out and nobody paid.
 *
 * A famine in Latium made bread dear on paper and changed nothing: the legions
 * cost Rome what they cost in a fat year, and a merchant carrying grain into a
 * starving port earned what he earned carrying it anywhere. Now an army's keep
 * is partly bread bought at the market, and a trade route earns by its ends.
 *
 * What makes bread dear changed with the markets (phase C): it was how fed a
 * province was, a number a test could write into a row; it is now how much
 * grain the granary of the province's market holds against what is left to eat
 * before the next crop, so a famine here is a granary run down, and the tests
 * run Rome's granaries down (`starved`) where they used to write 2 500 into
 * the rows. The assertions are the same ones: dear grain is over twice the
 * ordinary price, the legion costs more, the ruler is told.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const romanGround = (world: WorldState): Set<string> => new Set(world.map.provinces.filter((province) => province.controllerPolityId === "rome").map((province) => province.id));
/** Every market Rome trades in with its granary down to a twentieth of what it ought to hold. */
const starved = (opened: WorldState): WorldState => {
  const world = ensureMarkets(opened);
  const geography = marketGeography(world);
  const hubs = [...new Set([...romanGround(world)].map((id) => geography.hubOf.get(id)!))];
  return hubs.reduce((next, hub) => {
    const entry = next.economy!.markets.find((candidate) => candidate.hubId === hub)!.goods.find((good) => good.good === "grain")!;
    return drawStock(next, hub, "grain", entry.stock * 0.95).world;
  }, world);
};

describe("bread at the market", () => {
  it("makes an army's keep follow the price of its bread, and leaves other debts alone", () => {
    expect(victualledAmount(1_000, "army_pay", 10_000)).toBe(1_000);
    expect(victualledAmount(1_000, "army_pay", 20_000)).toBe(1_300);
    expect(victualledAmount(1_000, "army_upkeep", 20_000)).toBe(1_700);
    expect(victualledAmount(1_000, "army_upkeep", 5_000)).toBe(650);
    expect(victualledAmount(1_000, "tribute", 30_000)).toBe(1_000);
  });

  it("pays a merchant better for carrying into a dear market, within bounds", () => {
    expect(tradePremiumBps(10_000, 10_000)).toBe(10_000);
    expect(tradePremiumBps(8_000, 20_000)).toBe(15_000);
    expect(tradePremiumBps(20_000, 8_000)).toBe(7_000);
  });

  it("costs Rome more to keep its legions in a famine month", () => {
    const fed = opening();
    const hungry = starved(fed);
    expect(polityGrainPriceBps(hungry, "rome")).toBeGreaterThan(20_000);
    const pay = fed.material.obligations.find((obligation) => obligation.id === "rome-legion-pay")!;
    expect(obligationAmountNow(fed, pay)).toBe(pay.amount);
    expect(obligationAmountNow(hungry, pay)).toBeGreaterThan(pay.amount);

    const paidIn = (world: WorldState): number => {
      const ticked = runDeterministicTick({ world, toDay: pay.nextDueStep, ids: createIdFactory("bread"), warfare: definition.warfare, clock: definition.clock });
      return ticked.world.material.transactions.filter((transaction) => transaction.cause.id === pay.id).reduce((sum, transaction) => sum + transaction.amount, 0);
    };
    expect(paidIn(hungry)).toBeGreaterThan(paidIn(fed));
  });

  it("tells whoever governs that bread is dear, and says nothing in an ordinary year", () => {
    const render = (world: WorldState): string => renderWorldSlice(buildWorldSlice({
      world, clock: definition.clock, offices: definition.government.offices, actorRef: { kind: "character", id: "gaius-genucius" }, actorPolityId: "rome",
      orderText: null, facts: [], dueEvents: [], pendingEvents: [],
    }));
    expect(render(opening())).not.toContain("Grain sells at");
    expect(render(starved(opening()))).toContain("bread is dear");
  });
});
