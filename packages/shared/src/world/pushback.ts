import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema } from "../material-state";

/**
 * The world pushes back (docs/plans/a-living-world.md §5).
 *
 * Rome swallowed ten peoples in six months of the soldier's run and nobody
 * blinked. A power that grows fast and roughly frightens the powers around it,
 * and frightened powers league together, pay its enemies, and strike when its
 * armies are away. `alarm` is that fear, one power's toward another, rising
 * with conquest, absorption, wars begun and treaties broken, and fading over
 * years; `holdings` is the monthly record of each power's land it is read
 * from. The difficulty chosen when the game was made scales it, and the
 * player's own advantages, and nothing else.
 */

export const AlarmSchema = z
  .object({
    polityId: EntityIdSchema,
    towardPolityId: EntityIdSchema,
    /** 0 to 100: unease at 25, fear at 50, a power that will league against it at the coalition bar. */
    level: z.number().int().min(0).max(100),
    /** What raised it last, in a few words. */
    why: z.string().trim().min(1).max(240),
    updatedAtStep: ElapsedStepSchema,
  })
  .strict();
export type Alarm = z.infer<typeof AlarmSchema>;

/** A power's land on the first of a month: what its growth is measured against. */
export const HoldingsSchema = z
  .object({
    polityId: EntityIdSchema,
    atStep: ElapsedStepSchema,
    provinces: z.number().int().nonnegative(),
  })
  .strict();
export type Holdings = z.infer<typeof HoldingsSchema>;

export const DifficultySchema = z.enum(["gentle", "normal", "hard", "merciless"]);
export type Difficulty = z.infer<typeof DifficultySchema>;

export interface DifficultyRules {
  /** How much alarm a power's growth raises, against the normal. */
  readonly alarmGain: number;
  /** Alarm at which neighbours league against the player's power. */
  readonly coalitionAt: number;
  /** Points added to every power's appetite for war against the player's power. */
  readonly appetiteAgainstPlayer: number;
  /** Of the cast's open seats, how many go first to people hostile to the player. */
  readonly hostileSeats: number;
  /** The player's purse at the start, against the scenario's. */
  readonly purseShare: number;
  /** Standing the player starts with, added (basis points). */
  readonly standingBps: number;
  /** An edge in the player's own battles and plots (basis points on the odds). */
  readonly playerEdgeBps: number;
}

export const DIFFICULTY_RULES: Readonly<Record<Difficulty, DifficultyRules>> = {
  gentle: { alarmGain: 0.5, coalitionAt: 75, appetiteAgainstPlayer: -10, hostileSeats: 0, purseShare: 1.5, standingBps: 500, playerEdgeBps: 1_000 },
  normal: { alarmGain: 1, coalitionAt: 60, appetiteAgainstPlayer: 0, hostileSeats: 1, purseShare: 1, standingBps: 0, playerEdgeBps: 0 },
  hard: { alarmGain: 1.5, coalitionAt: 50, appetiteAgainstPlayer: 10, hostileSeats: 2, purseShare: 0.75, standingBps: 0, playerEdgeBps: -500 },
  merciless: { alarmGain: 2, coalitionAt: 40, appetiteAgainstPlayer: 20, hostileSeats: 3, purseShare: 0.5, standingBps: -500, playerEdgeBps: -1_000 },
};

export const difficultyRules = (difficulty: Difficulty | undefined): DifficultyRules => DIFFICULTY_RULES[difficulty ?? "normal"];
