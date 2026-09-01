import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { buildReactionDirectorSystemPrompt } from "./reaction-director-prompt";
import { buildSimulatorSystemPrompt } from "./simulator-prompt";
import { WORKFLOW_MUTATION_RULE } from "./prompts";
import { buildWorldDirectorSystemPrompt } from "./world-director-prompt";

const world = firstPunicWarScenario.initialWorld;
const playerCharacterId = "marcus-atilius";

describe("workflow mutation rule", () => {
  it("uses the player workflow-mutation rule for every AI director", () => {
    const directorPrompts = [
      buildReactionDirectorSystemPrompt(world, [], playerCharacterId),
      buildSimulatorSystemPrompt(world, {
        star: new Set<string>(),
        near: new Set<string>(),
        far: new Set<string>(),
        coarse: new Set<string>(),
      }, playerCharacterId),
      buildWorldDirectorSystemPrompt(world, { proposals: [], conflicts: [], totalSalience: 0 }, playerCharacterId),
    ];

    for (const prompt of directorPrompts) {
      expect(prompt).toContain(WORKFLOW_MUTATION_RULE);
      expect(prompt).toContain("moving an army or general to another province");
      expect(prompt).toContain("changing a treasury or any account balance");
    }
  });
});
