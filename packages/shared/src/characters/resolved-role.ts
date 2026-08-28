import { z } from "zod";
import { EntityIdSchema } from "../material-state";

// Generated starting cast (docs/08, goal: replace the temporary chat prototype).
//
// A declared character resolves, once, into a role and a bounded cast of
// contacts -- this is what a worker-side AI call produces and what
// `player_game_ui_state.generatedCast` persists. `packages/sim` later
// materializes the new-character contacts into `world.characters`; these
// schemas are the validated boundary between the AI call and that step.

export const ContactRoleKindSchema = z.enum(["superior", "subordinate", "peer", "authority", "crisis"]);
export type ContactRoleKind = z.infer<typeof ContactRoleKindSchema>;

export const GeneratedContactSchema = z
  .object({
    characterId: EntityIdSchema,
    /** false = matched an existing world.characters office-holder. */
    isNewCharacter: z.boolean(),
    name: z.string().trim().min(1).max(120),
    roleKind: ContactRoleKindSchema,
    roleLabel: z.string().trim().min(1).max(160),
    locationProvinceId: EntityIdSchema,
    polityId: EntityIdSchema.nullable(),
    pitch: z.string().trim().min(1).max(400),
  })
  .strict();
export type GeneratedContact = z.infer<typeof GeneratedContactSchema>;

export const ResolvedContactSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    roleLabel: z.string().trim().min(1).max(160),
    locationProvinceId: z.string().trim().min(1),
    polityId: z.string().trim().min(1).nullable(),
  })
  .strict();
export type ResolvedContact = z.infer<typeof ResolvedContactSchema>;

export const ResolvedRoleSchema = z
  .object({
    /** The player character's own name -- distinct from roleLabel, which describes the position, not the person. */
    characterName: z.string().trim().min(1).max(120),
    roleLabel: z.string().trim().min(1).max(160),
    startingLocationProvinceId: EntityIdSchema,
    startingPolityId: EntityIdSchema.nullable(),
    startingOfficeId: EntityIdSchema.nullable(),
    socialPositionSummary: z.string().trim().min(1).max(400),
    /** Bounded cast, enforced here. */
    contacts: z.array(GeneratedContactSchema).min(3).max(5),
    immediateEvent: z
      .object({
        summary: z.string().trim().min(1).max(400),
        salience: z.number().int().min(0).max(100),
      })
      .strict(),
  })
  .strict();
export type ResolvedRole = z.infer<typeof ResolvedRoleSchema>;
