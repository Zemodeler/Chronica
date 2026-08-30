import { describe, expect, it } from "vitest";
import { ProvinceGraphSchema } from "./map";

const graph = (settlementControllerPolityId: string | null) => ({
  provinces: [{
    id: "latium",
    name: "Latium",
    formerNames: [],
    terrainId: "farmland",
    settlements: [{ id: "roma", name: "Roma", kind: "city", controllerPolityId: settlementControllerPolityId, size: 100, fortificationLevel: 4 }],
    controllerPolityId: "ROM",
    controlFirmnessBps: 9_000,
    tier: "focus",
  }],
  edges: [],
  polities: [{ id: "ROM", name: "Roman Republic", capitalSettlementId: "roma" }],
});

describe("settlement ownership", () => {
  it("stores city control independently from province control", () => {
    const result = ProvinceGraphSchema.parse(graph(null));
    expect(result.provinces[0]?.controllerPolityId).toBe("ROM");
    expect(result.provinces[0]?.settlements[0]?.controllerPolityId).toBeNull();
  });

  it("rejects a city controller that is not present in the world graph", () => {
    expect(ProvinceGraphSchema.safeParse(graph("CAR")).success).toBe(false);
  });
});
