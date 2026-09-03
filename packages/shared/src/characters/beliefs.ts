import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema, VisibilitySchema, type Visibility } from "../material-state";

// Individual beliefs and knowledge (character-sim phase 2).
//
// A character can only speak or act from what they plausibly possess. Shared
// knowledge pools (packages/shared/src/dialogue/dialogue.ts,
// `SharedKnowledgebaseEntrySchema`) may still exist for discovery/performance,
// but they are never themselves knowledge -- a character holds a belief only
// once some channel below has actually granted them one. A secret's channel
// never resolves a broad recipient list, which is what keeps "never
// universally known merely because it exists in a world event" true rather
// than aspirational.

export const BeliefKindSchema = z.enum(["fact", "rumour", "suspicion", "secret"]);
export type BeliefKind = z.infer<typeof BeliefKindSchema>;

export const BeliefStatusSchema = z.enum(["active", "superseded", "expired"]);
export type BeliefStatus = z.infer<typeof BeliefStatusSchema>;

export const CharacterBeliefSchema = z
  .object({
    id: EntityIdSchema,
    holderCharacterId: EntityIdSchema,
    subjectEntityId: EntityIdSchema.nullable(),
    claim: z.string().trim().min(1).max(400),
    kind: BeliefKindSchema,
    sourceCharacterId: EntityIdSchema.nullable(),
    sourceEventId: EntityIdSchema.nullable(),
    confidence: z.number().int().min(0).max(100),
    visibility: VisibilitySchema,
    learnedAtStep: ElapsedStepSchema,
    expiresAtStep: ElapsedStepSchema.nullable(),
    supersedesBeliefIds: z.array(EntityIdSchema).default([]),
    status: BeliefStatusSchema,
  })
  .strict();
export type CharacterBelief = z.infer<typeof CharacterBeliefSchema>;

export const KnowledgeChannelSchema = z.enum([
  "direct_witness",
  "event_participant",
  "public_announcement",
  "trusted_report",
  "ordinary_rumour",
  "private_disclosure",
  "intercepted_secret",
]);
export type KnowledgeChannel = z.infer<typeof KnowledgeChannelSchema>;

export interface ChannelDefaults {
  readonly defaultConfidence: number;
  readonly defaultVisibility: Visibility;
}

/** Every channel names its own default confidence and visibility -- no belief is created without picking one. */
export const KNOWLEDGE_CHANNEL_DEFAULTS: Readonly<Record<KnowledgeChannel, ChannelDefaults>> = {
  direct_witness: { defaultConfidence: 95, defaultVisibility: "private" },
  event_participant: { defaultConfidence: 100, defaultVisibility: "private" },
  public_announcement: { defaultConfidence: 80, defaultVisibility: "public" },
  trusted_report: { defaultConfidence: 70, defaultVisibility: "private" },
  ordinary_rumour: { defaultConfidence: 35, defaultVisibility: "public" },
  private_disclosure: { defaultConfidence: 75, defaultVisibility: "private" },
  intercepted_secret: { defaultConfidence: 60, defaultVisibility: "private" },
};

const MAX_RUMOUR_RECIPIENTS = 4;

export interface RecipientResolutionInput {
  readonly channel: KnowledgeChannel;
  readonly participantCharacterIds: readonly string[];
  readonly witnessCharacterIds: readonly string[];
  readonly sourceCharacterId: string | null;
  /** Only consulted for "ordinary_rumour" -- the source's existing contacts. */
  readonly sourceSocialLinkTargetIds: readonly string[];
  /** Explicit recipients an event author already named (required for private_disclosure/intercepted_secret). */
  readonly explicitRecipientIds: readonly string[];
}

/**
 * Deterministic recipient resolution per channel -- no randomness, so a
 * replay always grants the same belief to the same characters.
 */
export function resolveRecipients(input: RecipientResolutionInput): readonly string[] {
  switch (input.channel) {
    case "direct_witness":
      return [...new Set(input.witnessCharacterIds)];
    case "event_participant":
      return [...new Set(input.participantCharacterIds)];
    case "public_announcement":
      return [...new Set(input.explicitRecipientIds)];
    case "trusted_report":
    case "private_disclosure":
    case "intercepted_secret":
      // Never a broad grant: only whoever the event explicitly named.
      return [...new Set(input.explicitRecipientIds)];
    case "ordinary_rumour":
      return [...new Set(input.sourceSocialLinkTargetIds)].sort().slice(0, MAX_RUMOUR_RECIPIENTS);
    default:
      return [];
  }
}

export interface BeliefWorldView {
  readonly characterBeliefs: readonly CharacterBelief[];
}

/** Every active belief `holderId` holds, optionally narrowed to one subject. */
export function queryBeliefs(world: BeliefWorldView, holderId: string, subjectEntityId?: string): readonly CharacterBelief[] {
  return world.characterBeliefs.filter((belief) =>
    belief.holderCharacterId === holderId
    && belief.status === "active"
    && (subjectEntityId === undefined || belief.subjectEntityId === subjectEntityId),
  );
}

export interface AddBeliefInput {
  readonly id: string;
  readonly holderCharacterId: string;
  readonly subjectEntityId: string | null;
  readonly claim: string;
  readonly kind: BeliefKind;
  readonly sourceCharacterId: string | null;
  readonly sourceEventId: string | null;
  readonly channel: KnowledgeChannel;
  readonly atStep: number;
  readonly expiresInSteps: number | null;
  /** Overrides the channel default when an event author has a stronger or weaker basis to claim. */
  readonly confidenceOverride?: number;
}

/**
 * Adds a new belief, or reinforces an existing identical one (same holder,
 * subject, and claim) by raising its confidence instead of duplicating it.
 */
export function addOrReinforceBelief(world: BeliefWorldView, input: AddBeliefInput): Pick<BeliefWorldView, "characterBeliefs"> {
  const defaults = KNOWLEDGE_CHANNEL_DEFAULTS[input.channel];
  const confidence = Math.max(0, Math.min(100, input.confidenceOverride ?? defaults.defaultConfidence));

  const existing = world.characterBeliefs.find((belief) =>
    belief.holderCharacterId === input.holderCharacterId
    && belief.status === "active"
    && belief.claim === input.claim
    && belief.subjectEntityId === input.subjectEntityId,
  );

  if (existing !== undefined) {
    return {
      characterBeliefs: world.characterBeliefs.map((belief) =>
        belief.id === existing.id
          ? { ...belief, confidence: Math.max(0, Math.min(100, belief.confidence + Math.round((confidence - belief.confidence) / 2))) }
          : belief,
      ),
    };
  }

  const belief: CharacterBelief = {
    id: input.id,
    holderCharacterId: input.holderCharacterId,
    subjectEntityId: input.subjectEntityId,
    claim: input.claim,
    kind: input.kind,
    sourceCharacterId: input.sourceCharacterId,
    sourceEventId: input.sourceEventId,
    confidence,
    visibility: defaults.defaultVisibility,
    learnedAtStep: input.atStep,
    expiresAtStep: input.expiresInSteps === null ? null : input.atStep + input.expiresInSteps,
    supersedesBeliefIds: [],
    status: "active",
  };
  return { characterBeliefs: [...world.characterBeliefs, belief] };
}

export function reduceConfidence(world: BeliefWorldView, beliefId: string, amount: number): Pick<BeliefWorldView, "characterBeliefs"> {
  return {
    characterBeliefs: world.characterBeliefs.map((belief) =>
      belief.id === beliefId ? { ...belief, confidence: Math.max(0, belief.confidence - Math.max(0, amount)) } : belief,
    ),
  };
}

/** Marks an old belief superseded by a new one, preserving the old record rather than deleting it. */
export function supersedeBelief(
  world: BeliefWorldView,
  supersededBeliefId: string,
  replacement: AddBeliefInput,
): Pick<BeliefWorldView, "characterBeliefs"> {
  const withNew = addOrReinforceBelief(world, { ...replacement, sourceEventId: replacement.sourceEventId });
  const newBeliefId = withNew.characterBeliefs.find(
    (b) => !world.characterBeliefs.some((existing) => existing.id === b.id),
  )?.id ?? replacement.id;

  return {
    characterBeliefs: withNew.characterBeliefs.map((belief) => {
      if (belief.id === supersededBeliefId) return { ...belief, status: "superseded" as const };
      if (belief.id === newBeliefId) return { ...belief, supersedesBeliefIds: [...belief.supersedesBeliefIds, supersededBeliefId] };
      return belief;
    }),
  };
}

/** Expires every active, time-sensitive belief whose `expiresAtStep` has come due. */
export function expireBeliefs(world: BeliefWorldView, atStep: number): Pick<BeliefWorldView, "characterBeliefs"> {
  return {
    characterBeliefs: world.characterBeliefs.map((belief) =>
      belief.status === "active" && belief.expiresAtStep !== null && belief.expiresAtStep <= atStep
        ? { ...belief, status: "expired" as const }
        : belief,
    ),
  };
}
