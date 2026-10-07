import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  WorldStateSchema,
  adjacentTo,
  applyWarDamage,
  ensureProvinceMaterial,
  sackTheProvince,
  type ProvinceMaterial,
  type WorldState,
} from "@chronica/shared";
import { reviewTheLand } from "./economy";
import { provinceTargetsFrom } from "./standing-effects";
import { months } from "./passing-months";

/**
 * "Carthage's army sacked the Latin plain and lay over it for two summers.
 * Ten years after the peace, how is it doing against the province across the
 * hill that never saw a soldier?"
 *
 * It was doing as well as the other one inside three years, because everything
 * a war did to a place was undone at the same few hundred a month: the burned
 * fields came back, the displaced came home, and nothing else had ever been
 * lost. Development is what else is lost -- the roads, the harbour, the
 * estates, the merchants who stopped coming -- and it falls at once and comes
 * back at a fifth of the speed, while a scar written on the province by every
 * sack, siege and campaign caps what it can become for a generation. Each case
 * runs the same province twice from the same opening, once untouched and once
 * struck, so the only difference between them is the war.
 */

const LATIUM = PUNIC_IDS.rome;
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const rowOf = (world: WorldState, id: string): ProvinceMaterial => world.material.provinceMaterial.find((row) => row.provinceId === id)!;
const withRow = (world: WorldState, id: string, patch: Partial<ProvinceMaterial>): WorldState => ({
  ...world,
  material: { ...world.material, provinceMaterial: world.material.provinceMaterial.map((row) => (row.provinceId === id ? { ...row, ...patch } : row)) },
});

/** Carthage's army takes what Latium has, as the siege and the raid do (`sackTheProvince`). */
function sacked(world: WorldState, atStep: number): WorldState {
  const result = sackTheProvince(world, {
    provinceId: LATIUM, takerPolityId: "carthage", takingForceId: null, atStep,
    cause: { kind: "action", id: "the-sack", explanation: "Carthage's army sacks the Latin plain" }, transactionId: `sack-${atStep}`,
  });
  expect(result.taken).toBeGreaterThan(0);
  return result.world;
}

/** The years that follow, as the calendar passes them, and what the province has become at the end of each of the ones asked for. */
function years(world: WorldState, count: number, from = 0, targets = provinceTargetsFrom): WorldState {
  return months(world, count * 12, from, targets);
}

describe("a war-torn region lags", () => {
  it("is struck at once, and scarred: a sack takes a fifth of its development and writes a scar that lasts", () => {
    const peace = opening();
    const struck = sacked(peace, 0);
    const before = rowOf(peace, LATIUM);
    const after = rowOf(struck, LATIUM);
    expect(after.developmentBps!).toBeLessThan(before.developmentBps! * 0.85);
    expect(after.developmentBps!).toBeGreaterThan(before.developmentBps! * 0.7);
    expect(after.scarBps!).toBeGreaterThan(1_000);
    expect(after.warDamageBps).toBeGreaterThan(0);
    // A battle on its fields is a twentieth, not a fifth: severity in proportion.
    const battle = applyWarDamage(before, { severityBps: 1_000 }, 0);
    expect(before.developmentBps! - battle.developmentBps!).toBeLessThan(before.developmentBps! - after.developmentBps!);
    expect(battle.scarBps!).toBeLessThan(after.scarBps!);
    // A second blow adds to the first and does not repeat it: the scar deepens, by less each time.
    const twice = applyWarDamage(after, { severityBps: 4_000 }, 0);
    expect(twice.scarBps!).toBeGreaterThan(after.scarBps!);
    expect(twice.scarBps! - after.scarBps!).toBeLessThan(after.scarBps!);
  });

  it("is clearly behind the province nothing happened to, ten years on, in development, people and what it pays", () => {
    const peace = years(opening(), 10);
    const torn = years(sacked(opening(), 0), 10);
    const a = rowOf(peace, LATIUM);
    const b = rowOf(torn, LATIUM);
    expect(a.developmentBps! - b.developmentBps!).toBeGreaterThan(900);
    expect(b.population).toBeLessThan(a.population * 0.99);
    expect(b.taxCapacity).toBeLessThan(a.taxCapacity * 0.95);
    expect(b.scarBps!).toBeGreaterThan(500);
    expect(a.scarBps!).toBe(0);
    // And the gap is wider ten years on than it was the day after, because the scarred province builds more slowly.
    const struck = rowOf(sacked(opening(), 0), LATIUM);
    expect(a.developmentBps! - b.developmentBps!).toBeGreaterThan(rowOf(opening(), LATIUM).developmentBps! - struck.developmentBps!);
  });

  it("is sown again within three years, and a generation behind: fields mend fast, development does not", () => {
    const struck = sacked(opening(), 0);
    const three = years(struck, 3);
    const peace = years(opening(), 3);
    // The burned fields are quickly sown again.
    expect(rowOf(three, LATIUM).warDamageBps).toBeLessThanOrEqual(100);
    // The development that fell with them has barely begun to come back.
    const lost = rowOf(peace, LATIUM).developmentBps! - rowOf(three, LATIUM).developmentBps!;
    expect(lost).toBeGreaterThan(rowOf(opening(), LATIUM).developmentBps! - rowOf(struck, LATIUM).developmentBps!);
    expect(rowOf(three, LATIUM).scarBps!).toBeGreaterThan(rowOf(struck, LATIUM).scarBps! * 0.8);
    // A generation on (fourteen years) the scar is still there, though fading: a sack heals in about nineteen.
    const generation = years(struck, 14);
    expect(rowOf(generation, LATIUM).scarBps!).toBeGreaterThan(0);
    expect(rowOf(generation, LATIUM).scarBps!).toBeLessThan(rowOf(three, LATIUM).scarBps!);
  });

  it("is deepened by a second war", () => {
    const once = years(sacked(opening(), 0), 10);
    const stepped = years(sacked(opening(), 0), 5);
    const twice = years(sacked({ ...stepped }, 5 * 360), 5, 5 * 360);
    expect(rowOf(twice, LATIUM).scarBps!).toBeGreaterThan(rowOf(once, LATIUM).scarBps!);
    expect(rowOf(twice, LATIUM).developmentBps!).toBeLessThan(rowOf(once, LATIUM).developmentBps!);
    expect(rowOf(twice, LATIUM).population).toBeLessThan(rowOf(once, LATIUM).population);
  });

  it("is made worse by a heavy tax on it, and better by a light one", () => {
    const struck = sacked(opening(), 0);
    const at = (rate: number): ProvinceMaterial => rowOf(years(withRow(struck, LATIUM, { taxRateBps: rate }), 8), LATIUM);
    const light = at(500);
    const ordinary = at(1_000);
    const heavy = at(3_000);
    expect(heavy.developmentBps!).toBeLessThan(ordinary.developmentBps! - 400);
    expect(ordinary.developmentBps!).toBeLessThan(light.developmentBps!);
    // The scar fades slower under a heavy hand.
    expect(heavy.scarBps!).toBeGreaterThan(ordinary.scarBps!);
    expect(light.scarBps!).toBeLessThan(ordinary.scarBps!);
  });

  it("is made up by rebuilding: a work that raises development narrows the gap and fades the scar faster", () => {
    const struck = sacked(opening(), 0);
    const works = {
      id: "the-rebuilding", kind: "other" as const, name: "The rebuilding of the Latin roads and farms", provinceId: LATIUM, settlementId: null, ownerPolityId: "rome",
      garrisonCapacity: 0, defensiveEffectsBps: 0, supplyRadius: 0, builtAtStep: 0, provenanceProjectId: null,
      effects: [{ quantity: "development" as const, direction: "raise" as const, band: "marked" as const, scope: "here" as const }],
    };
    const rebuilt = years({ ...struck, structures: [...struck.structures, works] }, 10);
    const left = years(struck, 10);
    const peace = years(opening(), 10);
    expect(rowOf(rebuilt, LATIUM).scarBps!).toBeLessThan(rowOf(left, LATIUM).scarBps!);
    expect(rowOf(rebuilt, LATIUM).developmentBps!).toBeGreaterThan(rowOf(left, LATIUM).developmentBps!);
    expect(rowOf(peace, LATIUM).developmentBps! - rowOf(rebuilt, LATIUM).developmentBps!)
      .toBeLessThan(rowOf(peace, LATIUM).developmentBps! - rowOf(left, LATIUM).developmentBps!);
  });

  it("is squeezed by an occupier who plunders it, and let alone by one who administers it", () => {
    const occupied = (rate: number): WorldState => {
      const world = opening();
      return withRow({
        ...world,
        map: { ...world.map, provinces: world.map.provinces.map((province) => (province.id === LATIUM ? { ...province, controllerPolityId: "carthage", ownerPolityId: "rome" } : province)) },
      }, LATIUM, { taxRateBps: rate });
    };
    const plundered = rowOf(years(occupied(3_500), 3), LATIUM);
    const administered = rowOf(years(occupied(600), 3), LATIUM);
    expect(plundered.scarBps!).toBeGreaterThan(administered.scarBps! * 2);
    expect(plundered.developmentBps!).toBeLessThan(administered.developmentBps!);
    // Even the gentler occupation is no growth: the province does not develop under an army's heel.
    expect(administered.developmentBps!).toBeLessThanOrEqual(rowOf(opening(), LATIUM).developmentBps!);
  });

  it("sends its people to the safe country beside it, which gains a little for them", () => {
    const base = opening();
    const neighbours = adjacentTo(base, LATIUM).map((other) => other.provinceId);
    const fled = withRow(base, LATIUM, { displacedPopulation: 200_000, stabilityBps: 2_500 });
    const one = (world: WorldState) => reviewTheLand({ world: reviewTheLand({ world, toDay: 0 }).world, toDay: 30 }).world;
    const with_ = one(fled);
    const without = one(base);
    const gained = neighbours.filter((id) => rowOf(with_, id).developmentBps! > rowOf(without, id).developmentBps!);
    expect(gained.length).toBeGreaterThan(0);
    const gone = rowOf(with_, LATIUM).population < rowOf(without, LATIUM).population;
    expect(gone).toBe(true);
  });

  it("tells a power its countryside lies waste once, as one line, and never a line a province", () => {
    // Sacked twice, and campaigned over: past the line at which a district is laid waste.
    const struck = sacked(sacked(opening(), 0), 1);
    const start = reviewTheLand({ world: struck, toDay: 0 }).world;
    const lines: string[] = [];
    let world = start;
    for (let month = 1; month <= 36; month += 1) {
      const land = reviewTheLand({ world, toDay: month * 30 });
      world = land.world;
      lines.push(...land.facts.filter((fact) => fact.kind === "devastation").map((fact) => fact.summary));
    }
    // One news in three years, for the one power, naming the province and no more than three.
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("lies waste");
    expect(lines[0]!.length).toBeLessThan(600);
  });
});
