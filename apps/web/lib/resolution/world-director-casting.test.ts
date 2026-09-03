import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import {
  WorldDirectorDecisionBatchSchema,
  WorldStateSchema,
  executeWorkflow,
} from "@chronica/shared";
import { buildWorldDirectorSystemPrompt } from "./world-director-prompt";

describe("World Director Chronicle casting", () => {
  it("accepts a grounded new NPC cast profile", () => {
    const parsed = WorldDirectorDecisionBatchSchema.parse({
      decisions: [{
        proposalId: "proposal-1",
        decision: "approve",
        rationale: "A named opponent gives the Senate debate a human stake.",
        finalWorkflows: [],
        chronicleCast: {
          role: "opponent",
          newCharacter: {
            name: "Publius Cornelius",
            polityId: "rome",
            locationProvinceId: "ita-local-23120603B86473916475875",
            officeId: null,
          },
        },
      }],
    });

    expect(parsed.decisions[0]?.chronicleCast?.newCharacter?.name).toBe("Publius Cornelius");
  });

  it("creates a complete, schema-valid NPC when the cast requires one", () => {
    const outcome = executeWorkflow({
      actionId: "create_world_character",
      actorId: "marcus-atilius",
      parameters: {
        characterId: "char-cast-publius",
        name: "Publius Cornelius",
        polityId: "rome",
        locationProvinceId: "ita-local-23120603B86473916475875",
        officeId: null,
        provenance: {
          reason: "Chronicle casting for a Senate debate.",
          storylineId: null,
          createdByDirector: true,
        },
      },
    }, structuredClone(firstPunicWarScenario.initialWorld), 1);

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.world.characters.find((character) => character.id === "char-cast-publius")?.name).toBe("Publius Cornelius");
      expect(WorldStateSchema.safeParse(outcome.world).success).toBe(true);
    }
  });

  it("instructs the Director to use only schema-valid cast role tokens", () => {
    const prompt = buildWorldDirectorSystemPrompt(
      firstPunicWarScenario.initialWorld,
      { proposals: [], conflicts: [], totalSalience: 0 },
      "marcus-atilius",
    );

    expect(prompt).toContain('"role" MUST be exactly one of: "supporter", "opponent", "spokesperson", "presiding_official", "witness", "negotiator"');
    expect(prompt).toContain("never write a descriptive role or title");
  });
});
