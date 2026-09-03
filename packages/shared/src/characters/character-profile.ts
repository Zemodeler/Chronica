import { z } from "zod";
import { EntityIdSchema } from "../material-state";

// Character profile projection (docs/08 follow-up, character-sim phase 1).
//
// Dialogue needs prose a `Character` record was never meant to hold: a
// biography, a voice, a way to present them. None of it is simulation truth,
// so none of it lives in `WorldState`. This is the one place it is allowed to
// live -- cacheable, replaceable, and never consulted by the Simulator,
// Character Director, or World Director.
//
// Anything that changes what the character *is* rather than how they *read* --
// location, life state, relationships, availability -- belongs on `Character`
// or the social-event ledger instead, never here.

export const CharacterProfileSchema = z
  .object({
    gameId: EntityIdSchema,
    characterId: EntityIdSchema,
    version: z.number().int().positive(),
    roleLabel: z.string().trim().min(1).max(200),
    biography: z.string().trim().max(2_000).nullable(),
    voiceSummary: z.string().trim().max(600).nullable(),
    presentationDetails: z.record(z.string(), z.unknown()).default({}),
    updatedAtStep: z.number().int().nonnegative(),
  })
  .strict();
export type CharacterProfile = z.infer<typeof CharacterProfileSchema>;
