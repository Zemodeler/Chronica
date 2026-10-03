import { describe, expect, it } from "vitest";
import type { CrossingType, ProvinceEdge } from "./map";
import { adjacentTo, kmBetween, kmFrom, kmFromAny, landKmBetween, strictKmBetween, type MapWorld } from "./movement";
import { MARCH_KM_PER_DAY, REFERENCE_PROVINCE_KM, describeKm, marchDaysFor, sailDaysFor } from "./travel";
import { MAX_NEWS_DAYS, newsDaysBetween, type NewsWorld } from "./news";

/**
 * A journey takes as long as the road is, not as many provinces as lie on it.
 * The same 360 km is laid out as 3 provinces and as 9, and everything that
 * takes time or reaches somewhere must give the same answer for both.
 */

/** A straight road of `provinces` provinces, `totalKm` from end to end. */
function chain(provinces: number, totalKm: number, crossing: CrossingType = "land"): NewsWorld & MapWorld {
  const ids = Array.from({ length: provinces }, (_, index) => `p${index}`);
  const edges: ProvinceEdge[] = ids.slice(1).map((to, index) => ({ from: ids[index]!, to, crossing, distance: totalKm / (provinces - 1) }));
  return { map: { provinces: ids.map((id) => ({ id })), edges }, characters: [], material: {} } as unknown as NewsWorld & MapWorld;
}

const COARSE = chain(3, 360);
const FINE = chain(9, 360);

describe("distance is kilometres, not provinces", () => {
  it("measures the same road the same however finely it is cut", () => {
    expect(kmBetween(COARSE, "p0", "p2")).toBe(360);
    expect(kmBetween(FINE, "p0", "p8")).toBe(360);
    expect(kmBetween(FINE, "p8", "p0")).toBe(360);
    expect(landKmBetween(FINE, "p0", "p8")).toBe(360);
  });

  it("takes as many days to march the road on either map", () => {
    const coarse = marchDaysFor(kmBetween(COARSE, "p0", "p2")!);
    const fine = marchDaysFor(kmBetween(FINE, "p0", "p8")!);
    expect(fine).toBeCloseTo(coarse, 9);
    // An old-map province is four days of march, about 21 km a day: a Roman
    // army's pace on a road, where it was once eight days, half that.
    expect(marchDaysFor(REFERENCE_PROVINCE_KM)).toBeCloseTo(4, 9);
    expect(coarse).toBeCloseTo(360 / MARCH_KM_PER_DAY, 9);
  });

  it("takes as many days for word to arrive on either map", () => {
    const coarse = newsDaysBetween(COARSE, "p0", "p2");
    const fine = newsDaysBetween(FINE, "p0", "p8");
    expect(fine).toBe(coarse);
    // Two days a reference province, so 360 km is about nine days by road.
    expect(coarse).toBe(Math.ceil(360 / (REFERENCE_PROVINCE_KM / 2)));
    expect(newsDaysBetween(FINE, "p8", "p0")).toBe(fine);
  });

  it("caps word at a month, and holds nothing back where there is no road", () => {
    const long = chain(40, 4_000);
    expect(newsDaysBetween(long, "p0", "p39")).toBe(MAX_NEWS_DAYS);
    const apart = { map: { provinces: [{ id: "a" }, { id: "b" }, { id: "c" }], edges: [{ from: "a", to: "b", crossing: "land", distance: 50 }] }, characters: [], material: {} } as unknown as NewsWorld;
    expect(newsDaysBetween(apart, "a", "c")).toBe(0);
  });

  it("gives a crossing by water at least a morning, and a pass a slower pace than the plain", () => {
    expect(newsDaysBetween(chain(2, 5, "strait"), "p0", "p1")).toBe(1);
    expect(newsDaysBetween(chain(2, 170, "pass"), "p0", "p1")).toBeGreaterThan(newsDaysBetween(chain(2, 170, "land"), "p0", "p1"));
  });

  it("sails a fleet the same days over the same distance", () => {
    expect(sailDaysFor(kmBetween(COARSE, "p0", "p2")!)).toBe(sailDaysFor(kmBetween(FINE, "p0", "p8")!));
  });
});

describe("routes over a graph", () => {
  it("keeps to the kilometre budget", () => {
    expect(kmBetween(FINE, "p0", "p8", 359)).toBeNull();
    expect(kmBetween(FINE, "p0", "p8", 360)).toBe(360);
    expect([...kmFrom(FINE, "p0", { budgetKm: 100 }).keys()]).toEqual(["p0", "p1", "p2"]);
  });

  it("takes the shorter of two roads, not the one with fewer provinces", () => {
    const edges: ProvinceEdge[] = [
      { from: "a", to: "z", crossing: "land", distance: 500 },
      { from: "a", to: "b", crossing: "land", distance: 100 },
      { from: "b", to: "c", crossing: "land", distance: 100 },
      { from: "c", to: "z", crossing: "land", distance: 100 },
    ];
    const world = { map: { provinces: [], edges } } as unknown as MapWorld;
    expect(kmBetween(world, "a", "z")).toBe(300);
  });

  it("refuses the sea to a march on foot, and finds it for a fleet", () => {
    const edges: ProvinceEdge[] = [
      { from: "a", to: "b", crossing: "land", distance: 50 },
      { from: "b", to: "c", crossing: "strait", distance: 20 },
    ];
    const world = { map: { provinces: [], edges } } as unknown as MapWorld;
    expect(landKmBetween(world, "a", "c")).toBeNull();
    expect(kmBetween(world, "a", "c")).toBe(70);
    expect(strictKmBetween(world, "a", "c", (crossing) => crossing !== "sea_lane")).toBe(70);
    expect(strictKmBetween(world, "a", "c", (crossing) => crossing === "land")).toBeNull();
  });

  it("starts from several places at once", () => {
    const reached = kmFromAny(FINE, ["p0", "p8"], { budgetKm: 50 });
    expect([...reached.keys()].sort()).toEqual(["p0", "p1", "p7", "p8"]);
  });

  it("indexes the edges once and lists a province's neighbours in edge order", () => {
    expect(adjacentTo(FINE, "p4").map((next) => next.provinceId)).toEqual(["p3", "p5"]);
    expect(adjacentTo(FINE, "p4")).toBe(adjacentTo(FINE, "p4"));
    expect(adjacentTo(FINE, "nowhere")).toEqual([]);
  });

  it("says a distance the way a person would", () => {
    expect(describeKm(4)).toBe("4 km");
    expect(describeKm(87)).toBe("85 km");
    expect(describeKm(263)).toBe("260 km");
  });
});
