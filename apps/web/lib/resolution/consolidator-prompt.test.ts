import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { CharacterSuggestionSchema, executeWorkflow } from "@chronica/shared";
import { consolidateProposals } from "./consolidator-prompt";

describe("consolidateProposals character suggestions", () => {
  it("turns an approved-goal suggestion into a bounded persistent-agency workflow", () => {
    const suggestion = CharacterSuggestionSchema.parse({
      characterId: "hanno",
      suggestionKind: "create_goal",
      proposedGoal: {
        objective: "Preserve Carthaginian control of Sicily.",
        category: "preserve_power",
        targetEntityIds: ["carthage"],
        priority: 5,
        visibility: "polity",
      },
      rationale: "Roman pressure makes Sicily's defence his foremost concern.",
      visibility: "polity",
      salience: 7,
    });

    const result = consolidateProposals([suggestion], [], []);
    const proposal = result.proposals[0];

    expect(proposal?.characterId).toBe("hanno");
    expect(proposal?.proposedWorkflows).toEqual([{
      actionId: "create_character_goal",
      actorId: "hanno",
      parameters: {
        characterId: "hanno",
        objective: "Preserve Carthaginian control of Sicily.",
        category: "preserve_power",
        targetEntityIds: ["carthage"],
        priority: 5,
        visibility: "polity",
      },
    }]);

    const workflow = proposal?.proposedWorkflows[0];
    expect(workflow).toBeDefined();
    const outcome = executeWorkflow(workflow!, structuredClone(firstPunicWarScenario.initialWorld), 1);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.world.characterGoals.some((goal) => goal.characterId === "hanno" && goal.objective === "Preserve Carthaginian control of Sicily.")).toBe(true);
    }
  });
});
