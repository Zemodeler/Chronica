import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { WorldState } from "../world/world-state";
import { buildAuthorityIndex } from "../authority/authority-grant";
import { deriveRegions, deriveTheatre, resolveRepresentative, scoreStarContext, selectStarContext, widerRef } from "./selector";
import { buildStarContextPayload } from "./context";

function world(): WorldState {
  return structuredClone(firstPunicWarScenario.initialWorld);
}

const index = () => buildAuthorityIndex({ officeSeats: [], forces: world().material.forces }, [], [], 1);

describe("selectStarContext (docs/32, Phase 7)", () => {
  it("selects a unit-level context for a force, never manufacturing a finer level than the event supports", () => {
    const context = selectStarContext(world(), { kind: "force", id: "legio-i" }, index(), 1);
    expect(context.level).toBe("unit");
    expect(context.label).toBe("Legio I");
  });

  it("resolves the force's commander as its representative", () => {
    const context = selectStarContext(world(), { kind: "force", id: "legio-i" }, index(), 1);
    expect(context.representativeCharacterId).toBe("marcus-atilius");
  });

  it("selects a polity-level context with no representative when no office is held", () => {
    const context = selectStarContext(world(), { kind: "polity", id: "carthage" }, index(), 1);
    expect(context.level).toBe("polity");
    expect(context.representativeCharacterId).toBeNull(); // no officeSeats supplied in this fixture's index
  });
});

describe("widerRef: the walk-up path", () => {
  it("widens a force to its province", () => {
    expect(widerRef(world(), { kind: "force", id: "carthaginian-army" })).toEqual({ kind: "province", id: "ita-72843720b81376294924159-sicily-west" });
  });

  it("widens a province to its controlling polity", () => {
    expect(widerRef(world(), { kind: "province", id: "ita-72843720b81376294924159-sicily-west" })).toEqual({ kind: "polity", id: "carthage" });
  });

  it("widens a polity to world, the top of the hierarchy", () => {
    expect(widerRef(world(), { kind: "polity", id: "carthage" })).toEqual({ kind: "world", id: "world" });
  });
});

describe("resolveRepresentative", () => {
  it("returns null when no AuthorityGrant covers the scope", () => {
    expect(resolveRepresentative(index(), { kind: "settlement", id: "settlement-rome" })).toBeNull();
  });
});

describe("deriveTheatre", () => {
  it("collects every province controlled by either belligerent, derived on demand", () => {
    const theatre = deriveTheatre(world(), "carthage", "rome");
    expect(theatre.provinceIds).toContain("ita-72843720b81376294924159-sicily-west"); // carthage
    expect(theatre.provinceIds).toContain("ita-72843720b81376294924159-sicily-northeast"); // rome
    expect(theatre.provinceIds).not.toContain("ita-72843720b81376294924159-sicily-southeast"); // syracuse
  });
});

describe("deriveRegions", () => {
  it("groups contiguous same-controller provinces, distinct polities in separate regions", () => {
    const regions = deriveRegions(world());
    const carthageRegion = regions.find((r) => r.provinceIds.includes("ita-72843720b81376294924159-sicily-west"));
    const romeRegion = regions.find((r) => r.provinceIds.includes("ita-72843720b81376294924159-sicily-northeast"));
    expect(carthageRegion).toBeDefined();
    expect(romeRegion).toBeDefined();
    expect(carthageRegion?.id).not.toBe(romeRegion?.id);
  });
});

describe("scoreStarContext", () => {
  it("scores a polity actively at war higher than one at peace", () => {
    const atWar = selectStarContext(world(), { kind: "polity", id: "carthage" }, index(), 1);
    const atPeace = selectStarContext(world(), { kind: "polity", id: "syracuse" }, index(), 1);
    expect(scoreStarContext(world(), atWar, 1)).toBeGreaterThan(scoreStarContext(world(), atPeace, 1));
  });

  it("scores a context with no living representative higher than one that already has one", () => {
    const withRep = selectStarContext(world(), { kind: "force", id: "legio-i" }, index(), 1);
    const withoutRep = { ...withRep, id: "star:polity:syracuse", level: "polity" as const, scopeRef: { kind: "polity" as const, id: "syracuse" }, representativeCharacterId: null };
    expect(scoreStarContext(world(), withoutRep, 1)).toBeGreaterThan(scoreStarContext(world(), withRep, 1));
  });
});

describe("buildStarContextPayload: institutional-only, never private character state", () => {
  it("includes forces and open procedures within the polity's scope", () => {
    const context = selectStarContext(world(), { kind: "polity", id: "rome" }, index(), 1);
    const payload = buildStarContextPayload(world(), context);
    expect(payload.forces.some((f) => f.id === "legio-i")).toBe(true);
    expect(payload.openProcedures.length).toBeGreaterThan(0);
  });

  it("includes only public, polity-owned accounts, never a private character purse", () => {
    const context = selectStarContext(world(), { kind: "polity", id: "rome" }, index(), 1);
    const payload = buildStarContextPayload(world(), context);
    expect(payload.publicAccounts.every((a) => a.owner.kind === "polity")).toBe(true);
  });

  it("scopes a settlement-level context to only its own province's forces and sieges", () => {
    const context = selectStarContext(world(), { kind: "settlement", id: "messana-city" }, index(), 1);
    const payload = buildStarContextPayload(world(), context);
    expect(payload.forces.every((f) => f.locationId === "ita-72843720b81376294924159-sicily-northeast")).toBe(true);
  });
});
