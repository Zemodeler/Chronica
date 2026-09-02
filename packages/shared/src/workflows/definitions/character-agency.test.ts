import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { executeWorkflow } from "../executor";

const world = () => structuredClone(firstPunicWarScenario.initialWorld);

describe("create_character_goal id determinism", () => {
  it("mints the same goal id when the same invocation is replayed against the same world and step", () => {
    const params = {
      characterId: "marcus-atilius",
      objective: "Secure the grain contract.",
      category: "resource" as const,
      targetEntityIds: [],
      priority: 3,
      visibility: "private" as const,
    };
    const first = executeWorkflow({ actionId: "create_character_goal", actorId: "marcus-atilius", parameters: params }, world(), 7);
    const second = executeWorkflow({ actionId: "create_character_goal", actorId: "marcus-atilius", parameters: params }, world(), 7);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.world.characterGoals.at(-1)!.id).toBe(second.world.characterGoals.at(-1)!.id);
  });
});

describe("create_character_plot id determinism", () => {
  it("mints the same plot id when the same invocation is replayed against the same world and step", () => {
    const w = world();
    const withGoal = executeWorkflow(
      { actionId: "create_character_goal", actorId: "marcus-atilius", parameters: { characterId: "marcus-atilius", objective: "Secure the grain contract.", category: "resource", targetEntityIds: [], priority: 3, visibility: "private" } },
      w,
      7,
    );
    expect(withGoal.ok).toBe(true);
    if (!withGoal.ok) return;
    const goalId = withGoal.world.characterGoals.at(-1)!.id;

    const params = {
      characterId: "marcus-atilius",
      goalId,
      objective: "Bribe the harbourmaster.",
      participantIds: [],
      targetIds: [],
      visibility: "private" as const,
      stakes: "Losing the grain contract.",
      currentObstacle: null,
      worldStorylineId: null,
    };
    const first = executeWorkflow({ actionId: "create_character_plot", actorId: "marcus-atilius", parameters: params }, withGoal.world, 7);
    const second = executeWorkflow({ actionId: "create_character_plot", actorId: "marcus-atilius", parameters: params }, withGoal.world, 7);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.world.characterPlots.at(-1)!.id).toBe(second.world.characterPlots.at(-1)!.id);
  });
});
