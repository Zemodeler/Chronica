import { describe, expect, it } from "vitest";
import { applyMapOverlayDelta, diffMapOverlay, DynamicMapOverlaySchema, MapOverlayDeltaSchema, type DynamicMapOverlay } from "./map-presentation";

function overlay(revision: number, owners: Record<string, string | null>, siegedTown?: string): DynamicMapOverlay {
  const provinceIds = Object.keys(owners);
  return DynamicMapOverlaySchema.parse({
    revision,
    polities: [{ polityId: "rome", name: "Rome" }, { polityId: "carthage", name: "Carthage" }],
    provinces: provinceIds.map((provinceId) => ({ provinceId, controllerPolityId: owners[provinceId], controlFirmnessBps: 5000, terrainId: "plain" })),
    settlements: provinceIds.map((provinceId) => ({
      settlementId: `${provinceId}-town`, provinceId, anchorFeatureId: `${provinceId}-town`, name: `Town of ${provinceId}`, kind: "town",
      controllerPolityId: owners[provinceId], capitalPolityId: null, importance: 10, underSiege: `${provinceId}-town` === siegedTown, damaged: false,
    })),
    forces: [],
  });
}

describe("a map overlay delta", () => {
  const before = overlay(10, { a: "rome", b: "rome", c: "carthage", d: null });

  it("is empty for an overlay that has not changed", () => {
    const delta = diffMapOverlay(before, structuredClone(before));
    expect(delta.provinces).toEqual({ changed: [], removed: [] });
    expect(delta.settlements).toEqual({ changed: [], removed: [] });
  });

  it("carries only the rows that differ, and rebuilds the newer overlay exactly", () => {
    const after = overlay(11, { a: "rome", b: "carthage", c: "carthage", d: null }, "c-town");
    const delta = diffMapOverlay(before, after);
    expect(delta.provinces.changed.map((row) => row.provinceId)).toEqual(["b"]);
    expect(delta.settlements.changed.map((row) => row.settlementId)).toEqual(["b-town", "c-town"]);
    expect(MapOverlayDeltaSchema.parse(JSON.parse(JSON.stringify(delta)))).toEqual(delta);
    expect(applyMapOverlayDelta(before, delta)).toEqual(after);
  });

  it("removes rows that are gone and adds rows that are new", () => {
    const after = overlay(12, { a: "rome", c: "carthage", d: null, e: "rome" });
    const delta = diffMapOverlay(before, after);
    expect(delta.provinces.removed).toEqual(["b"]);
    expect(delta.provinces.changed.map((row) => row.provinceId)).toEqual(["e"]);
    expect(applyMapOverlayDelta(before, delta)).toEqual(after);
  });

  it("chains: applying each delta in turn equals the last full state", () => {
    const steps = [
      overlay(11, { a: "carthage", b: "rome", c: "carthage", d: null }),
      overlay(12, { a: "carthage", b: "rome", c: "rome", d: "rome" }, "d-town"),
      overlay(13, { a: "carthage", b: "rome", c: "rome", d: "rome", e: null }),
    ];
    let held = before;
    let previous = before;
    for (const next of steps) {
      held = applyMapOverlayDelta(held, diffMapOverlay(previous, next));
      previous = next;
    }
    expect(held).toEqual(steps[2]);
  });

  it("stays small next to the overlay when a few of four thousand provinces change hands", () => {
    const owners = Object.fromEntries(Array.from({ length: 4400 }, (_, index) => [`p${index}`, index % 3 === 0 ? "rome" : "carthage"]));
    const large = overlay(1, owners);
    const moved = overlay(2, { ...owners, p0: "carthage", p1: "rome" });
    const delta = diffMapOverlay(large, moved);
    expect(delta.provinces.changed).toHaveLength(2);
    expect(JSON.stringify(delta).length).toBeLessThan(JSON.stringify(large).length / 50);
    expect(applyMapOverlayDelta(large, delta)).toEqual(moved);
  });
});
