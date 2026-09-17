import { z } from "zod";
import {
  AuthorityDomainSchema,
  AuthorityPowerSchema,
  AuthorityScopeSchema,
  AuthoritySourceSchema,
  AuthorityStandingSchema,
  type AuthorityDomain,
} from "../authority/vocabulary";
import { CharacterIntentActionTypeSchema } from "../characters/intents";
import { CharacterSocialEventKindSchema } from "../characters/social-events";
import { BasisPointsSchema, EntityIdSchema, MoneyAmountSchema, SignedScoreSchema, VisibilitySchema } from "../material-state";
import { OrderPartyRefSchema } from "../world/party-ref";
import { LocalIdSchema, RefSchema } from "./refs";

/**
 * Every way the model is allowed to change the world.
 *
 * This union is the whole of "the AI is sovereign over causality, software is
 * sovereign over arithmetic" (VISION §3). The model decides *what* changes and
 * by how much; each arm carries only the judgment, and the engine supplies
 * every id, timestamp, and derived field. Nothing outside this union can reach
 * `WorldState`.
 *
 * The union is deliberately small. Its predecessor gave the model ~97 bespoke
 * workflow tools and still could not keep the books straight (see
 * docs/plans/delete-chronicle-orders-turns.md); the lesson taken here is that a
 * narrow closed set plus one honest escape hatch (`generic_entity_create`,
 * VISION §9) covers more than a wide one, because every arm can actually be
 * validated.
 *
 * Time is always expressed as an offset in days from the current instant, never
 * as an absolute date: date arithmetic is the engine's job, and a model asked
 * to do it will eventually schedule something in the past.
 */

const ReasonSchema = z.string().trim().min(1).max(300);
const DayOffsetSchema = z.number().int().min(0).max(36_600);

/** Money moving between accounts. `toAccountRef: null` is money genuinely leaving the modelled world (a foreign shipwright, a bribe abroad). */
const MoneyTransferSchema = z.object({
  op: z.literal("money_transfer"),
  fromAccountRef: RefSchema,
  toAccountRef: RefSchema.nullable(),
  amount: MoneyAmountSchema,
  reason: ReasonSchema,
}).strict();

/** VISION §7: once the AI judges a tax reform worth +21/month, that becomes persistent state, not a one-off. */
const IncomeSourceUpsertSchema = z.object({
  op: z.literal("income_source_upsert"),
  localId: LocalIdSchema.optional(),
  incomeSourceRef: RefSchema.nullable(),
  kind: z.enum(["land", "office", "trade", "pension", "tax"]),
  label: z.string().trim().min(1).max(120),
  beneficiaryAccountRef: RefSchema,
  amount: MoneyAmountSchema,
  cadenceDays: z.number().int().positive().max(36_600),
  collectionRateBps: BasisPointsSchema.optional(),
  active: z.boolean().default(true),
  reason: ReasonSchema,
}).strict();

/** The recurring cost side of the same coin -- army pay, upkeep, debt service. */
const ObligationUpsertSchema = z.object({
  op: z.literal("obligation_upsert"),
  localId: LocalIdSchema.optional(),
  obligationRef: RefSchema.nullable(),
  kind: z.enum(["army_pay", "army_upkeep", "salary", "tribute", "pension"]),
  label: z.string().trim().min(1).max(120),
  payerAccountRef: RefSchema,
  recipientAccountRef: RefSchema.nullable(),
  amount: MoneyAmountSchema,
  cadenceDays: z.number().int().positive().max(36_600),
  priority: z.number().int().min(0).max(1000).default(500),
  active: z.boolean().default(true),
  reason: ReasonSchema,
}).strict();

/**
 * VISION §8: an overambitious order does not fail, it becomes a project with
 * friction. Milestones are what let §17's queue schedule four months of
 * recruitment without reasoning through four months.
 */
const ProjectCreateSchema = z.object({
  op: z.literal("project_create"),
  localId: LocalIdSchema,
  kind: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(160),
  sponsorRef: OrderPartyRefSchema,
  fundingAccountRef: RefSchema.nullable(),
  milestones: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(160),
        dueInDays: DayOffsetSchema,
        costAmount: MoneyAmountSchema.default(0),
      }),
    )
    .min(1)
    .max(20),
  reason: ReasonSchema,
}).strict();

const ProjectMilestoneUpdateSchema = z.object({
  op: z.literal("project_milestone_update"),
  projectRef: RefSchema,
  milestoneId: EntityIdSchema,
  status: z.enum(["completed", "skipped"]),
  reason: ReasonSchema,
}).strict();

const ForceCreateSchema = z.object({
  op: z.literal("force_create"),
  localId: LocalIdSchema,
  name: z.string().trim().min(1).max(120),
  polityId: EntityIdSchema,
  commanderCharacterRef: RefSchema,
  controllerCharacterRef: RefSchema,
  locationId: EntityIdSchema,
  authorizedStrength: z.number().int().positive().max(1_000_000),
  reason: ReasonSchema,
}).strict();

const ForceModifySchema = z.object({
  op: z.literal("force_modify"),
  forceRef: RefSchema,
  locationId: EntityIdSchema.optional(),
  commanderCharacterRef: RefSchema.optional(),
  authorizedStrengthDelta: z.number().int().min(-1_000_000).max(1_000_000).optional(),
  moraleBpsDelta: z.number().int().min(-10_000).max(10_000).optional(),
  provisionStatus: z.enum(["provisioned", "shortage", "critical"]).optional(),
  reason: ReasonSchema,
}).strict();

/**
 * VISION §5: the world generates the official it needs and keeps him forever.
 * Only the judgment is here -- the engine builds the canonical `Character`.
 */
const CharacterCreateSchema = z.object({
  op: z.literal("character_create"),
  localId: LocalIdSchema,
  name: z.string().trim().min(1).max(120),
  polityId: EntityIdSchema,
  provinceId: EntityIdSchema.nullable(),
  age: z.number().int().min(0).max(120),
  officeLabel: z.string().trim().max(120).nullable(),
  traits: z.array(z.string().trim().min(1).max(60)).max(8),
  /** VISION §5 keeps the reason a generated person exists, because it is often why they matter later. */
  generatedBecause: ReasonSchema,
}).strict();

const CharacterIntentSetSchema = z.object({
  op: z.literal("character_intent_set"),
  actorCharacterRef: RefSchema,
  actionType: CharacterIntentActionTypeSchema,
  targetRefs: z.array(RefSchema).max(8).default([]),
  rationale: z.string().trim().min(1).max(400),
  priority: z.number().int().min(0).max(100).default(50),
  visibility: VisibilitySchema.default("private"),
}).strict();

/**
 * Relationship, belief, pressure and commitment change, routed through the
 * character system's own `applySocialEvents` rather than a second mechanism.
 * The engine completes each draft into a `CharacterSocialEvent`.
 */
const SocialEventsSchema = z.object({
  op: z.literal("social_events"),
  events: z
    .array(
      z.object({
        /** Two at least: a social event with one participant is not one, and an encounter with one fails validation. */
        participantCharacterRefs: z.array(RefSchema).min(2).max(16),
        kind: CharacterSocialEventKindSchema,
        visibility: VisibilitySchema,
        summary: ReasonSchema,
      }),
    )
    .min(1)
    .max(8),
}).strict();

/** VISION §9's escape hatch: a novel institution no typed schema fits, recorded rather than invented in place. */
const GenericEntityCreateSchema = z.object({
  op: z.literal("generic_entity_create"),
  localId: LocalIdSchema,
  kind: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(160),
  ownerRef: OrderPartyRefSchema.nullable(),
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  reason: ReasonSchema,
}).strict();

const AuthorityGrantUpsertSchema = z.object({
  op: z.literal("authority_grant_upsert"),
  localId: LocalIdSchema.optional(),
  grantRef: RefSchema.nullable(),
  holder: OrderPartyRefSchema,
  source: AuthoritySourceSchema,
  domain: AuthorityDomainSchema,
  scope: AuthorityScopeSchema,
  powers: z.array(AuthorityPowerSchema).min(1),
  standing: AuthorityStandingSchema,
  expiresInDays: DayOffsetSchema.nullable().default(null),
  reason: ReasonSchema,
}).strict();

/** VISION §13: the delegate's own answer. `subvert` is reachable, and an unauthorized "accept" is recorded as one. */
const OrderAttemptDecideSchema = z.object({
  op: z.literal("order_attempt_decide"),
  orderAttemptRef: RefSchema,
  decision: z.enum(["accept", "delay", "refuse", "ignore", "subvert"]),
  reason: ReasonSchema,
}).strict();

const PolityStanceShiftSchema = z.object({
  op: z.literal("polity_stance_shift"),
  polityId: EntityIdSchema,
  towardPolityId: EntityIdSchema,
  trustDelta: SignedScoreSchema,
  reason: ReasonSchema,
}).strict();

export const WorldDeltaSchema = z.discriminatedUnion("op", [
  MoneyTransferSchema,
  IncomeSourceUpsertSchema,
  ObligationUpsertSchema,
  ProjectCreateSchema,
  ProjectMilestoneUpdateSchema,
  ForceCreateSchema,
  ForceModifySchema,
  CharacterCreateSchema,
  CharacterIntentSetSchema,
  SocialEventsSchema,
  GenericEntityCreateSchema,
  AuthorityGrantUpsertSchema,
  OrderAttemptDecideSchema,
  PolityStanceShiftSchema,
]);
export type WorldDelta = z.infer<typeof WorldDeltaSchema>;
export type WorldDeltaOp = WorldDelta["op"];

/** Every op in the union, for exhaustiveness checks and prompt generation. */
export const WORLD_DELTA_OPS = [
  "money_transfer",
  "income_source_upsert",
  "obligation_upsert",
  "project_create",
  "project_milestone_update",
  "force_create",
  "force_modify",
  "character_create",
  "character_intent_set",
  "social_events",
  "generic_entity_create",
  "authority_grant_upsert",
  "order_attempt_decide",
  "polity_stance_shift",
] as const satisfies readonly WorldDeltaOp[];

/**
 * Which authority domain a delta acts in, so `checkAuthority` can classify the
 * actor's standing to do it (VISION §12). A delta outside the actor's authority
 * is still applied -- it is recorded as a breach, because insubordination is a
 * story, not a validation failure.
 */
export const DELTA_AUTHORITY_DOMAIN: Record<WorldDeltaOp, AuthorityDomain> = {
  money_transfer: "fiscal",
  income_source_upsert: "fiscal",
  obligation_upsert: "fiscal",
  project_create: "civil",
  project_milestone_update: "civil",
  force_create: "military",
  force_modify: "military",
  character_create: "civil",
  character_intent_set: "social",
  social_events: "social",
  generic_entity_create: "civil",
  authority_grant_upsert: "judicial",
  order_attempt_decide: "civil",
  polity_stance_shift: "diplomatic",
};
