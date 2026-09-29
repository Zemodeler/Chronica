import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema } from "../material-state";

/**
 * A man cut off on a lost field, between one report and the next.
 *
 * The resolver rolls a commander's fate in the instant the fighting ends, and
 * for the player that instant was the whole of it: a report that opened on a
 * battle closed on his death, with nothing between for him to do. A death or a
 * capture that matters now happens in two acts. The battle leaves him
 * surrounded ("encircled", where the roll said he would fall) or separated
 * from his men ("cut_off", where it said he would be taken), and the report
 * ends there. What he does about it -- break out, hold for relief, yield his
 * sword, stand -- is the next report's opening, and the engine decides it.
 *
 * Code owns who, where and against whom; the thread (`storylineId`) owns the
 * telling, as it does for every other matter the world follows.
 */
export const FieldPlightSchema = z.enum(["encircled", "cut_off"]);
export type FieldPlight = z.infer<typeof FieldPlightSchema>;

/** What a man can do with the enemy all round him. */
export const FieldChoiceSchema = z.enum(["break_out", "hold", "yield", "stand"]);
export type FieldChoice = z.infer<typeof FieldChoiceSchema>;

export const FieldOutcomeSchema = z.enum(["escaped", "escaped_wounded", "relieved", "captured", "killed"]);
export type FieldOutcome = z.infer<typeof FieldOutcomeSchema>;

export const FieldPerilSchema = z
  .object({
    id: EntityIdSchema,
    characterId: EntityIdSchema,
    plight: FieldPlightSchema,
    battleId: EntityIdSchema,
    provinceId: EntityIdSchema,
    /** The army he was fighting in or leading, if it still exists. */
    ownForceId: EntityIdSchema.nullable(),
    /** The army between him and safety. */
    enemyForceId: EntityIdSchema,
    enemyPolityId: EntityIdSchema,
    /** How many are still with him: his guard, his staff, whoever did not run. */
    companions: z.number().int().nonnegative().max(5_000),
    storylineId: EntityIdSchema,
    openedAtStep: ElapsedStepSchema,
    /** The player's answer, when it was his to give. Null until then, and for everyone else. */
    choice: FieldChoiceSchema.nullable().default(null),
    resolvedAtStep: ElapsedStepSchema.nullable().default(null),
    outcome: FieldOutcomeSchema.nullable().default(null),
  })
  .strict();
export type FieldPeril = z.infer<typeof FieldPerilSchema>;

/** The option ids a field decision is asked with, so the answer names the choice and nothing else. */
export const FIELD_OPTION_PREFIX = "field-";

export function fieldOptionId(choice: FieldChoice): string {
  return `${FIELD_OPTION_PREFIX}${choice.replace("_", "-")}`;
}

export function fieldChoiceOf(optionId: string | null | undefined): FieldChoice | null {
  if (optionId == null || !optionId.startsWith(FIELD_OPTION_PREFIX)) return null;
  const parsed = FieldChoiceSchema.safeParse(optionId.slice(FIELD_OPTION_PREFIX.length).replace("-", "_"));
  return parsed.success ? parsed.data : null;
}

/** The one standing against this person, if they are in one. */
export function openFieldPerilOf(perils: readonly FieldPeril[], characterId: string | null): FieldPeril | undefined {
  if (characterId === null) return undefined;
  return perils.find((peril) => peril.characterId === characterId && peril.resolvedAtStep === null);
}
