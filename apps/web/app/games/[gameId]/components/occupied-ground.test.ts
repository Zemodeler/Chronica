import { describe, expect, it } from "vitest";
import { derivePoliticalMapState, type PoliticalOverlayInput } from "./political-geometry";
import { prepareStaticWorldGeometry } from "./world-geometry";
import { syntheticProvinceMap } from "./synthetic-province-map";

/**
 * Occupied ground on the map (docs/plans/a-living-world.md §3): held is not
 * owned, so an occupied province keeps its owner's colour and borders, and
 * the occupier's stripes go over it -- the way EU4 shows a war in progress.
 */
describe("occupied ground", () => {
  const world = prepareStaticWorldGeometry(syntheticProvinceMap({ columns: 4, rows: 2 }));
  const ids = world.provinces.map((province) => province.id);
  const overlay: PoliticalOverlayInput = {
    polities: [{ polityId: "rome", name: "Rome" }, { polityId: "carthage", name: "Carthage" }],
    provinces: ids.map((provinceId, index) => (index === 1
      // Rome's, held by Carthage.
      ? { provinceId, controllerPolityId: "carthage", ownerPolityId: "rome", controlFirmnessBps: 2_000, terrainId: "plain" }
      : { provinceId, controllerPolityId: index % 4 < 2 ? "rome" : "carthage", controlFirmnessBps: 5_000, terrainId: "plain" })),
  };

  it("paints it as its owner's and stripes it as the occupier's", () => {
    const state = derivePoliticalMapState(world, overlay);
    expect(state.ownerByProvince.get(ids[1]!)).toBe("rome");
    expect(state.occupierByProvince?.get(ids[1]!)).toBe("carthage");
    expect(state.occupierByProvince?.size).toBe(1);
    // Its owner's territory still includes it: an occupation does not redraw the border.
    expect(state.territories.find((territory) => territory.polityId === "rome")!.components.flatMap((component) => component.provinceIds)).toContain(ids[1]);
  });
});
