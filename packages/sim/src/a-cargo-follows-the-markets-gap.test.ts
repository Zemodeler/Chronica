import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  GOODS,
  WorldStateSchema,
  bestGapGood,
  ensureMarkets,
  ensureProvinceMaterial,
  marketGeography,
  marketPriceBps,
  priceBpsFrom,
  type GoodId,
  type WorldState,
} from "@chronica/shared";
import { MAX_MARGIN_BPS, MIN_MARGIN_BPS, cargoMarginBps } from "./cargoes";

/**
 * A cargo follows the markets' gap (phase C of the economy rework).
 *
 * A cargo's margin was read off the grain price at the two ends, whatever the
 * ship carried. It is now the gap in the price of the good it carries: oil
 * carried from where it is cheap to where it is dear earns what oil earns, and
 * a ship that names no good carries the one that pays best between its ports.
 * The margin is still held between eight in a hundred and forty-five, and a war
 * at either end and a long voyage still take their share.
 */

const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);

/** A world where one hub holds exactly this much of a good, so that its price is whatever that stock says. */
function stocked(world: WorldState, hubId: string, good: GoodId, stockShare: number): WorldState {
  return {
    ...world,
    economy: {
      ...world.economy!,
      markets: world.economy!.markets.map((hub) => (hub.hubId !== hubId ? hub : {
        ...hub,
        goods: hub.goods.map((entry) => {
          if (entry.good !== good) return entry;
          const stock = Math.round(entry.target * stockShare);
          return { ...entry, stock, priceBps: priceBpsFrom(GOODS.find((spec) => spec.id === good)!, stock, entry.target) };
        }),
      })),
    },
  };
}

describe("a cargo follows the markets' gap", () => {
  const base = ensureMarkets(opening());
  const geography = marketGeography(base);
  const from = PUNIC_IDS.syracuse;
  const to = PUNIC_IDS.carthage;
  const fromHub = geography.hubOf.get(from)!;
  const toHub = geography.hubOf.get(to)!;

  it("is between two markets of its own", () => {
    expect(fromHub).not.toBe(toHub);
  });

  it("earns more for a good that is cheap here and dear there than for one that is dear here and cheap there", () => {
    const outward = stocked(stocked(base, fromHub, "metals", 4), toHub, "metals", 0.2);
    const back = stocked(stocked(base, fromHub, "metals", 0.2), toHub, "metals", 4);
    const cargo = { fromProvinceId: from, toProvinceId: to, cargo: { good: "metals" as const } };
    expect(cargoMarginBps(outward, cargo)).toBeGreaterThan(cargoMarginBps(base, cargo));
    expect(cargoMarginBps(base, cargo)).toBeGreaterThan(cargoMarginBps(back, cargo));
  });

  it("is priced by the good it carries and not by grain", () => {
    // Grain is at one price at both ends; textiles are four times as dear at the far end than the near.
    const world = stocked(stocked(base, fromHub, "textiles", 4), toHub, "textiles", 0.2);
    const oftextiles = cargoMarginBps(world, { fromProvinceId: from, toProvinceId: to, cargo: { good: "textiles" } });
    const ofgrain = cargoMarginBps(world, { fromProvinceId: from, toProvinceId: to, cargo: { good: "grain" } });
    expect(oftextiles).toBeGreaterThan(ofgrain);
    expect(marketPriceBps(world, to, "grain")).toBe(marketPriceBps(world, from, "grain"));
  });

  it("carries, where it names no good, the one that pays best between its ports", () => {
    const world = stocked(stocked(base, fromHub, "oil_wine", 4), toHub, "oil_wine", 0.2);
    expect(bestGapGood(world, from, to).good).toBe("oil_wine");
    const unnamed = cargoMarginBps(world, { fromProvinceId: from, toProvinceId: to });
    expect(unnamed).toBe(cargoMarginBps(world, { fromProvinceId: from, toProvinceId: to, cargo: { good: "oil_wine" } }));
    // Between markets at one price it is grain, as every old venture was.
    expect(bestGapGood(base, from, to).good).toBe("grain");
  });

  it("stays between five and twenty-four in a hundred a voyage whatever the gap", () => {
    for (const [near, far] of [[4, 0.02], [0.02, 4], [1, 1]] as const) {
      const world = stocked(stocked(base, fromHub, "metals", near), toHub, "metals", far);
      const margin = cargoMarginBps(world, { fromProvinceId: from, toProvinceId: to, cargo: { good: "metals" } });
      expect(margin).toBeGreaterThanOrEqual(MIN_MARGIN_BPS);
      expect(margin).toBeLessThanOrEqual(MAX_MARGIN_BPS);
    }
    expect(MIN_MARGIN_BPS).toBe(500);
    expect(MAX_MARGIN_BPS).toBe(2_400);
    // The widest gap pays the most the ceiling allows, and the reverse the least.
    const widest = cargoMarginBps(stocked(stocked(base, fromHub, "metals", 4), toHub, "metals", 0.02), { fromProvinceId: from, toProvinceId: to, cargo: { good: "metals" } });
    const narrowest = cargoMarginBps(stocked(stocked(base, fromHub, "metals", 0.02), toHub, "metals", 4), { fromProvinceId: from, toProvinceId: to, cargo: { good: "metals" } });
    expect(widest).toBeGreaterThan(narrowest + 1_000);
  });

  it("is smaller for a war at either end", () => {
    const peace = cargoMarginBps(base, { fromProvinceId: from, toProvinceId: to, cargo: { good: "grain" } });
    const warring: WorldState = {
      ...base,
      polityAgreements: [...base.polityAgreements, {
        id: "war-rome-carthage", kind: "war", polityId: "carthage", otherPolityId: "rome", terms: "War.", sinceStep: 0,
        untilStep: null, sourceMessageId: null, status: "active", endedAtStep: null, endedReason: null, visibility: "public",
      }],
    };
    expect(cargoMarginBps(warring, { fromProvinceId: from, toProvinceId: to, cargo: { good: "grain" } })).toBeLessThan(peace);
  });
});
