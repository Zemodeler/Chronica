import { describe, expect, it } from "vitest";
import { derivePoliticalMapState, deriveWarBorderPaths, type PoliticalOverlayInput } from "./political-geometry";
import { prepareStaticWorldGeometry } from "./world-geometry";
import { syntheticProvinceMap } from "./synthetic-province-map";

const COLUMNS = 70;
const ROWS = 63;
const EDGES_PER_SIDE = 21;

/** Three powers in vertical bands, and a strip of unclaimed land on the right. */
function ownerOf(index: number): string | null {
  const column = index % COLUMNS;
  return column < 25 ? "rome" : column < 50 ? "carthage" : column < 65 ? "syracuse" : null;
}

describe("the political map at four thousand provinces", () => {
  const world = prepareStaticWorldGeometry(syntheticProvinceMap({ columns: COLUMNS, rows: ROWS }));
  const overlay: PoliticalOverlayInput = {
    polities: [{ polityId: "rome", name: "Rome" }, { polityId: "carthage", name: "Carthage" }, { polityId: "syracuse", name: "Syracuse" }],
    provinces: world.provinces.map((province, index) => ({ provinceId: province.id, controllerPolityId: ownerOf(index), controlFirmnessBps: 5000, terrainId: "plain" })),
  };

  it("finds each power as one territory of its own provinces, and classifies every border", () => {
    const state = derivePoliticalMapState(world, overlay);
    expect(state.territories.map((territory) => territory.polityId).sort()).toEqual(["carthage", "rome", "syracuse"]);
    for (const territory of state.territories) expect(territory.components).toHaveLength(1);
    expect(state.territories.find((territory) => territory.polityId === "rome")!.primaryComponent.provinceIds).toHaveLength(25 * ROWS);
    const countryEdges = state.borderSegments.filter((segment) => segment.classification === "country_border").reduce((sum, segment) => sum + segment.points.length - 1, 0);
    // Three vertical borders (rome | carthage, carthage | syracuse, syracuse | unclaimed) of 63 provinces, 21 edges to a side.
    expect(countryEdges).toBe(3 * ROWS * EDGES_PER_SIDE);
  });

  it("draws a war border only between the powers at war, from paths built when asked for", () => {
    const state = derivePoliticalMapState(world, overlay);
    const path = deriveWarBorderPaths(state, [{ polityAId: "carthage", polityBId: "rome" }]);
    expect((path.match(/M/g) ?? []).length).toBe(ROWS * EDGES_PER_SIDE);
    expect(deriveWarBorderPaths(state, [])).toBe("");
  });

  it("reuses an unchanged power's territory when one province changes hands", () => {
    const first = derivePoliticalMapState(world, overlay);
    const moved = { ...overlay, provinces: overlay.provinces.map((row, index) => index === 0 ? { ...row, controllerPolityId: "carthage" } : row) };
    const second = derivePoliticalMapState(world, moved, first);
    expect(second.territories.find((territory) => territory.polityId === "syracuse")).toBe(first.territories.find((territory) => territory.polityId === "syracuse"));
    expect(second.ownerByProvince.get(world.provinces[0]!.id)).toBe("carthage");
  });
});
