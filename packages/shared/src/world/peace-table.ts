import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema, MoneyAmountSchema } from "../material-state";
import type { DiplomaticMessage } from "./diplomacy";
import type { WorldState } from "./world-state";

/**
 * The peace table (docs/plans/a-living-world.md §8), after Hearts of Iron IV.
 *
 * Peace was a letter answered yes or no. Now a letter asking to discuss peace
 * ("peace_talks"), once accepted, seats the two sides at a table: each side's
 * war score is what it can ask for, every term has a price, and the sides
 * take turns -- the player's power by his hand, the other by rule
 * (`sim/src/peace-table.ts`). Sessions take the days envoys take, and the war
 * goes on between them, so a battle won mid-conference moves what can be
 * asked. A man who cannot speak for his power may still buy a negotiator.
 */

/** What may be asked at the table. Converted to treaty clauses and agreements when it is signed. */
export const PeaceTermSchema = z.discriminatedUnion("kind", [
  /** A province passes to the asking side. */
  z.object({ kind: z.literal("cede"), provinceId: EntityIdSchema }).strict(),
  /** A province the asking side's enemy occupies goes back to its owner. */
  z.object({ kind: z.literal("return"), provinceId: EntityIdSchema }).strict(),
  z.object({ kind: z.literal("indemnity"), amount: MoneyAmountSchema, periods: z.number().int().min(1).max(20) }).strict(),
  z.object({ kind: z.literal("hostage"), characterId: EntityIdSchema }).strict(),
  /** The other side gives itself up: only when it is beaten. */
  z.object({ kind: z.literal("submission") }).strict(),
  /** Yearly tribute: a tributary agreement. */
  z.object({ kind: z.literal("tribute") }).strict(),
  /** The other side gives up an alliance with this power. */
  z.object({ kind: z.literal("break_alliance"), withPolityId: EntityIdSchema }).strict(),
  /** The other side comes under the asking side's protection: a client. */
  z.object({ kind: z.literal("client") }).strict(),
  /** No army of the other side's within this province of the border. */
  z.object({ kind: z.literal("demilitarize"), provinceId: EntityIdSchema }).strict(),
  /** Trade opened on the asking side's terms. */
  z.object({ kind: z.literal("trade") }).strict(),
]);
export type PeaceTerm = z.infer<typeof PeaceTermSchema>;

export const PeaceSessionSchema = z
  .object({
    atStep: ElapsedStepSchema,
    /** Whose turn it was: the side that put these terms. */
    byPolityId: EntityIdSchema,
    terms: z.array(PeaceTermSchema).max(24),
    /** What they would cost the other side, by the table's prices, when put. */
    price: z.number().int().nonnegative(),
    answer: z.enum(["accepted", "countered", "refused", "walked_out"]).nullable().default(null),
    /** The other side's envoy, in his own words. */
    words: z.string().trim().max(400).nullable().default(null),
    /** Countered: the part of these terms the other side would sign, for the asker to take or leave. */
    counterTerms: z.array(PeaceTermSchema).max(24).optional(),
  })
  .strict();
export type PeaceSession = z.infer<typeof PeaceSessionSchema>;

export const PeaceBribeSchema = z
  .object({
    atStep: ElapsedStepSchema,
    byCharacterId: EntityIdSchema,
    toCharacterId: EntityIdSchema,
    amount: MoneyAmountSchema,
    /** Taken, and so the points it buys at the table; refused; or taken and found out. */
    outcome: z.enum(["taken", "refused", "found_out"]),
    /** Points it moves what the bribed side will bear. */
    points: z.number().int(),
  })
  .strict();
export type PeaceBribe = z.infer<typeof PeaceBribeSchema>;

export const PeaceTableSchema = z
  .object({
    id: EntityIdSchema,
    warId: EntityIdSchema,
    /** The two powers at the table. */
    sides: z.tuple([EntityIdSchema, EntityIdSchema]),
    openedAtStep: ElapsedStepSchema,
    /** The letter that seated them. */
    sourceMessageId: EntityIdSchema.nullable().default(null),
    status: z.enum(["open", "signed", "walked_out"]),
    sessions: z.array(PeaceSessionSchema).max(40).default([]),
    /** The day the next session can sit: envoys travel. */
    nextSessionStep: ElapsedStepSchema,
    bribes: z.array(PeaceBribeSchema).max(20).default([]),
    closedAtStep: ElapsedStepSchema.nullable().default(null),
  })
  .strict();
export type PeaceTable = z.infer<typeof PeaceTableSchema>;

/** Seats two powers at a table, from the accepted letter. Nothing if one is already open between them. */
export function openPeaceTable(world: WorldState, message: DiplomaticMessage, atStep: number): WorldState {
  const war = world.polityAgreements.find((agreement) => agreement.status === "active" && agreement.kind === "war"
    && [agreement.polityId, agreement.otherPolityId].includes(message.fromPolityId) && [agreement.polityId, agreement.otherPolityId].includes(message.toPolityId));
  if (war === undefined) return world;
  if (world.peaceTables.some((table) => table.status === "open" && table.warId === war.id)) return world;
  const table: PeaceTable = {
    id: `table-${war.id}-${atStep}`.slice(0, 120),
    warId: war.id,
    sides: [message.fromPolityId, message.toPolityId],
    openedAtStep: atStep,
    sourceMessageId: message.id,
    status: "open",
    sessions: [],
    nextSessionStep: atStep,
    bribes: [],
    closedAtStep: null,
  };
  return { ...world, peaceTables: [...world.peaceTables, table].slice(-40) };
}

