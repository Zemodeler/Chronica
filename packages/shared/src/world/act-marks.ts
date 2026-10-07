import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema } from "../material-state";
import { ActKindSchema, ACT_WINDOW_DAYS, type ActKind } from "../authority/charge-vocabulary";

/**
 * Who last decided an act, and when: the memory behind "one decider to a season" (docs/plans/government.md, "H0 as built").
 *
 * Two consuls of equal power may each set the tribute, and the state would have two rates a week. So when
 * one of them has settled an act, the other may not settle it again until the season (`ACT_WINDOW_DAYS`) is out,
 * unless he outranks the first or the chamber itself decrees otherwise. One row a power and act, replaced by
 * the next decision, so the whole is a few hundred rows however long the world runs. It is not a ledger: the
 * money audit and the news are the ledger.
 *
 * Spending keeps a row a power and *office*, with the sum drawn in the year (`total`), for the allowance.
 */
export const ActMarkSchema = z
  .object({
    polityId: EntityIdSchema,
    act: ActKindSchema,
    /** The office the row is kept for: only spending, where each office has its own allowance. */
    officeId: EntityIdSchema.nullable().default(null),
    /** The man who decided it; null where the chamber decreed it. */
    byCharacterId: EntityIdSchema.nullable(),
    /** The office he held when he did, for who outranks whom. */
    byOfficeId: EntityIdSchema.nullable().default(null),
    atStep: ElapsedStepSchema,
    /** The day the sum in `total` began to be counted: a year of spending is counted from the first draw. */
    sinceStep: ElapsedStepSchema,
    /** What has been drawn since `sinceStep`, for spending; zero for the rest. */
    total: z.number().int().nonnegative().default(0),
  })
  .strict();
export type ActMark = z.infer<typeof ActMarkSchema>;

/** No world keeps more rows than this: a power's twelve acts, over a few dozen powers, and some offices' spending. */
export const MAX_ACT_MARKS = 900;
/** A year of spending is counted from the first draw, and begins again once it is out. */
export const SPENDING_YEAR_DAYS = 360;

const keyOf = (mark: Pick<ActMark, "polityId" | "act" | "officeId">): string => `${mark.polityId}|${mark.act}|${mark.act === "spending" ? mark.officeId ?? "" : ""}`;

/** The row for an act of a power (and, for spending, of an office), or undefined. */
export function actMarkOf(marks: readonly ActMark[], polityId: string, act: ActKind, officeId: string | null = null): ActMark | undefined {
  const key = keyOf({ polityId, act, officeId });
  return marks.find((mark) => keyOf(mark) === key);
}

/** Whether the season of a decision is still running at `now`. */
export function actWindowOpen(mark: Pick<ActMark, "act" | "atStep">, now: number): boolean {
  return ACT_WINDOW_DAYS[mark.act] > 0 && now - mark.atStep < ACT_WINDOW_DAYS[mark.act];
}

/** The marks with this one written over the one it replaces; the oldest go first once the cap is reached. */
export function withActMark(marks: readonly ActMark[], mark: ActMark): ActMark[] {
  const key = keyOf(mark);
  const kept = marks.filter((candidate) => keyOf(candidate) !== key);
  const next = [...kept, mark];
  return next.length <= MAX_ACT_MARKS ? next : next.sort((a, b) => b.atStep - a.atStep).slice(0, MAX_ACT_MARKS);
}
