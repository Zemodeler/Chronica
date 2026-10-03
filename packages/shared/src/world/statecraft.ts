import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema } from "../material-state";

/**
 * What the powers decided by rule, and why (docs/plans/a-living-world.md §2).
 *
 * The world AI (`sim/src/statecraft.ts`) makes each power's big moves without
 * the model, once a month. Every decision is written down with its reason --
 * "Antiochus's army stands on the border, Coele-Syria is lightly held, and the
 * claim is old" -- because the reason is what the rest of the world reads: the
 * news tells it, a person promoted into the cast is handed it as what he did
 * lately, and a hand run can be read for it.
 */

export const StatecraftActSchema = z.enum([
  "declare_war",
  "revolt",
  "raid",
  "alliance",
  "make_peace",
  "subsidy",
  "plot",
  "purge",
  "sack",
  "seize",
  "raise_levy",
  "march",
  "attack",
  "besiege",
  "fall_back",
  "answer_letter",
  "hold",
]);
export type StatecraftAct = z.infer<typeof StatecraftActSchema>;

export const StatecraftEntrySchema = z
  .object({
    day: ElapsedStepSchema,
    polityId: EntityIdSchema,
    /** Who it is done in the name of: the ruler, or the commander of the army. */
    actorCharacterId: EntityIdSchema.nullable(),
    act: StatecraftActSchema,
    targetPolityId: EntityIdSchema.nullable().default(null),
    /** What it weighed, in plain words. */
    why: z.string().trim().min(1).max(400),
  })
  .strict();
export type StatecraftEntry = z.infer<typeof StatecraftEntrySchema>;

/** How many decisions are kept: about two years of a busy world. */
export const STATECRAFT_LOG_MAX = 600;

export const StatecraftLedgerSchema = z
  .object({
    /** The last day the monthly pass ran; null before the first. */
    lastRunDay: ElapsedStepSchema.nullable().default(null),
    log: z.array(StatecraftEntrySchema).max(STATECRAFT_LOG_MAX).default([]),
  })
  .strict();
export type StatecraftLedger = z.infer<typeof StatecraftLedgerSchema>;
