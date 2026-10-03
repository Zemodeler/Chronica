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
  /**
   * The world pushing back on the player as a person, not only on his power
   * (play-test L11): of the world's stirrings each season, the share that
   * befall him and his house (`narrator.ts`) ...
   */
  readonly personalSeedShare: number;
  /** ... the weight of what a private man has to answer for at which he is prosecuted (`personal-pushback.ts`) ... */
  readonly prosecuteAt: number;
  /** ... and the twelfths a month that a man who hates him moves against him by plot (`villainy.ts`). */
  readonly plotAgainstPlayerTwelfths: number;
  /** Whether an accusation the narrator lays on him is brought before a court in earnest. */
  readonly accusationsInEarnest: boolean;
}

export const DIFFICULTY_RULES: Readonly<Record<Difficulty, DifficultyRules>> = {
  gentle: { alarmGain: 0.5, coalitionAt: 75, appetiteAgainstPlayer: -10, hostileSeats: 0, purseShare: 1.5, standingBps: 500, playerEdgeBps: 1_000, personalSeedShare: 0.2, prosecuteAt: 6, plotAgainstPlayerTwelfths: 0, accusationsInEarnest: false },
  normal: { alarmGain: 1, coalitionAt: 60, appetiteAgainstPlayer: 0, hostileSeats: 1, purseShare: 1, standingBps: 0, playerEdgeBps: 0, personalSeedShare: 1 / 3, prosecuteAt: 3, plotAgainstPlayerTwelfths: 1, accusationsInEarnest: false },
  hard: { alarmGain: 1.5, coalitionAt: 50, appetiteAgainstPlayer: 10, hostileSeats: 2, purseShare: 0.75, standingBps: 0, playerEdgeBps: -500, personalSeedShare: 0.5, prosecuteAt: 2, plotAgainstPlayerTwelfths: 2, accusationsInEarnest: true },
  merciless: { alarmGain: 2, coalitionAt: 40, appetiteAgainstPlayer: 20, hostileSeats: 3, purseShare: 0.5, standingBps: -500, playerEdgeBps: -1_000, personalSeedShare: 0.6, prosecuteAt: 1, plotAgainstPlayerTwelfths: 3, accusationsInEarnest: true },
};

export const difficultyRules = (difficulty: Difficulty | undefined): DifficultyRules => DIFFICULTY_RULES[difficulty ?? "normal"];
