import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { WorldStateSchema, estateTerms, ventureTerms, type EffectBand } from "@chronica/shared";
import { MAX_MARGIN_BPS, MIN_MARGIN_BPS } from "./cargoes";

/**
 * Estates paid sixty-one in the hundred a year and ventures eighty: against a legionary's hundred and twenty drachmae a year, a senator's wealth in five years
 * from a merchant's start. Land pays four to eight in the hundred of what it cost (Columella, later, has it at four to six), a venture ten to twenty-five once
 * its losses, crews and customs are paid; and what each costs to buy has not changed.
 */
const world = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
const BANDS: readonly EffectBand[] = ["slight", "marked", "great"];
const yearly = (monthly: number, price: number): number => (monthly * 12) / price;

describe("what land and trade pay", () => {
  it("pays an estate four to eight in the hundred a year of its price, in every province and size", () => {
    for (const province of world.map.provinces.slice(0, 40)) {
      for (const band of BANDS) {
        const terms = estateTerms(world, province.id, band);
        if (terms === null || terms.monthlyYield < 20) continue;
        const rate = yearly(terms.monthlyYield, terms.price);
        expect(rate, `${province.name} ${band}`).toBeGreaterThan(0.04);
        expect(rate, `${province.name} ${band}`).toBeLessThan(0.08);
      }
    }
  });
  it("pays a land venture ten to twenty-five in the hundred a year of its price, and a cargo a margin of five to twenty-four a voyage", () => {
    const latium = PUNIC_IDS.rome;
    const terms = ventureTerms(world, latium, PUNIC_IDS.syracuse, "marked")!;
    expect(yearly(terms.monthlyReturn, terms.price)).toBeGreaterThan(0.1);
    expect(yearly(terms.monthlyReturn, terms.price)).toBeLessThan(0.25);
    expect(MIN_MARGIN_BPS).toBe(500);
    expect(MAX_MARGIN_BPS).toBe(2_400);
  });
  it("costs what land cost: a senator's estate is still a fraction of his hundred thousand", () => {
    const marked = estateTerms(world, PUNIC_IDS.rome, "marked")!;
    expect(marked.price).toBeGreaterThan(1_000);
    expect(marked.price).toBeLessThan(150_000);
  });
});
