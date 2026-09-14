import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema } from "../material-state";
import { OrderPartyRefSchema, type OrderPartyRef } from "../actions/orders";
import { AuthorityDomainSchema, AuthorityPowerSchema, AuthorityScopeKindSchema } from "../authority/authority-grant";
import { WorldInstantSchema } from "../world/instant";

/**
 * World matters (docs/plans/ai-world-matters-runtime.md, "The canonical
 * world matter"). Phase 1 generalizes `WorldDevelopment` (five kinds, one
 * `actorId`) into a source-backed, multi-stakeholder record. The five
 * legacy kinds are reserved first for exact behavioral continuity with the
 * developments they replace; the remaining kinds are reserved for later
 * phases (fiscal, institutional, supply, diplomatic, plan-premise domains)
 * so the enum does not need another breaking change when those detectors
 * land.
 */
export const WorldMatterKindSchema = z.enum([
  "scarcity",
  "reconstruction",
  "civic",
  "war_burden",
  "household",
  // Reserved for later phases -- see docs/plans/ai-world-matters-runtime.md's
  // implementation sequence. Nothing produces these yet.
  "income_assessment",
  "obligation_due",
  "treasury_risk",
  "office_term",
  "seat_vacancy",
  "supply_review",
  "treaty_review",
  "commitment_review",
  "plan_premise_lost",
]);
export type WorldMatterKind = z.infer<typeof WorldMatterKindSchema>;

/**
 * A matter-scoped entity reference: a superset of `OrderPartyRef`'s kinds
 * (docs/14) plus kinds that only a matter's source, responsibility, or
 * stakeholder list ever needs to name. Deliberately not built by widening
 * `OrderPartyRefSchema` itself -- that schema is shared by the order model,
 * which has no reason to grow matter-only kinds -- see `toPartyRef` below
 * for the narrowing back the other way.
 */
export const MatterEntityRefSchema = z
  .object({
    kind: z.enum([
      // Shared with `OrderPartyRef` (docs/14, `actions/orders.ts`).
      "character", "faction", "polity", "institution", "force", "province", "settlement", "account", "office", "procedure",
      "region", "theatre", "world",
      // Matter-only.
      "income_source", "obligation", "holding", "household", "seat", "commitment", "treaty", "war",
      // World matters, Phase 7: a diplomatic proposal awaiting reply (`world/diplomacy.ts`'s `DiplomaticMessage`) -- not itself a treaty, so it gets its own kind rather than overloading "treaty" for something unratified.
      "diplomatic_message",
    ]),
    id: EntityIdSchema,
  })
  .strict();
export type MatterEntityRef = z.infer<typeof MatterEntityRefSchema>;

/** The kinds `MatterEntityRefSchema` shares with `OrderPartyRefSchema`, read off that schema so the two cannot silently drift apart. */
const PARTY_REF_KINDS: ReadonlySet<string> = new Set(OrderPartyRefSchema.shape.kind.options as readonly string[]);

/** Narrows a `MatterEntityRef` to an `OrderPartyRef`, or `null` for a matter-only kind (income_source, obligation, holding, household, seat, commitment, treaty, war). */
export function toPartyRef(ref: MatterEntityRef): OrderPartyRef | null {
  if (!PARTY_REF_KINDS.has(ref.kind)) return null;
  return OrderPartyRefSchema.parse({ kind: ref.kind, id: ref.id });
}

/**
 * What standing a matter requires to address it, reusing the existing
 * authority domain/power/scope-kind enums (`authority/authority-grant.ts`)
 * rather than redefining them -- style matches `WorkflowAuthorityRequirement`
 * there.
 */
export const MatterAuthorityRequirementSchema = z
  .object({
    domain: AuthorityDomainSchema,
    power: AuthorityPowerSchema,
    scope: z.object({ kind: AuthorityScopeKindSchema, id: EntityIdSchema }).strict(),
  })
  .strict();
export type MatterAuthorityRequirement = z.infer<typeof MatterAuthorityRequirementSchema>;

/**
 * The record that a particular actor received a matter in usable context
 * (docs/plans/ai-world-matters-runtime.md, "Offer"). Phase 1 does not yet
 * populate these for freshly detected matters -- actor selection is Phase
 * 2's job -- but the migration path (`migration.ts`) seeds one from each
 * legacy `WorldDevelopment.actorId`.
 */
export const MatterOfferSchema = z
  .object({
    actorRef: MatterEntityRefSchema,
    offeredAt: WorldInstantSchema,
    role: z.enum(["responsible", "affected", "interested", "representative"]),
    knowledgeFactIds: z.array(z.string()).max(8),
    outcome: z.enum(["pending", "intent_declared", "deferred", "declined", "no_action"]),
    intentIds: z.array(z.string()).max(4),
  })
  .strict();
export type MatterOffer = z.infer<typeof MatterOfferSchema>;

/** One evaluated outcome of a matter, per the lifecycle's "Disposition" step. */
export const MatterDispositionSchema = z
  .object({
    kind: z.enum(["addressed", "partially_addressed", "deferred", "transferred", "blocked", "contested", "overdue", "cancelled"]),
    atInstant: WorldInstantSchema,
    byActorRef: MatterEntityRefSchema.nullable(),
    evidenceFactIds: z.array(z.string()).max(12),
    note: z.string().max(400),
  })
  .strict();
export type MatterDisposition = z.infer<typeof MatterDispositionSchema>;

/**
 * The canonical world matter (docs/plans/ai-world-matters-runtime.md, "The
 * canonical world matter"). Generalizes `WorldDevelopment` (`world/developments.ts`):
 * one `actorId` becomes `responsibleScopeRefs`/`stakeholderRefs`/`offers`,
 * and the source (`sourceRef`) persists independently of who currently
 * addresses it.
 *
 * `provinceId`, `intensity`, `reviews`, `pressureId`, `createdAtStep`,
 * `lastReviewedStep`, and `nextReviewStep` are carried over from
 * `WorldDevelopment` for parity with the scheduler this replaces and for
 * migration fidelity (`migration.ts`). The step fields are a read-only
 * back-reference for debugging/back-compat -- `createdAt`/`nextReviewAt`/
 * `lastReviewedAt` (WorldInstant) are what scheduling actually reads.
 */
export const WorldMatterSchema = z
  .object({
    id: z.string().min(1).max(400),
    kind: WorldMatterKindSchema,
    sourceRef: MatterEntityRefSchema,

    status: z.enum(["upcoming", "due", "overdue", "addressed", "cancelled"]),
    visibility: z.enum(["public", "polity", "private"]),
    summary: z.string().min(1).max(600),
    urgency: z.number().int().min(0).max(100),

    createdAt: WorldInstantSchema,
    dueAt: WorldInstantSchema.nullable(),
    nextReviewAt: WorldInstantSchema,
    lastReviewedAt: WorldInstantSchema.nullable(),

    requiredAuthority: z.array(MatterAuthorityRequirementSchema).max(4),
    responsibleScopeRefs: z.array(MatterEntityRefSchema).max(8),
    stakeholderRefs: z.array(MatterEntityRefSchema).max(8),
    relevantFactIds: z.array(z.string()).max(12),

    standingPlanId: z.string().nullable(),
    supersedesMatterId: z.string().nullable(),
    parentMatterId: z.string().nullable(),

    offers: z.array(MatterOfferSchema).max(24),
    dispositions: z.array(MatterDispositionSchema).max(16),
    resolutionFactIds: z.array(z.string()).max(12),

    // Carried over from `WorldDevelopment` -- see module comment above.
    provinceId: EntityIdSchema.nullable(),
    intensity: z.number().int().min(0).max(100),
    reviews: z.number().int().nonnegative(),
    pressureId: z.string().nullable(),
    createdAtStep: ElapsedStepSchema,
    lastReviewedStep: ElapsedStepSchema,
    nextReviewStep: ElapsedStepSchema,
  })
  .strict()
  .superRefine((matter, ctx) => {
    if (matter.status === "addressed" && matter.resolutionFactIds.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["resolutionFactIds"],
        message: "An addressed matter must cite at least one resolution fact.",
      });
    }
  });
export type WorldMatter = z.infer<typeof WorldMatterSchema>;
