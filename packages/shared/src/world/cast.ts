import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema } from "../material-state";

/**
 * The standing cast (docs/plans/a-living-world.md §4).
 *
 * Everybody runs on rules (`sim/src/statecraft.ts`) until they matter enough
 * to the player's story to be played by the model, the way the nemesis
 * always was: a capped cast of the people who matter most now, promoted by
 * salience and kept a while, each given one standing look a burst. Who is in
 * it, since when, which seat holds them, and how long they have been below
 * the line -- so a man does not flicker in and out of the story.
 */

export const CastSeatSchema = z.enum(["nemesis", "chain", "world", "open"]);
export type CastSeat = z.infer<typeof CastSeatSchema>;

export const CastMemberSchema = z
  .object({
    characterId: EntityIdSchema,
    seat: CastSeatSchema,
    sinceStep: ElapsedStepSchema,
    salience: z.number().int(),
    /** Why they are in it, in a few words: "his superior", "rules Egypt". */
    why: z.string().trim().min(1).max(200),
    /** Reviews in a row spent below the line to stay; two and they step down. */
    belowFor: z.number().int().nonnegative().default(0),
    /** Reviews served: nobody steps down before `CAST_MIN_STAY`. */
    reviews: z.number().int().nonnegative().default(0),
  })
  .strict();
export type CastMember = z.infer<typeof CastMemberSchema>;

export const CastSchema = z
  .object({
    members: z.array(CastMemberSchema).max(16).default([]),
    lastReviewStep: ElapsedStepSchema.nullable().default(null),
  })
  .strict();
export type Cast = z.infer<typeof CastSchema>;

/**
 * At or above this a person enters the cast; below `CAST_STAY_AT` for two
 * reviews, they leave. The plan guessed 60 and 40; measured on the opening of
 * 270, nobody but the nemesis reached 60 and the cast was empty.
 */
export const CAST_ENTER_AT = 40;
export const CAST_STAY_AT = 25;
/** A world seat is filled by the most salient foreign ruler at or above this, whether or not he reaches the line. */
export const CAST_WORLD_FLOOR = 15;
export const CAST_MIN_STAY = 3;
/** The cast's size: a budget setting, measured against cost (plan §4). */
export const CAST_SIZE_DEFAULT = 8;
