import { describe, expect, it } from "vitest";
import { opening } from "./fiscal-test-kit";
import { placeNamed } from "./place-named";

describe("indexed place names", () => {
  it("keeps longest names, word boundaries, settlement aliases and stable ties", () => {
    const base = opening();
    const province = base.map.provinces[0]!;
    const town = province.settlements[0]!;
    const world = { ...base, map: { ...base.map, provinces: [
      { ...province, id: "b", name: "Nova", settlements: [] },
      { ...province, id: "a", name: "Nova Roma", settlements: [{ ...town, name: "Portus" }] },
      { ...province, id: "c", name: "Nova Roma", settlements: [] },
    ] } };
    expect(placeNamed(world, "March to NOVA ROMA.")).toEqual({ provinceId: "a", name: "Nova Roma" });
    expect(placeNamed(world, "Go to Portus")).toEqual({ provinceId: "a", name: "Portus" });
    expect(placeNamed(world, "Supernova")).toBeNull();
    expect(placeNamed(world, "Nova")).toEqual({ provinceId: "b", name: "Nova" });
  });

  it("rebuilds the index when a province list changes", () => {
    const base = opening();
    const province = { ...base.map.provinces[0]!, name: "Old Name", settlements: [] };
    const world = { ...base, map: { ...base.map, provinces: [province] } };
    expect(placeNamed(world, "Old Name")?.provinceId).toBe(province.id);
    const changed = { ...world, map: { ...world.map, provinces: [{ ...province, name: "New Name" }] } };
    expect(placeNamed(changed, "Old Name")).toBeNull();
    expect(placeNamed(changed, "New Name")?.provinceId).toBe(province.id);
    expect(placeNamed(world, "Old Name")?.provinceId).toBe(province.id);
  });
});
