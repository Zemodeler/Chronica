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
  /** Written by the rules for the head of the state (never shown to a person: `shownWarPlanVariant`). */
  byRule: z.boolean().optional(),
  reason: Reason,
}).strict();

/** The two acts, by name: the orchestrator is not shown them (the player's armies ignore plans), and a person is shown them compactly. */
export const WAR_PLAN_OPS: ReadonlySet<string> = new Set(["war_plan_set", "campaign_plan_set"]);

/**
 * What a person is shown of these two acts: the fields a man writes, and none of what the rules alone fill in (the theatres and the
 * allotment of armies, the sea plan, the base and the fallback, the theatre named). The parser still reads the whole.
 */
export function shownWarPlanVariant<T extends Record<string, unknown>>(variant: T): T | Record<string, unknown> {
  const op = ((variant.properties as Record<string, { const?: unknown }> | undefined)?.op)?.const;
  if (op === "war_plan_set") {
    return {
      type: "object",
      properties: {
        op: { const: "war_plan_set" }, polityId: { $ref: "#/$defs/Ref" }, enemyPolityId: { $ref: "#/$defs/Ref" },
        aims: { type: "array", items: { type: "object", properties: { kind: { enum: ["hold_province", "take_province", "break_army", "sue_for_peace", "raid", "blockade"] }, provinceId: { $ref: "#/$defs/Id" } }, required: ["kind"] } },
        posture: { enum: ["attrition", "decisive", "defend"] }, reason: { type: "string" },
      },
      required: ["op", "polityId", "enemyPolityId", "aims", "posture", "reason"],
    };
  }
  if (op === "campaign_plan_set") {
    return {
      type: "object",
      properties: {
        op: { const: "campaign_plan_set" }, forceRef: { $ref: "#/$defs/Ref" }, mode: { enum: ["seek_battle", "refuse", "siege", "raid", "garrison", "winter"] },
        objectiveProvinceId: { $ref: "#/$defs/Id" }, objectiveForceRef: { $ref: "#/$defs/Ref" }, days: { type: "integer", maximum: 240 }, reason: { type: "string" },
      },
      required: ["op", "forceRef", "mode", "reason"],
    };
  }
  return variant;
}
