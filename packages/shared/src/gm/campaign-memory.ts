import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema } from "../material-state";

// Compact campaign memory (Game Master refactor, requirement 6).
//
// The committed world snapshot is the only source of truth about *state*.
// This is the source of truth about *narrative continuity*: what the campaign
// has been about, what happened in the last few turns, and which threads are
// still open. It is derived from committed facts -- executed tool results and
// the deterministic turn record -- never from Chronicle prose, which is
// downstream of both and may carry a narrator's voice.
//
// It lives inside WorldState so it is hashed with the snapshot, replays
// identically, and needs no second store. It is deliberately small: every
// field is capped so the Game Master prompt cannot grow without bound as a
// campaign lengthens.

/** One turn's exact, factual account. Written by the pipeline, never by a model. */
export const CampaignTurnMemorySchema = z
  .object({
    atStep: ElapsedStepSchema,
    /** Bullet list of what actually changed, derived from executed tool results. */
    summary: z.string().trim().min(1).max(1_200),
    /** Registered action tools that executed successfully this turn. */
    executedActionIds: z.array(z.string().trim().min(1).max(120)).max(40).default([]),
    /** Capability requests recorded this turn (no mutation occurred for these). */
    unresolvedActionCount: z.number().int().nonnegative().default(0),
  })
  .strict();
export type CampaignTurnMemory = z.infer<typeof CampaignTurnMemorySchema>;

export const MAX_CAMPAIGN_RECENT_TURNS = 6;

export const CampaignMemorySchema = z
  .object({
    /**
     * The durable through-line: what this campaign has been about since it
     * began. Rewritten by compaction as older turns fall out of `recentTurns`,
     * so the oldest history survives as a compact statement rather than being
     * dropped.
     */
    durableSummary: z.string().trim().max(3_000).default(""),
    /** Exact accounts of the most recent turns, newest last. */
    recentTurns: z.array(CampaignTurnMemorySchema).max(MAX_CAMPAIGN_RECENT_TURNS).default([]),
    /** Characters whose personal thread the GM should keep continuous. */
    characterNotes: z
      .array(
        z
          .object({
            characterId: EntityIdSchema,
            note: z.string().trim().min(1).max(400),
            updatedAtStep: ElapsedStepSchema,
          })
          .strict(),
      )
      .max(16)
      .default([]),
    updatedAtStep: ElapsedStepSchema.default(0),
  })
  .strict();
export type CampaignMemory = z.infer<typeof CampaignMemorySchema>;

export const EMPTY_CAMPAIGN_MEMORY: CampaignMemory = {
  durableSummary: "",
  recentTurns: [],
  characterNotes: [],
  updatedAtStep: 0,
};

/**
 * Fold this turn's factual account into campaign memory.
 *
 * Compaction is deterministic and lossy in exactly one direction: a turn that
 * falls out of `recentTurns` is appended to `durableSummary` as a single line,
 * and `durableSummary` is truncated from the front when it reaches its cap, so
 * the memory converges on "the recent past in detail, the deep past in
 * outline" without any AI call.
 */
export function foldTurnIntoCampaignMemory(
  memory: CampaignMemory,
  turn: CampaignTurnMemory,
): CampaignMemory {
  const recent = [...memory.recentTurns.filter((entry) => entry.atStep !== turn.atStep), turn]
    .sort((left, right) => left.atStep - right.atStep);
  const overflow = recent.slice(0, Math.max(0, recent.length - MAX_CAMPAIGN_RECENT_TURNS));
  const kept = recent.slice(-MAX_CAMPAIGN_RECENT_TURNS);

  let durable = memory.durableSummary;
  for (const dropped of overflow) {
    const headline = dropped.summary.replace(/\s+/g, " ").trim().slice(0, 200);
    durable = durable.length === 0 ? `Step ${dropped.atStep}: ${headline}` : `${durable}\nStep ${dropped.atStep}: ${headline}`;
  }
  if (durable.length > 3_000) durable = durable.slice(durable.length - 3_000).replace(/^[^\n]*\n/, "");

  return {
    durableSummary: durable,
    recentTurns: kept,
    characterNotes: memory.characterNotes,
    updatedAtStep: turn.atStep,
  };
}
