import { z } from "zod";
import { BasisPointsSchema, EntityIdSchema } from "../material-state";
import type { Character } from "./character";

// Canonical age and life status (character-sim phase 5).
//
// Age was documented as clock-derived since Phase 1 but nothing ever derived
// it -- the only workflow touching it (`add_age`) mutated the frozen start
// value instead. This is the derivation that was missing, plus the generic,
// scenario-authored life-stage classification the engine never hardcodes to
// any one culture.

/** Today's age in whole years, derived from the clock -- never recomputed into the snapshot. */
export function currentAgeYears(
  character: Pick<Character, "ageYearsAtStart" | "birthStep">,
  stepsPerYear: number,
  elapsedStep: number,
): number {
  if (character.birthStep !== null) {
    return Math.floor((elapsedStep - character.birthStep) / stepsPerYear);
  }
  return character.ageYearsAtStart + Math.floor(elapsedStep / stepsPerYear);
}

/**
 * A scenario-authored life stage. Generic by construction: the engine never
 * hardcodes "child"/"adult"/"elder" or any culture's stages, only reads
 * whichever bracket a scenario names. Mortality/incapacity/recovery rates
 * default to 0 -- a scenario that authors no rates gets no automatic life
 * events, keeping this bounded rather than an unbounded population sim.
 */
export const LifeStageSchema = z
  .object({
    id: EntityIdSchema,
    label: z.string().trim().min(1).max(80),
    minAgeYears: z.number().int().nonnegative(),
    maxAgeYears: z.number().int().nonnegative().nullable(),
    mortalityRatePerYearBps: BasisPointsSchema.default(0),
    incapacityRatePerYearBps: BasisPointsSchema.default(0),
    recoveryRatePerYearBps: BasisPointsSchema.default(0),
  })
  .strict()
  .superRefine((stage, context) => {
    if (stage.maxAgeYears !== null && stage.maxAgeYears < stage.minAgeYears) {
      context.addIssue({
        code: "custom",
        path: ["maxAgeYears"],
        message: "A life stage's maximum age must be at or above its minimum age.",
      });
    }
  });
export type LifeStage = z.infer<typeof LifeStageSchema>;

/** The life stage `ageYears` falls into, or undefined if no authored stage covers it. */
export function classifyLifeStage(ageYears: number, stages: readonly LifeStage[]): LifeStage | undefined {
  return stages.find((stage) => ageYears >= stage.minAgeYears && (stage.maxAgeYears === null || ageYears <= stage.maxAgeYears));
}

export type LifeStatus = "deceased" | "captured" | "incapacitated" | "retired" | "unavailable" | "living";

/**
 * Engine-known status tags read from the existing, generic
 * `disqualifyingStatuses` array (Phase 4) -- reused, not replaced. Checked in
 * priority order: a dead character is always "deceased" regardless of tags.
 */
const STATUS_TAG_PRIORITY: readonly { tag: string; status: LifeStatus }[] = [
  { tag: "captured", status: "captured" },
  { tag: "incapacitated", status: "incapacitated" },
  { tag: "retired", status: "retired" },
  { tag: "unavailable", status: "unavailable" },
];

export function lifeStatus(character: Pick<Character, "alive" | "disqualifyingStatuses">): LifeStatus {
  if (!character.alive) return "deceased";
  for (const { tag, status } of STATUS_TAG_PRIORITY) {
    if (character.disqualifyingStatuses.includes(tag)) return status;
  }
  return "living";
}
