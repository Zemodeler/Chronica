import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, ensureProvinceMaterial, provinceGrounds, MIN_DEVELOPMENT_BPS, type ProvinceMaterial, type WorldState } from "@chronica/shared";
import { months } from "./passing-months";

/**
 * Over a long peace the regions of the map should draw far apart.
 *
 * Five years of peace used to leave the gap between the best and the worst
 * tenth of the provinces where it began (1,750 at the start, 1,759 after five
 * years): every province was lifted by much the same and only a harbour or a
 * market's traffic told two apart. A province's growth now follows where it lies
 * (the fertility of its soil, the sea and the roads, a big town or a court within
 * reach, what its ground sells beyond its own bread), who holds it and for how long,
 * how crowded it is, how near a war, its own luck, and a head start that compounds.
 * These run the real monthly pass over the whole Punic map for ten years and
 * look at the spread, at a rich port and an upland no road reaches, at ground
 * a war has just handed to a new master, and at the bounds.
 */
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const rowOf = (world: WorldState, id: string): ProvinceMaterial => world.material.provinceMaterial.find((row) => row.provinceId === id)!;
const withRow = (world: WorldState, id: string, patch: Partial<ProvinceMaterial>): WorldState => ({
  ...world,
  material: { ...world.material, provinceMaterial: world.material.provinceMaterial.map((row) => (row.provinceId === id ? { ...row, ...patch } : row)) },
});

const percentile = (sorted: readonly number[], share: number): number => sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))]!;
function spreadOf(world: WorldState): { readonly p10: number; readonly median: number; readonly p90: number; readonly gap: number; readonly sd: number; readonly mean: number } {
  const values = world.material.provinceMaterial.map((row) => row.developmentBps ?? 0).sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
  return { p10: percentile(values, 0.1), median: percentile(values, 0.5), p90: percentile(values, 0.9), gap: percentile(values, 0.9) - percentile(values, 0.1), sd, mean };
}

/** The whole map through ten years of peace, kept at the fifth and tenth year (the monthly pass the tick runs, thirty days at a time). */
const start = opening();
const five = months(start, 60);
const ten = months(five, 60, 60 * 30);
const began = spreadOf(start);

/** A rich port on the plain beside a big town, and an upland walled in by passes with nothing near it, both set to the same start so that only the place differs. */
const grounds = provinceGrounds(start);
const ids = start.map.provinces.map((province) => province.id).sort();
const RICH = ids.find((id) => {
  const province = start.map.provinces.find((candidate) => candidate.id === id)!;
  const site = grounds.get(id)!.site;
  return province.terrainId === "coastal-plain" && province.settlements.some((settlement) => settlement.kind === "port") && site.agglomeration > 0.5 && site.coastal;
})!;
const UPLAND = ids.find((id) => {
  const province = start.map.provinces.find((candidate) => candidate.id === id)!;
  const site = grounds.get(id)!.site;
  return province.terrainId === "hills-uplands" && province.settlements.length === 0 && site.agglomeration === 0 && site.enclosed && !site.coastal && !site.mineral && site.court < 0.05;
})!;
const SAME_START = 2_500;

function pair(): WorldState {
  return withRow(withRow(opening(), RICH, { developmentBps: SAME_START }), UPLAND, { developmentBps: SAME_START });
}

describe("regions diverge over a decade of peace", () => {
  it("finds a rich port and an upland that are alike at the start", () => {
    expect(RICH).toBeDefined();
    expect(UPLAND).toBeDefined();
    expect(grounds.get(RICH)!.potentialBps).toBeGreaterThan(grounds.get(UPLAND)!.potentialBps + 2_500);
  });

  it("widens the gap between the best and the worst tenth of the provinces, by half again in five years' time and by a good deal more in ten", () => {
    const afterFive = spreadOf(five);
    const afterTen = spreadOf(ten);
    // It began at about 1,750 (p10 2,205, p90 3,955) and was barely moved in five years.
    expect(began.gap).toBeGreaterThan(1_600);
    expect(began.gap).toBeLessThan(1_900);
    expect(afterFive.gap).toBeGreaterThan(1.2 * began.gap);
    expect(afterTen.gap).toBeGreaterThan(1.6 * began.gap);
    expect(afterTen.gap).toBeGreaterThan(afterFive.gap);
    // The whole distribution spreads, not just its tails.
    expect(afterFive.sd).toBeGreaterThan(1.15 * began.sd);
    expect(afterTen.sd).toBeGreaterThan(1.7 * began.sd);
  });

  it("keeps the mean growing at a modest pace: some hundred a year, not some thousand", () => {
    const afterTen = spreadOf(ten);
    const perYear = (afterTen.mean - began.mean) / 10;
    expect(perYear).toBeGreaterThan(60);
    expect(perYear).toBeLessThan(200);
    // The poor and isolated tenth hardly move, the favoured tenth builds a few hundred a year.
    expect(afterTen.p10 - began.p10).toBeLessThan(700);
    expect((afterTen.p90 - began.p90) / 10).toBeLessThan(300);
    expect(afterTen.p90 - began.p90).toBeGreaterThan(1_200);
  });

  it("lets some provinces stand still or slip back, and some build a great deal", () => {
    const gains = start.material.provinceMaterial.map((row) => rowOf(ten, row.provinceId).developmentBps! - row.developmentBps!).sort((a, b) => a - b);
    expect(percentile(gains, 0.05)).toBeLessThan(150);
    expect(gains[0]!).toBeLessThan(10);
    expect(gains[gains.length - 1]!).toBeGreaterThan(2_500);
  });

  it("leaves no province pinned at the floor or at the top of the scale for no reason", () => {
    for (const row of ten.material.provinceMaterial) {
      expect(row.developmentBps!).toBeGreaterThanOrEqual(MIN_DEVELOPMENT_BPS);
      expect(row.developmentBps!).toBeLessThanOrEqual(10_000);
    }
    const values = ten.material.provinceMaterial.map((row) => row.developmentBps!);
    expect(values.filter((value) => value <= MIN_DEVELOPMENT_BPS).length).toBe(0);
    expect(values.filter((value) => value >= 10_000).length).toBe(0);
    // And none is past what its ground could carry.
    const ceilings = provinceGrounds(ten);
    for (const row of ten.material.provinceMaterial) expect(row.developmentBps!).toBeLessThanOrEqual(ceilings.get(row.provinceId)!.potentialBps);
  });

  it("raises a rich port, on the plain beside a big town, far beyond an upland with no road, from the same start", () => {
    const end = months(pair(), 120);
    const port = rowOf(end, RICH).developmentBps! - SAME_START;
    const hills = rowOf(end, UPLAND).developmentBps! - SAME_START;
    expect(port).toBeGreaterThan(1_200);
    expect(hills).toBeLessThan(450);
    expect(port).toBeGreaterThan(4 * Math.max(1, hills));
  });

  it("leaves ground a war has just handed to a new master behind the same ground held for generations", () => {
    const held = pair();
    const province = held.map.provinces.find((candidate) => candidate.id === RICH)!;
    const master = held.map.polities.find((polity) => polity.id !== province.controllerPolityId && polity.id !== "carthage") ?? held.map.polities[0]!;
    const taken: WorldState = {
      ...held,
      map: {
        ...held.map,
        provinces: held.map.provinces.map((candidate) => (candidate.id === RICH
          ? { ...candidate, controllerPolityId: master.id, lostBy: { polityId: province.controllerPolityId ?? "rome", atStep: 0 }, controlFirmnessBps: 4_500 }
          : candidate)),
      },
    };
    const longHeld = rowOf(months(held, 120), RICH).developmentBps! - SAME_START;
    const conquered = rowOf(months(taken, 120), RICH).developmentBps! - SAME_START;
    expect(conquered).toBeGreaterThan(0);
    expect(conquered).toBeLessThan(0.8 * longHeld);
    // As the years pass the new master's tenure lengthens and the gap in speed closes: it is behind most at the start.
    const early = rowOf(months(held, 24), RICH).developmentBps! - SAME_START;
    const earlyTaken = rowOf(months(taken, 24), RICH).developmentBps! - SAME_START;
    expect(earlyTaken / early).toBeLessThan(conquered / longHeld);
  });

  it("is the same on every run", () => {
    const again = months(opening(), 24);
    const once = months(opening(), 24);
    expect(again.material.provinceMaterial.map((row) => row.developmentBps)).toEqual(once.material.provinceMaterial.map((row) => row.developmentBps));
    expect(spreadOf(months(opening(), 60))).toEqual(spreadOf(five));
  });
});
