import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import type { GeoJsonMap } from "@chronica/shared";
import { PUNIC_IDS } from "../../../packages/db/src/punic-ids";
import { projectWorldView } from "./world-view";
import { derivePoliticalMapState, deriveWarBorderPaths, politicalColourWithAlpha } from "../app/games/[gameId]/components/political-geometry";
import { derivePoliticalLabels } from "../app/games/[gameId]/components/political-labels";
import { prepareStaticWorldGeometry } from "../app/games/[gameId]/components/world-geometry";

const { initialWorld, definition } = punicWarsScenario;
const view = projectWorldView(initialWorld, {
  gameId: "campanian-opening", gameTitle: "Punic Wars", clock: definition.clock,
  offices: definition.government.offices, facts: [], warfare: definition.warfare,
}, "decius-vibellius");
const asset = JSON.parse(readFileSync(join(process.cwd(), "public/maps/punic-wars-provinces.geojson"), "utf8")) as GeoJsonMap;
const neighbours = initialWorld.map.edges.filter((edge) => edge.crossing === "land" && (edge.from === PUNIC_IDS.rhegium || edge.to === PUNIC_IDS.rhegium))
  .map((edge) => edge.from === PUNIC_IDS.rhegium ? edge.to : edge.from);
const localIds = new Set([PUNIC_IDS.rhegium, PUNIC_IDS.messana, ...neighbours]);
const geometry = prepareStaticWorldGeometry({ ...asset, features: asset.features.filter((feature) => localIds.has(feature.id)) });
const political = derivePoliticalMapState(geometry, view.mapOverlay);

describe("Campanian Legion on the opening scenario map", () => {
  it("uses the same owner for the province, city, army and selection panel", () => {
    expect(political.ownerByProvince.get(PUNIC_IDS.rhegium)).toBe("rhegium-campanians");
    expect(view.mapOverlay.settlements.find((settlement) => settlement.settlementId === "settlement-rhegium"))
      .toMatchObject({ controllerPolityId: "rhegium-campanians", capitalPolityId: "rhegium-campanians" });
    expect(view.mapOverlay.forces.find((force) => force.forceId === "campanian-legion"))
      .toMatchObject({ ownerPolityId: "rhegium-campanians", provinceId: PUNIC_IDS.rhegium });
    expect(view.provinces.find((province) => province.id === PUNIC_IDS.rhegium)?.controllerLabel).toBe("Campanian Legion");
    expect(political.ownerByProvince.get(PUNIC_IDS.messana)).toBe("mamertines");
    for (const id of neighbours) expect(political.ownerByProvince.get(id)).toBe("bruttians");
  });

  it("labels the legion at local zoom with a colour distinct from Rome, its allies and the Mamertines", () => {
    expect(derivePoliticalLabels(political, 200, { scale: 12 }).find((label) => label.polityId === "rhegium-campanians")?.name).toBe("Campanian Legion");
    const colour = politicalColourWithAlpha("rhegium-campanians", 1, political.leaderByPolity);
    for (const id of ["rome", "bruttians", "mamertines"]) {
      expect(colour).not.toBe(politicalColourWithAlpha(id, 1, political.leaderByPolity));
    }
    expect(political.leaderByPolity.has("rhegium-campanians")).toBe(false);
  });

  it("shows the opening war along the border with Rome's Bruttian allies", () => {
    expect(view.mapOverlay.conflicts.wars).toContainEqual({ polityAId: "rhegium-campanians", polityBId: "rome" });
    const warBorders = deriveWarBorderPaths(political, view.mapOverlay.conflicts.wars);
    expect(warBorders).not.toBe("");
    const borders = political.borderSegments.filter((border) => border.provinceB !== null &&
      (border.provinceA === PUNIC_IDS.rhegium || border.provinceB === PUNIC_IDS.rhegium));
    expect(borders.length).toBeGreaterThan(0);
    for (const border of borders) expect(warBorders).toContain(border.svgPath);
    expect(deriveWarBorderPaths(political, [])).toBe("");
  });
});
