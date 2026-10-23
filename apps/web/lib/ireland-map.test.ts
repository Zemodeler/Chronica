import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { builtInScenarioMap, PUNIC_WARS_MAP_ASSET_ID } from "./built-in-scenario-maps";
import { prepareStaticWorldGeometry, provinceAtPoint } from "../app/games/[gameId]/components/world-geometry";
import extension from "../../../scripts/map-gen/ireland-extension.json";

const map = builtInScenarioMap(PUNIC_WARS_MAP_ASSET_ID)!;
const world = prepareStaticWorldGeometry(map);
const addedIds = new Set(extension.provinceIds);

describe("Ireland's drawn provinces", () => {
  it("covers western, southern, eastern and central Ireland as well as the existing north", () => {
    for (const [lon, lat] of [[-9.5, 52.2], [-8.5, 51.9], [-6.7, 52.4], [-6.3, 53.3], [-8.3, 53.8], [-7.5, 53.5], [-8.2, 54.9], [-6.7, 54.35]]) {
      expect(provinceAtPoint(world, [lon!, lat!])?.id, `${lon},${lat}`).toMatch(/^hib-/);
    }
  });

  it("shares exact boundary vertices between the added districts and existing Ulster", () => {
    const joined = world.sharedBoundaries.filter((edge) => edge.provinceB !== null && addedIds.has(edge.provinceA) !== addedIds.has(edge.provinceB));
    expect(joined.length).toBeGreaterThan(5);
    expect(joined.every((edge) => edge.provinceA.startsWith("hib-") && edge.provinceB!.startsWith("hib-"))).toBe(true);
    const internal = world.sharedBoundaries.filter((edge) => edge.provinceB !== null && addedIds.has(edge.provinceA) && addedIds.has(edge.provinceB));
    expect(internal.length).toBeGreaterThan(100);
  });

  it("does not let troops walk from Ireland to Britain", () => {
    const crossings = punicWarsScenario.initialWorld.map.edges.filter((edge) => edge.from.startsWith("hib-") !== edge.to.startsWith("hib-"));
    expect(crossings.length).toBeGreaterThan(0);
    expect(crossings.every((edge) => edge.crossing === "strait" || edge.crossing === "sea_lane")).toBe(true);
  });
});
