import { z } from "zod";
import { EntityIdSchema } from "../../material-state";
import { defineWorkflow, refuse, type AnyWorkflowDefinition } from "../types";
import { fulfillCommitment, deferCommitment, breakCommitment, renegotiateCommitment, type Commitment } from "../../character-agency/commitments";
import { applySocialEvents } from "../../characters/apply-social-events";
import type { CharacterSocialEvent } from "../../characters/social-events";
import { BeliefKindSchema, KnowledgeChannelSchema } from "../../characters/beliefs";
import { investigateBelief } from "../../characters/beliefs";

// NPC agency commands (docs/30).
//
// Before this file existed, a due commitment was kept, deferred, or broken by
// plain functions in `character-agency/commitments.ts` -- called directly by
// the resolution pipeline, with no tool the Game Master could invoke itself.
// Likewise a social action (a threat, an attempt at reconciliation) was
// applied immediately by the pipeline the instant a candidate scored highest,
// through `applySocialEvents` with no path for the Game Master to choose the
// target, the kind, or the reason. These four workflows are that path: the
// underlying deterministic functions are unchanged, reached through the
// command layer now instead of only from the pipeline.
//
// A command must not decide whether an actor "would want" to act -- that is
// exactly what the retired candidate-ranking pass used to do on the actor's
// behalf. It stays as advisory context (surfaced in the prompt); what to act
// on, if any, is the acting agent's own choice.

/** The one-word social effect this workflow may record; its magnitude/dimension mapping is a fixed game-balance fact, not a choice. */
export const SocialActionKindSchema = z.enum([
  "threaten", "reconcile", "offer_favour", "negotiate", "publicly_oppose", "seek_support", "request_assistance",
]);
export type SocialActionKind = z.infer<typeof SocialActionKindSchema>;

/** Dimension + magnitude each social-action kind moves the relationship by. Fixed: the kind and target are the Game Master's choice, this mapping is not. */
export const SOCIAL_ACTION_EFFECT: Record<SocialActionKind, {
  readonly eventKind: CharacterSocialEvent["kind"];
  readonly dimension: "affection" | "trust" | "fear" | "respect" | "obligation";
  readonly delta: number;
}> = {
  threaten: { eventKind: "insult", dimension: "fear", delta: 15 },
  reconcile: { eventKind: "favour", dimension: "affection", delta: 12 },
  offer_favour: { eventKind: "favour", dimension: "affection", delta: 10 },
  negotiate: { eventKind: "conversation", dimension: "trust", delta: 6 },
  publicly_oppose: { eventKind: "insult", dimension: "respect", delta: -12 },
  seek_support: { eventKind: "conversation", dimension: "trust", delta: 8 },
  request_assistance: { eventKind: "conversation", dimension: "obligation", delta: 10 },
};

function findResolvableCommitment(world: { commitments: readonly Commitment[] }, commitmentId: string) {
  const commitment = world.commitments.find((c) => c.id === commitmentId);
  if (!commitment) return refuse(`No commitment exists with the id "${commitmentId}".`);
  return commitment;
}

export const npcAgencyWorkflows: AnyWorkflowDefinition[] = [
  defineWorkflow({
    id: "fulfill_commitment",
    description: "Keep a commitment you made, spending the promised resource for real. Only the character who made the commitment may fulfill it.",
    category: "character",
    parametersSchema: z.object({ commitmentId: EntityIdSchema }).strict(),
    apply(world, params, context) {
      const found = findResolvableCommitment(world, params.commitmentId);
      if ("refused" in found) return found;
      const result = fulfillCommitment(world, params.commitmentId, context.atStep);
      return {
        world: { ...world, characters: [...result.characters], commitments: [...result.commitments], characterPressures: [...result.characterPressures], material: result.material },
        result: { summary: `${context.actorId} fulfills a commitment: ${found.description}`, applied: true },
      };
    },
  }),

  defineWorkflow({
    id: "defer_commitment",
    description: "Defer a commitment to a later review step, without penalty. Only the character who made the commitment may defer it.",
    category: "character",
    parametersSchema: z.object({ commitmentId: EntityIdSchema, reason: z.string().trim().min(1).max(400), reviewInSteps: z.number().int().min(1).max(52).default(4) }).strict(),
    apply(world, params, context) {
      const found = findResolvableCommitment(world, params.commitmentId);
      if ("refused" in found) return found;
      const result = deferCommitment(world, params.commitmentId, context.atStep, params.reason, params.reviewInSteps);
      return {
        world: { ...world, characters: [...result.characters], commitments: [...result.commitments], characterPressures: [...result.characterPressures], material: result.material },
        result: { summary: `${context.actorId} defers a commitment: ${params.reason}`, applied: true },
      };
    },
  }),

  defineWorkflow({
    id: "break_commitment",
    description: "Break a commitment outright, at a reputational cost -- creates a pressure on the character who breaks it. Only the character who made the commitment may break it.",
    category: "character",
    parametersSchema: z.object({ commitmentId: EntityIdSchema, reason: z.string().trim().min(1).max(400) }).strict(),
    apply(world, params, context) {
      const found = findResolvableCommitment(world, params.commitmentId);
      if ("refused" in found) return found;
      const result = breakCommitment(world, params.commitmentId, context.atStep, params.reason);
      return {
        world: { ...world, characters: [...result.characters], commitments: [...result.commitments], characterPressures: [...result.characterPressures], material: result.material },
        result: { summary: `${context.actorId} breaks a commitment: ${params.reason}`, applied: true },
      };
    },
  }),

  defineWorkflow({
    id: "renegotiate_commitment",
    description: "Propose new terms for a commitment you can no longer keep as originally made -- a different resource, office, or description. Only the character who made the commitment may renegotiate it; the beneficiary is informed, not asked to agree.",
    category: "character",
    parametersSchema: z.object({
      commitmentId: EntityIdSchema,
      description: z.string().trim().min(1).max(400),
      requiredResource: z.object({ accountId: EntityIdSchema, minAmount: z.number().int().positive() }).nullable().optional(),
      requiredOfficeId: EntityIdSchema.nullable().optional(),
      reviewInSteps: z.number().int().min(1).max(52).default(4),
    }).strict(),
    apply(world, params, context) {
      const found = findResolvableCommitment(world, params.commitmentId);
      if ("refused" in found) return found;
      const result = renegotiateCommitment(world, params.commitmentId, context.atStep, {
        description: params.description,
        requiredResource: params.requiredResource,
        requiredOfficeId: params.requiredOfficeId,
      }, params.reviewInSteps);
      if ("rejectionReason" in result) return refuse(result.rejectionReason);
      return {
        world: { ...world, characters: [...result.characters], commitments: [...result.commitments], characterPressures: [...result.characterPressures], material: result.material },
        result: { summary: `${context.actorId} proposes new terms for a commitment: ${params.description}`, applied: true },
      };
    },
  }),

  defineWorkflow({
    id: "investigate",
    description: "Look further into a suspicion you already hold, raising your own confidence in it by a fixed amount. Only the belief's own holder may investigate it.",
    category: "character",
    parametersSchema: z.object({ beliefId: EntityIdSchema }).strict(),
    apply(world, params, context) {
      const belief = world.characterBeliefs.find((b) => b.id === params.beliefId);
      if (!belief) return refuse(`No belief exists with the id "${params.beliefId}".`);
      const result = investigateBelief(world, params.beliefId);
      return {
        world: { ...world, characterBeliefs: [...result.characterBeliefs] },
        result: { summary: `${context.actorId} looks further into: ${belief.claim}`, applied: true },
      };
    },
  }),

  defineWorkflow({
    id: "spread_belief",
    description: "Share a claim you hold with another character, privately -- granting them a belief of their own through the same channel dialogue uses. The claim, its kind, and the recipient are yours to choose; how much they end up believing it is the channel's own, fixed rule.",
    category: "character",
    parametersSchema: z.object({
      targetCharacterId: EntityIdSchema,
      subjectEntityId: EntityIdSchema.nullable(),
      claim: z.string().trim().min(1).max(400),
      kind: BeliefKindSchema,
      channel: KnowledgeChannelSchema.default("private_disclosure"),
    }).strict(),
    apply(world, params, context) {
      const actor = world.characters.find((c) => c.id === context.actorId);
      if (!actor) return refuse(`No character exists with the id "${context.actorId}".`);
      const target = world.characters.find((c) => c.id === params.targetCharacterId);
      if (!target) return refuse(`No character exists with the id "${params.targetCharacterId}".`);

      const event: CharacterSocialEvent = {
        id: `belief-share-${context.actorId}-${params.targetCharacterId}-${context.atStep}`,
        gameId: "",
        sourceTurnId: null,
        sourceSessionId: null,
        sourceMessageId: null,
        participantCharacterIds: [actor.id, target.id],
        kind: "conversation",
        visibility: "private",
        knownByCharacterIds: [actor.id, target.id],
        relationCauses: [],
        knowledgeClaims: [],
        proposedBeliefs: [{
          subjectEntityId: params.subjectEntityId,
          claim: params.claim,
          kind: params.kind,
          channel: params.channel,
          explicitRecipientCharacterIds: [target.id],
          expiresInSteps: null,
        }],
        pressureChanges: [],
        commitmentProposal: null,
        introducedCharacter: null,
        introducedProfile: null,
        createdAtStep: context.atStep,
        appliedAtStep: null,
        appliedInTurnId: null,
        status: "proposed",
        rejectionReason: null,
      };
      const applied = applySocialEvents(world, [event], context.atStep, "game-master-turn");
      const rejection = applied.rejectedIds.find((r) => r.id === event.id);
      if (rejection) return refuse(rejection.reason);
      return {
        world: applied.world,
        result: { summary: `${actor.name} shares with ${target.name}: ${params.claim}`, applied: true },
      };
    },
  }),

  defineWorkflow({
    id: "record_character_social_action",
    description: "Record a pure social action toward another character -- a threat, an attempt at reconciliation, a favour, a negotiation, or public opposition. Moves the relationship by a fixed amount for the given kind; the target, kind, and stated reason are yours to choose.",
    category: "character",
    parametersSchema: z.object({
      targetCharacterId: EntityIdSchema,
      kind: SocialActionKindSchema,
      reasonLabel: z.string().trim().min(1).max(200),
    }).strict(),
    apply(world, params, context) {
      const actor = world.characters.find((c) => c.id === context.actorId);
      if (!actor) return refuse(`No character exists with the id "${context.actorId}".`);
      const target = world.characters.find((c) => c.id === params.targetCharacterId);
      if (!target) return refuse(`No character exists with the id "${params.targetCharacterId}".`);

      const effect = SOCIAL_ACTION_EFFECT[params.kind];
      const event: CharacterSocialEvent = {
        id: `social-${context.actorId}-${params.targetCharacterId}-${context.atStep}`,
        gameId: "",
        sourceTurnId: null,
        sourceSessionId: null,
        sourceMessageId: null,
        participantCharacterIds: [actor.id, target.id],
        kind: effect.eventKind,
        visibility: "polity",
        knownByCharacterIds: [actor.id, target.id],
        relationCauses: [{
          subjectCharacterId: target.id,
          targetCharacterId: actor.id,
          label: params.reasonLabel,
          score: effect.delta,
          decayPerYearBps: 3_000,
          dimensions: { [effect.dimension]: effect.delta },
        }],
        knowledgeClaims: [],
        proposedBeliefs: [],
        pressureChanges: [],
        commitmentProposal: null,
        introducedCharacter: null,
        introducedProfile: null,
        createdAtStep: context.atStep,
        appliedAtStep: null,
        appliedInTurnId: null,
        status: "proposed",
        rejectionReason: null,
      };
      const applied = applySocialEvents(world, [event], context.atStep, "game-master-turn");
      const rejection = applied.rejectedIds.find((r) => r.id === event.id);
      if (rejection) return refuse(rejection.reason);
      return {
        world: applied.world,
        result: { summary: `${actor.name} ${params.kind.replace(/_/g, " ")}s ${target.name}: ${params.reasonLabel}`, applied: true },
      };
    },
  }),
];
