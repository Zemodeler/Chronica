import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
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
