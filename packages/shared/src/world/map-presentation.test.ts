import { describe, expect, it } from "vitest";
import { DynamicMapOverlaySchema, MapVisualConfigSchema } from "./map-presentation";

const border = { colour: "#312b24", width: 1, opacityBps: 8_000 };
const symbol = { symbolId: "marker", minZoom: 1, scale: 1 };

const visualConfig = {
  terrain: {
    farmland: {
      category: "farmland",
      baseColour: "#879867",
      textureOpacityBps: 3_000,
      reliefOpacityBps: 2_000,
    },
  },
  polities: { ROM: { colour: "#8c2f39", patternId: "roman-hatching" } },
  water: { baseColour: "#496b77", textureOpacityBps: 1_000 },
  reliefAssetId: "italy-hillshade",
  zoom: {
    minZoom: 1,
    maxZoom: 8,
    mediumStartsAt: 2.5,
    closeStartsAt: 5,
    politicalOpacityBps: { far: 7_000, medium: 4_000, close: 2_000 },
    minorRoadMinZoom: 5,
    minorSettlementMinZoom: 5,
    minorBorderMinZoom: 2.5,
  },
  borders: {
    minor: border,
    regional: { ...border, width: 1.5 },
    realm: { ...border, width: 2 },
    selected: { ...border, colour: "#f1d87a", width: 3 },
    hovered: { ...border, colour: "#fff1bd", width: 2 },
  },
  settlementSymbols: {
    city: symbol,
    town: symbol,
    village: symbol,
    fortress: symbol,
    port: symbol,
  },
  forceSymbol: { ...symbol, symbolId: "army" },
  labels: [
    { kind: "settlement", minZoom: 3, maxZoom: 8, priority: 50, textTransform: "none" },
    { kind: "realm", minZoom: 1, maxZoom: 5, priority: 100, textTransform: "uppercase" },
  ],
};

describe("map presentation contracts", () => {
  it("accepts a visual configuration with stronger political tint at far zoom", () => {
    expect(MapVisualConfigSchema.safeParse(visualConfig).success).toBe(true);
  });

  it("rejects inverted zoom bands and political opacity", () => {
    expect(MapVisualConfigSchema.safeParse({
      ...visualConfig,
      zoom: {
        ...visualConfig.zoom,
        closeStartsAt: 2,
        politicalOpacityBps: { far: 2_000, medium: 4_000, close: 7_000 },
      },
    }).success).toBe(false);
  });

  it("accepts state overlays independently of immutable geometry", () => {
    const result = DynamicMapOverlaySchema.safeParse({
      revision: 7,
      polities: [{ polityId: "ROM", name: "Roman Republic" }],
      provinces: [{
        provinceId: "latium",
        controllerPolityId: "ROM",
        controlFirmnessBps: 8_500,
        terrainId: "farmland",
        tier: "focus",
      }],
      settlements: [{
        settlementId: "roma",
        provinceId: "latium",
        anchorFeatureId: "anchor-roma",
        name: "Roma",
        kind: "city",
        controllerPolityId: "ROM",
        capitalPolityId: "ROM",
        cultureStyleId: "roman",
        importance: 100,
      }],
      forces: [{
        forceId: "legio-i",
        provinceId: "latium",
        ownerPolityId: "ROM",
        name: "Legio I",
        commanderLabel: "Scipio",
        strengthLabel: "18.2K",
        relation: "friendly",
        movement: {
          start: [12.4964, 41.9028],
          destination: [14.2681, 40.8518],
          path: [[12.4964, 41.9028], [13.4, 41.4], [14.2681, 40.8518]],
          progressBps: 4_000,
          state: "moving",
        },
      }],
      conflicts: { battles: [], sieges: [], wars: [] },
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.forces[0]?.selected).toBe(false);
  });

  it("rejects invalid movement paths", () => {
    expect(DynamicMapOverlaySchema.safeParse({
      revision: 0,
      polities: [],
      provinces: [],
      settlements: [],
      forces: [{
        forceId: "force",
        provinceId: "province",
        ownerPolityId: "polity",
        name: "Force",
        commanderLabel: null,
        strengthLabel: "100",
        relation: "unknown",
        movement: {
          start: [0, 0],
          destination: [1, 1],
          path: [[0, 0], [1, 0]],
          progressBps: 10_001,
          state: "moving",
        },
      }],
      conflicts: { battles: [], sieges: [], wars: [] },
    }).success).toBe(false);
  });

  it("rejects duplicate polity names in one dynamic overlay", () => {
    expect(DynamicMapOverlaySchema.safeParse({
      revision: 0,
      polities: [{ polityId: "ROM", name: "Roman Republic" }, { polityId: "ROM", name: "Renamed Rome" }],
      provinces: [],
      settlements: [],
      forces: [],
      conflicts: { battles: [], sieges: [], wars: [] },
    }).success).toBe(false);
  });

  it("rejects conflicts that reference absent overlay entities", () => {
    expect(DynamicMapOverlaySchema.safeParse({
      revision: 0,
      polities: [{ polityId: "ROM", name: "Rome" }],
      provinces: [],
      settlements: [],
      forces: [],
      conflicts: { battles: [{ battleId: "battle", participantForceIds: ["missing-a", "missing-b"], attackerForceIds: ["missing-a"] }], sieges: [], wars: [] },
    }).success).toBe(false);
  });

  it("accepts persistent battle, siege, and war state", () => {
    expect(DynamicMapOverlaySchema.safeParse({
      revision: 0,
      polities: [{ polityId: "CAR", name: "Carthage" }, { polityId: "ROM", name: "Rome" }],
      provinces: [],
      settlements: [{ settlementId: "lilybaeum", provinceId: "sicily", anchorFeatureId: "anchor", name: "Lilybaeum", kind: "port", controllerPolityId: "CAR", capitalPolityId: null, importance: 80 }],
      forces: [
        { forceId: "rome-army", provinceId: "sicily", ownerPolityId: "ROM", name: "Roman army", commanderLabel: "Scipio", strengthLabel: "3,000", relation: "friendly", movement: null },
        { forceId: "carthage-army", provinceId: "sicily", ownerPolityId: "CAR", name: "Carthaginian army", commanderLabel: "Hanno", strengthLabel: "3,000", relation: "hostile", movement: null },
      ],
      conflicts: {
        battles: [{ battleId: "sicily-battle", participantForceIds: ["rome-army", "carthage-army"], attackerForceIds: ["rome-army"] }],
        sieges: [{ settlementId: "lilybaeum", invadingForceIds: ["rome-army"], defendingForceIds: ["carthage-army"] }],
        wars: [{ polityAId: "CAR", polityBId: "ROM" }],
      },
    }).success).toBe(true);
  });

  it("accepts a multi-force side merged behind one attacker/defender split", () => {
    expect(DynamicMapOverlaySchema.safeParse({
      revision: 0,
      polities: [{ polityId: "CAR", name: "Carthage" }, { polityId: "ROM", name: "Rome" }],
      provinces: [],
      settlements: [],
      forces: [
        { forceId: "legio-i", provinceId: "sicily", ownerPolityId: "ROM", name: "Legio I", commanderLabel: "Scipio", strengthLabel: "3,000", relation: "friendly", movement: null },
        { forceId: "legio-ii", provinceId: "sicily", ownerPolityId: "ROM", name: "Legio II", commanderLabel: "Cato", strengthLabel: "3,000", relation: "friendly", movement: null },
        { forceId: "carthage-army", provinceId: "sicily", ownerPolityId: "CAR", name: "Carthaginian army", commanderLabel: "Hanno", strengthLabel: "3,000", relation: "hostile", movement: null },
      ],
      conflicts: {
        battles: [{ battleId: "sicily-battle", participantForceIds: ["legio-i", "legio-ii", "carthage-army"], attackerForceIds: ["legio-i", "legio-ii"] }],
        sieges: [],
        wars: [],
      },
    }).success).toBe(true);
  });

  it("rejects a battle whose attackers are its every participant", () => {
    expect(DynamicMapOverlaySchema.safeParse({
      revision: 0,
      polities: [],
      provinces: [],
      settlements: [],
      forces: [
        { forceId: "legio-i", provinceId: "sicily", ownerPolityId: "ROM", name: "Legio I", commanderLabel: "Scipio", strengthLabel: "3,000", relation: "friendly", movement: null },
        { forceId: "legio-ii", provinceId: "sicily", ownerPolityId: "ROM", name: "Legio II", commanderLabel: "Cato", strengthLabel: "3,000", relation: "friendly", movement: null },
      ],
      conflicts: {
        battles: [{ battleId: "sicily-battle", participantForceIds: ["legio-i", "legio-ii"], attackerForceIds: ["legio-i", "legio-ii"] }],
        sieges: [],
        wars: [],
      },
    }).success).toBe(false);
  });
});
