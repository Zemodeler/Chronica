import { describe, expect, it } from "vitest";
import type { MapForceOverlay, MapMovementOverlay } from "@chronica/shared";
import { interpolateMovement, resolveForceMapPosition, resolveMapForcePlacements } from "./map-dynamic-geometry";
import { prepareStaticWorldGeometry } from "./world-geometry";

const movement: MapMovementOverlay = {
  start: [0, 0],
  destination: [6, 8],
  path: [[0, 0], [3, 0], [3, 4], [6, 8]],
  progressBps: 5_000,
  state: "moving",
};

describe("dynamic map geometry", () => {
  it("interpolates by cumulative segment length and clips the travelled route", () => {
    const result = interpolateMovement(movement);
    expect(result.coordinate).toEqual([3, 3]);
    expect(result.travelledPath).toEqual([[0, 0], [3, 0], [3, 3]]);
  });

  it("uses the supplied retreat direction and handles degenerate paths", () => {
    expect(interpolateMovement({ ...movement, state: "retreating", progressBps: 10_000 }).coordinate).toEqual([6, 8]);
    expect(interpolateMovement({ ...movement, path: [[0, 0], [0, 0]], destination: [0, 0] }).coordinate).toEqual([0, 0]);
  });

  it("prefers movement, then explicit coordinates, then the province centroid", () => {
    const world = prepareStaticWorldGeometry({ type: "FeatureCollection", features: [
      { type: "Feature", id: "province", geometry: { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] }, properties: { kind: "province", name: "Province" } },
    ] });
    const force: MapForceOverlay = { forceId: "force", provinceId: "province", coordinate: [9, 9], ownerPolityId: "rome", name: "Force", commanderLabel: null, strengthLabel: "100", relation: "friendly", selected: false, movement };
    expect(resolveForceMapPosition(force, world)?.travelledPath?.at(-1)).toEqual([3, 3]);
    expect(resolveForceMapPosition({ ...force, movement: null }, world)?.x).toBe(9);
    expect(resolveForceMapPosition({ ...force, coordinate: undefined, movement: null }, world)?.x).toBe(1);
  });

  it("keeps an army visible when a legacy location has no polygon", () => {
    const world = prepareStaticWorldGeometry({ type: "FeatureCollection", features: [
      { type: "Feature", id: "rome", geometry: { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] }, properties: { kind: "province", name: "Rome" } },
      { type: "Feature", id: "carthage", geometry: { type: "Polygon", coordinates: [[[4, 0], [6, 0], [6, 2], [4, 2], [4, 0]]] }, properties: { kind: "province", name: "Carthage" } },
    ] });
    const force: MapForceOverlay = { forceId: "lost-legion", provinceId: "retired-location", ownerPolityId: "rome", name: "Lost Legion", commanderLabel: null, strengthLabel: "100", relation: "friendly", selected: false, movement: null };
    const overlay = {
      revision: 1,
      polities: [{ polityId: "rome", name: "Rome" }, { polityId: "carthage", name: "Carthage" }],
      politicalRelations: [],
      provinces: [
        { provinceId: "rome", controllerPolityId: "rome", controlFirmnessBps: 10_000, terrainId: "plain", tier: "focus" as const },
        { provinceId: "carthage", controllerPolityId: "carthage", controlFirmnessBps: 10_000, terrainId: "plain", tier: "focus" as const },
      ],
      settlements: [],
      forces: [force],
      conflicts: { battles: [], sieges: [], wars: [] },
    };

    expect(resolveForceMapPosition(force, world, overlay)?.x).toBe(1);
    expect(resolveForceMapPosition({ ...force, ownerPolityId: "unknown" }, world, overlay)?.x).toBe(1);
  });
});

describe("resolveMapForcePlacements (docs/19 Phase 3)", () => {
  const world = prepareStaticWorldGeometry({ type: "FeatureCollection", features: [
    { type: "Feature", id: "sicily", geometry: { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] }, properties: { kind: "province", name: "Sicily" } },
  ] });
  const forceA: MapForceOverlay = { forceId: "force-a", provinceId: "sicily", ownerPolityId: "rome", name: "A", commanderLabel: null, strengthLabel: "100", relation: "friendly", selected: false, movement: null };
  const forceB: MapForceOverlay = { forceId: "force-b", provinceId: "sicily", ownerPolityId: "carthage", name: "B", commanderLabel: null, strengthLabel: "100", relation: "hostile", selected: false, movement: null };

  it("offsets two forces that merely share a province, without any conflict", () => {
    const placements = resolveMapForcePlacements([forceA, forceB], world, null);
    expect(placements).toHaveLength(2);
    expect(placements.every((p) => p.group === null)).toBe(true);
    const [a, b] = placements;
    expect(a!.x === b!.x && a!.y === b!.y).toBe(false);
  });

  it("does not offset a lone force", () => {
    const placements = resolveMapForcePlacements([forceA], world, null);
    expect(placements[0]!.x).toBe(1);
    expect(placements[0]!.y).toBe(-1);
  });

  it("groups both sides of a battle at the same placement, with one primary", () => {
    const overlay = {
      revision: 1, polities: [], politicalRelations: [],
      provinces: [{ provinceId: "sicily", controllerPolityId: "rome", controlFirmnessBps: 10_000, terrainId: "plain", tier: "focus" as const }],
      settlements: [], forces: [forceA, forceB],
      conflicts: { battles: [{ battleId: "b1", participantForceIds: ["force-a", "force-b"], attackerForceIds: ["force-a"] }], sieges: [], wars: [] },
    };
    const placements = resolveMapForcePlacements([forceA, forceB], world, overlay);
    expect(placements.every((p) => p.group?.key === "battle:b1" && p.group.size === 2)).toBe(true);
    expect(placements.filter((p) => p.group?.isPrimary).length).toBe(1);
    const [a, b] = placements;
    expect(a!.x).toBe(b!.x);
    expect(a!.y).toBe(b!.y);
  });

  it("groups joint siege attackers, but leaves a lone defender ungrouped", () => {
    const forceC: MapForceOverlay = { ...forceA, forceId: "force-c" };
    const overlay = {
      revision: 1, polities: [], politicalRelations: [],
      provinces: [{ provinceId: "sicily", controllerPolityId: "rome", controlFirmnessBps: 10_000, terrainId: "plain", tier: "focus" as const }],
      settlements: [], forces: [forceA, forceB, forceC],
      conflicts: { battles: [], sieges: [{ settlementId: "s1", invadingForceIds: ["force-a", "force-c"], defendingForceIds: ["force-b"] }], wars: [] },
    };
    const placements = resolveMapForcePlacements([forceA, forceB, forceC], world, overlay);
    const attackerPlacements = placements.filter((p) => p.forceId !== "force-b");
    expect(attackerPlacements.every((p) => p.group?.key === "siege-attackers:s1" && p.group.size === 2)).toBe(true);
    const defenderPlacement = placements.find((p) => p.forceId === "force-b")!;
    expect(defenderPlacement.group).toBeNull();
  });
});
