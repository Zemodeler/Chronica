import { z } from "zod";
import type { AnsweredDecision } from "@chronica/sim";

/**
 * The order as it was given, stored on its job (`turn_jobs.input`) so any
 * worker -- this process after a restart, or another -- can carry it out.
 *
 * Only what the player said and on whose behalf. Everything the burst reads
 * from the world is read again by the attempt that runs it: a stored copy of
 * the world would be a second, staler world.
 *
 * Versioned: a job written by one build is read by the next, and a shape this
 * build cannot read fails the job with a sentence rather than guessing.
 */
export const TURN_INPUT_VERSION = 1;

const AnsweredDecisionSchema = z.object({
  prompt: z.string(),
  label: z.string(),
  summary: z.string(),
  optionId: z.string().optional(),
  predecessorId: z.string().optional(),
});

const TurnInputSchema = z.object({
  v: z.literal(TURN_INPUT_VERSION),
  userId: z.string().min(1),
  playerId: z.string().min(1),
  characterId: z.string().min(1),
  /** Null to let time pass without an order. */
  orderText: z.string().nullable(),
  spanDays: z.number().int().positive().optional(),
  /** A further stretch of a turn cut off by its time limit. */
  continuation: z.boolean(),
  /** Which stretch of the order this is: 1 for the order itself. */
  leg: z.number().int().positive(),
  answeredDecision: AnsweredDecisionSchema.optional(),
  resolvesDecision: z.object({ id: z.string(), optionId: z.string() }).optional(),
  askedAs: z.string().optional(),
});

export type TurnInput = z.infer<typeof TurnInputSchema> & { readonly answeredDecision?: AnsweredDecision | undefined };

export function turnInput(input: Omit<TurnInput, "v">): TurnInput {
  // Undefined fields are dropped rather than stored as nulls the schema refuses.
  return JSON.parse(JSON.stringify({ v: TURN_INPUT_VERSION, ...input })) as TurnInput;
}

/** The stored input, or null when this build cannot read it. */
export function parseTurnInput(raw: unknown, version: number): TurnInput | null {
  if (version !== TURN_INPUT_VERSION) return null;
  const parsed = TurnInputSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
