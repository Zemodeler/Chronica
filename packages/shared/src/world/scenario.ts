import { z } from "zod";
import { ScenarioGovernmentRulesSchema } from "../characters/character";
import { ContinuityConfigSchema } from "../continuity/continuity";
import { ScenarioDialogueRulesSchema } from "../dialogue/dialogue";
import { ScenarioWarfareRulesSchema } from "../warfare/battle";
import { ScenarioClockSchema } from "./clock";
import { ScenarioMapRulesSchema } from "./map";

export const ScenarioKnowledgeFactSchema = z.object({
  id: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(600),
  subjectIds: z.array(z.string().trim().min(1)).max(12).default([]),
  provinceIds: z.array(z.string().trim().min(1)).max(12).default([]),
}).strict();
export type ScenarioKnowledgeFact = z.infer<typeof ScenarioKnowledgeFactSchema>;

// The stored scenario definition (docs/03, docs/09).
//
// `scenario_versions.definition` is jsonb precisely so a scenario stays a
// versioned document rather than a second schema migration path (docs/03). This
// is the schema that document must satisfy before a game may be resolved against
// it -- the single place that turns "whatever is in the column" into the
// ScenarioRules packages/sim actually consumes, so a malformed or hand-edited
// row fails loudly at load rather than producing a turn nobody can replay.
export const ScenarioDefinitionSchema = z
  .object({
    clock: ScenarioClockSchema,
    map: ScenarioMapRulesSchema,
    warfare: ScenarioWarfareRulesSchema,
    government: ScenarioGovernmentRulesSchema,
    dialogue: ScenarioDialogueRulesSchema,
    continuity: ContinuityConfigSchema,
    knowledge: z.array(ScenarioKnowledgeFactSchema).max(200).default([]),
  })
  .strict();
export type ScenarioDefinition = z.infer<typeof ScenarioDefinitionSchema>;
