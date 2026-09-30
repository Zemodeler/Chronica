import { z } from "zod";
import { BasisPointsSchema, ElapsedStepSchema, EntityIdSchema, MoneyAmountSchema } from "../material-state";

/**
 * Something laid against a person in secret, and how it is going.
 *
 * The order this exists for is the oldest one in the genre: *"Claudius would
 * use the budget from the Senate to hire an experienced assassin to kill
 * Fabius, without ever revealing his identity."* The engine had no answer to
 * it. Nothing in the vocabulary could kill a man, by design -- death runs
 * through `mortality.ts` so that nobody is killed off without it having been
 * made a thing of first -- and the nearest thing available, dropping the
 * target's health and tagging him `"dead"`, produced a man at no health, marked
 * dead, and alive, still commanding his army. That is the engine failing an
 * order, which it may not do.
 *
 * So a plot is a real, durable object with four properties the design turns on:
 *
 * **It is always allowed to be laid.** Hiring a killer is a thing a person can
 * do. Whether it works is a different question from whether it may be tried.
 *
 * **The odds are the engine's.** Computed once, at the moment it is laid, from
 * the state of the world: who is paying, how much, how good they are at this,
 * how guarded the mark is, and whether he has already been warned. A model
 * allowed to decide whether its own plot succeeded would succeed whenever the
 * story wanted it to, which is the one way this stops being a simulation. The
 * same bargain as `force_engage`: the world proposes, the engine resolves.
 *
 * **It takes time, and is visible while it takes it.** A plot laid today
 * resolves on a day the world chose within bounds the engine sets, and puts
 * developments into its own thread while it waits. That is what makes it
 * several chronicles rather than one line: the mark can be warned, the plot can
 * be found, and the man who ordered it lives with it standing open.
 *
 * **It can end four ways**, and only one of them is a death. Most attempts on
 * a life failed, and a good many of the ones that did not still left the mark
 * alive and short of an eye.
 */
/**
 * `espionage` is the one that hurts nobody: a spy set on a man, whose success
 * is a report -- what the man knows and hides, what he means to do, what he
 * commands and holds, and who he trusts -- and whose failure is a spy caught.
 */
export const CovertPlotKindSchema = z.enum(["assassination", "abduction", "sabotage", "poison", "espionage"]);
export type CovertPlotKind = z.infer<typeof CovertPlotKindSchema>;

/**
 * How it ended.
 *
 * `nothing` is the commonest and the least interesting: the man was not
 * reached, and nobody ever knew anybody had tried. `discovered` is the one
 * that starts a war inside a government.
 */
export const CovertPlotOutcomeSchema = z.enum(["nothing", "discovered", "maimed", "killed", "learned"]);
export type CovertPlotOutcome = z.infer<typeof CovertPlotOutcomeSchema>;

export const CovertPlotSchema = z
  .object({
    id: EntityIdSchema,
    kind: CovertPlotKindSchema,
    targetCharacterId: EntityIdSchema,
    /** Who wanted it done. Not necessarily anybody who will ever be named for it. */
    sponsorCharacterId: EntityIdSchema,
    /** Whose hand it is, where the world named one. */
    agentCharacterId: EntityIdSchema.nullable().default(null),
    /** What was paid for it. Money buys a better hand, and only up to a point. */
    spend: MoneyAmountSchema.default(0),
    /** Whose money it was: the sponsor's own purse, or a treasury. Shown to the sponsor, so no purse is spent unseen (R73). */
    fundingAccountId: EntityIdSchema.nullable().optional(),
    /** What the world is meant to believe if it goes wrong -- whom the blame falls on. */
    cover: z.string().trim().min(1).max(300),
    /** The engine's own figure, settled when the plot was laid and never rewritten. */
    successOddsBps: BasisPointsSchema,
    /** How well hidden it is, which decides whether a failure is ever traced back. */
    secrecyBps: BasisPointsSchema,
    openedAtStep: ElapsedStepSchema,
    /** The day it comes to a head. The world's pacing, inside the engine's bounds. */
    resolvesAtStep: ElapsedStepSchema,
    /** The thread it runs in, so the player reads it happening rather than only having happened. */
    storylineId: EntityIdSchema.nullable().default(null),
    /** Set once, when it resolves. */
    outcome: CovertPlotOutcomeSchema.nullable().default(null),
    resolvedAtStep: ElapsedStepSchema.nullable().default(null),
    /**
     * Whether the halfway development has already happened, so it happens once.
     * Distinct from `targetWarned`, which is about the mark rather than about
     * the bookkeeping: a plot that stirs quietly has stirred and has not warned
     * anybody, and conflating the two told the mark about every plot ever laid.
     */
    stirred: z.boolean().default(false),
    /** Whether the target has come to know somebody is at him. A warned man is a harder one. */
    targetWarned: z.boolean().default(false),
  })
  .strict();
export type CovertPlot = z.infer<typeof CovertPlotSchema>;

/** Still to come to a head. */
export const isPlotOpen = (plot: CovertPlot): boolean => plot.outcome === null;

/**
 * The floor and ceiling on how long a plot may take to come off.
 *
 * The world says how long it thinks it will take -- an assassin has to be
 * found, and got near, and left alone with him -- and the engine holds that
 * between three weeks and a year. Below the floor a plot is a murder in the
 * street with no plot to it; above the ceiling nobody is still watching.
 */
export const PLOT_MIN_DAYS = 21;
export const PLOT_MAX_DAYS = 365;

/** Never certain, and never impossible: the two things an attempt on a life is not. */
export const PLOT_MIN_ODDS_BPS = 200;
export const PLOT_MAX_ODDS_BPS = 6_000;
