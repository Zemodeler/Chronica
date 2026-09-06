import { z } from "zod";
import { EntityIdSchema } from "../../material-state";
import { defineWorkflow, refuse, type AnyWorkflowDefinition } from "../types";
import { fulfillCommitment, deferCommitment, breakCommitment, type Commitment } from "../../character-agency/commitments";
import { applySocialEvents } from "../../characters/apply-social-events";
import type { CharacterSocialEvent } from "../../characters/social-events";

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
// exactly what character-agency/scoring.ts's candidate ranking used to do on
// the Game Master's behalf. It stays as advisory context (surfaced in the
// prompt); which candidate to act on, if any, is the Game Master's choice.

/** The one-word social effect this workflow may record; its magnitude/dimension mapping is a fixed game-balance fact, not a choice. */
export const SocialActionKindSchema = z.enum(["threaten", "reconcile", "offer_favour", "negotiate", "publicly_oppose"]);
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
};

const RESOLVABLE_COMMITMENT_STATUSES = new Set(["pending", "prepared", "partially_fulfilled", "deferred"]);

function findResolvableCommitment(world: { commitments: readonly Commitment[] }, commitmentId: string, actorId: string) {
  const commitment = world.commitments.find((c) => c.id === commitmentId);
  if (!commitment) return refuse(`No commitment exists with the id "${commitmentId}".`);
  if (commitment.promisorCharacterId !== actorId) {
    return refuse(`"${actorId}" did not make this commitment; only ${commitment.promisorCharacterId} may resolve it.`);
  }
  if (!RESOLVABLE_COMMITMENT_STATUSES.has(commitment.status)) {
    return refuse(`Commitment "${commitmentId}" is already ${commitment.status} and cannot be resolved again.`);
  }
  return commitment;
}

export const npcAgencyWorkflows: AnyWorkflowDefinition[] = [
  defineWorkflow({
    id: "fulfill_commitment",
    description: "Keep a commitment you made, spending the promised resource for real. Only the character who made the commitment may fulfill it.",
    category: "character",
    parametersSchema: z.object({ commitmentId: EntityIdSchema }).strict(),
    apply(world, params, context) {
      const found = findResolvableCommitment(world, params.commitmentId, context.actorId);
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
      const found = findResolvableCommitment(world, params.commitmentId, context.actorId);
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
      const found = findResolvableCommitment(world, params.commitmentId, context.actorId);
      if ("refused" in found) return found;
      const result = breakCommitment(world, params.commitmentId, context.atStep, params.reason);
      return {
        world: { ...world, characters: [...result.characters], commitments: [...result.commitments], characterPressures: [...result.characterPressures], material: result.material },
        result: { summary: `${context.actorId} breaks a commitment: ${params.reason}`, applied: true },
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
      if (!actor || !actor.alive) return refuse(`No living character exists with the id "${context.actorId}".`);
      const target = world.characters.find((c) => c.id === params.targetCharacterId);
      if (!target || !target.alive) return refuse(`No living character exists with the id "${params.targetCharacterId}".`);
      if (target.id === actor.id) return refuse("A character cannot direct a social action at themselves.");

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
