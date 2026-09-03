import { z } from "zod";
import { ScenarioGovernmentRulesSchema } from "../characters/character";
import { ScenarioLifeRulesSchema } from "../characters/family";
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

/**
 * Chronicle-first scenario authoring (character-sim phase 6): how the
 * Chronicle opens and reads, distinct from `knowledge` above (static
 * background lore facts, unrelated to Chronicle tone or opening context).
 */
export const ScenarioHistoricalBackgroundEntrySchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(1_200),
    knowledgeStatus: z.enum(["confirmed", "report", "rumour", "suspicion"]).default("confirmed"),
  })
  .strict();
export type ScenarioHistoricalBackgroundEntry = z.infer<typeof ScenarioHistoricalBackgroundEntrySchema>;

export const ScenarioChronicleRulesSchema = z
  .object({
    openingContext: z.string().trim().max(2_000).default(""),
    historicalBackground: z.array(ScenarioHistoricalBackgroundEntrySchema).max(20).default([]),
    openingTensions: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
    /** Scenario-specific term overrides for Chronicle prose, e.g. {"institution": "Senate"}. */
    terminology: z.record(z.string(), z.string().trim().min(1).max(80)).default({}),
  })
  .strict();
export type ScenarioChronicleRules = z.infer<typeof ScenarioChronicleRulesSchema>;

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
    /** Life stages, mortality/incapacity rates, and inheritance rules (character-sim phase 5). */
    life: ScenarioLifeRulesSchema.default({ lifeStages: [], inheritanceRules: [], reviewIntervalSteps: 4 }),
    /** Opening Chronicle context, historical background, tensions, and terminology (character-sim phase 6). */
    chronicle: ScenarioChronicleRulesSchema.default({ openingContext: "", historicalBackground: [], openingTensions: [], terminology: {} }),
  })
  .strict();
export type ScenarioDefinition = z.infer<typeof ScenarioDefinitionSchema>;
