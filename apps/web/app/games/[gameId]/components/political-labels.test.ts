import { describe, expect, it } from "vitest";
import type { DynamicMapOverlay, GeoJsonMap } from "@chronica/shared";
import { derivePoliticalLabels } from "./political-labels";

const map: GeoJsonMap = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: "west",
      geometry: { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] },
      properties: { kind: "province", name: "West" },
    },
    {
      type: "Feature",
      id: "east",
      geometry: { type: "Polygon", coordinates: [[[4, 0], [6, 0], [6, 2], [4, 2], [4, 0]]] },
      properties: { kind: "province", name: "East" },
    },
  ],
};

function overlay(provinces: DynamicMapOverlay["provinces"]): DynamicMapOverlay {
  return {
    revision: 1,
    polities: [{ polityId: "rome", name: "Roman Republic" }],
    provinces,
    settlements: [],
    forces: [],
    hostileBorders: [],
  };
}

describe("derivePoliticalLabels", () => {
  it("groups owned provinces and resolves the polity name from the overlay", () => {
    const labels = derivePoliticalLabels(map, overlay([
      { provinceId: "west", controllerPolityId: "rome", controlFirmnessBps: 8500, terrainId: "plain", tier: "focus" },
      { provinceId: "east", controllerPolityId: "rome", controlFirmnessBps: 8500, terrainId: "plain", tier: "far" },
    ]));

    expect(labels).toEqual([
      { polityId: "rome", name: "Roman Republic", coordinate: [1, 1] },
    ]);
  });

  it("falls back to the largest owned province when the combined center is not owned", () => {
    const labels = derivePoliticalLabels(map, overlay([
      { provinceId: "west", controllerPolityId: "rome", controlFirmnessBps: 8500, terrainId: "plain", tier: "focus" },
      { provinceId: "east", controllerPolityId: "rome", controlFirmnessBps: 8500, terrainId: "plain", tier: "far" },
    ]));

    expect(labels[0]?.coordinate).toEqual([1, 1]);
  });

  it("does not emit labels for ownership outside the visible geography", () => {
    const labels = derivePoliticalLabels(map, overlay([
      { provinceId: "missing", controllerPolityId: "rome", controlFirmnessBps: 8500, terrainId: "plain", tier: "far" },
    ]));

    expect(labels).toEqual([]);
  });

  it("uses the polygon center for a single owned province", () => {
    const labels = derivePoliticalLabels(map, overlay([
      { provinceId: "east", controllerPolityId: "rome", controlFirmnessBps: 8500, terrainId: "plain", tier: "far" },
    ]));

    expect(labels[0]?.coordinate).toEqual([5, 1]);
  });
});
