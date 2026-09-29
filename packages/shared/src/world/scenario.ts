import { z } from "zod";
import { ScenarioGovernmentRulesSchema } from "../characters/character";
import { ScenarioLifeRulesSchema } from "../characters/family";
import { ScenarioWealthRulesSchema } from "../characters/wealth";
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

/**
 * What the period was tending toward, offered to the world when its
 * circumstances hold -- and never otherwise.
 *
 * The alternative designs are both worse. A scripted timeline says Cannae
 * happens in 216 BC, which stops being true the moment the player changes
 * anything and leaves the record telling a lie. A world with no historical
 * grain at all produces a plausible Mediterranean in which nothing that
 * actually mattered about it is ever likely to happen.
 *
 * So a pressure is not an event. It is a standing condition with a *shape* --
 * Carthage's army is mercenary and unpaid; Rome's alliance system in the south
 * is brittle; the Alps can be crossed in autumn at a price -- and the narrator
 * is allowed to reach for it only when the world still looks like that. If
 * nobody ever fails to pay the mercenaries, the mutiny never happens and the
 * pressure simply expires unused. History becomes a thing this world can fall
 * into rather than a thing it is on rails toward.
 *
 * Each is offered once. A pressure that kept firing would be a rail.
 */
export const ScenarioHistoricalPressureSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    /** In a few words, for the ledger and for debugging: "the mercenaries go unpaid". */
    label: z.string().trim().min(1).max(160),
    /** Which of the narrator's kinds of trouble this is, so it competes with the ordinary ones. */
    kind: z.enum(["person_problem", "world_event", "new_actor"]),
    /** What the orchestrator is asked to do with it. Written like an archetype's brief. */
    brief: z.string().trim().min(1).max(1_200),
    /** Against the archetype table's own weights: 8 is an ordinary pull, 20 is the shape of the age. */
    weight: z.number().int().min(1).max(40).default(10),
    severity: z.enum(["minor", "serious", "grave"]).default("serious"),
    /** True when this must be kept from the world until somebody finds it out. */
    secret: z.boolean().default(false),
    /** An incident that runs its course rather than one that grows into a thread. */
    oneShot: z.boolean().default(false),
    /**
     * When the world still looks like this. Every stated condition must hold;
     * an empty set of conditions is a pressure that is always available, which
     * is a legitimate thing to author and a dangerous one.
     */
    when: z
      .object({
        /** These powers must all still exist. */
        politiesExist: z.array(z.string().trim().min(1)).max(8).default([]),
        /** This power must hold every one of these provinces. */
        polityHolds: z.array(z.object({ polityId: z.string().trim().min(1), provinceIds: z.array(z.string().trim().min(1)).max(12) }).strict()).max(4).default([]),
        /** These two must be at war -- or, with `atPeace`, must not be. */
        atWar: z.array(z.object({ polityId: z.string().trim().min(1), otherPolityId: z.string().trim().min(1) }).strict()).max(4).default([]),
        atPeace: z.array(z.object({ polityId: z.string().trim().min(1), otherPolityId: z.string().trim().min(1) }).strict()).max(4).default([]),
        /** Days from the scenario epoch, so an age can arrive and pass. */
        notBeforeDay: z.number().int().min(0).max(3_660_000).default(0),
        notAfterDay: z.number().int().min(0).max(3_660_000).nullable().default(null),
        /**
         * Pressures that must already have been put to the world.
         *
         * What makes a crisis a chain rather than a list. Messana asking for a
         * protector is one event; a great power answering and the other one
         * objecting is what it turns into, and it is only available once the
         * asking has happened. Without this every pressure of an age is
         * independently available from day one and the age has no order to it.
         */
        afterPressureIds: z.array(z.string().trim().min(1)).max(8).default([]),
        /**
         * One of these powers must have men standing in the province.
         *
         * "Whoever crosses to Messana" was reachable once Messana had asked,
         * whether or not anybody had crossed -- and the brief asked the model
         * to decide which power had, so a Roman landing was written up as a
         * Carthaginian one and the wrong war was opened. The pressure now waits
         * for the crossing, and is told who made it (`narrator.ts`).
         */
        forcesPresent: z.array(z.object({ polityIds: z.array(z.string().trim().min(1)).min(1).max(8), provinceId: z.string().trim().min(1) }).strict()).max(4).default([]),
      })
      .strict()
      .default({ politiesExist: [], polityHolds: [], atWar: [], atPeace: [], notBeforeDay: 0, notAfterDay: null, afterPressureIds: [], forcesPresent: [] }),
    /** Where it lands, when the pressure names a place or a power itself. */
    target: z
      .object({
        polityId: z.string().trim().min(1).nullable().default(null),
        provinceId: z.string().trim().min(1).nullable().default(null),
        /** The other party, where the pressure is about two powers rather than one. */
        otherPolityId: z.string().trim().min(1).nullable().default(null),
      })
      .strict()
      .default({ polityId: null, provinceId: null, otherPolityId: null }),
  })
  .strict();
export type ScenarioHistoricalPressure = z.infer<typeof ScenarioHistoricalPressureSchema>;

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
    /**
     * What a person of a given standing is worth, in this scenario's own
     * currency. Empty means the engine's coarse defaults, which is what every
     * scenario got before there was anywhere to say otherwise.
     */
    wealth: ScenarioWealthRulesSchema.default({ bands: [], defaultBandId: null }),
    /** Opening Chronicle context, historical background, tensions, and terminology (character-sim phase 6). */
    chronicle: ScenarioChronicleRulesSchema.default({ openingContext: "", historicalBackground: [], openingTensions: [], terminology: {} }),
    /** What the period tends toward, offered when its circumstances hold -- see `ScenarioHistoricalPressureSchema`. */
    historicalPressures: z.array(ScenarioHistoricalPressureSchema).max(60).default([]),
  })
  .strict();
export type ScenarioDefinition = z.infer<typeof ScenarioDefinitionSchema>;
