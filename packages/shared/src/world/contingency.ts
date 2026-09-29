import { z } from "zod";
import { BasisPointsSchema, ElapsedStepSchema, EntityIdSchema, MoneyAmountSchema } from "../material-state";
import { WatchPredicateSchema } from "./watch";

/**
 * A plan laid against a day that has not come.
 *
 * *"Prepare a strategy called the Burning City: when the Carthaginians pass
 * through the first layer of walls, set it ablaze and lock the gates."*
 *
 * About a fifth of the orders in the play corpus are shaped like that. They
 * were recordable and inert: `generic_entity_create` could write the plan down
 * with its trigger and its action, and nothing in the engine would ever read
 * it. In practice the model had to notice the note next turn and choose to
 * spring it, which means the trap worked when the narrator remembered it. A
 * trap that only works when somebody remembers is not a trap.
 *
 * ## What took so long was not the trigger
 *
 * The trigger was easy and is borrowed whole: `WatchPredicate` is already a
 * closed, deterministic, free language for "when X happens", already evaluated
 * after every hop of every burst. The hard question was what a contingency is
 * allowed to *do* when it springs, and there were three answers:
 *
 * 1. It raises a fact and a pressure and leaves the killing to a battle
 *    somebody still has to fight. Safe, and the trap does not work.
 * 2. It applies a bounded effect the *engine* computes from what was actually
 *    prepared. The world says what was laid; the engine says what it did.
 * 3. It carries its own deltas. Most expressive, and it hands an author a way
 *    to pre-write six thousand basis points of casualties with no battle
 *    resolved -- arithmetic through the side door.
 *
 * This is (2), and (1) survives as `stand_to` for every conditional order whose
 * consequence is a decision rather than a bang. (3) is not built and should not
 * be: the moment a plan can carry deltas, every plan will.
 *
 * ## What it costs to lay one
 *
 * Money, up front, at the moment it is armed -- because that is what a trap is:
 * pitch and timber bought and put in place months before anyone walks into it.
 * The spend is the whole of what decides how badly it hurts, so a trap nobody
 * paid for is a trap that mostly makes noise, and there is no way to lay a
 * devastating one for nothing.
 */
export const ContingencyEffectSchema = z.enum([
  /**
   * The prepared thing happens: the ward is fired, the gates barred, the mine
   * collapsed, the dam cut. The engine works out what that costs the men caught
   * in it, from what was spent laying it and how many are standing there.
   */
  "spring_trap",
  /**
   * The alarm is raised and the ruler is handed the wheel, with the condition
   * met and a thread already open on it.
   *
   * This is the honest answer to every conditional whose consequence is a
   * judgment: "should Hadrumentum fall, write to the Senate", "should the
   * battle be won, offer the survivors service", "should they refuse, assault
   * the walls". None of those is an effect. All of them are the player's next
   * order, and what they were missing was not a mechanism but a prompt at the
   * right moment.
   */
  "stand_to",
]);
export type ContingencyEffect = z.infer<typeof ContingencyEffectSchema>;

export const ContingencyStatusSchema = z.enum(["armed", "sprung", "disarmed", "lapsed"]);
export type ContingencyStatus = z.infer<typeof ContingencyStatusSchema>;

export const ContingencySchema = z
  .object({
    id: EntityIdSchema,
    /** What the player called it. "The Burning City." Shown back, never parsed. */
    label: z.string().trim().min(1).max(200),
    /** Whose plan it is, and who answers for it afterwards. */
    ownerCharacterId: EntityIdSchema,
    /** The power whose men it is not laid for. Null for a man who answers to nobody. */
    ownerPolityId: EntityIdSchema.nullable().default(null),
    /** When it springs. The same language a watch is written in. */
    trigger: WatchPredicateSchema,
    effect: ContingencyEffectSchema,
    /** Where it is laid. A trap is a place before it is anything else. */
    provinceId: EntityIdSchema,
    /** The exact ground, where the plan is about ground: the ward, the pass, the ford. */
    positionId: EntityIdSchema.nullable().default(null),
    /**
     * Whom it is laid for. Null catches whoever walks into it, which is what an
     * untended trap does -- including, in principle, its owner's own men.
     */
    againstPolityId: EntityIdSchema.nullable().default(null),
    /** Pitch, timber, powder, men paid to be there. Taken when it is armed, not when it fires. */
    preparationSpend: MoneyAmountSchema.default(0),
    /**
     * Who falls on them after it springs, where anybody does.
     *
     * The second half of half these orders: the ward burns *and then* the
     * hidden cohorts come in from the flanks. What happens when they do is an
     * ordinary battle, resolved by the ordinary resolver, with the men inside
     * already burnt and broken.
     */
    ambushForceId: EntityIdSchema.nullable().default(null),
    /**
     * What its trigger read as on the day it was laid.
     *
     * A plan is armed in March and springs in August; the world it was armed
     * against is long gone by then, so it cannot be compared to. It keeps the
     * reading instead, and fires when the reading changes in the right
     * direction -- which is also what makes "a trap armed under men already
     * standing in it does not fire until they leave and come back" fall out of
     * the design rather than needing a rule.
     */
    armedReading: z.string().min(1).max(120).default("no"),
    armedAtStep: ElapsedStepSchema,
    /** A plan nobody springs goes stale: the timber rots, the men are moved. Null for one that waits forever. */
    expiresAtStep: ElapsedStepSchema.nullable().default(null),
    status: ContingencyStatusSchema.default("armed"),
    sprungAtStep: ElapsedStepSchema.nullable().default(null),
    /** What it actually did, in the engine's own figures, kept so the record can say. */
    tollBps: BasisPointsSchema.nullable().default(null),
    /**
     * What its owner said to do then, in their own words -- for a `stand_to`,
     * the order the moment is for. Handed back with the wheel, so "the thing
     * was waiting on has happened" says what the thing was for.
     */
    standingOrder: z.string().trim().min(1).max(400).nullable().optional(),
  })
  .strict();
export type Contingency = z.infer<typeof ContingencySchema>;

export const isContingencyArmed = (plan: Contingency): boolean => plan.status === "armed";

/**
 * What a trap may take, at the very most.
 *
 * Thirty-five per cent of the men standing in it, and their order with it. The
 * player who wrote the Burning City asked for "every troop stuck inside that
 * layer dies", and this is the honest answer to that: a third of them dead and
 * the rest broken and running is a catastrophe that decides a siege, and it is
 * still not annihilation, because an army is not a number in a box and men run
 * out of burning buildings.
 *
 * It is a ceiling and not a figure. A trap nobody spent anything on gets
 * nowhere near it.
 */
export const TRAP_MAX_TOLL_BPS = 3_500;

/** What the cheapest possible trap does: enough to be worth the writing, not enough to matter much. */
export const TRAP_MIN_TOLL_BPS = 300;

/**
 * What it costs to buy the ceiling.
 *
 * Deliberately a lot -- about a fifth of Rome's opening treasury -- because the
 * whole point is that a devastating trap is a season's work and a real expense,
 * not a sentence in an order. Below it the toll scales on the square root of
 * the spend, so the first coins buy the most.
 */
export const TRAP_SPEND_FOR_FULL_TOLL = 2_000;
