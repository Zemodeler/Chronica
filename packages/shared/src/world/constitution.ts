import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema } from "../material-state";
import { GovernmentFormSchema, type GovernmentForm } from "../political-parts";

/**
 * How a constitution came to be what it is.
 *
 * - `scenario`: authored, as the world opened.
 * - `generated`: grown by the engine from the power's form, the first time
 *   the world needed it to have a government.
 * - `reform`: a measure carried, or a ruler's decree.
 * - `seizure`: taken by force -- a coup or a revolution.
 * - `restoration`: the fallen government taken back.
 * - `imposition`: dictated by a conqueror or a senior ally.
 * - `extinction`: a line of rulers died out, and somebody else governs now.
 */
export const ConstitutionOriginSchema = z.enum(["scenario", "generated", "reform", "seizure", "restoration", "imposition", "extinction"]);
export type ConstitutionOrigin = z.infer<typeof ConstitutionOriginSchema>;

export const ConstitutionChangeSchema = z
  .object({
    atStep: ElapsedStepSchema,
    origin: ConstitutionOriginSchema,
    /** What it was, and what it became. */
    fromForm: GovernmentFormSchema.nullable(),
    toForm: GovernmentFormSchema,
    summary: z.string().trim().min(1).max(400),
    /** Whoever brought it about, where somebody did. */
    byCharacterId: EntityIdSchema.nullable().default(null),
  })
  .strict();
export type ConstitutionChange = z.infer<typeof ConstitutionChangeSchema>;

/**
 * One power's constitution, as a record of what it is and how it got there.
 *
 * The parts themselves live where the engine already reads them: chambers in
 * `material.institutions`, offices in `offices`, succession rules in
 * `successionRules`. This says which of them are the power's own, what form
 * that reads as, and the history -- because a republic that was a kingdom
 * twenty years ago is not the same thing as one that never was.
 */
export const ConstitutionSchema = z
  .object({
    polityId: EntityIdSchema,
    /** The form read back from its parts, last time they changed. */
    form: GovernmentFormSchema,
    origin: ConstitutionOriginSchema,
    adoptedAtStep: ElapsedStepSchema,
    /** The seat that is the head of state, where there is one. */
    rulerOfficeId: EntityIdSchema.nullable(),
    /** The chamber that may change all this, where one may. Null: the ruler decrees it. */
    sovereignInstitutionId: EntityIdSchema.nullable(),
    history: z.array(ConstitutionChangeSchema).max(24).default([]),
  })
  .strict();
export type Constitution = z.infer<typeof ConstitutionSchema>;

/**
 * What the world has to remember from month to month to see a group coming.
 *
 * Most groups are read straight off the world as it is -- debts, ventures,
 * who backed whom. A few need memory: who ruled a province before it was
 * taken, how long a man has had his army, how many soldiers went home, what
 * has been done before.
 */
export const SocietyMemorySchema = z
  .object({
    /** The first power the world saw holding each province: who its people are. */
    nativeControllers: z.array(z.object({ provinceId: EntityIdSchema, polityId: EntityIdSchema }).strict()).default([]),
    /** How long each army has had the man at its head. */
    commandSince: z.array(z.object({ forceId: EntityIdSchema, commanderCharacterId: EntityIdSchema, sinceStep: ElapsedStepSchema }).strict()).default([]),
    /** Men under arms at the last review, by power: a fall that was not a battle is men sent home. */
    menUnderArms: z.array(z.object({ polityId: EntityIdSchema, count: z.number().int().nonnegative() }).strict()).default([]),
    /** Men sent home, by power and month, kept for three years. */
    discharged: z.array(z.object({ polityId: EntityIdSchema, count: z.number().int().positive(), atStep: ElapsedStepSchema }).strict()).max(400).default([]),
    /**
     * Things done, by kind, so a second time can become a custom: a council
     * overruled, an emergency office made again, a throne taken by an army.
     */
    precedents: z
      .array(z.object({ polityId: EntityIdSchema, kind: z.enum(["overruled_council", "emergency_office", "army_made_ruler"]), key: z.string().trim().min(1).max(160), atStep: ElapsedStepSchema }).strict())
      .max(200)
      .default([]),
    /** Offices nobody has held, and since when: an office idle long enough lapses. */
    idleOffices: z.array(z.object({ officeId: EntityIdSchema, sinceStep: ElapsedStepSchema }).strict()).default([]),
    /** The last day the groups were reviewed. */
    lastReviewStep: ElapsedStepSchema.nullable().default(null),
  })
  .strict();
export type SocietyMemory = z.infer<typeof SocietyMemorySchema>;

export const EMPTY_SOCIETY_MEMORY: SocietyMemory = {
  nativeControllers: [],
  commandSince: [],
  menUnderArms: [],
  discharged: [],
  precedents: [],
  idleOffices: [],
  lastReviewStep: null,
};

/** The form a power with no stated one is taken to have: loose powers are confederations, the rest are ruled. */
export function inferredGovernmentForm(polity: { readonly governmentForm?: GovernmentForm | null | undefined; readonly cohesionBps?: number | undefined }): GovernmentForm {
  if (polity.governmentForm != null) return polity.governmentForm;
  return (polity.cohesionBps ?? 7_000) < 4_500 ? "tribal_confederation" : "monarchy";
}
