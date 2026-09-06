import type { WorkflowAuditEntry, WorkflowCandidateSource } from "../workflows/manager-types";
import type { ProposedInvocation } from "./orders";
import { type OngoingAction, type OrderPartyRef, type InvocationSource, isTerminalStatus } from "./orders";
import { type PersistentOperation, isTerminalOperationStatus } from "./operations";

// Universal order/operation projection (docs/14, Phase 1 of the
// unified-resolution redesign).
//
// This module turns the Workflow Manager's per-turn audit trail --
// already carrying source, requested invocation, policy violation, manager
// decision, and execution outcome for every player, NPC, and world-director
// candidate -- into the persisted `OngoingAction`/`PersistentOperation`
// records the rest of the game reads. It adds no new authority or policy
// engine: `validateCandidate` (workflows/policy.ts) already decided whether
// an order was authorised, and this module only records that decision as
// committed history instead of letting a rejected candidate vanish into the
// audit blob unseen.
//
// Pure and deterministic: same audit entries and same previous state always
// produce the same actions/operations/refusals, so a replay matches exactly.

/** A grounded, in-world refusal or failure, ready to become a Chronicle fact. */
export interface OrderRefusalFact {
  readonly actionId: string;
  readonly actorId: string;
  readonly source: WorkflowCandidateSource;
  readonly reason: string;
  /** "authority" for a policy-level rejection, "failed" for a dry-run/execution failure. */
  readonly kind: "authority" | "failed";
}

/** Lossy but documented bridge from the Workflow Manager's five-way candidate
 * source to the narrower `InvocationSource` enum `ActionInvocationSchema`
 * already uses. A later phase should unify these two enums; Phase 1 only
 * needs `OngoingAction.invocation` to be a valid `ActionInvocation`. */
const CANDIDATE_SOURCE_TO_INVOCATION_SOURCE: Record<WorkflowCandidateSource, InvocationSource> = {
  game_master: "game_master",
  player_directive: "grammar",
  character_director: "npc",
  near_event: "event_director",
  far_event: "event_director",
  coarse_event: "event_director",
  reaction_director: "event_director",
  simulator: "simulation",
  world_director_synthesis: "simulation",
};

const TARGET_PARAMETER_KINDS: Record<string, OrderPartyRef["kind"]> = {
  forceId: "force",
  attackingForceId: "force",
  defendingForceId: "force",
  destinationProvinceId: "province",
  provinceId: "province",
  targetCharacterId: "character",
  characterId: "character",
  accountId: "account",
  officeId: "office",
  settlementId: "settlement",
  targetPolityId: "polity",
  polityId: "polity",
};

function inferTargetRefs(invocation: ProposedInvocation): OrderPartyRef[] {
  const refs: OrderPartyRef[] = [];
  const seen = new Set<string>();
  for (const [key, kind] of Object.entries(TARGET_PARAMETER_KINDS)) {
    const value = invocation.parameters[key];
    if (typeof value !== "string" || value.length === 0) continue;
    if (key === "characterId" && value === invocation.actorId) continue;
    const dedupeKey = `${kind}:${value}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    refs.push({ kind, id: value });
  }
  return refs.slice(0, 10);
}

function humanizeActionId(actionId: string): string {
  return actionId.replace(/_/g, " ");
}

function inferDesiredOutcome(invocation: ProposedInvocation): string {
  return humanizeActionId(invocation.actionId).slice(0, 400);
}

type AuthorityBasis = NonNullable<OngoingAction["authorityBasis"]>;

const POLICY_KIND_TO_CLAIMED_TYPE: Record<string, string> = {
  authority_mismatch: "command_or_office",
  scope_violation: "scope",
  treasury_unauthorised: "treasury_access",
  dead_actor: "none",
  unknown_actor: "none",
  unknown_action: "none",
  invalid_params: "none",
  duplicate: "none",
};

function deriveAuthorityBasis(entry: WorkflowAuditEntry): AuthorityBasis {
  if (entry.policyViolation) {
    return {
      claimedType: POLICY_KIND_TO_CLAIMED_TYPE[entry.policyViolation.kind] ?? "unspecified",
      validated: false,
      basis: entry.policyViolation.message,
    };
  }
  if (entry.managerDecision === "reject" || entry.managerDecision === "no_action") {
    return { claimedType: "reviewed", validated: false, basis: entry.managerReason };
  }
  return { claimedType: "granted", validated: true, basis: entry.managerReason };
}

interface ClassifiedOutcome {
  readonly status: OngoingAction["status"];
  readonly terminalReason: string | null;
}

/** Stable enough for the JSON-shaped workflow parameter object. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function refusalKey(invocation: ProposedInvocation, kind: OrderRefusalFact["kind"], reason: string): string {
  return `${invocation.actorId}\u0000${invocation.actionId}\u0000${kind}\u0000${reason}\u0000${canonicalJson(invocation.parameters)}`;
}

/**
 * True when an audit entry describes the Game Master's malformed call rather
 * than a decision made by the world.  These entries remain in the audit trail
 * so they can guide a retry, but must never become an OngoingAction, an
 * operation, or a Chronicle refusal.  Otherwise an invented placeholder such
 * as `force-?` is shown to the player as if a commander had rejected a real
 * march.
 *
 * Keep this deliberately aligned with the session's recoverable-failure
 * classification.  A real refusal (authority, resources, an existing siege,
 * and so on) is still projected and narrated; only a bad tool name, malformed
 * parameters, or an entity lookup that can be corrected is hidden.
 */
function isRecoverableToolCallMistake(entry: WorkflowAuditEntry): boolean {
  const violation = entry.policyViolation;
  if (violation) {
    return violation.kind === "unknown_action"
      || violation.kind === "invalid_params"
      || violation.kind === "unknown_actor";
  }

  const reason = entry.executionReason ?? "";
  return /^invalid param/i.test(reason)
    || /\bwith the id\b/i.test(reason)
    || /\banswers to\b/i.test(reason)
    || /\bdoes not exist in world state\b/i.test(reason);
}

function classifyOutcome(entry: WorkflowAuditEntry, isLongRunning: boolean): ClassifiedOutcome {
  if (entry.policyViolation) {
    return { status: "impossible", terminalReason: entry.policyViolation.message };
  }
  if (entry.managerDecision === "reject" || entry.managerDecision === "no_action") {
    return { status: "impossible", terminalReason: entry.managerReason ?? "Rejected by the workflow manager." };
  }
  if (entry.executionOk === false) {
    return { status: "failed", terminalReason: entry.executionReason ?? "Execution failed." };
  }
  if (entry.executionOk === true) {
    return isLongRunning
      ? { status: "active", terminalReason: null }
      : { status: "completed", terminalReason: "Executed successfully." };
  }
  // Accepted by the manager but never reached the executor this turn.
  return { status: "active", terminalReason: null };
}

export interface OrderProjectionInput {
  readonly previousActions: readonly OngoingAction[];
  readonly previousOperations: readonly PersistentOperation[];
  readonly candidates: readonly WorkflowAuditEntry[];
  readonly turnIndex: number;
  readonly atStep: number;
  /** True when this candidate's action represents a multi-turn effort (docs/14). */
  readonly isLongRunningAction: (actionId: string) => boolean;
}

/** Same bound `world.characterIntents` already applies to its own resolved-history tail. */
export const MAX_TERMINAL_ACTION_HISTORY = 200;

export interface OrderProjectionResult {
  readonly actions: OngoingAction[];
  readonly operations: PersistentOperation[];
  readonly refusals: readonly OrderRefusalFact[];
}

/** One explicit cancellation, ready to become a Chronicle fact. */
export interface CancelledActionFact {
  readonly actionId: string;
  readonly actorId: string;
  readonly operationId?: string;
  /** Carried from the cancelled action, so its Chronicle entry can join the same causal chain (docs/19 Phase 3 follow-on). */
  readonly chronicleChainId?: string;
}

export interface CancellationResult {
  readonly actions: OngoingAction[];
  readonly operations: PersistentOperation[];
  readonly cancelled: readonly CancelledActionFact[];
}

/**
 * Apply explicit player/NPC cancellation directives (an `OrderDirectiveSchema`
 * of kind "cancel") to the order/operation model (docs/14 Phase 6: "resume
 * preserves operations; revision/cancellation changes them explicitly").
 *
 * This is deterministic and needs no AI interpretation -- a cancellation
 * names the exact `OngoingAction.id` it targets, so there is nothing to
 * interpret. Cancelling an already-terminal or unknown action is silently a
 * no-op: cancellation can stop unfinished work, never rewrite what already
 * happened.
 */
export function applyCancellationDirectives(
  actions: readonly OngoingAction[],
  operations: readonly PersistentOperation[],
  cancelActionIds: readonly string[],
  atStep: number,
): CancellationResult {
  const cancelled: CancelledActionFact[] = [];
  const cancelSet = new Set(cancelActionIds);
  const cancelledOperationIds = new Set<string>();

  const nextActions = actions.map((action) => {
    if (!cancelSet.has(action.id) || isTerminalStatus(action.status)) return action;
    cancelled.push({
      actionId: action.id,
      actorId: action.actorId,
      ...(action.operationId ? { operationId: action.operationId } : {}),
      ...(action.chronicleChainId ? { chronicleChainId: action.chronicleChainId } : {}),
    });
    if (action.operationId) cancelledOperationIds.add(action.operationId);
    return {
      ...action,
      status: "cancelled" as const,
      terminalReason: "Cancelled by explicit order.",
      updatedAtStep: atStep,
    };
  });

  const nextOperations = operations.map((operation) => {
    if (!cancelledOperationIds.has(operation.id) || isTerminalOperationStatus(operation.status)) return operation;
    return {
      ...operation,
      status: "cancelled" as const,
      statusReason: "Originating order was cancelled.",
      updatedAtStep: atStep,
    };
  });

  return { actions: nextActions, operations: nextOperations, cancelled };
}

/** One explicit structural revision, ready to become a Chronicle fact. */
export interface RevisedActionFact {
  readonly actionId: string;
  readonly actorId: string;
  readonly text: string;
  readonly operationId?: string;
  /** Carried from the revised action, so its Chronicle entry can join the same causal chain (docs/19 Phase 3 follow-on). */
  readonly chronicleChainId?: string;
}

export interface RevisionResult {
  readonly actions: OngoingAction[];
  readonly operations: PersistentOperation[];
  readonly revised: readonly RevisedActionFact[];
}

/**
 * Apply explicit player/NPC revision directives (an `OrderDirectiveSchema` of
 * kind "revise") to the order/operation model -- the structural counterpart
 * to `applyCancellationDirectives` above (docs/14 Phase 6: "revision ...
 * changes [operations] explicitly"). Before this, a "revise" directive only
 * corrected the player's own wording at the AI-interpretation step; the
 * `actionId` it names was parsed but never read, so it silently became a
 * brand-new action instead of editing the one it named.
 *
 * Deliberately narrow, like cancellation: needs no AI interpretation, since
 * a revision names the exact action and supplies its own new text. It
 * patches only the narrative fields that describe *what* the actor wants
 * (`desiredOutcome`, and the linked operation's `objective`/
 * `standingInstructions`) -- never `invocation.parameters`, `progress`, or
 * `startedAtStep`, which are what make this "the same action continuing"
 * rather than a new one. Revising an already-terminal or unknown action is
 * silently a no-op, the same contract cancellation already has.
 */
export function applyRevisionDirectives(
  actions: readonly OngoingAction[],
  operations: readonly PersistentOperation[],
  revisions: readonly { readonly actionId: string; readonly text: string }[],
  turnIndex: number,
  atStep: number,
): RevisionResult {
  const revised: RevisedActionFact[] = [];
  const revisionByActionId = new Map(revisions.map((r) => [r.actionId, r]));
  const revisedTextByOperationId = new Map<string, string>();

  const nextActions = actions.map((action) => {
    const revision = revisionByActionId.get(action.id);
    if (!revision || isTerminalStatus(action.status)) return action;
    revised.push({
      actionId: action.id,
      actorId: action.actorId,
      text: revision.text,
      ...(action.operationId ? { operationId: action.operationId } : {}),
      ...(action.chronicleChainId ? { chronicleChainId: action.chronicleChainId } : {}),
    });
    if (action.operationId) revisedTextByOperationId.set(action.operationId, revision.text);
    const nextRevision = action.revision + 1;
    return {
      ...action,
      revision: nextRevision,
      revisions: [...action.revisions, {
        revision: nextRevision,
        sourceIntentId: action.sourceIntentId,
        submittedTurnIndex: turnIndex,
        directiveKind: "revise" as const,
        rawText: revision.text,
        priority: action.priority,
        assessment: null,
        preservesProgress: true,
      }],
      desiredOutcome: revision.text.slice(0, 400),
      updatedAtStep: atStep,
    };
  });

  const nextOperations = operations.map((operation) => {
    const text = revisedTextByOperationId.get(operation.id);
    if (text === undefined || isTerminalOperationStatus(operation.status)) return operation;
    return { ...operation, objective: text.slice(0, 400), standingInstructions: text.slice(0, 600), updatedAtStep: atStep };
  });

  return { actions: nextActions, operations: nextOperations, revised };
}

/**
 * Project this turn's Workflow Manager audit trail into universal order and
 * persistent-operation records, carrying forward every non-terminal record
 * from prior turns untouched (docs/14: "an unfinished operation continues
 * under standing instructions" without a new scheduler).
 */
export function projectOrdersAndOperations(input: OrderProjectionInput): OrderProjectionResult {
  const { previousActions, previousOperations, candidates, turnIndex, atStep, isLongRunningAction } = input;

  const newActions: OngoingAction[] = [];
  const newOperations: PersistentOperation[] = [];
  const refusals: OrderRefusalFact[] = [];
  const refusalKeys = new Set<string>();

  const recordRefusal = (invocation: ProposedInvocation, kind: OrderRefusalFact["kind"], reason: string, source: WorkflowCandidateSource) => {
    const key = refusalKey(invocation, kind, reason);
    if (refusalKeys.has(key)) return;
    refusalKeys.add(key);
    refusals.push({ actionId: invocation.actionId, actorId: invocation.actorId, source, reason, kind });
  };

  for (const entry of candidates) {
    // The GM session requires the model to correct these calls before it can
    // finish.  If it nevertheless runs out of steps or provider time, retain
    // the diagnostic only in the private audit -- do not manufacture a false
    // in-world refusal from it.
    if (isRecoverableToolCallMistake(entry)) continue;

    const invocation = entry.finalInvocation ?? entry.requestedInvocation;
    const longRunning = isLongRunningAction(invocation.actionId);
    const { status, terminalReason } = classifyOutcome(entry, longRunning);
    const authorityBasis = deriveAuthorityBasis(entry);

    if (status === "impossible") {
      recordRefusal(invocation, "authority", terminalReason ?? "Refused.", entry.source);
    } else if (status === "failed") {
      recordRefusal(invocation, "failed", terminalReason ?? "Failed.", entry.source);
    }

    let operationId: string | undefined;
    if (status === "active" && longRunning) {
      const operationIdValue = `op-${entry.correlationId}`;
      const forceIdParam = invocation.parameters["forceId"];
      newOperations.push({
        id: operationIdValue,
        originatingOrderId: entry.correlationId,
        ownerRef: { kind: "character", id: invocation.actorId },
        objective: inferDesiredOutcome(invocation),
        stage: "in_progress",
        standingInstructions: "",
        risks: [],
        blockers: [],
        nextScheduledStep: null,
        relatedForceIds: typeof forceIdParam === "string" ? [forceIdParam] : [],
        relatedPositionIds: [],
        relatedProcedureId: null,
        relatedOperationIds: [],
        status: "active",
        statusReason: null,
        startedAtStep: atStep,
        updatedAtStep: atStep,
      });
      operationId = operationIdValue;
    }

    newActions.push({
      id: entry.correlationId,
      actorId: invocation.actorId,
      sourceIntentId: entry.sourceRef,
      revision: 1,
      revisions: [{
        revision: 1,
        sourceIntentId: entry.sourceRef,
        submittedTurnIndex: turnIndex,
        directiveKind: "new",
        rawText: humanizeActionId(invocation.actionId),
        priority: 0,
        assessment: null,
        preservesProgress: false,
      }],
      invocation: {
        actionId: invocation.actionId,
        actorId: invocation.actorId,
        parameters: invocation.parameters,
        source: CANDIDATE_SOURCE_TO_INVOCATION_SOURCE[entry.source],
        sourceRef: entry.sourceRef,
      },
      startedTurnIndex: turnIndex,
      startedAtStep: atStep,
      priority: 0,
      dependencyActionIds: [],
      progress: { stepsElapsed: 0, stepsExpected: null },
      continuationPolicy: "automatic",
      status,
      waitingReason: null,
      terminalReason,
      replacedByActionId: null,
      issuerRef: { kind: "character", id: invocation.actorId },
      targetRefs: inferTargetRefs(invocation),
      desiredOutcome: inferDesiredOutcome(invocation),
      authorityBasis,
      operationId,
      updatedAtStep: atStep,
      // Links this action's Chronicle-facing events into one causal chain
      // across every turn it continues (docs/19 Phase 3 follow-on:
      // `chronicleChainId` existed on the schema but nothing ever set it).
      // Deterministic and derived from the operation, not a random id, so a
      // replay of the same turn links the same way. Only operation-linked
      // actions get one -- a one-shot action has nothing to chain across
      // turns.
      ...(operationId ? { chronicleChainId: `chain:${operationId}` } : {}),
    });
  }

  // Carry forward every non-terminal operation from prior turns untouched --
  // this is what makes an unfinished operation continue without being redone.
  const carriedOperations = previousOperations.filter((operation) => !isTerminalOperationStatus(operation.status));

  // Bounded snapshot growth (docs/14 Phase 6, "long-running simulation
  // remains bounded"): every active/waiting action is always kept -- dropping
  // one would silently lose in-progress work -- but a terminal action is
  // history, and only the most recent MAX_TERMINAL_ACTION_HISTORY of those
  // survive, the same bound `characterIntents` already applies to its own history.
  const allActions = [...previousActions, ...newActions];
  const recentTerminalActionIds = new Set(
    allActions.filter((action) => isTerminalStatus(action.status)).slice(-MAX_TERMINAL_ACTION_HISTORY).map((action) => action.id),
  );
  const boundedActions = allActions.filter((action) => !isTerminalStatus(action.status) || recentTerminalActionIds.has(action.id));

  return {
    actions: boundedActions,
    operations: [...carriedOperations, ...newOperations],
    refusals,
  };
}
