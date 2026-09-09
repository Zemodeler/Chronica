import { z } from "zod";
import { EntityIdSchema } from "../material-state";
import { OrderPartyRefSchema, OrderResourceRefSchema } from "./orders";

/**
 * How the player-reasoning agent (docs/32, Part B.3) classifies one directive
 * before any workflow runs. This is a read of intent, not an effect -- the
 * dispatcher, not the model, turns a clarified interpretation into the actual
 * `session.invoke()` call, reusing the existing invocation/refusal path
 * unchanged.
 */
export const PlayerIntentKindSchema = z.enum([
  "acting_personally",
  "issuing_order",
  "petitioning_authority",
  "proposing_policy",
  "offering_bargain",
  "starting_project",
  "delegating_work",
  "breaking_authority",
]);
export type PlayerIntentKind = z.infer<typeof PlayerIntentKindSchema>;

/**
 * The concrete shape of what the player wants done, reusing `OrderPartyRef`/
 * `OrderResourceRef` verbatim rather than inventing a parallel reference
 * system -- an order-attempt (B.6) is built directly from this.
 */
export const ConcreteProposalSchema = z
  .object({
    issuerRef: OrderPartyRefSchema,
    targetRefs: z.array(OrderPartyRefSchema).max(10).default([]),
    resourceRefs: z.array(OrderResourceRefSchema).max(10).default([]),
    /** The workflow or world-tool id the dispatcher should attempt, if the agent named one. */
    proposedWorkflowId: z.string().trim().min(1).max(80).optional(),
    /** Free-form parameters the dispatcher passes through to that workflow/tool. */
    proposedParameters: z.record(z.string(), z.unknown()).default({}),
    /** The player's own words for what they want -- preserved verbatim, never paraphrased away. */
    desiredOutcome: z.string().trim().min(1).max(500),
  })
  .strict();
export type ConcreteProposal = z.infer<typeof ConcreteProposalSchema>;

/**
 * One directive's interpretation. `needsClarification` is set only for
 * genuinely consequential ambiguity -- never for an omitted workflow name,
 * troop count, or account id, which the dispatcher/agent should infer or ask
 * a narrow follow-up about instead. This is the direct mechanism against
 * "The Unheard Order": a directive is never silently dropped for being
 * imprecise.
 */
export const PlayerIntentInterpretationSchema = z
  .object({
    directiveId: EntityIdSchema,
    kind: PlayerIntentKindSchema,
    concreteProposal: ConcreteProposalSchema.optional(),
    /**
     * Explicit constraints the player stated, preserved verbatim (e.g. "but
     * not before the harvest," "only with the Senate's approval"). Never
     * summarized or dropped -- a downstream agent must be able to see the
     * player's own words when deciding whether a proposal respects them.
     */
    explicitConstraints: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
    needsClarification: z.boolean().default(false),
    /** Present only when `needsClarification` is true: what is genuinely unresolved. */
    clarificationQuestion: z.string().trim().min(1).max(300).optional(),
    /** The agent's own account of why it classified the directive this way, for audit/Chronicle grounding. */
    reasoning: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.needsClarification && value.clarificationQuestion === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["clarificationQuestion"], message: "needsClarification requires a clarificationQuestion." });
    }
    if (!value.needsClarification && value.concreteProposal === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["concreteProposal"], message: "A directive that does not need clarification must resolve to a concreteProposal." });
    }
  });
export type PlayerIntentInterpretation = z.infer<typeof PlayerIntentInterpretationSchema>;
