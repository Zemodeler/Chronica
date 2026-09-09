import { z } from "zod";
import { EntityIdSchema, ElapsedStepSchema } from "../material-state";
import { OrderPartyRefSchema } from "../actions/orders";
import { AuthorityCheckResultSchema } from "./authority-grant";

/**
 * The order-attempt state machine (docs/32, Phase 7): "orders requiring
 * another person or institution always become an attempted order." This is
 * NOT a second top-level action-status lifecycle -- Part A (`actions/orders.ts`)
 * owns the general `ActionStatus` enum
 * (proposed/scheduled/started/active/completed/interrupted/failed/cancelled/
 * impossible/replaced). `OrderAttempt.status` is a *refinement* that exists
 * only while an order targets a different holder of agency than its issuer,
 * tracked on the SAME `OngoingAction.id` via `actionId` below -- an
 * `OrderAttempt` row is never a parallel action record.
 *
 * Rough mapping onto the underlying `OngoingAction.status` (informative,
 * not enforced by this schema -- the dispatcher that drives both is
 * responsible for keeping them consistent):
 *   issued/received/accepted/delayed -> proposed/scheduled/started/active
 *   refused/ignored/subverted        -> failed (with this record preserving WHY)
 *   carried_out                      -> completed
 *   abandoned                        -> cancelled
 */
export const OrderAttemptStatusSchema = z.enum([
  "issued",
  "received",
  "accepted",
  "delayed",
  "refused",
  "ignored",
  "subverted",
  "carried_out",
  "abandoned",
]);
export type OrderAttemptStatus = z.infer<typeof OrderAttemptStatusSchema>;

/** Statuses in which the recipient has made a final decision -- the order is no longer awaiting a response. */
export const TERMINAL_ORDER_ATTEMPT_STATUSES = [
  "refused",
  "ignored",
  "subverted",
  "carried_out",
  "abandoned",
] as const satisfies readonly OrderAttemptStatus[];

export const isTerminalOrderAttemptStatus = (status: OrderAttemptStatus): boolean =>
  (TERMINAL_ORDER_ATTEMPT_STATUSES as readonly string[]).includes(status);

export const OrderAttemptSchema = z
  .object({
    id: EntityIdSchema,
    /** The `OngoingAction` (Part A) this attempt refines. */
    actionId: EntityIdSchema,
    issuerRef: OrderPartyRefSchema,
    /** Who or what must decide -- a character, or (when no character currently represents it) a star-context's scope. */
    recipientRef: OrderPartyRefSchema,
    claimedAuthorityGrantId: EntityIdSchema.nullable().default(null),
    /** Snapshot of `checkAuthority`'s result at issue time -- never recomputed after the fact, so a later grant change cannot retroactively legalize or void a past attempt. */
    authorityCheck: AuthorityCheckResultSchema,
    status: OrderAttemptStatusSchema,
    /** The recipient's own stated reason for their decision, once they have made one. */
    recipientDecisionReason: z.string().trim().max(400).nullable().default(null),
    issuedAtStep: ElapsedStepSchema,
    decidedAtStep: ElapsedStepSchema.nullable().default(null),
    /** Facts (legitimacy adjustment, discoverable evidence) recording the fallout of a refusal/subversion. */
    consequenceFactRefs: z.array(z.string().max(120)).max(8).default([]),
  })
  .strict()
  .superRefine((attempt, context) => {
    if (isTerminalOrderAttemptStatus(attempt.status) && attempt.decidedAtStep === null) {
      context.addIssue({ code: "custom", path: ["decidedAtStep"], message: "A decided order attempt must record when it was decided." });
    }
    if (!isTerminalOrderAttemptStatus(attempt.status) && attempt.decidedAtStep !== null) {
      context.addIssue({ code: "custom", path: ["decidedAtStep"], message: "An order attempt still awaiting a decision cannot record when it was decided." });
    }
  });
export type OrderAttempt = z.infer<typeof OrderAttemptSchema>;

/*
 * Pure status-transition helpers, in the same style as
 * `actions/orders.ts`'s `proposeAction`/`scheduleAction`/etc. -- no
 * `WorldState` dependency; these operate on a single `OrderAttempt` value.
 */

export function issueOrderAttempt(input: Omit<OrderAttempt, "status" | "decidedAtStep" | "recipientDecisionReason" | "consequenceFactRefs">): OrderAttempt {
  return OrderAttemptSchema.parse({ ...input, status: "issued", decidedAtStep: null, recipientDecisionReason: null, consequenceFactRefs: [] });
}

/** The order reaches its recipient this turn -- they may now decide it. */
export function receiveOrderAttempt(attempt: OrderAttempt): OrderAttempt {
  if (attempt.status !== "issued") throw new Error(`Only an issued order attempt can be received; "${attempt.id}" is ${attempt.status}.`);
  return { ...attempt, status: "received" };
}

const RECIPIENT_DECISIONS = ["accept", "delay", "refuse", "ignore", "subvert"] as const;
export type OrderAttemptDecision = (typeof RECIPIENT_DECISIONS)[number];

const DECISION_TO_STATUS: Record<OrderAttemptDecision, OrderAttemptStatus> = {
  accept: "accepted",
  delay: "delayed",
  refuse: "refused",
  ignore: "ignored",
  subvert: "subverted",
};

/**
 * The recipient's own decision (`respond_to_order`, Part B's dispatcher).
 * `accept` when `!authorityCheck.authorized` is legal for the recipient to
 * choose -- a corrupt, sympathetic, or coerced recipient really can comply
 * with an order they know is unauthorized -- but it is recorded as
 * `subvert`, not `accept`: an authority breach can never silently gain the
 * power of a lawful order.
 */
export function decideOrderAttempt(attempt: OrderAttempt, decision: OrderAttemptDecision, reason: string, atStep: number): OrderAttempt {
  if (attempt.status !== "received" && attempt.status !== "delayed") {
    throw new Error(`Only a received or delayed order attempt can be decided; "${attempt.id}" is ${attempt.status}.`);
  }
  const effectiveDecision: OrderAttemptDecision = decision === "accept" && !attempt.authorityCheck.authorized ? "subvert" : decision;
  const status = DECISION_TO_STATUS[effectiveDecision];
  const decided = isTerminalOrderAttemptStatus(status);
  return {
    ...attempt,
    status,
    recipientDecisionReason: reason,
    decidedAtStep: decided ? atStep : null,
  };
}

/** `accepted` -> `carried_out`, once the underlying workflow actually applies. */
export function completeOrderAttempt(attempt: OrderAttempt, atStep: number): OrderAttempt {
  if (attempt.status !== "accepted") throw new Error(`Only an accepted order attempt can be carried out; "${attempt.id}" is ${attempt.status}.`);
  return { ...attempt, status: "carried_out", decidedAtStep: atStep };
}

/** `accepted` -> `abandoned`, when the underlying workflow refuses on mechanical grounds (a world-mechanical failure, distinct from a social refusal). */
export function abandonOrderAttempt(attempt: OrderAttempt, atStep: number): OrderAttempt {
  if (attempt.status !== "accepted") throw new Error(`Only an accepted order attempt can be abandoned; "${attempt.id}" is ${attempt.status}.`);
  return { ...attempt, status: "abandoned", decidedAtStep: atStep };
}

/** Links the Fact(s) recording this attempt's consequences (legitimacy adjustment, discoverable evidence) once they are emitted. */
export function recordOrderAttemptConsequences(attempt: OrderAttempt, factIds: readonly string[]): OrderAttempt {
  return { ...attempt, consequenceFactRefs: [...attempt.consequenceFactRefs, ...factIds] };
}
