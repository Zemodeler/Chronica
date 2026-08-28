import { z } from "zod";
import { EntityIdSchema } from "../material-state";

// Character introduction (docs/08, goal: replace the temporary chat prototype).
//
// Declaring a character does not by itself create a `Character` in
// `world.characters`. This schema is the staged instruction `packages/sim`'s
// `applyCharacterIntroductions` consumes, inside the normal turn-commit
// transaction, to materialize the player's own character and any
// `isNewCharacter` generated contact.

export const CharacterIntroductionSchema = z
  .object({
    characterId: EntityIdSchema,
    name: z.string().trim().min(1).max(120),
    cultureId: EntityIdSchema,
    locationProvinceId: EntityIdSchema,
    polityId: EntityIdSchema.nullable(),
    officeId: EntityIdSchema.nullable(),
    origin: z.enum(["player_declared", "generated_contact"]),
    /** The character_claims.id this is staged against, for idempotency. */
    claimId: EntityIdSchema,
  })
  .strict();
export type CharacterIntroduction = z.infer<typeof CharacterIntroductionSchema>;
