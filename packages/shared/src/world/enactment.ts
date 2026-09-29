import { z } from "zod";
import { EntityIdSchema } from "../material-state";
import { StandingEffectSchema, StandingUpkeepSchema } from "./standing-effects";
import { ChamberPowerSchema, FranchiseSchema, GovernmentFormSchema } from "../political-parts";
import { LeverIdSchema } from "./departments";

/**
 * A change to the constitution itself, as parts (`sim/constitutions.ts`).
 *
 * - `form`: the whole of it recast -- a kingship abolished for a republic.
 *   Every part the old form had and the new one lacks goes.
 * - `chamber`: one chamber founded, reformed or abolished.
 * - `succession`: how one office is filled -- a throne made elective.
 */
export const ConstitutionAmendmentSchema = z
  .object({
    form: GovernmentFormSchema.nullable().default(null),
    chamber: z
      .object({
        /** Null founds a new one. */
        institutionId: EntityIdSchema.nullable().default(null),
        name: z.string().trim().min(1).max(120).nullable().default(null),
        powers: z.array(ChamberPowerSchema).max(6).nullable().default(null),
        advisory: z.boolean().nullable().default(null),
        franchise: FranchiseSchema.nullable().default(null),
        abolish: z.boolean().default(false),
      })
      .strict()
      .nullable()
      .default(null),
    succession: z
      .object({
        officeId: EntityIdSchema,
        kind: z.enum(["primogeniture", "elective", "appointment", "seniority"]),
        /** The chamber that elects, for an elective office. */
        institutionId: EntityIdSchema.nullable().default(null),
      })
      .strict()
      .nullable()
      .default(null),
  })
  .strict();
export type ConstitutionAmendment = z.infer<typeof ConstitutionAmendmentSchema>;

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
    /** The constitution changed, as parts. */
    constitution: ConstitutionAmendmentSchema.nullable().optional(),
    /**
     * A department founded, reformed or abolished (`world/departments.ts`):
     * who is in charge of what. Null leaves every department as it was.
     */
    department: z
      .object({
        /** Null founds a new one. */
        departmentId: EntityIdSchema.nullable().default(null),
        name: z.string().trim().min(1).max(120).nullable().default(null),
        /** Null keeps what it had; a new one with none is given what its name says, or a standing effect. */
        levers: z.array(LeverIdSchema).max(12).nullable().default(null),
        offices: z.array(z.object({
          officeId: EntityIdSchema,
          officeLabel: z.string().trim().min(1).max(120).nullable().default(null),
          role: z.enum(["head", "officer", "deputy"]).default("officer"),
          seats: z.number().int().min(1).max(12).nullable().default(null),
        }).strict()).max(8).default([]),
        pay: z.enum(["honorary", "salaried"]).nullable().default(null),
        /** What it goes on doing that no lever says. */
        effects: z.array(StandingEffectSchema).max(4).default([]),
        abolish: z.boolean().default(false),
      })
      .strict()
      .nullable()
      .default(null),
    /** A work it pays for, kept "proposed" until it passes and begun then. */
    projectId: EntityIdSchema.nullable().default(null),
    /** A man excused the ladder for one office (`resolveEligibility`). */
    waiver: z.object({ characterId: EntityIdSchema, officeId: EntityIdSchema }).strict().nullable().default(null),
    /** Set when it was carried out, so it is never carried out twice. */
    enactedAtStep: z.number().int().nonnegative().nullable().default(null),
  })
  .strict();
export type Enactment = z.infer<typeof EnactmentSchema>;
