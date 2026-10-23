import { z } from "zod";

/**
 * The vocabulary of an office's charge (docs/plans/government.md, "H0 as built").
 *
 * Kept in a file of its own, importing nothing but zod, because the office record (`characters/character.ts`)
 * carries a charge and `competence.ts` reads offices: neither may import the other.
 *
 * An act is one of the things a state does with money, goods and treaties that more than one man may think
 * is his to decide. Who may decide each is not written anywhere as a list of names: it is read from the
 * parts of the constitution (`competence.ts`), and an office's `charge` is the data a form's template (or
 * a scenario) adds to say what the form does differently from the common run.
 */
export const ACT_KINDS = [
  "tax_rate",
  "customs",
  "coinage",
  "loans",
  "grain",
  "pacts",
  "embargoes",
  "levy",
  "war",
  "peace",
  "appointment",
  "spending",
] as const;
export const ActKindSchema = z.enum(ACT_KINDS);
export type ActKind = z.infer<typeof ActKindSchema>;

/**
 * How an office stands towards an act.
 *
 * - `alone`: within his charge; he decides, and answers for it at the close of his office.
 * - `with_colleague`: collegial. Either of the two may act; the other may stop it (*par potestas*, *intercessio*).
 * - `by_the_body`: it must be laid before the chamber that holds that power; he may move it, and may not do it.
 * - `forbidden`: it is not his to do, or to move. Somebody else decides it.
 */
export const CompetenceGradeSchema = z.enum(["alone", "with_colleague", "by_the_body", "forbidden"]);
export type CompetenceGrade = z.infer<typeof CompetenceGradeSchema>;

/**
 * One line of an office's charge: how it stands towards the act, and how far its own competence goes.
 *
 * `within` is the most he may do on the grade given, in the act's own unit (`WITHIN_UNIT`); a larger figure
 * becomes `beyond` (the chamber's, by default). Absent, there is no figure to stay within.
 */
export const ChargeRuleSchema = z
  .object({
    grade: CompetenceGradeSchema,
    within: z.number().int().nonnegative().optional(),
    beyond: z.enum(["by_the_body", "forbidden"]).optional(),
  })
  .strict();
export type ChargeRule = z.infer<typeof ChargeRuleSchema>;

/** An office's charge: a line for each act it says something particular about. Acts it says nothing of are read from the constitution. */
export const ChargeSchema = z.partialRecord(ActKindSchema, ChargeRuleSchema);
export type Charge = z.infer<typeof ChargeSchema>;

/** What `within` counts, per act. */
export const WITHIN_UNIT: Readonly<Record<ActKind, string>> = {
  tax_rate: "the rate, in basis points of the yield",
  customs: "the tariff, in basis points of the goods' value",
  coinage: "the change to the coin's silver, in basis points",
  loans: "the sum borrowed, in months of what the power takes in",
  grain: "the sum spent on bread, in months of what the power takes in",
  pacts: "no figure",
  embargoes: "no figure",
  levy: "no figure",
  war: "no figure",
  peace: "no figure",
  appointment: "no figure",
  spending: "the sum drawn in a year, in months of what the power takes in",
};

/** How an act is called after "may", in the words of the age. */
export const ACT_WORDS: Readonly<Record<ActKind, string>> = {
  tax_rate: "lay the rate of the tribute",
  customs: "set the customs on foreign goods",
  coinage: "have the coin struck with other silver",
  loans: "borrow in the state's name",
  grain: "buy bread and give it out",
  pacts: "make a pact or an alliance",
  embargoes: "close the markets to a power",
  levy: "hold the levy",
  war: "make war",
  peace: "make peace",
  appointment: "name men to office",
  spending: "draw upon the treasury",
};

/** Days one decision on an act stands before another may be made on it by another hand: one decider to a season. */
export const ACT_WINDOW_DAYS: Readonly<Record<ActKind, number>> = {
  tax_rate: 90,
  customs: 60,
  coinage: 60,
  loans: 30,
  grain: 30,
  pacts: 30,
  embargoes: 30,
  levy: 30,
  war: 0,
  peace: 0,
  appointment: 0,
  spending: 0,
};
