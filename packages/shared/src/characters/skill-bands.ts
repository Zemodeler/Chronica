import { z } from "zod";

/**
 * How good somebody is at a thing, in the words a world would use.
 *
 * The world judges; the engine counts. A person the world creates is described
 * in bands, and the band is turned into a skill here, so that nobody the model
 * invents can be made a better general than the scenario's best by writing a
 * larger number.
 */
export const SkillBandSchema = z.enum(["poor", "ordinary", "able", "gifted", "exceptional"]);
export type SkillBand = z.infer<typeof SkillBandSchema>;

/**
 * The skill each band stands for, on the scenario's 0-100 scale.
 *
 * `exceptional` is 85 and not 100: a man the world invented in one sentence is
 * not the equal of the best-authored general in the scenario (Manius Curius,
 * 80) by more than a little, and a ceiling below the maximum leaves room for the
 * authored ones to stand out.
 */
export const SKILL_BY_BAND: Record<SkillBand, number> = {
  poor: 30,
  ordinary: 45,
  able: 60,
  gifted: 72,
  exceptional: 85,
};
