import { describe, expect, it } from "vitest";
import { firstPunicWarScenario, punicWarsScenario } from "@chronica/db";
import { executeWorkflow } from "@chronica/shared";
import { projectWorldView } from "./world-view";

function project(conflicts: typeof firstPunicWarScenario.initialWorld.conflicts) {
  const world = structuredClone(firstPunicWarScenario.initialWorld);
  world.conflicts = conflicts;
  return projectWorldView(world, {
    gameId: "game-1",
    gameTitle: "First Punic War",
    turnIndex: 1,
    turnStatus: "collecting",
    submittedPlayers: 0,
    totalPlayers: 1,
  }, "marcus-atilius");
}

describe("projectWorldView map conflicts", () => {
  it("allows sieges only against real settlements", () => {
    const world = structuredClone(firstPunicWarScenario.initialWorld);
    const againstSettlement = executeWorkflow({
      actionId: "start_siege",
      actorId: "marcus-atilius",
      parameters: { settlementId: "drepanum-city", invadingForceIds: ["legio-i"], defendingForceIds: ["carthaginian-army"] },
    }, world, 1);
    const againstProvince = executeWorkflow({
      actionId: "start_siege",
      actorId: "marcus-atilius",
      parameters: { settlementId: "ita-72843720b81376294924159-sicily-central", invadingForceIds: ["legio-i"], defendingForceIds: [] },
    }, world, 1);

    expect(againstSettlement.ok).toBe(true);
    expect(againstProvince.ok).toBe(false);
  });

  it("renders a siege attached to a real settlement", () => {
    const view = project({
      battles: [],
      wars: [],
      sieges: [{ settlementId: "drepanum-city", invadingForceIds: ["legio-i"], defendingForceIds: ["carthaginian-army"] }],
    });

    expect(view.mapOverlay?.conflicts.sieges).toHaveLength(1);
    expect(view.mapOverlay?.settlements.find((settlement) => settlement.settlementId === "drepanum-city")?.underSiege).toBe(true);
  });

  it("omits an unrecoverable historic siege rather than crashing the game page", () => {
    const view = project({
      battles: [],
      wars: [],
      sieges: [{ settlementId: "ita-72843720b81376294924159-sicily-central", invadingForceIds: ["legio-i"], defendingForceIds: [] }],
    });

    expect(view.mapOverlay?.conflicts.sieges).toEqual([]);
  });
});

describe("Punic Wars opening map", () => {
  it("keeps the opening at peace while exposing the historical map without tactical ties", () => {
    const view = projectWorldView(punicWarsScenario.initialWorld, {
      gameId: "punic-wars-game",
      gameTitle: "Punic Wars",
      turnIndex: 0,
      turnStatus: "collecting",
      submittedPlayers: 0,
      totalPlayers: 1,
      clock: punicWarsScenario.definition.clock,
    }, "gaius-genucius");

    expect(view.mapOverlay?.conflicts.wars).toEqual([]);
    expect(view.mapOverlay?.politicalRelations).toEqual([]);
    expect(view.mapOverlay?.provinces.some((province) => province.provinceId === "punic-iberia-turdetani" && province.controllerPolityId === "carthage")).toBe(true);
    expect(view.mapOverlay?.polities.some((polity) => polity.polityId === "mamertines")).toBe(true);
  });

  it("corrects legacy opening snapshots that retained Roman client controllers", () => {
    const legacyWorld = structuredClone(punicWarsScenario.initialWorld);
    const samnium = legacyWorld.map.provinces.find(
      (province) => province.id === "punic-italy-samnium",
    );

    expect(samnium).toBeDefined();
    if (samnium === undefined) return;

    samnium.controllerPolityId = "samnites";
    legacyWorld.map.politicalRelations = [
      {
        id: "rome-alliance-samnites",
        kind: "alliance",
        leaderPolityId: "rome",
        memberPolityId: "samnites",
        sourceNote: "Legacy opening snapshot.",
      },
    ];

    const view = projectWorldView(legacyWorld, {
      gameId: "punic-wars-game",
      gameTitle: "Punic Wars",
      turnIndex: 0,
      turnStatus: "collecting",
      submittedPlayers: 0,
      totalPlayers: 1,
      clock: punicWarsScenario.definition.clock,
    }, "gaius-genucius");

    expect(
      view.mapOverlay?.provinces.find((province) => province.provinceId === "punic-italy-samnium")
        ?.controllerPolityId,
    ).toBe("rome");
    expect(view.mapOverlay?.politicalRelations).toEqual([]);
  });
});
