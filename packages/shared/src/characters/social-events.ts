import { z } from "zod";
import { BasisPointsSchema, ElapsedStepSchema, EntityIdSchema, VisibilitySchema } from "../material-state";
import { CharacterSchema, RelationDimensionScoresSchema } from "./character";
import { CharacterProfileSchema } from "./character-profile";
import { SocialLinkKindSchema } from "./relationship-dimensions";
import { CharacterPressureKindSchema } from "./pressures";
import { BeliefKindSchema, KnowledgeChannelSchema } from "./beliefs";

// Character social events (character-sim phase 1).
//
// The boundary between chat and simulation. Dialogue never mutates a
// `Character` directly -- it can only propose one of these. Turn resolution is
// the sole authority that validates a proposal against canonical world state,
// applies its deterministic deltas, and marks it applied. A chat request can
// never become a hidden, unreplayable world mutation this way, and the same
// event can never be applied twice (enforced at the DB layer: an UPDATE
// guarded by `WHERE status = 'proposed'`).
//
// Kept deliberately narrow: an event may add relation causes, knowledge
// claims, and (for `discovery`) introduce a brand-new character. It may never
// carry a material, office, or territory effect -- there is simply no field
// for one.

export const CharacterSocialEventKindSchema = z.enum([
  "conversation",
  "promise",
  "insult",
  "favour",
  "deception",
  "discovery",
  "rumour",
]);
export type CharacterSocialEventKind = z.infer<typeof CharacterSocialEventKindSchema>;

/** One relation-cause to append to `subjectCharacterId`'s directed view of `targetCharacterId`. */
export const RelationCauseProposalSchema = z
  .object({
    subjectCharacterId: EntityIdSchema,
    targetCharacterId: EntityIdSchema,
    label: z.string().trim().min(1).max(200),
    /** Clamped to the same ±20 bound the previous ad hoc extraction used. */
    score: z.number().int().min(-20).max(20),
    decayPerYearBps: BasisPointsSchema,
    /** Character-sim phase 2: which dimensions this cause moves. Omit to keep the legacy affection-only default. */
    dimensions: RelationDimensionScoresSchema.optional(),
    /** Optionally also creates a typed social link between the two characters (character-sim phase 2). */
    socialLinkKind: SocialLinkKindSchema.optional(),
  })
  .strict();
export type RelationCauseProposal = z.infer<typeof RelationCauseProposalSchema>;

/**
 * A belief dialogue or a world event may propose for one recipient
 * (character-sim phase 2). The resolver -- never the proposer -- decides the
 * final recipient list, confidence, and visibility from the named channel;
 * `confidenceOverride` only ever narrows, it cannot inflate past what the
 * channel and the proposer's own standing would support.
 */
export const BeliefProposalSchema = z
  .object({
    subjectEntityId: EntityIdSchema.nullable(),
    claim: z.string().trim().min(1).max(400),
    kind: BeliefKindSchema,
    channel: KnowledgeChannelSchema,
    /** Explicit recipients for private_disclosure/intercepted_secret/trusted_report -- never resolved broadly. */
    explicitRecipientCharacterIds: z.array(EntityIdSchema).max(8).default([]),
    confidenceOverride: z.number().int().min(0).max(100).optional(),
    expiresInSteps: z.number().int().positive().max(400).nullable().default(null),
  })
  .strict();
export type BeliefProposal = z.infer<typeof BeliefProposalSchema>;

/** A pressure lifecycle change dialogue or a world event may propose (character-sim phase 2). */
export const PressureChangeProposalSchema = z
  .object({
    characterId: EntityIdSchema,
    action: z.enum(["create", "refresh", "resolve"]),
    kind: CharacterPressureKindSchema.optional(),
    intensity: z.number().int().min(0).max(100).optional(),
    label: z.string().trim().min(1).max(200).optional(),
    reviewInSteps: z.number().int().positive().max(100).default(4),
    expiresInSteps: z.number().int().positive().max(400).nullable().default(null),
    visibility: VisibilitySchema.default("private"),
  })
  .strict()
  .superRefine((proposal, context) => {
    if (proposal.action === "create" && (proposal.kind === undefined || proposal.intensity === undefined || proposal.label === undefined)) {
      context.addIssue({ code: "custom", message: "Creating a pressure requires kind, intensity, and label." });
    }
  });
export type PressureChangeProposal = z.infer<typeof PressureChangeProposalSchema>;

/** A fact worth sharing into a knowledge pool. Informational only -- carries no state mutation. */
export const KnowledgeClaimProposalSchema = z
  .object({
    body: z.string().trim().min(1).max(400),
    aboutCharacterIds: z.array(EntityIdSchema).max(8).default([]),
  })
  .strict();
export type KnowledgeClaimProposal = z.infer<typeof KnowledgeClaimProposalSchema>;

/**
 * Character-sim phase 3: a canonical `Commitment`, not merely a DB row.
 * `promisorCharacterId` is always the proposing NPC (dialogue may never
 * promise on the player's behalf); `requiredOfficeId`/`requiredResource`
 * name what the promisor must actually control for this to be more than
 * words -- `applySocialEvents` rejects the proposal outright if they don't.
 */
export const CommitmentProposalSchema = z
  .object({
    actionKind: z.enum([
      "payment", "military_support", "political_support",
      "information_sharing", "protection", "office_favour", "other",
    ]),
    promisedResult: z.string().trim().min(1).max(400),
    conditions: z.string().trim().max(400).default(""),
    rationale: z.string().trim().max(400).default(""),
    promisorCharacterId: EntityIdSchema,
    beneficiaryCharacterId: EntityIdSchema,
    requiredOfficeId: EntityIdSchema.nullable().default(null),
    requiredResource: z
      .object({ accountId: EntityIdSchema, minAmount: z.number().int().positive() })
      .strict()
      .nullable()
      .default(null),
    reviewInSteps: z.number().int().positive().max(100).default(6),
  })
  .strict();
export type CommitmentProposal = z.infer<typeof CommitmentProposalSchema>;

/**
 * The full, server-assigned event as it lives in the ledger.
 *
 * `id` is allocated once, at proposal time -- off the replay-sensitive path
 * (dialogue is not part of turn replay). Turn resolution only ever reads and
 * applies events by this pre-allocated id; it never mints one.
 */
export const CharacterSocialEventSchema = z
  .object({
    id: EntityIdSchema,
    gameId: EntityIdSchema,
    sourceTurnId: EntityIdSchema.nullable(),
    sourceSessionId: EntityIdSchema.nullable(),
    sourceMessageId: EntityIdSchema.nullable(),
    participantCharacterIds: z.array(EntityIdSchema).min(1).max(16),
    kind: CharacterSocialEventKindSchema,
    visibility: VisibilitySchema,
    knownByCharacterIds: z.array(EntityIdSchema).max(64),
    relationCauses: z.array(RelationCauseProposalSchema).max(16),
    knowledgeClaims: z.array(KnowledgeClaimProposalSchema).max(8),
    /** Character-sim phase 2: beliefs this event may grant, one recipient's channel-validated belief each. */
    proposedBeliefs: z.array(BeliefProposalSchema).max(8).default([]),
    /** Character-sim phase 2: pressure lifecycle changes this event may trigger. */
    pressureChanges: z.array(PressureChangeProposalSchema).max(4).default([]),
    commitmentProposal: CommitmentProposalSchema.nullable(),
    /** Set only for kind = "discovery": the character this event introduces. */
    introducedCharacter: CharacterSchema.nullable(),
    introducedProfile: CharacterProfileSchema.nullable(),
    createdAtStep: ElapsedStepSchema,
    appliedAtStep: ElapsedStepSchema.nullable(),
    appliedInTurnId: EntityIdSchema.nullable(),
    status: z.enum(["proposed", "applied", "rejected"]),
    rejectionReason: z.string().trim().max(400).nullable(),
  })
  .strict();
export type CharacterSocialEvent = z.infer<typeof CharacterSocialEventSchema>;

/**
 * What dialogue is allowed to hand the server before an id, turn, or status
 * exists. The AI-facing structured-output shape validates against this.
 */
export const CharacterSocialEventDraftSchema = CharacterSocialEventSchema.omit({
  id: true,
  gameId: true,
  sourceTurnId: true,
  appliedAtStep: true,
  appliedInTurnId: true,
  status: true,
  rejectionReason: true,
}).extend({
  // Drafts may reference the character a paired "discovery" event is
  // introducing, so ids in participants/causes are validated by the caller
  // against canonical state plus that pending introduction, not schema-side.
});
export type CharacterSocialEventDraft = z.infer<typeof CharacterSocialEventDraftSchema>;
