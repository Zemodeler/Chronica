import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { WorldState } from "@chronica/shared";
import { buildGameMasterSystemPrompt, type GameMasterPromptInput } from "./game-master-prompt";

// Regression: a formed NPC intention used to reach the Game Master only as
// loose summary prose it had to independently reconstruct into a tool call --
// which it rarely did, so a principal NPC's own chosen action sat "prepared"
// and then silently "deferred". The prompt must now carry the exact,
// executable proposal.

const PLAYER = "marcus-atilius";

function world(): WorldState {
  return structuredClone(firstPunicWarScenario.initialWorld);
}

function baseInput(overrides: Partial<GameMasterPromptInput> = {}): GameMasterPromptInput {
  return {
    world: world(),
    actorCharacterId: PLAYER,
    atStep: 1,
    directives: [],
    selectedCharacters: [],
    npcProposals: [],
    playerContext: undefined,
    scenarioGovernment: undefined,
    scenarioChronicle: undefined,
    ...overrides,
  };
}

describe("FORMED NPC INTENTIONS", () => {
  it("says none this turn when character agency formed nothing", () => {
    const prompt = buildGameMasterSystemPrompt(baseInput());
    expect(prompt).toContain("FORMED NPC INTENTIONS");
    expect(prompt).toContain("None this turn.");
  });

  it("renders a principal NPC's formed workflow with actor, intention, rationale, and exact invocation", () => {
    const prompt = buildGameMasterSystemPrompt(baseInput({
      npcProposals: [{
        intentId: "intent-hanno-1",
        actorCharacterId: "hanno",
        actionType: "economic_action",
        rationale: "Hanno manages remaining funds to reduce exposure.",
        workflowIds: ["remove_gold"],
        invocation: { actionId: "remove_gold", actorId: "hanno", parameters: { accountId: "hanno-purse", amount: 50, reason: "Bribes an informant." } },
      }],
    }));

    expect(prompt).toContain("Hanno");
    expect(prompt).toContain("hanno");
    expect(prompt).toContain("economic_action");
    expect(prompt).toContain("Hanno manages remaining funds to reduce exposure.");
    expect(prompt).toContain("remove_gold");
    expect(prompt).toContain("hanno-purse");
    expect(prompt).toContain("50");
    // The instruction that these are already-selected actions to invoke, not
    // narrate -- prose alone must not count as execution.
    expect(prompt).toMatch(/not suggestions/i);
    expect(prompt).toMatch(/prose about the actor's intention is not executing it/i);
  });
});
