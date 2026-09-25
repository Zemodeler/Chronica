import { z } from "zod";
import { EntityIdSchema, MoneyAmountSchema } from "../material-state";

// Watch conditions (docs/04, docs/14).
//
// "Continue the campaign; wake me if Rome mobilises." These are pure rules, they
// cost nothing, and they are the main tool for keeping a long match from producing
// turns with nothing in them.
//
// The language is deliberately a closed union rather than free text. Three reasons,
// in order of how much they matter:
//
// 1. It must be free. A condition evaluated by a model would be charged for on
//    every step of every span, which is the most expensive shape in the whole
//    design (docs/06).
// 2. It must be deterministic. A replay has to stop at the same step *for the same
//    reason*, and a natural-language predicate re-interpreted later would not.
// 3. It must be honest about what it can see. Every predicate below reads
//    authoritative state the player's character could plausibly learn about, so a
//    watch cannot become a fog-of-war leak that wakes a player for something they
//    should not know.
//
// The web app renders these as a small form, never as a text box that silently
// fails to match. Growing the union is ordinary work in packages/sim.

/**
 * The arms, as a tuple, so a second language can be built over the same ones.
 *
 * A mechanic (`world/mechanic.ts`) reads the world by these arms and by more
 * of its own -- a province's order, a purse, a relation, a war. Those cannot
 * be added here: this union is a named `$def` inside the orchestrator's prompt,
 * and every arm added to it is paid for in the prompt's ceiling. So the arms
 * are exported and the wider union is assembled elsewhere; one evaluator
 * (`sim/watch.ts`) reads both.
 */
export const WATCH_ARMS = [
  /** An army arrives somewhere. The commonest watch, and the reason for the rest. */
  z
    .object({
      kind: z.literal("force_enters_province"),
      provinceId: EntityIdSchema,
      /** Only this polity's forces, or any foreign force when omitted. */
      polityId: EntityIdSchema.optional(),
    })
    .strict(),
  /** A place changes hands, whoever took it. */
  z.object({ kind: z.literal("province_control_changes"), provinceId: EntityIdSchema }).strict(),
  /**
   * An army reaches a named piece of ground *inside* a province: the ward
   * behind the outer wall, the pass, the ford, the siege line.
   *
   * A province is too coarse for the thing players actually write. "When the
   * Carthaginians are through the first wall, fire it" is not a condition about
   * north-western Sicily; the enemy has been in north-western Sicily for a
   * month. It is a condition about one position, which is why it could not be
   * expressed until positions could be occupied.
   */
  z
    .object({
      kind: z.literal("force_enters_position"),
      positionId: EntityIdSchema,
      /** Only this polity's forces, or any force not the watcher's when omitted. */
      polityId: EntityIdSchema.optional(),
    })
    .strict(),
  /**
   * A city changes hands. "Should Hadrumentum fall" is a sentence half the
   * orders in a campaign hang on, and a province changing hands is not the same
   * event -- a garrison can hold a city whose countryside has gone.
   */
  z.object({ kind: z.literal("settlement_control_changes"), settlementId: EntityIdSchema }).strict(),
  /**
   * "Rome mobilises": a polity's total fit headcount crosses a threshold.
   *
   * Headcount rather than a count of forces, so splitting an army into three does
   * not fire a watch and merging three does not silence one.
   */
  z
    .object({
      kind: z.literal("polity_strength_above"),
      polityId: EntityIdSchema,
      headcount: z.number().int().positive(),
    })
    .strict(),
  /** One of my own armies is being worn down. */
  z
    .object({
      kind: z.literal("force_strength_below"),
      forceId: EntityIdSchema,
      headcount: z.number().int().nonnegative(),
    })
    .strict(),
  /** The purse or the treasury will not last. */
  z
    .object({
      kind: z.literal("account_below"),
      accountId: EntityIdSchema,
      amount: MoneyAmountSchema,
    })
    .strict(),
  /** Pay is falling behind, before it becomes desertion. */
  z
    .object({
      kind: z.literal("arrears_reach"),
      obligationId: EntityIdSchema,
      periods: z.number().int().positive(),
    })
    .strict(),
  /** A named person dies. Succession, ransom and revenge all key off this. */
  z.object({ kind: z.literal("character_dies"), characterId: EntityIdSchema }).strict(),
  /** A named office falls vacant, or is filled. */
  z
    .object({
      kind: z.literal("office_vacant"),
      officeId: EntityIdSchema,
      vacant: z.boolean(),
    })
    .strict(),
] as const;

export const WatchPredicateSchema = z.discriminatedUnion("kind", [...WATCH_ARMS]).meta({
  // Named, so the orchestrator's schema states it once and points at it from
  // both places it is used -- the ruler's own watch and a contingency's
  // trigger -- instead of inlining the same two thousand characters twice.
  // Only this one is named, and by a word a model can read; the blanket
  // alternative (`reused: "ref"`) names everything `__schema0`.
  id: "WatchPredicate",
});
export type WatchPredicate = z.infer<typeof WatchPredicateSchema>;

export const WatchConditionSchema = z
  .object({
    id: EntityIdSchema,
    /** Plain language the player wrote, shown back to them. Never parsed. */
    label: z.string().trim().min(1).max(200),
    predicate: WatchPredicateSchema,
    /**
     * Whether firing disarms it.
     *
     * The default, because a condition that keeps firing turns the elastic clock
     * back into a per-step prompt -- the exact thing it exists to prevent.
     */
    once: z.boolean().default(true),
    /** False once it has fired and `once` is set. Kept, so the player can see why. */
    armed: z.boolean().default(true),
  })
  .strict();
export type WatchCondition = z.infer<typeof WatchConditionSchema>;

/**
 * At most eight per player, matching the order batch.
 *
 * Not an arbitrary number: it is the same bound docs/14 puts on directives, and for
 * the same reason. A player who wants to watch forty things is asking for a
 * per-step prompt by another route.
 */
export const WatchConditionListSchema = z.array(WatchConditionSchema).max(8);
