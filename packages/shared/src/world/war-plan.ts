import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema } from "../material-state";

/**
 * A war has a plan, and each army in it has its orders (docs/plans/war-plans.md).
 *
 * Before this an army at war chose again every month from a list: offer battle if the odds were good,
 * fall back if outnumbered, lay siege, or march on whatever scored best that day. So a consul's army
 * went one way in March and the other in April, and the head of the state, who is the one who knows
 * what the war is for, was heard by nobody. Now the war has aims and a main effort (the `WarPlan`,
 * the head of the state's), and each army has a `CampaignPlan` given it down the chain of command
 * ("the consul sends X against Y"), which it keeps to until something that a sensible man would
 * answer happens: a stronger army before him, bread running out, his object taken.
 *
 * Both are kept in the world, small and few: a plan names provinces and armies, never roads. A war
 * with two or three theatres is a handful of records; the paths are found when an army marches.
 */

export const WAR_AIM_KINDS = ["hold_province", "take_province", "break_army", "sue_for_peace", "raid", "blockade"] as const;
export const WarAimKindSchema = z.enum(WAR_AIM_KINDS);
export type WarAimKind = z.infer<typeof WarAimKindSchema>;

/** What the war is for: one thing to hold or take or break. A province, or the power whose army it is. */
export const WarAimSchema = z.object({
  kind: WarAimKindSchema,
  provinceId: EntityIdSchema.optional(),
  polityId: EntityIdSchema.optional(),
}).strict();
export type WarAim = z.infer<typeof WarAimSchema>;

/** A part of the war: the ground it is fought over, the armies that fight it, the man who leads them. */
export const WarTheatreSchema = z.object({
  id: z.string().trim().min(1).max(60),
  provinceIds: z.array(EntityIdSchema).max(12),
  mainEffort: z.boolean(),
  forceIds: z.array(EntityIdSchema).max(8),
  commanderId: EntityIdSchema.nullable(),
}).strict();
export type WarTheatre = z.infer<typeof WarTheatreSchema>;

export const WAR_POSTURES = ["attrition", "decisive", "defend"] as const;
export const WarPostureSchema = z.enum(WAR_POSTURES);
export type WarPosture = z.infer<typeof WarPostureSchema>;

export const NavalPlanSchema = z.object({
  kind: z.enum(["escort", "blockade", "seek_fleet"]),
  seaProvinceIds: z.array(EntityIdSchema).max(6),
}).strict();
export type NavalPlan = z.infer<typeof NavalPlanSchema>;

export const WarPlanSchema = z.object({
  /** The war it is for: the war record's id. */
  warId: EntityIdSchema,
  /** The power whose plan it is, and the power it is against. */
  polityId: EntityIdSchema,
  enemyPolityId: EntityIdSchema,
  aims: z.array(WarAimSchema).max(8),
  theatres: z.array(WarTheatreSchema).max(5),
  posture: WarPostureSchema,
  navalPlan: NavalPlanSchema.optional(),
  /** When it was last looked at, and when its aims last changed: an aim is kept some months before it is changed. */
  reviewedAtStep: ElapsedStepSchema,
  aimsSetAtStep: ElapsedStepSchema,
  /** The man whose plan it is: the head of the state, or the chamber's man. */
  issuedByCharacterId: EntityIdSchema.nullable(),
}).strict();
export type WarPlan = z.infer<typeof WarPlanSchema>;

export const CAMPAIGN_MODES = ["seek_battle", "refuse", "siege", "raid", "garrison", "winter"] as const;
export const CampaignModeSchema = z.enum(CAMPAIGN_MODES);
export type CampaignMode = z.infer<typeof CampaignModeSchema>;

export const CampaignObjectiveSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("province"), provinceId: EntityIdSchema }).strict(),
  z.object({ kind: z.literal("army"), forceId: EntityIdSchema }).strict(),
]);
export type CampaignObjective = z.infer<typeof CampaignObjectiveSchema>;

/** What one army is sent to do, by whom, and until when. */
export const CampaignPlanSchema = z.object({
  forceId: EntityIdSchema,
  polityId: EntityIdSchema,
  warId: EntityIdSchema,
  theatreId: z.string().trim().min(1).max(60).nullable(),
  objective: CampaignObjectiveSchema,
  /** Where it draws its bread, and where it goes if it must give way. */
  baseProvinceId: EntityIdSchema.nullable(),
  fallbackProvinceId: EntityIdSchema.nullable(),
  mode: CampaignModeSchema,
  issuedByCharacterId: EntityIdSchema,
  issuedStep: ElapsedStepSchema,
  expiresStep: ElapsedStepSchema,
}).strict();
export type CampaignPlan = z.infer<typeof CampaignPlanSchema>;

/** The longest an order to an army stands without being renewed or answered, in days. */
export const CAMPAIGN_MAX_DAYS = 240;
/** The fewest months an aim is kept before the head of the state changes it, short of something happening. */
export const AIM_KEPT_DAYS = 90;

export const warPlanOf = (world: { readonly warPlans?: readonly WarPlan[] | undefined }, polityId: string, enemyPolityId: string): WarPlan | undefined =>
  (world.warPlans ?? []).find((plan) => plan.polityId === polityId && plan.enemyPolityId === enemyPolityId);

export const campaignOf = (world: { readonly campaigns?: readonly CampaignPlan[] | undefined }, forceId: string): CampaignPlan | undefined =>
  (world.campaigns ?? []).find((plan) => plan.forceId === forceId);

const MODE_IN_WORDS: Record<CampaignMode, string> = {
  seek_battle: "to seek the enemy's army", refuse: "to refuse battle and keep his strength", siege: "to besiege",
  raid: "to harry the country of", garrison: "to hold", winter: "to winter at",
};
const AIM_IN_WORDS: Record<WarAim["kind"], string> = {
  hold_province: "hold", take_province: "take", break_army: "break the army of", sue_for_peace: "bring them to peace", raid: "raid", blockade: "shut up the harbours of",
};

/** A plan in one short line, for a man's dossier: what the war is for, the main effort, and the stance. */
export function warPlanLine(plan: WarPlan, nameOf: (id: string) => string): string {
  const aims = plan.aims.slice(0, 3).map((aim) => `${AIM_IN_WORDS[aim.kind]} ${aim.provinceId !== undefined ? nameOf(aim.provinceId) : aim.polityId !== undefined ? nameOf(aim.polityId) : ""}`.trim()).join("; ");
  const main = plan.theatres.find((theatre) => theatre.mainEffort);
  const stance = plan.posture === "decisive" ? "to fight it out" : plan.posture === "defend" ? "to stand on the defence" : "to wear them down";
  return `War plan against ${nameOf(plan.enemyPolityId)}: ${aims || "no aim yet"}${main === undefined ? "" : `; main effort ${main.provinceIds.slice(0, 2).map(nameOf).join(" and ")}`}; ${stance}${plan.navalPlan === undefined ? "" : `; at sea, ${plan.navalPlan.kind === "escort" ? "to convoy" : plan.navalPlan.kind === "blockade" ? "to blockade" : "to seek their fleet"}`}.`;
}

/** An army's orders in one short line. */
export function campaignLine(plan: CampaignPlan, nameOf: (id: string) => string, forceName: (id: string) => string): string {
  const object = plan.objective.kind === "province" ? nameOf(plan.objective.provinceId) : forceName(plan.objective.forceId);
  return `Orders: ${MODE_IN_WORDS[plan.mode]} ${object}${plan.baseProvinceId === null ? "" : `, fed from ${nameOf(plan.baseProvinceId)}`}${plan.fallbackProvinceId === null ? "" : `, falling back on ${nameOf(plan.fallbackProvinceId)}`}.`;
}
