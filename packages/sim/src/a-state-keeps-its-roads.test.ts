import { describe, expect, it } from "vitest";
import { economyOf, monthlyTakings, neglectShiftBps, type WorldState } from "@chronica/shared";
import { atDay, definition, opening, treasuryBalance, withChest } from "./fiscal-test-kit";
import { keepTheState } from "./keeping-the-state";
import { auditMoney } from "./money-audit";
import { createIdFactory } from "./ports";
import { provinceTargetsFrom } from "./standing-effects";
import { upkeepByPolity } from "./the-upkeep-of-a-state";

/**
 * "Who mends the roads?"
 *
 * Every power pays each month for the upkeep of what it holds (its roads, walls, harbours, granaries, aqueducts and halls), by the settled size of its towns,
 * the development of its provinces, the fortified places and the ports, and, for a maritime power, the hulls at dock. In a peace it is some tenth of what the power
 * takes in. When the chest cannot pay, the upkeep is behind: after half a year the ceiling of what its provinces can become sinks, slowly, and a wall may slip.
 * A power that pays again recovers.
 */

const month = (world: WorldState, toDay: number, playerCharacterId: string | null = null) =>
  keepTheState({ world: atDay(world, toDay), toDay, ids: createIdFactory(`roads-${toDay}`), offices: definition.government.offices, playerCharacterId });

/** Nothing is let: only the upkeep and the costs are looked at. */
const withoutWorks = (world: WorldState): WorldState => ({ ...world, departments: world.departments.map((department) => ({ ...department, levers: department.levers.filter((lever) => lever !== "public_works_cost") })) });

const rowOf = (world: WorldState, polityId: string) => economyOf(world).keeping.find((row) => row.polityId === polityId)!;

describe("a state keeps its roads", () => {
  it("pays each month for the upkeep of what it holds: about a tenth of what a great power takes in, never more than a seventh", () => {
    const world = withoutWorks(opening(120));
    const done = month(world, 150);
    for (const polityId of ["rome", "carthage", "syracuse"]) {
      const takings = monthlyTakings(world, polityId);
      const row = rowOf(done.world, polityId);
      const share = row.upkeepDue / takings;
      expect(share, `${polityId}: ${row.upkeepDue} of ${takings}`).toBeGreaterThan(0.08);
      expect(share).toBeLessThanOrEqual(0.15);
      expect(row.upkeepPaidBps).toBe(10_000);
    }
    // It leaves the chest, and nothing is made of it: a passage out to the men nobody names.
    const audit = auditMoney(world, done.world);
    expect(audit.unexplained).toEqual([]);
    expect(audit.doors.the_unnamed.out).toBeGreaterThan(0);
    expect(treasuryBalance(done.world, "rome")).toBeLessThan(treasuryBalance(world, "rome"));
  });

  it("is more where the towns are bigger, the land richer, the walls higher, the ports busier and the fleet at dock", () => {
    const world = opening(120);
    const base = upkeepByPolity(world).get("rome")!;
    const grown = (change: (province: WorldState["map"]["provinces"][number]) => WorldState["map"]["provinces"][number]): WorldState => ({
      ...world, map: { ...world.map, provinces: world.map.provinces.map((province) => (province.controllerPolityId === "rome" ? change(province) : province)) },
    });
    const bigger = upkeepByPolity(grown((province) => ({ ...province, settlements: province.settlements.map((settlement) => ({ ...settlement, size: settlement.size * 2 })) }))).get("rome")!;
    expect(bigger.towns).toBeGreaterThan(base.towns * 1.9);
    const walled = upkeepByPolity(grown((province) => ({ ...province, settlements: province.settlements.map((settlement) => ({ ...settlement, fortificationLevel: Math.min(10, settlement.fortificationLevel + 2) })) }))).get("rome")!;
    expect(walled.walls).toBeGreaterThan(base.walls);
    const richer: WorldState = { ...world, material: { ...world.material, provinceMaterial: world.material.provinceMaterial.map((row) => ({ ...row, developmentBps: Math.min(10_000, (row.developmentBps ?? 3_000) + 2_000) })) } };
    const rich = upkeepByPolity(richer).get("rome")!;
    expect(rich.roads).toBeGreaterThan(base.roads * 1.4);
    expect(rich.total).toBeGreaterThan(base.total);
    // Carthage keeps a fleet at dock and Rome none: the hulls are counted for the one that has them.
    const carthage = upkeepByPolity(world).get("carthage")!;
    expect(carthage.docks).toBeGreaterThan(0);
    expect(base.docks).toBe(0);
    expect(carthage.harbours).toBeGreaterThan(base.harbours);
  });

  it("lets the upkeep fall behind where the chest cannot pay, and the land slowly pays for it", () => {
    let world = withoutWorks(withChest(opening(120), "rome", 0));
    const romeProvince = world.map.provinces.find((province) => province.controllerPolityId === "rome")!.id;
    const shiftAt: Record<number, number> = {};
    for (let m = 1; m <= 24; m += 1) {
      world = month(world, 120 + m * 30).world;
      const row = rowOf(world, "rome");
      expect(row.upkeepPaidBps).toBe(0);
      expect(row.behindMonths).toBe(m);
      shiftAt[m] = provinceTargetsFrom(world).get(romeProvince)?.developmentShiftBps ?? 0;
    }
    // A half-year of grace; then a quarter of a point a month, never more than six points.
    expect(shiftAt[6]).toBe(0);
    expect(shiftAt[7]).toBe(neglectShiftBps(7));
    expect(shiftAt[12]).toBe(-150);
    expect(shiftAt[24]).toBe(-450);
    expect(neglectShiftBps(200)).toBe(-600);
    // A power that is not behind loses nothing.
    expect(provinceTargetsFrom(world).get(world.map.provinces.find((province) => province.controllerPolityId === "carthage")!.id)?.developmentShiftBps ?? 0).toBeGreaterThanOrEqual(0);
  });

  it("lets a wall slip a level after a year and a half, once a year, and not before", () => {
    let world = withoutWorks(withChest(opening(120), "rome", 0));
    const levelsOf = (w: WorldState): number => w.map.provinces.filter((province) => province.controllerPolityId === "rome").reduce((sum, province) => sum + province.settlements.reduce((s, settlement) => s + settlement.fortificationLevel, 0), 0);
    const start = levelsOf(world);
    const levels: number[] = [];
    for (let m = 1; m <= 40; m += 1) {
      world = month(world, 120 + m * 30).world;
      levels.push(levelsOf(world));
    }
    expect(levels[16]).toBe(start);
    expect(levels[17]).toBe(start - 1);
    expect(levels[28]).toBe(start - 1);
    expect(levels[29]).toBe(start - 2);
  });

  it("recovers when the chest pays again, two months for each that was behind", () => {
    let world = withoutWorks(withChest(opening(120), "rome", 0));
    for (let m = 1; m <= 12; m += 1) world = month(world, 120 + m * 30).world;
    expect(rowOf(world, "rome").behindMonths).toBe(12);
    world = withChest(world, "rome", 9_000_000);
    for (let m = 13; m <= 18; m += 1) world = month(world, 120 + m * 30).world;
    expect(rowOf(world, "rome").behindMonths).toBe(0);
    expect(provinceTargetsFrom(world).get(world.map.provinces.find((province) => province.controllerPolityId === "rome")!.id)?.developmentShiftBps ?? 0).toBe(0);
  });

  it("keeps a floor back for the pay of the army and the offices: it pays out of what is above it and no more", () => {
    const world = withoutWorks(opening(120));
    const floor = monthlyTakings(world, "rome");
    // Just over the floor: the costs are paid first, then what is left goes to the upkeep.
    const thin = withChest(world, "rome", floor + 20_000);
    const done = month(thin, 150).world;
    expect(rowOf(done, "rome").upkeepPaidBps).toBeLessThan(10_000);
    expect(treasuryBalance(done, "rome")).toBeGreaterThanOrEqual(floor - 1);
  });
});
