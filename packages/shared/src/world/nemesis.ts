import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema } from "../material-state";

/**
 * The one person in the world who is *about* the ruler.
 *
 * A world of evenly-weighted rivals is a world with no antagonist in it. The
 * attention router is fair by design -- it wakes whoever the facts happen to
 * touch -- so the man who has been quietly working against the ruler for two
 * years gets a turn only when he happens to score high enough that week, and
 * a reign reads as a sequence of unrelated difficulties rather than as a
 * struggle with somebody.
 *
 * This is the exception, and the only one: a single named person who is
 * guaranteed a hearing every round, whose campaign is a thread the world
 * follows, and whose relation to the ruler is a *stance* rather than a flag.
 *
 * What is deliberately not here: what he does, what he wants in words, what he
 * has already done. All of that is the storyline's -- `storylineId` points at
 * it -- because the engine already knows how to carry a thread with a phase,
 * stakes, a history and a next development, and a second copy of that would
 * drift from the first. Code owns who and whether; the world owns the story.
 */

/** Where the quarrel is fought. Chosen from what the man actually holds, never at random. */
export const NemesisArenaSchema = z.enum([
  /** Office, councils, votes, prosecutions. */
  "political",
  /** An army, and what an army lets a man do. */
  "military",
  /** Blood: the succession, the marriage, the ruler's own house. */
  "dynastic",
  /** Ground: a province far enough from the centre to be held against it. */
  "separatist",
  /** A commander of another power whose war is with this ruler in particular. */
  "foreign",
]);
export type NemesisArena = z.infer<typeof NemesisArenaSchema>;

/**
 * Whether their interests currently run with the ruler's or against them.
 *
 * Derived every burst from the world rather than stored, because it is a fact
 * about the situation and not about the man: a rival who wants the ruler's
 * office still wants the country to survive the war he is being invaded in.
 * An antagonist who cannot ever be on your side is a villain, and a villain is
 * a worse thing to play against than a rival.
 */
export const NemesisStanceSchema = z.enum(["opposed", "converged", "dormant"]);
export type NemesisStance = z.infer<typeof NemesisStanceSchema>;

/**
 * How he fights, which is a fact about the man and not about the quarrel.
 *
 * Two rivals who want the same office are not the same antagonist. One writes
 * to the ruler, says what he intends, and beats him in council; the other
 * agrees with him in the room and works on the army behind his back. That
 * difference is already in the character model -- honesty, discipline,
 * boldness, what he holds to and what he will not do -- and was going unread,
 * so every nemesis conspired.
 *
 * Derived rather than stored, like the stance: it is read off the man each
 * time, so a rival whose temperament is changed by what happens to him fights
 * differently afterwards.
 */
export const NemesisMethodSchema = z.enum([
  /** Says what he means to do and does it in the open. Will not conspire and will not lie. */
  "open",
  /** Agrees to your face and works against you elsewhere. */
  "covert",
  /** Prefers the open way, and will take a quiet chance when it is cheap and deniable. */
  "pragmatic",
]);
export type NemesisMethod = z.infer<typeof NemesisMethodSchema>;

export const NemesisSchema = z
  .object({
    id: EntityIdSchema,
    /** The rival. */
    characterId: EntityIdSchema,
    /** Whose nemesis they are -- the player's character, not their polity. */
    targetCharacterId: EntityIdSchema,
    arena: NemesisArenaSchema,
    /** The thread their campaign is told in; everything narrative lives there. */
    storylineId: EntityIdSchema,
    chosenAtStep: ElapsedStepSchema,
    /** Set when they die, are broken, or their thread closes. A retired nemesis is history, not a slot. */
    retiredAtStep: ElapsedStepSchema.nullable().default(null),
    /** Why they were chosen, in the engine's own words. For inspection, never for the prompt. */
    reason: z.string().trim().min(1).max(240),
  })
  .strict();
export type Nemesis = z.infer<typeof NemesisSchema>;

/** The live one for this ruler, if there is one. */
export function nemesisOf(nemeses: readonly Nemesis[], targetCharacterId: string | null): Nemesis | undefined {
  if (targetCharacterId === null) return undefined;
  return nemeses.find((entry) => entry.targetCharacterId === targetCharacterId && entry.retiredAtStep === null);
}
