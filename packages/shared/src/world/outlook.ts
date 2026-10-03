import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema } from "../material-state";

/**
 * What a polity is trying to do (VISION §11).
 *
 * Until now only individuals had minds. A country had a name, a capital, some
 * provinces and a directed trust score toward each neighbour -- nothing that
 * said what it *wanted*, so foreign powers could only ever react. An outlook is
 * the state-level counterpart to `Character.mind`: standing objectives, what it
 * is worried about, what it means to do next, and how much it will risk.
 *
 * It is explicitly not scenario data. §11 is emphatic that intentions "evolve as
 * circumstances change", so this is ordinary world state the model rewrites as
 * the situation moves, through the `polity_outlook_set` delta.
 *
 * It is also not public. A rival's aims are exactly the kind of thing a
 * government would spend agents to learn, so an outlook never reaches an NPC's
 * cognition unless it is their own government's, and never reaches a Chronicle
 * at all. The orchestrator sees every outlook because it is the world and must
 * drive foreign powers coherently; nobody inside the world gets that view.
 */

export const OutlookConcernLevelSchema = z.enum(["low", "medium", "high"]);
export type OutlookConcernLevel = z.infer<typeof OutlookConcernLevelSchema>;

export const OutlookConcernSchema = z
  .object({
    label: z.string().trim().min(1).max(160),
    level: OutlookConcernLevelSchema,
  })
  .strict();
export type OutlookConcern = z.infer<typeof OutlookConcernSchema>;

export const PolityOutlookSchema = z
  .object({
    polityId: EntityIdSchema,
    /** The one thing this polity is ultimately trying to preserve or achieve. */
    primaryObjective: z.string().trim().min(1).max(240),
    concerns: z.array(OutlookConcernSchema).max(6).default([]),
    /** What it means to do about them, in its own words. */
    intentions: z.array(z.string().trim().min(1).max(200)).max(6).default([]),
    riskTolerance: z.number().int().min(0).max(100),
    updatedAtStep: ElapsedStepSchema,
    lastChangeReason: z.string().trim().min(1).max(300),
  })
  .strict();
export type PolityOutlook = z.infer<typeof PolityOutlookSchema>;

/** The outlook of one polity, or undefined where the world has not formed one yet. */
export function outlookFor(outlooks: readonly PolityOutlook[], polityId: string | null): PolityOutlook | undefined {
  if (polityId === null) return undefined;
  return outlooks.find((outlook) => outlook.polityId === polityId);
}

const WAR_CONCERN = (enemy: string): string => `the war with ${enemy}`;
const WAR_INTENTION = (enemy: string): string => `press the war with ${enemy} wherever their armies and ground can be reached`;
/** A war that is the leader's, not its own: an ally bound by foedus sends men to it and makes no war of its own. */
const LEADERS_WAR_CONCERN = (enemy: string, leader: string): string => `the war with ${enemy}, which is ${leader}'s`;
const LEADERS_WAR_INTENTION = (enemy: string, leader: string): string => `send its men to ${leader}'s war with ${enemy} when ${leader} calls for them`;
const WAR_MARK = /^(the war with |press the war with |send its men to )/;

/**
 * A government's aims, kept true to the wars it is in.
 *
 * Aims were written in 270 BCE and rewritten only when the player's own order
 * happened to ask for it, so Carthage went on meaning to "keep western Sicily
 * without a war against Rome" four months into a war with Rome, and the
 * Campanians of Rhegium, at war from the first day, meant only to "hold the
 * walls". Everybody reads these aims every time they are asked anything. A war
 * is a concern and an intention for as long as it lasts, and neither once it
 * is over; the rest of the aims are left as they were written.
 */
export function aimsAtWar(
  outlooks: readonly PolityOutlook[],
  enemiesOf: (polityId: string) => readonly string[],
  nameOf: (polityId: string) => string,
  atStep: number,
  /**
   * Whose wars these are. The Italian allies pulled into Rome's war with
   * Rhegium were each told to "press the war wherever their armies can be
   * reached" -- seven peoples who make no war of their own, with that as the
   * only thing their governments wanted, for a year. A war that is the
   * leader's is a contingent to send, not a war to press.
   */
  sides?: { readonly leaderOf: (polityId: string) => string | null; readonly ownEnemiesOf: (polityId: string) => readonly string[] },
): PolityOutlook[] {
  return outlooks.map((outlook) => {
    const enemyIds = enemiesOf(outlook.polityId);
    const leader = sides?.leaderOf(outlook.polityId) ?? null;
    const own = new Set(sides === undefined || leader === null ? enemyIds : sides.ownEnemiesOf(outlook.polityId));
    const enemies = enemyIds.map(nameOf);
    const concerns = outlook.concerns.filter((concern) => !WAR_MARK.test(concern.label));
    const intentions = outlook.intentions.filter((intention) => !WAR_MARK.test(intention));
    const warConcerns = enemyIds.map((id) => own.has(id)
      ? { label: WAR_CONCERN(nameOf(id)), level: "high" as const }
      : { label: LEADERS_WAR_CONCERN(nameOf(id), nameOf(leader!)).slice(0, 160), level: "medium" as const });
    const warIntentions = enemyIds.map((id) => (own.has(id) ? WAR_INTENTION(nameOf(id)) : LEADERS_WAR_INTENTION(nameOf(id), nameOf(leader!)).slice(0, 200)));
    const next = {
      ...outlook,
      concerns: [...warConcerns, ...concerns].slice(0, 6),
      intentions: [...warIntentions, ...intentions].slice(0, 6),
    };
    const same = JSON.stringify(next.concerns) === JSON.stringify(outlook.concerns) && JSON.stringify(next.intentions) === JSON.stringify(outlook.intentions);
    if (same) return outlook;
    return {
      ...next,
      updatedAtStep: atStep,
      lastChangeReason: (enemies.length === 0 ? "Its wars are over." : `At war with ${enemies.join(" and ")}.`).slice(0, 300),
    };
  });
}
