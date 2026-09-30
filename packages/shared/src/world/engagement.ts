import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema } from "../material-state";

/**
 * A fight that has begun and not yet been decided (docs/plans/battles-that-last.md).
 *
 * Armies of the period did not meet and settle it in an afternoon, most of the
 * time. They camped in sight of each other, offered battle, refused it,
 * skirmished over water and fodder for days -- Ilipa, Fabius's summer, the days
 * before Cannae -- and then, on one day, fought the battle that decided it. A
 * battle used to be one exchange resolved the instant it was ordered. It is
 * now this: opened by an order, fought a round a day, and ended only when one
 * side is beaten, gone, or has called it off.
 *
 * The sides are forces, not powers: an army ordered in joins, an army that
 * marches away leaves, and the engagement ends when one side has nobody left
 * on the field.
 */

export const EngagementEndSchema = z.enum([
  /** One side broke, or was driven off the field in a pitched battle. */
  "decided",
  /** The weaker side fell back without orders before it could be caught (the one-in-three rule). */
  "withdrew",
  /** The side that attacked was put on hold, and the fight went out of it. */
  "broken_off",
  /** Nobody was left on one side: marched away, disbanded, or dead. */
  "left_the_field",
]);
export type EngagementEnd = z.infer<typeof EngagementEndSchema>;

/** The moments in a fight that are put to the player (docs/plans/battles-that-last.md, decision 11). */
export const TurningPointKindSchema = z.enum([
  /** Battle is offered to his army, and it could refuse. */
  "battle_offered",
  /** His side came out of a day of battle with its spirit failing. */
  "wavering",
  /** The man commanding his side was killed or taken. */
  "commander_lost",
  /** Another enemy army has come onto the field. */
  "reinforced",
  /** His penned army has eaten what it carried. */
  "hungry",
  /** An army of his stands by on the same ground while its own side fights. */
  "ally_fighting",
]);

/**
 * How one side means to force the issue, or get away (`force_engage.manoeuvre`).
 * Tried on the next round; provoking goes on every day until another order.
 */
export const ManoeuvreKindSchema = z.enum(["storm_camp", "night_attack", "provoke", "lure", "withdraw_by_night"]);
export type ManoeuvreKind = z.infer<typeof ManoeuvreKindSchema>;
export type TurningPointKind = z.infer<typeof TurningPointKindSchema>;

export const EngagementSchema = z
  .object({
    id: EntityIdSchema,
    provinceId: EntityIdSchema,
    /** The armies on each side today. Rewritten each round from who is still on the field. */
    attackerForceIds: z.array(EntityIdSchema).min(1).max(16),
    defenderForceIds: z.array(EntityIdSchema).min(1).max(16),
    /** The army whose order began it. */
    openedByForceId: EntityIdSchema,
    openedAtStep: ElapsedStepSchema,
    /** The last day a round was fought: the tick fights every day after it, up to today. */
    lastRoundStep: ElapsedStepSchema,
    /**
     * What the attacker was ordered to do: bring the enemy to battle, or only
     * harass him -- skirmish, cut up his foragers, keep him penned (the Fabian
     * way, and what `force_engage` means by any posture short of offering battle).
     */
    seeking: z.enum(["battle", "harass"]),
    rounds: z.number().int().nonnegative().default(0),
    /** Of them, the days a pitched battle was fought. */
    pitchedRounds: z.number().int().nonnegative().default(0),
    /**
     * "facing": enemy armies on the same ground with no order to fight given,
     * remembered so the day it began is known; "open": fighting; "ended".
     */
    status: z.enum(["facing", "open", "ended"]),
    /**
     * A moment the player's decision could change, waiting on his answer: the
     * fight on his side stands still until he gives it (phase 3). The rest of
     * the world goes on.
     */
    awaiting: z.object({
      kind: TurningPointKindSchema,
      side: z.enum(["attacker", "defender"]),
      askedAtStep: ElapsedStepSchema,
    }).strict().nullable().default(null),
    manoeuvre: z.object({
      kind: ManoeuvreKindSchema,
      side: z.enum(["attacker", "defender"]),
      byForceId: EntityIdSchema,
    }).strict().nullable().default(null),
    /** What the player last told his side to do when battle is offered: come out, or keep to the camp. */
    playerStance: z.enum(["fight", "refuse"]).nullable().default(null),
    /** Turning points already put to him, so each is asked once ("wavering@41" once a day). */
    asked: z.array(z.string().max(60)).max(40).default([]),
    /** Every army that has stood on either side, so a new one arriving is news. */
    seenForceIds: z.array(EntityIdSchema).max(32).default([]),
    winner: z.enum(["attacker", "defender"]).nullable().default(null),
    endedBy: EngagementEndSchema.nullable().default(null),
    endedAtStep: ElapsedStepSchema.nullable().default(null),
  })
  .strict();
export type Engagement = z.infer<typeof EngagementSchema>;

export const isOpenEngagement = (engagement: Engagement): boolean => engagement.status === "open";

/** The open engagement a force is fighting in, if any. */
export function engagementOf(engagements: readonly Engagement[], forceId: string): Engagement | undefined {
  return engagements.find((engagement) => isOpenEngagement(engagement)
    && (engagement.attackerForceIds.includes(forceId) || engagement.defenderForceIds.includes(forceId)));
}

/**
 * Bread on the road to an army (`force_provision` with "convoy"). It arrives
 * when the road says it does, unless an enemy on the way -- above all the one
 * penning the army in -- takes it first.
 */
export const ConvoySchema = z
  .object({
    id: EntityIdSchema,
    forceId: EntityIdSchema,
    polityId: EntityIdSchema,
    fromProvinceId: EntityIdSchema,
    toProvinceId: EntityIdSchema,
    /** Days of bread it carries for the army it is sent to. */
    days: z.number().int().min(1).max(120),
    /** Men it can feed for those days: the army's strength the day it was sent. */
    men: z.number().int().nonnegative(),
    sentAtStep: ElapsedStepSchema,
    arrivesAtStep: ElapsedStepSchema,
    status: z.enum(["on_the_road", "delivered", "taken", "lost"]),
  })
  .strict();
export type Convoy = z.infer<typeof ConvoySchema>;

/**
 * An enemy fleet sitting off a port (`sim/blockades.ts`). Kept so it has a
 * beginning and an end, and a tightness: a few ships watch a harbour, a fleet
 * seals it.
 */
export const BlockadeSchema = z
  .object({
    id: EntityIdSchema,
    provinceId: EntityIdSchema,
    blockadedPolityId: EntityIdSchema,
    blockaderPolityId: EntityIdSchema,
    fleetIds: z.array(EntityIdSchema).min(1).max(12),
    sinceStep: ElapsedStepSchema,
    /** 0-10 000: how nearly shut the port is, from the hulls on station. */
    tightnessBps: z.number().int().min(0).max(10_000),
    status: z.enum(["active", "ended"]),
    endedAtStep: ElapsedStepSchema.nullable().default(null),
  })
  .strict();
export type Blockade = z.infer<typeof BlockadeSchema>;
