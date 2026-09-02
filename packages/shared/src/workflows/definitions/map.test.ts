import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { executeWorkflow } from "../executor";

const world = () => structuredClone(firstPunicWarScenario.initialWorld);

describe("found_settlement", () => {
  it("adds a settlement to an existing province", () => {
    const w = world();
    const result = executeWorkflow(
      { actionId: "found_settlement", actorId: "test-actor", parameters: { provinceId: "ita-72843720b81376294924159-sicily-central", settlementId: "agrigentum-city", name: "Agrigentum", kind: "city", size: 40, controllerPolityId: "carthage" } },
      w,
      0,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const province = result.world.map.provinces.find((p) => p.id === "ita-72843720b81376294924159-sicily-central");
    expect(province?.settlements.map((s) => s.id)).toContain("agrigentum-city");
    expect(province?.settlements.find((s) => s.id === "agrigentum-city")?.provinceId).toBe(province?.id);
  });

  it("is not applicable to an unknown province", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "found_settlement", actorId: "test-actor", parameters: { provinceId: "nowhere", settlementId: "new-city", name: "New City", kind: "city", size: 10, controllerPolityId: null } },
      w,
      0,
    );
    expect(outcome.ok).toBe(false);
  });
});

describe("raze_settlement", () => {
  it("removes a settlement from its province", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "raze_settlement", actorId: "test-actor", parameters: { provinceId: "ita-72843720b81376294924159-sicily-west", settlementId: "drepanum-city", reason: "Destroyed in the war." } },
      w,
      0,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const province = outcome.world.map.provinces.find((p) => p.id === "ita-72843720b81376294924159-sicily-west");
    expect(province?.settlements).toEqual([]);
  });

  it("is not applicable to an unknown settlement", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "raze_settlement", actorId: "test-actor", parameters: { provinceId: "ita-72843720b81376294924159-sicily-west", settlementId: "nowhere", reason: "n/a" } },
      w,
      0,
    );
    expect(outcome.ok).toBe(false);
  });
});

describe("cede_settlement", () => {
  it("changes a settlement's local controller independently of the province", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "cede_settlement", actorId: "test-actor", parameters: { provinceId: "ita-72843720b81376294924159-sicily-southeast", settlementId: "syracuse-city", newControllerPolityId: "carthage" } },
      w,
      0,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const province = outcome.world.map.provinces.find((p) => p.id === "ita-72843720b81376294924159-sicily-southeast");
    expect(province?.settlements.find((s) => s.id === "syracuse-city")?.controllerPolityId).toBe("carthage");
    expect(province?.controllerPolityId).toBe("syracuse");
  });

  it("is not applicable when the new controller is not a declared polity", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "cede_settlement", actorId: "test-actor", parameters: { provinceId: "ita-72843720b81376294924159-sicily-southeast", settlementId: "syracuse-city", newControllerPolityId: "atlantis" } },
      w,
      0,
    );
    expect(outcome.ok).toBe(false);
  });
});

describe("split_province", () => {
  it("splits named settlements off into a new province", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "split_province", actorId: "test-actor", parameters: { sourceProvinceId: "ita-72843720b81376294924159-sicily-northeast", newProvinceId: "messana-standalone", newProvinceName: "Messana", terrainId: "coastal-plain", movedSettlementIds: ["messana-city"] } },
      w,
      0,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const source = outcome.world.map.provinces.find((p) => p.id === "ita-72843720b81376294924159-sicily-northeast");
    const created = outcome.world.map.provinces.find((p) => p.id === "messana-standalone");
    expect(source?.settlements).toEqual([]);
    expect(created?.settlements.map((s) => s.id)).toEqual(["messana-city"]);
    expect(created?.settlements[0]?.provinceId).toBe("messana-standalone");
  });

  it("is not applicable when the new province id is already taken", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "split_province", actorId: "test-actor", parameters: { sourceProvinceId: "ita-72843720b81376294924159-sicily-northeast", newProvinceId: "ita-72843720b81376294924159-sicily-west", newProvinceName: "Messana", terrainId: "coastal-plain", movedSettlementIds: ["messana-city"] } },
      w,
      0,
    );
    expect(outcome.ok).toBe(false);
  });
});

describe("merge_provinces", () => {
  it("merges an empty province into a neighbor and drops shared edges", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "merge_provinces", actorId: "test-actor", parameters: { absorbedProvinceId: "ita-72843720b81376294924159-sicily-central", targetProvinceId: "ita-72843720b81376294924159-sicily-southeast" } },
      w,
      0,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.map.provinces.some((p) => p.id === "ita-72843720b81376294924159-sicily-central")).toBe(false);
    expect(outcome.world.map.edges.some((e) => e.from === "ita-72843720b81376294924159-sicily-central" || e.to === "ita-72843720b81376294924159-sicily-central")).toBe(false);
  });

  it("is not applicable when the same province is given for both sides", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "merge_provinces", actorId: "test-actor", parameters: { absorbedProvinceId: "ita-72843720b81376294924159-sicily-central", targetProvinceId: "ita-72843720b81376294924159-sicily-central" } },
      w,
      0,
    );
    expect(outcome.ok).toBe(false);
  });
});

describe("change_province_tier", () => {
  it("changes a province's detail tier", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "change_province_tier", actorId: "test-actor", parameters: { provinceId: "ita-72843720b863019116732", newTier: "near" } },
      w,
      0,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.map.provinces.find((p) => p.id === "ita-72843720b863019116732")?.tier).toBe("near");
  });

  it("is not applicable when the tier is unchanged", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "change_province_tier", actorId: "test-actor", parameters: { provinceId: "ita-72843720b863019116732", newTier: "far" } },
      w,
      0,
    );
    expect(outcome.ok).toBe(false);
  });
});

describe("fortify_province_capital", () => {
  it("sets a settlement's fortification level directly", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "fortify_province_capital", actorId: "test-actor", parameters: { provinceId: "ita-72843720b863019116732", settlementId: "settlement-rome", newFortificationLevel: 9 } },
      w,
      0,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const settlement = outcome.world.map.provinces.find((p) => p.id === "ita-72843720b863019116732")?.settlements[0];
    expect(settlement?.fortificationLevel).toBe(9);
  });

  it("is not applicable to an unknown settlement", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "fortify_province_capital", actorId: "test-actor", parameters: { provinceId: "ita-72843720b863019116732", settlementId: "nowhere", newFortificationLevel: 5 } },
      w,
      0,
    );
    expect(outcome.ok).toBe(false);
  });
});
