import { z } from "zod";
import {
  ElapsedStepSchema,
  EntityIdSchema,
  MaterialEffectProposalSchema,
  SignedScoreSchema,
  VisibilitySchema,
} from "../material-state";
import { PlayerInvolvementSchema, SalienceSchema } from "../world/scope";
import { ProposedInvocationSchema, StepRangeSchema } from "./orders";

// Adjudication (ADR-0019, docs/14).
//
// These shapes are consumed in M2; they are defined now because two of the
// project's load-bearing rules are expressed *in the schema itself*, and a
// schema written later tends to be written to fit whatever the code already
// does.
//
//  1. Obstacles are required and come first. An adjudicator that grants what is
//     asked destroys the game instantly, because the optimal strategy becomes
//     writing confidently. Making the array non-empty forces the model to name
//     the opposition before it can wave it away.
//  2. The model proposes deltas; the simulation applies them. A verdict is an
//     *input* to packages/sim, which validates every delta and rejects the
//     illegal ones. The model can rule that a bribe worked; it cannot mint
//     money that does not exist.

export const ObstacleSchema = z
  .object({
    /** Who or what resists. */
    source: z.string().trim().min(1).max(200),
    weight: z.enum(["trivial", "real", "decisive"]),
    reason: z.string().trim().min(1).max(400),
  })
  .strict();
export type Obstacle = z.infer<typeof ObstacleSchema>;

/**
 * A proposed change, never a patch.
 *
 * Every variant is a *request* the simulation may refuse. There is deliberately
 * no "set this balance" or "move this army" member: docs/20 is explicit that
 * direct balance patches are invalid including a model-proposed one, and a
 * union that could express one would eventually be used.
 */
export const StateDeltaSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("material_effect"),
      /** Source, recipient and a bounded magnitude. The sim picks the amount. */
      effect: MaterialEffectProposalSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("relationship_cause"),
      /** Directed: A's opinion of B is not B's of A. */
      holderCharacterId: EntityIdSchema,
      subjectCharacterId: EntityIdSchema,
      label: z.string().trim().min(1).max(160),
      score: SignedScoreSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("knowledge_grant"),
      characterId: EntityIdSchema,
      factId: EntityIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("workflow"),
      /** Routed through the same validation gate as every other proposal. */
      invocation: ProposedInvocationSchema,
    })
    .strict(),
]);
export type StateDelta = z.infer<typeof StateDeltaSchema>;

/** A pointer back to an applied delta, so a consequence can name its cause. */
export const StateDeltaReferenceSchema = z
  .object({
    id: EntityIdSchema,
    kind: z.enum(["material_effect", "relationship_cause", "knowledge_grant", "workflow"]),
    explanation: z.string().trim().min(1).max(240),
  })
  .strict();
export type StateDeltaReference = z.infer<typeof StateDeltaReferenceSchema>;

export const BattlePhaseSchema = z.enum([
  "contact",
  "engagement",
  "cohesion",
  "withdrawal",
  "aftermath",
]);
export type BattlePhase = z.infer<typeof BattlePhaseSchema>;

export const TacticalPreconditionSchema = z
  .object({
    label: z.string().trim().min(1).max(200),
    subjectId: EntityIdSchema.nullable(),
  })
  .strict();

export const ResourceCostSchema = z
  .object({
    resourceId: EntityIdSchema,
    amount: z.number().int().positive().safe(),
  })
  .strict();

/**
 * A bounded interpretation of a genuinely novel tactic (docs/19).
 *
 * There is no `decisive` magnitude and no casualty, retreat, control or victory
 * field, because the warfare engine alone decides those. The warfare rules
 * verify and cap this in Phase 5; the shape is fixed here so nothing can grow a
 * field that would let a model write battle state.
 */
export const TacticalModifierProposalSchema = z
  .object({
    battleId: EntityIdSchema,
    actorId: EntityIdSchema,
    factor: z.enum([
      "deployment",
      "surprise",
      "effective_strength",
      "cohesion",
      "morale",
      "withdrawal",
    ]),
    magnitude: z.enum(["minor", "meaningful"]),
    phases: z.array(BattlePhaseSchema).min(1),
    preconditions: z.array(TacticalPreconditionSchema).min(1),
    costs: z.array(ResourceCostSchema),
    rationale: z.string().trim().min(1).max(600),
  })
  .strict();
export type TacticalModifierProposal = z.infer<typeof TacticalModifierProposalSchema>;

export const VerdictSchema = z
  .object({
    directiveId: EntityIdSchema,
    outcome: z.enum(["succeeds", "partially_succeeds", "fails", "backfires", "impossible"]),
    /** Non-empty by contract. This is the yes-man defence, in the type. */
    obstacles: z.array(ObstacleSchema).min(1),
    deltas: z.array(StateDeltaSchema),
    tacticalModifiers: z.array(TacticalModifierProposalSchema),
    timeCost: StepRangeSchema,
    /** Shown to the player when they ask why; must name the deciding constraint. */
    rationale: z.string().trim().min(1).max(1_200),
    /** Which characters may learn it -- not who may read the shared news. */
    knowledgeVisibility: VisibilitySchema,
    playerInvolvement: z.array(PlayerInvolvementSchema),
  })
  .strict();
export type Verdict = z.infer<typeof VerdictSchema>;

/**
 * The deterministic trigger that alone may wake the Event Director (ADR-0029).
 *
 * The model cannot decide to call itself, scan the world or write state.
 * packages/sim emits this; without one, no call happens at all.
 */
export const EventDirectionTriggerSchema = z
  .object({
    id: EntityIdSchema,
    kind: z.enum(["tension", "scenario", "quiet_span"]),
    elapsedStep: ElapsedStepSchema,
    /** The affected Focus/Near scope only. Never the Far skeleton. */
    scopeIds: z.array(EntityIdSchema).min(1),
    causeFactIds: z.array(EntityIdSchema).min(1),
  })
  .strict();
export type EventDirectionTrigger = z.infer<typeof EventDirectionTriggerSchema>;

export const EventProposalSchema = z
  .object({
    triggerId: EntityIdSchema,
    causeFactIds: z.array(EntityIdSchema).min(1),
    affectedScopeIds: z.array(EntityIdSchema).min(1),
    visibility: VisibilitySchema,
    salience: SalienceSchema,
    /** Workflow proposals only. There is deliberately no state-delta field. */
    actions: z.array(ProposedInvocationSchema).min(1).max(2),
    /** One-sentence narrative summary for the Workflow Manager to evaluate this event's intent. */
    summary: z.string().trim().max(300).optional(),
  })
  .strict();
export type EventProposal = z.infer<typeof EventProposalSchema>;
