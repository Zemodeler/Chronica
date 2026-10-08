import { z } from "zod";
import { EntityIdSchema } from "../material-state";
import { CAMPAIGN_MAX_DAYS, CampaignModeSchema, NavalPlanSchema, WarAimSchema, WarPostureSchema, WarTheatreSchema } from "../world/war-plan";
import { MaybeRefSchema, RefSchema } from "./refs";

/**
 * Writing a war's plan and an army's orders (`world/war-plan.ts`).
 *
 * The rules write them by these, for every power nobody plays; a man the model plays writes them by
 * the same two acts, and the same bounds hold. The engine checks that the provinces are there, that
 * the armies are the power's own, and that nothing is laid down for longer than a campaign.
 */
const Reason = z.string().trim().min(1).max(300);
const MaybeId = EntityIdSchema.nullable().default(null);

/** What the power means to do by the war with another: its aims, where its main effort falls, and how it means to fight. */
export const WarPlanSetSchema = z.object({
  op: z.literal("war_plan_set"),
  polityId: RefSchema,
  enemyPolityId: RefSchema,
  aims: z.array(WarAimSchema).min(1).max(6),
  theatres: z.array(WarTheatreSchema).max(4).default([]),
  posture: WarPostureSchema,
  navalPlan: NavalPlanSchema.optional(),
  reason: Reason,
}).strict();

/** What an army is sent to do: against a province or an army, in one of six ways, from a base and to a fallback, for so many days. */
export const CampaignPlanSetSchema = z.object({
  op: z.literal("campaign_plan_set"),
  forceRef: RefSchema,
  mode: CampaignModeSchema,
  objectiveProvinceId: MaybeId,
  objectiveForceRef: MaybeRefSchema.default(null),
  baseProvinceId: MaybeId,
  fallbackProvinceId: MaybeId,
  days: z.number().int().min(10).max(CAMPAIGN_MAX_DAYS).default(90),
  theatreId: z.string().trim().min(1).max(60).nullable().default(null),
  reason: Reason,
}).strict();
