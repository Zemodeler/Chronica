import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema } from "../material-state";

/**
 * A command held past the office that gave it, or under somebody else's.
 *
 * A consul's year ends on a fixed day and his war does not. What happens to
 * his army then is a constitution's business (`CommandTenure`): at Rome the
 * Senate may extend his command for a year (`prorogued`); otherwise he keeps
 * it until his successor reaches the army and takes it from him
 * (`awaiting_successor`), and may stay on under that successor as his legate
 * (`legate`). Before this, the year's end changed nothing about who led the
 * army -- the outgoing consul led it for ever, and only his powers at home
 * lapsed, without a word.
 */
export const CommandHoldSchema = z
  .object({
    id: EntityIdSchema,
    polityId: EntityIdSchema,
    characterId: EntityIdSchema,
    /** The armies he holds by it. */
    forceIds: z.array(EntityIdSchema).min(1).max(8),
    /** The magistracy whose year ran out, where one did. */
    officeId: EntityIdSchema.nullable().default(null),
    /**
     * `triumph`: a general home from a victory, waiting outside the city for
     * the vote that lets him enter it in triumph.
     */
    basis: z.enum(["prorogued", "awaiting_successor", "legate", "triumph"]),
    /** Who is coming to take the army over (`awaiting_successor`). */
    successorCharacterId: EntityIdSchema.nullable().default(null),
    /** Whom he serves under (`legate`). */
    superiorCharacterId: EntityIdSchema.nullable().default(null),
    /** The vote that extended it (`prorogued`). */
    procedureId: EntityIdSchema.nullable().default(null),
    /** Where a legate last stood with the army: gone from it, he has left its service. */
    atProvinceId: EntityIdSchema.nullable().default(null),
    sinceStep: ElapsedStepSchema,
    /** The day it runs out: a prorogation's year, a successor's arrival. Null runs until something ends it. */
    untilStep: ElapsedStepSchema.nullable().default(null),
    status: z.enum(["active", "ended"]).default("active"),
    endedAtStep: ElapsedStepSchema.nullable().default(null),
    endedHow: z.string().trim().max(240).nullable().default(null),
  })
  .strict();
export type CommandHold = z.infer<typeof CommandHoldSchema>;

/**
 * What a man will have to answer for when his office no longer protects him:
 * a battle lost, a fleet sunk, an act beyond his powers. Read when his command
 * ends (`sim/command-tenure.ts`), by whoever would like to see him tried --
 * Claudius Pulcher lost ninety-three ships at Drepana and was fined a thousand
 * asses for each the year after.
 */
export const AnswerableSchema = z
  .object({
    characterId: EntityIdSchema,
    polityId: EntityIdSchema,
    kind: z.enum(["defeat", "breach"]),
    label: z.string().trim().min(1).max(240),
    atStep: ElapsedStepSchema,
    /** How heavily it weighs: a skirmish lost is 1, an army or a fleet lost is 5. */
    weight: z.number().int().min(1).max(10),
  })
  .strict();
export type Answerable = z.infer<typeof AnswerableSchema>;
