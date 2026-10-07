import { describe, expect, it } from "vitest";
import type { Province, ProvinceEdge } from "../world/map";
import type { WorldState } from "../world/world-state";
import { developmentPotential } from "./province-material";
import { provinceSites } from "./province-site";

/** A province, with the little that matters here. */
function province(id: string, terrainId: string, settlements: Array<{ kind: "city" | "town" | "village" | "fortress" | "port"; size: number }> = []): Province {
  return {
    id, name: id, formerNames: [], terrainId, controllerPolityId: "rome", controlFirmnessBps: 8_000,
    settlements: settlements.map((settlement, index) => ({ id: `${id}-s${index}`, name: `${id}-s${index}`, kind: settlement.kind, provinceId: id, controllerPolityId: "rome", size: settlement.size, fortificationLevel: 0 })),
  } as Province;
}
const edge = (from: string, to: string, crossing: ProvinceEdge["crossing"] = "land", distance = 30): ProvinceEdge => ({ from, to, crossing, distance });

/** A city on a plain with a ring of provinces round it, and an upland far down a pass road, walled in. */
function map(): Pick<WorldState, "map"> {
  const provinces = [
    province("city", "coastal-plain", [{ kind: "city", size: 80 }]),
    province("plain", "coastal-plain"),
    province("hill", "hills"),
    province("far-plain", "coastal-plain"),
    province("far-hill", "hills-uplands"),
    province("walled", "hills-uplands"),
    province("steppe", "desert-steppe"),
  ];
  const edges = [edge("city", "plain"), edge("city", "hill"), edge("plain", "far-plain", "land", 120), edge("far-plain", "far-hill", "land", 120), edge("far-hill", "walled", "pass"), edge("far-plain", "steppe", "land", 200)];
  return { map: { provinces, edges, polities: [], politicalRelations: [], controlRecords: [], claimRecords: [], occupationRecords: [], administrationRecords: [] } } as unknown as Pick<WorldState, "map">;
}

describe("a province's site", () => {
  const world = map();
  const sites = provinceSites(world);
  const potential = (id: string) => developmentPotential(world.map.provinces.find((candidate) => candidate.id === id)!, false, sites.get(id));

  it("lifts what lies near a big town and lets it fade with the distance", () => {
    expect(sites.get("city")!.agglomeration).toBeGreaterThan(sites.get("plain")!.agglomeration);
    expect(sites.get("plain")!.agglomeration).toBeGreaterThan(sites.get("far-plain")!.agglomeration);
    expect(sites.get("far-plain")!.agglomeration).toBeLessThan(0.1);
    expect(potential("plain")).toBeGreaterThan(potential("far-plain") + 100);
  });

  it("makes the plain richer than the hills, the hills than the uplands, and the uplands than the steppe, at the same distance from anything", () => {
    expect(potential("far-plain")).toBeGreaterThan(potential("far-hill"));
    expect(potential("far-hill")).toBeGreaterThan(potential("steppe"));
  });

  it("takes a ceiling from an upland that mountains wall in", () => {
    expect(sites.get("walled")!.enclosed).toBe(true);
    expect(sites.get("far-hill")!.enclosed).toBe(false);
    expect(potential("walled")).toBeLessThan(potential("far-hill") + 1);
  });

  it("is kept for the map and the same on every call", () => {
    expect(provinceSites(world)).toBe(sites);
    const again = provinceSites(map());
    for (const [id, site] of sites) expect(again.get(id)).toEqual(site);
  });

  it("keeps every factor in its range", () => {
    for (const site of sites.values()) {
      expect(site.agglomeration).toBeGreaterThanOrEqual(0);
      expect(site.agglomeration).toBeLessThanOrEqual(1);
      expect(site.court).toBeGreaterThanOrEqual(0);
      expect(site.luck).toBeGreaterThanOrEqual(0.95);
      expect(site.luck).toBeLessThanOrEqual(1.05);
      expect(site.soilGrowth).toBeGreaterThan(0);
      expect(site.specialGrowth).toBeGreaterThanOrEqual(1);
      expect(site.specialGrowth).toBeLessThanOrEqual(1.35);
    }
  });

  it("never lets a ceiling leave the scale", () => {
    for (const province of world.map.provinces) expect(potential(province.id)).toBeLessThanOrEqual(10_000);
  });
});
