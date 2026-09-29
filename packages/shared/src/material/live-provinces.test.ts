import { describe, expect, it } from "vitest";
import type { WorldState } from "../world/world-state";
import { LIVE_REACH_KM, isLiveProvince, liveProvinceIds } from "./live-provinces";
import { isQuietGround } from "./province-material";

const province = (id: string, extra: object = {}) => ({ id, settlements: [], lostBy: null, yearning: null, ...extra });
const edge = (from: string, to: string, distance: number) => ({ from, to, crossing: "land", distance });

function world(over: Partial<Record<string, unknown>> = {}): WorldState {
  return {
    map: {
      // a - b - c - d - e in a line; b to c is far, the rest are near.
      provinces: [province("a"), province("b"), province("c"), province("d"), province("e"), province("far-away")],
      edges: [edge("a", "b", 30), edge("b", "c", LIVE_REACH_KM + 1), edge("c", "d", 40), edge("d", "e", 40)],
      occupationRecords: [],
    },
    material: { forces: [], ventures: [], contracts: [], holdings: [], provinceMaterial: [] },
    sieges: [],
    conflicts: { battles: [], sieges: [], wars: [] },
    characters: [],
    storylines: [],
    projects: [],
    structures: [],
    contingencies: [],
    ...over,
  } as unknown as WorldState;
}

describe("liveProvinceIds", () => {
  it("is empty when nothing is going on anywhere", () => {
    expect(liveProvinceIds(world()).size).toBe(0);
    expect(isQuietGround(world(), "a")).toBe(true);
  });

  it("makes a province live for a town, an army, a person or a storyline, and its near neighbours with it", () => {
    const withArmy = world({ material: { forces: [{ id: "f", locationId: "a" }], ventures: [], contracts: [], holdings: [], provinceMaterial: [] } });
    // a holds the army; b is 30 km off, c is farther than the reach from b and is not chained to.
    expect([...liveProvinceIds(withArmy)].sort()).toEqual(["a", "b"]);

    const withPerson = world({ characters: [{ alive: true, locationProvinceId: "d" }, { alive: false, locationProvinceId: "far-away" }] });
    expect([...liveProvinceIds(withPerson)].sort()).toEqual(["c", "d", "e"]);

    const withStory = world({ storylines: [{ provinceId: "e", closedAtStep: null }, { provinceId: "far-away", closedAtStep: 3 }] });
    expect([...liveProvinceIds(withStory)].sort()).toEqual(["d", "e"]);
  });

  it("follows a siege, an occupation and a battle to the province, and keeps a damaged province live", () => {
    const provinces = [province("a", { settlements: [{ id: "town" }] }), province("b"), province("c"), province("d"), province("e"), province("far-away")];
    const busy = world({
      map: { provinces, edges: [], occupationRecords: [{ status: "active", locationKind: "settlement", locationId: "town" }, { status: "ended", locationKind: "province", locationId: "e" }] },
      sieges: [{ status: "active", provinceId: "b" }, { status: "lifted", provinceId: "far-away" }],
      material: { forces: [{ id: "f", locationId: "c" }], ventures: [], contracts: [], holdings: [], provinceMaterial: [{ provinceId: "d", warDamageBps: 500, displacedPopulation: 0 }, { provinceId: "e", warDamageBps: 0, displacedPopulation: 900 }] },
      conflicts: { battles: [{ participantForceIds: ["f", "gone"] }], sieges: [], wars: [] },
    });
    expect([...liveProvinceIds(busy)].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("is computed once per world object", () => {
    const w = world({ characters: [{ alive: true, locationProvinceId: "a" }] });
    expect(liveProvinceIds(w)).toBe(liveProvinceIds(w));
    expect(isLiveProvince(w, "a")).toBe(true);
    expect(isLiveProvince(w, "far-away")).toBe(false);
  });
});
