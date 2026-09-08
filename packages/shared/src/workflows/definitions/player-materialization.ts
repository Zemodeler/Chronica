import { z } from "zod";
import { CharacterKnowledgebaseSchema } from "../../characters/knowledgebase";
import { ScenarioGovernmentRulesSchema } from "../../characters/character";
import { materializePlayerCharacter } from "../../characters/player-materialization";
import { EntityIdSchema } from "../../material-state";
import { defineWorkflow, type AnyWorkflowDefinition } from "../types";

// Confirmation is a player decision, but entering that confirmed identity into
// the snapshot is still a world mutation.  Keep it in the workflow registry so
// it is validated and audited through the same path as every other creation.
export const playerMaterializationWorkflows: AnyWorkflowDefinition[] = [
  defineWorkflow({
    id: "materialize_declared_player",
    description: "Place a confirmed player declaration into the world with its character, purse, and any valid starting office.",
    category: "character" as const,
    invokerAuthority: ["system"],
    parametersSchema: z.object({
      characterId: EntityIdSchema,
      knowledgebase: CharacterKnowledgebaseSchema,
      scenarioGovernment: ScenarioGovernmentRulesSchema.optional(),
    }).strict(),
    apply(world, params) {
      if (!params.knowledgebase.confirmedByPlayer || params.knowledgebase.characterId !== params.characterId) return null;
      try {
        const materialized = materializePlayerCharacter(world, params.characterId, params.knowledgebase, params.scenarioGovernment);
        return {
          world: materialized,
          result: {
            summary: `${params.knowledgebase.canonicalName} enters the world as the confirmed player character.`,
            applied: true,
            noOp: materialized === world,
          },
        };
      } catch {
        return null;
      }
    },
  }),
];
