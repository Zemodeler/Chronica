import { describe, expect, it } from "vitest";
import { reliefTilesFor, reliefZoomFor, type ReliefManifest } from "./relief-tiles";

const manifest: ReliefManifest = {
  tileSize: 512, minZoom: 0, maxZoom: 3,
  levels: [
    { zoom: 0, tileDegrees: 45, tileBounds: [3, 0, 5, 1] },
    { zoom: 1, tileDegrees: 22.5, tileBounds: [7, 0, 11, 3] },
    { zoom: 2, tileDegrees: 11.25, tileBounds: [14, 1, 23, 6] },
    { zoom: 3, tileDegrees: 5.625, tileBounds: [27, 4, 43, 13] },
  ],
};

describe("which relief level is drawn", () => {
  it("takes the coarsest level with about a source pixel to a device pixel, and the finest when zoomed further in", () => {
    // 512 px over 45 degrees is 11.4 px a degree; z3 is 91 px a degree.
    expect(reliefZoomFor(manifest, 9)).toBe(0);
    expect(reliefZoomFor(manifest, 19)).toBe(1);
    expect(reliefZoomFor(manifest, 38)).toBe(2);
    expect(reliefZoomFor(manifest, 80)).toBe(3);
    expect(reliefZoomFor(manifest, 4000)).toBe(3);
  });
});

describe("which relief tiles are in view", () => {
  const level = manifest.levels[3]!;

  it("finds the tiles a window meets on the world-aligned grid, nearest its middle first", () => {
    // Rome and its country: lon 8..17, lat 38..46.
    const tiles = reliefTilesFor(level, { west: 8, east: 17, south: 38, north: 46 });
    const at = (lon: number, lat: number) => tiles.find((tile) => tile.x === Math.floor((lon + 180) / 5.625) && tile.y === Math.floor((90 - lat) / 5.625));
    expect(at(12.5, 42)).toBeDefined();
    expect(tiles.every((tile) => tile.z === 3)).toBe(true);
    expect(tiles[0]).toEqual(at(12.5, 42));
    expect(new Set(tiles.map((tile) => `${tile.x}/${tile.y}`)).size).toBe(tiles.length);
  });

  it("stays inside the level's tiles", () => {
    const tiles = reliefTilesFor(level, { west: -180, east: 180, south: -90, north: 90 });
    expect(tiles).toHaveLength((43 - 27 + 1) * (13 - 4 + 1));
    expect(reliefTilesFor(level, { west: 100, east: 110, south: -60, north: -50 })).toEqual([]);
  });
});
