import { z } from "zod";
import { EntityIdSchema } from "../material-state";
import { StandingEffectSchema, StandingUpkeepSchema } from "./standing-effects";

/**
 * What a measure before a council will do if it is carried.
 *
 * Kept beside the procedure rather than on it, and carried out only on the
 * day the procedure passes (`sim/enact.ts`). A question used to change nothing
 * by being answered: a grain law was passed and then had to be carried out a
 * second time by hand, and nothing at all could reform an office or found a
 * council. Every reference here is already resolved to a real id.
 */
export const EnactmentSchema = z
  .object({
    procedureId: EntityIdSchema,
    /** The power whose law it is. */
    polityId: EntityIdSchema,
    effects: z.array(StandingEffectSchema).max(6).default([]),
    upkeep: StandingUpkeepSchema.nullable().default(null),
    office: z
      .object({
        officeId: EntityIdSchema,
        officeLabel: z.string().trim().min(1).max(120).nullable().default(null),
        authorises: z.array(z.string().trim().min(1).max(60)).max(16).nullable().default(null),
        /** Undefined leaves the term alone; null makes it a holding without term. */
        termDays: z.number().int().positive().max(36_600).nullable().optional(),
        seats: z.number().int().min(1).max(12).nullable().default(null),
        abolish: z.boolean().default(false),
      })
      .strict()
      .nullable()
      .default(null),
    body: z.object({ name: z.string().trim().min(1).max(120) }).strict().nullable().default(null),
    /** A man excused the ladder for one office (`resolveEligibility`). */
    waiver: z.object({ characterId: EntityIdSchema, officeId: EntityIdSchema }).strict().nullable().default(null),
    /** Set when it was carried out, so it is never carried out twice. */
    enactedAtStep: z.number().int().nonnegative().nullable().default(null),
  })
  .strict();
export type Enactment = z.infer<typeof EnactmentSchema>;
