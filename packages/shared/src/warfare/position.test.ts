import { describe, expect, it } from "vitest";
import type { Province } from "../world/map";
import { fallbackPositionsFor, positionsForProvince, findPosition, defaultPositionFor, resolveForcePosition } from "./position";

const province: Province = {
  id: "sicily-northeast",
  name: "North-eastern Sicily",
  formerNames: [],
  terrainId: "coastal-plain",
  settlements: [
    { id: "messana-city", name: "Messana", kind: "port", provinceId: "sicily-northeast", controllerPolityId: "rome", size: 55, fortificationLevel: 3 },
  ],
  controllerPolityId: "rome",
  controlFirmnessBps: 7_000,
};

describe("fallbackPositionsFor", () => {
  it("generates one settlement position per settlement, plus camp and interior", () => {
    const positions = fallbackPositionsFor(province);
    expect(positions.map((p) => p.type)).toEqual(["settlement", "camp", "interior"]);
    expect(positions[0]!.id).toContain("messana-city");
  });

  it("scales the settlement's combat modifier from its fortification level", () => {
    const positions = fallbackPositionsFor(province);
    expect(positions[0]!.combatModifierBps).toBe(3 * 200);
  });

  it("is deterministic across repeated calls", () => {
    expect(fallbackPositionsFor(province)).toEqual(fallbackPositionsFor(province));
  });
});

describe("positionsForProvince", () => {
  it("prefers authored positions when present", () => {
    const authored: Province = {
      ...province,
      positions: [{ id: "custom-1", provinceId: province.id, label: "The Harbour", type: "harbour", combatModifierBps: -200, capacity: null }],
    };
    expect(positionsForProvince(authored)).toEqual(authored.positions);
  });

  it("falls back when positions is an empty array", () => {
    const empty: Province = { ...province, positions: [] };
    expect(positionsForProvince(empty)).toEqual(fallbackPositionsFor(province));
  });
});

describe("resolveForcePosition / defaultPositionFor", () => {
  it("defaults an unassigned force to the province's settlement position", () => {
    const position = resolveForcePosition(province, null);
    expect(position.type).toBe("settlement");
  });

  it("resolves a force's own valid position id", () => {
    const positions = fallbackPositionsFor(province);
    const campId = positions.find((p) => p.type === "camp")!.id;
    expect(resolveForcePosition(province, campId).type).toBe("camp");
  });

  it("falls back to the province default when the assigned position no longer exists", () => {
    expect(resolveForcePosition(province, "no-such-position").type).toBe("settlement");
  });

  it("falls back to interior for a province with no settlements", () => {
    const empty: Province = { ...province, settlements: [] };
    expect(defaultPositionFor(empty).type).toBe("interior");
  });

  it("findPosition returns undefined for an unknown id", () => {
    expect(findPosition(province, "nope")).toBeUndefined();
  });
});
