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
import {
  BasisPointsSchema,
  EntityIdSchema,
  MoneyAmountSchema,
  PoliticalProcedureSubjectKindSchema,
  PoliticalProcedureTypeSchema,
  PoliticalResolutionMechanismSchema,
  SignedScoreSchema,
  SupportPositionChoiceSchema,
  SupportPositionKindSchema,
  SupportReasonKindSchema,
  VisibilitySchema,
} from "../material-state";
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
  /** Who pays it, where it comes from abroad -- so a war can cut this particular route. */
  counterpartyPolityId: EntityIdSchema.nullable().default(null),
  active: z.boolean().default(true),
  reason: ReasonSchema,
}).strict();

/** The recurring cost side of the same coin -- army pay, upkeep, debt service. */
const ObligationUpsertSchema = z.object({
  op: z.literal("obligation_upsert"),
  localId: LocalIdSchema.optional(),
  obligationRef: RefSchema.nullable(),
  kind: z.enum(["army_pay", "army_upkeep", "salary", "tribute", "pension", "debt_service"]),
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
  /**
   * What exists when the last milestone falls. A naval expansion that completes
   * and produces no ships has not happened. Omit it only for an effort whose
   * whole product is that it took place.
   */
  completionOutcome: z
    .object({
      kind: z.enum(["force", "structure", "income_source", "none"]),
      label: z.string().trim().min(1).max(160),
      /** Men for a force, garrison capacity for a structure, revenue per period for an income source. */
      amount: z.number().int().nonnegative().max(10_000_000).default(0),
      provinceId: EntityIdSchema.nullable().default(null),
      polityId: EntityIdSchema.nullable().default(null),
      commanderCharacterRef: RefSchema.nullable().default(null),
      beneficiaryAccountRef: RefSchema.nullable().default(null),
      cadenceDays: z.number().int().positive().max(36_600).nullable().default(null),
    })
    .strict()
    .nullable()
    .default(null),
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

/**
 * VISION §9: an arrangement the world invented goes on mattering.
 *
 * A generic entity used to be write-only -- created, never read, never changed.
 * A law whose recruitment pool is "expected to improve over several years" has
 * to be able to say how it is going, and to be retired when it is repealed.
 */
const GenericEntityUpdateSchema = z.object({
  op: z.literal("generic_entity_update"),
  entityRef: RefSchema,
  label: z.string().trim().min(1).max(160).optional(),
  /** Merged into what is already there. A null value removes that attribute. */
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  /** Repealed, dissolved, wound up. The record stays; it simply no longer applies. */
  retire: z.boolean().default(false),
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

/**
 * VISION §11: what a polity is trying to do, rewritten as circumstances change.
 * Upserted by polity -- a country has one outlook at a time, not a history of
 * them. Secret by construction: see `world/outlook.ts`.
 */
const PolityOutlookSetSchema = z.object({
  op: z.literal("polity_outlook_set"),
  polityId: EntityIdSchema,
  primaryObjective: z.string().trim().min(1).max(240),
  concerns: z
    .array(z.object({ label: z.string().trim().min(1).max(160), level: z.enum(["low", "medium", "high"]) }).strict())
    .max(6)
    .default([]),
  intentions: z.array(z.string().trim().min(1).max(200)).max(6).default([]),
  riskTolerance: z.number().int().min(0).max(100),
  reason: ReasonSchema,
}).strict();

/**
 * VISION §6/§7: a measure with a political price has one.
 *
 * Legitimacy and institutional confidence were modelled from the start and
 * nothing could move them, so "double taxes on the wealthy" cost a government
 * nothing but a sentence. Basis points, because that is the unit the rest of the
 * political machinery already speaks.
 */
const LegitimacyShiftSchema = z.object({
  op: z.literal("legitimacy_shift"),
  target: z.enum(["polity", "institution"]),
  targetId: EntityIdSchema,
  legitimacyBpsDelta: z.number().int().min(-10_000).max(10_000),
  /** Only meaningful for a polity: how far the institutions themselves are still trusted. */
  institutionalConfidenceBpsDelta: z.number().int().min(-10_000).max(10_000).optional(),
  causeLabel: z.string().trim().min(1).max(160),
  reason: ReasonSchema,
}).strict();

/**
 * VISION §6: the 18,400 available manpower, and everything else a province
 * actually consists of. Recruitment draws it down, war damages it, famine and
 * unrest move it -- all of which the engine could already compute and none of
 * which anything could ask for.
 */
const ProvinceMaterialShiftSchema = z.object({
  op: z.literal("province_material_shift"),
  provinceId: EntityIdSchema,
  availableManpowerDelta: z.number().int().min(-10_000_000).max(10_000_000).optional(),
  populationDelta: z.number().int().min(-10_000_000).max(10_000_000).optional(),
  stabilityBpsDelta: z.number().int().min(-10_000).max(10_000).optional(),
  foodSecurityBpsDelta: z.number().int().min(-10_000).max(10_000).optional(),
  productiveCapacityBpsDelta: z.number().int().min(-10_000).max(10_000).optional(),
  warDamageBpsDelta: z.number().int().min(-10_000).max(10_000).optional(),
  taxCapacityDelta: z.number().int().min(-10_000_000).max(10_000_000).optional(),
  displacedPopulationDelta: z.number().int().min(-10_000_000).max(10_000_000).optional(),
  reason: ReasonSchema,
}).strict();

/**
 * VISION §6's "senate support 63/100", as the thing it actually is: a question
 * put to a body, with people taking sides on it.
 *
 * `PoliticalProcedure` deliberately does not assume a legislature -- a decree,
 * an appointment and a vote are all procedures, differing in how they resolve.
 */
const PoliticalProcedureOpenSchema = z.object({
  op: z.literal("political_procedure_open"),
  localId: LocalIdSchema,
  type: PoliticalProcedureTypeSchema,
  institutionRef: RefSchema.nullable(),
  sponsorCharacterRef: RefSchema,
  subjectKind: PoliticalProcedureSubjectKindSchema,
  subjectRef: RefSchema.nullable(),
  label: z.string().trim().min(1).max(200),
  resolutionMechanism: PoliticalResolutionMechanismSchema,
  deadlineInDays: DayOffsetSchema.nullable().default(null),
  visibility: VisibilitySchema.default("polity"),
  reason: ReasonSchema,
}).strict();

/** Where one person or faction stands on an open question, and why. */
const PoliticalSupportSetSchema = z.object({
  op: z.literal("political_support_set"),
  procedureRef: RefSchema,
  supporterKind: SupportPositionKindSchema,
  supporterRef: RefSchema,
  position: SupportPositionChoiceSchema,
  influenceWeight: z.number().int().min(0).max(10_000),
  reasonKind: SupportReasonKindSchema,
  reasonLabel: z.string().trim().min(1).max(200),
  visibility: VisibilitySchema.default("polity"),
  reason: ReasonSchema,
}).strict();

/** The question is settled, one way or another. */
const PoliticalProcedureResolveSchema = z.object({
  op: z.literal("political_procedure_resolve"),
  procedureRef: RefSchema,
  outcome: z.enum(["passed", "failed", "blocked", "withdrawn"]),
  outcomeReason: z.string().trim().min(1).max(400),
  reason: ReasonSchema,
}).strict();

/**
 * VISION §7's "political seizure of assets", and every quieter transfer of land
 * besides. A holding carries who legally owns it and how much of it they
 * actually control, and the gap between the two is most of what makes land
 * political -- so both are movable here.
 */
const HoldingTransferSchema = z.object({
  op: z.literal("holding_transfer"),
  holdingRef: RefSchema,
  toCharacterRef: RefSchema.nullable(),
  physicalControlBpsDelta: z.number().int().min(-10_000).max(10_000).optional(),
  reason: ReasonSchema,
}).strict();

/**
 * VISION §7 and §20: a government borrows.
 *
 * The principal arrives now and the servicing is an ordinary obligation, so a
 * debt that goes unpaid falls into arrears through the same machinery that
 * makes an unpaid army desert. Where the lender is someone in this world, the
 * money leaves their account -- and they become a person with a claim on the
 * state, which is where political concessions start.
 */
const LoanOpenSchema = z.object({
  op: z.literal("loan_open"),
  localId: LocalIdSchema,
  lenderKind: z.enum(["character", "polity", "foreign"]),
  /** Omitted only for "foreign" money, which comes from outside the modelled world. */
  lenderRef: RefSchema.nullable(),
  borrowerAccountRef: RefSchema,
  principal: MoneyAmountSchema,
  /** Interest per servicing period, in basis points of the principal. */
  interestBps: BasisPointsSchema,
  cadenceDays: z.number().int().positive().max(36_600),
  /** What was agreed, in words. Often the politically expensive part. */
  terms: z.string().trim().min(1).max(300),
  collateralHoldingRef: RefSchema.nullable().default(null),
  reason: ReasonSchema,
}).strict();

/** Paying it down, walking away from it, or agreeing new terms under pressure. */
const LoanSettleSchema = z.object({
  op: z.literal("loan_settle"),
  loanRef: RefSchema,
  action: z.enum(["repay", "default", "renegotiate"]),
  /** For "repay": how much of the outstanding principal is being paid off now. */
  amount: MoneyAmountSchema.default(0),
  newInterestBps: BasisPointsSchema.optional(),
  newCadenceDays: z.number().int().positive().max(36_600).optional(),
  reason: ReasonSchema,
}).strict();

/**
 * What somebody takes to be true (VISION §14).
 *
 * The world already distinguished objective reality from what each person
 * believes about it, and nothing could put a belief into anybody's head. So
 * misinformation, deception and rumour had substrate and no mechanism: a
 * spymaster could not plant a falsehood, and an investigator could not form a
 * suspicion. Cognition reads these with their kind and confidence, so something
 * half-credited moves someone less than something witnessed -- and a planted
 * claim need not be true to be acted on.
 */
const BeliefSetSchema = z.object({
  op: z.literal("belief_set"),
  holderCharacterRef: RefSchema,
  claim: z.string().trim().min(1).max(400),
  kind: z.enum(["fact", "rumour", "suspicion", "secret"]),
  confidence: z.number().int().min(0).max(100),
  subjectRef: RefSchema.nullable().default(null),
  /** Who they heard it from, where anybody did. */
  sourceCharacterRef: RefSchema.nullable().default(null),
  visibility: VisibilitySchema.default("private"),
  reason: ReasonSchema,
}).strict();

/**
 * Two forces meet (VISION §3, §12).
 *
 * The one delta whose outcome its author does not decide. The model says who
 * engages whom and how they mean to fight; the engine resolves what happens --
 * casualties, morale, retreat, capture, ground -- from the deterministic
 * warfare rules. That is the sovereignty split at its sharpest: a model allowed
 * to author its own casualties would win every battle it cared about.
 *
 * A tactic may be *proposed*, and the engine may refuse it. A refusal is a fact
 * too.
 */
const ForceEngageSchema = z.object({
  op: z.literal("force_engage"),
  forceRef: RefSchema,
  targetForceRef: RefSchema,
  posture: z.enum(["offer_battle", "avoid_battle", "defend", "hold"]),
  /** An unusual thing to try, within bounds the engine checks. Omit for an ordinary engagement. */
  tactic: z
    .object({
      factor: z.enum(["deployment", "surprise", "effective_strength", "cohesion", "morale", "withdrawal"]),
      magnitude: z.enum(["minor", "meaningful"]),
      rationale: z.string().trim().min(1).max(600),
    })
    .strict()
    .nullable()
    .default(null),
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
  PolityOutlookSetSchema,
  LegitimacyShiftSchema,
  ProvinceMaterialShiftSchema,
  PoliticalProcedureOpenSchema,
  PoliticalSupportSetSchema,
  PoliticalProcedureResolveSchema,
  HoldingTransferSchema,
  GenericEntityUpdateSchema,
  LoanOpenSchema,
  LoanSettleSchema,
  BeliefSetSchema,
  ForceEngageSchema,
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
  "polity_outlook_set",
  "legitimacy_shift",
  "province_material_shift",
  "political_procedure_open",
  "political_support_set",
  "political_procedure_resolve",
  "holding_transfer",
  "generic_entity_update",
  "loan_open",
  "loan_settle",
  "belief_set",
  "force_engage",
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
  polity_outlook_set: "diplomatic",
  legitimacy_shift: "civil",
  province_material_shift: "civil",
  political_procedure_open: "civil",
  political_support_set: "social",
  political_procedure_resolve: "civil",
  holding_transfer: "judicial",
  generic_entity_update: "civil",
  loan_open: "fiscal",
  loan_settle: "fiscal",
  belief_set: "social",
  force_engage: "military",
};
