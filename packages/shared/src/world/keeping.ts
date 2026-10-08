import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema } from "../material-state";

/**
 * What a state spends to go on being a state (docs/economy.md, "Where the money goes").
 *
 * A treasury that took in the whole of the land's yield and paid out only its armies and its offices grew without end: nothing in the
 * world spent a peace's surplus. Three sinks now stand against it, and this is what they remember between months:
 *
 *  - the **upkeep** of what the power holds (roads, walls, harbours, granaries, aqueducts, temples), paid each month;
 *  - the **costs of the state** (the clerks and criers of the magistrates, the public slaves, the house of the council, the games and the
 *    rites, the lodging and the gifts of embassies, a king's court), paid each month;
 *  - its **public works**, let to contractors when the chest has cover above a reserve.
 *
 * One row a power for the first two (`StateKeeping`) and one row a work in hand (`PublicWorkContract`), so the whole is a few hundred
 * rows however long the world runs. Both are absent in a world that has never been through the pass, which reads them as empty.
 */

export const WORK_KINDS = ["road", "aqueduct", "temple", "walls", "harbour", "granary", "forum"] as const;
export const WorkKindSchema = z.enum(WORK_KINDS);
export type WorkKind = z.infer<typeof WorkKindSchema>;

export const StateKeepingSchema = z
  .object({
    polityId: EntityIdSchema,
    /** The day its month was last settled. */
    settledAtStep: ElapsedStepSchema,
    /** Months running in which the upkeep was mostly not paid: neglect is counted here, and read as a fall of the ceiling of development (`neglectShiftBps`). */
    behindMonths: z.number().int().min(0).max(240).default(0),
    /** What last month's upkeep and costs came to, and how much of the upkeep was paid (basis points), for the page and the tests. */
    upkeepDue: z.number().int().nonnegative().default(0),
    costsDue: z.number().int().nonnegative().default(0),
    upkeepPaidBps: z.number().int().min(0).max(10_000).default(10_000),
    /** The year works were last counted in (day / 360), and how many were begun in it. */
    worksYear: z.number().int().default(-1),
    worksBegun: z.number().int().nonnegative().default(0),
    /** The day it last began a work. */
    lastWorkStep: ElapsedStepSchema.nullable().default(null),
    /** The day it was last told of neglect, and the day a wall last slipped. */
    toldNeglectAtStep: ElapsedStepSchema.nullable().default(null),
    slippedAtStep: ElapsedStepSchema.nullable().default(null),
  })
  .strict();
export type StateKeeping = z.infer<typeof StateKeepingSchema>;

/** A work let to contractors, paid by instalments while it is built. */
export const PublicWorkContractSchema = z
  .object({
    /** The work's own id: `works:<kind>:<n>`; the structure it raises carries it as its provenance. */
    projectId: EntityIdSchema,
    polityId: EntityIdSchema,
    name: z.string().trim().min(1).max(160),
    kind: WorkKindSchema,
    provinceId: EntityIdSchema,
    /** The merchant house that took the contract; null where no house stands in the power (the work is paid to the men nobody names). */
    houseId: EntityIdSchema.nullable().default(null),
    /** What the treasury pays in all (the cost and the contractor's gain), and what the work costs to do. */
    price: z.number().int().positive(),
    cost: z.number().int().positive(),
    /** Instalments, one a month from the day it was let. */
    instalments: z.number().int().positive().max(48),
    letAtStep: ElapsedStepSchema,
    /** The day it will stand. */
    completesAtStep: ElapsedStepSchema,
    /** How much of the price the treasury has paid, and how much of the cost the contractor has spent. */
    paid: z.number().int().nonnegative().default(0),
    spent: z.number().int().nonnegative().default(0),
    /** The work stands; only the last instalments are owed. */
    built: z.boolean().default(false),
  })
  .strict();
export type PublicWorkContract = z.infer<typeof PublicWorkContractSchema>;

export const MAX_KEEPING_ROWS = 400;
export const MAX_WORK_CONTRACTS = 80;

/** Months of unpaid upkeep before neglect begins to tell on the land. */
export const NEGLECT_BEGINS_AFTER_MONTHS = 6;
/** How much of the ceiling of development each further month of neglect takes, and the most it takes (basis points). */
export const NEGLECT_PER_MONTH_BPS = 25;
export const NEGLECT_MAX_BPS = 600;

/**
 * How far the ceiling a province can build to is lowered where its power has let the upkeep lapse (basis points, 0 or less): nothing for
 * the first half-year, then a quarter of a point a month, never more than six points. It is a ceiling and not a blow: a province above it
 * sinks toward it a little each month (`ABOVE_CEILING_FALL_BPS`), and builds again the moment the upkeep is paid.
 */
export function neglectShiftBps(behindMonths: number): number {
  if (behindMonths <= NEGLECT_BEGINS_AFTER_MONTHS) return 0;
  return -Math.min(NEGLECT_MAX_BPS, (behindMonths - NEGLECT_BEGINS_AFTER_MONTHS) * NEGLECT_PER_MONTH_BPS);
}
