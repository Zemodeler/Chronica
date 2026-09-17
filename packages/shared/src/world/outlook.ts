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
