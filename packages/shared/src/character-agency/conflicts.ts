import type { WorldState } from "../world/world-state";
import type { CharacterIntentActionType } from "./intents";

// Conflict and resource resolution (character-sim phase 3).
//
// Before any chosen intent reaches the workflow manager, every claim on a
// shared, exclusive thing -- the same account's balance, the same office,
// the same military target -- is reconciled here, deterministically. Losing
// claims are marked blocked with a specific, inspectable reason; nothing is
// silently dropped and nothing is decided by call order or AI judgement.

export interface IntentClaim {
  readonly intentId: string;
  readonly actorCharacterId: string;
  readonly actionType: CharacterIntentActionType;
  readonly requiredResource: { readonly accountId: string; readonly minAmount: number } | null;
  readonly requiredOfficeId: string | null;
  readonly targetIds: readonly string[];
  /** This intent's score, from `scoring.ts` -- the primary deterministic priority signal. */
  readonly score: number;
  readonly createdAtStep: number;
}

export interface ClaimOutcome {
  readonly intentId: string;
  readonly accepted: boolean;
  readonly reason: string | null;
}

const EXCLUSIVE_TARGET_ACTIONS = new Set<CharacterIntentActionType>(["military_action", "seek_office"]);

/** Deterministic ordering used everywhere a tie must be broken: higher score, then earlier creation, then id. */
function comparePriority(a: IntentClaim, b: IntentClaim): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.createdAtStep !== b.createdAtStep) return a.createdAtStep - b.createdAtStep;
  return a.intentId.localeCompare(b.intentId);
}

/**
 * Resolves every resource, office, and exclusive-target conflict across a
 * turn's chosen intents. A claim not mentioned in the input never appears in
 * the output map as blocked -- callers should default unmentioned intents to
 * accepted.
 */
export function resolveIntentConflicts(
  world: Pick<WorldState, "material">,
  claims: readonly IntentClaim[],
): ReadonlyMap<string, ClaimOutcome> {
  const outcomes = new Map<string, ClaimOutcome>();
  const blocked = (intentId: string, reason: string) => outcomes.set(intentId, { intentId, accepted: false, reason });
  const accept = (intentId: string) => {
    if (!outcomes.has(intentId)) outcomes.set(intentId, { intentId, accepted: true, reason: null });
  };

  // 1. Shared account balance: accept in priority order until the balance runs out.
  const byAccount = new Map<string, IntentClaim[]>();
  for (const claim of claims) {
    if (claim.requiredResource === null) continue;
    const list = byAccount.get(claim.requiredResource.accountId) ?? [];
    list.push(claim);
    byAccount.set(claim.requiredResource.accountId, list);
  }
  for (const [accountId, accountClaims] of byAccount) {
    const balance = world.material.accounts.find((a) => a.id === accountId)?.balance ?? 0;
    const ordered = [...accountClaims].sort(comparePriority);
    let committed = 0;
    for (const claim of ordered) {
      const amount = claim.requiredResource?.minAmount ?? 0;
      if (committed + amount > balance) {
        blocked(claim.intentId, `Account "${accountId}" cannot cover this claim after higher-priority claims on it this turn.`);
      } else {
        committed += amount;
        accept(claim.intentId);
      }
    }
  }

  // 2. Exclusive office claims: only the highest-priority claim on a given office wins.
  const byOffice = new Map<string, IntentClaim[]>();
  for (const claim of claims) {
    if (claim.requiredOfficeId === null) continue;
    const list = byOffice.get(claim.requiredOfficeId) ?? [];
    list.push(claim);
    byOffice.set(claim.requiredOfficeId, list);
  }
  for (const [officeId, officeClaims] of byOffice) {
    if (officeClaims.length < 2) continue;
    const ordered = [...officeClaims].sort(comparePriority);
    for (const claim of ordered.slice(1)) {
      blocked(claim.intentId, `Office "${officeId}" is already claimed by a higher-priority intent this turn.`);
    }
  }

  // 3. Exclusive-target actions (the same military objective, the same sought office by target id).
  const byTarget = new Map<string, IntentClaim[]>();
  for (const claim of claims) {
    if (!EXCLUSIVE_TARGET_ACTIONS.has(claim.actionType) || claim.targetIds.length === 0) continue;
    const key = `${claim.actionType}:${claim.targetIds[0]}`;
    const list = byTarget.get(key) ?? [];
    list.push(claim);
    byTarget.set(key, list);
  }
  for (const [key, targetClaims] of byTarget) {
    if (targetClaims.length < 2) continue;
    const ordered = [...targetClaims].sort(comparePriority);
    for (const claim of ordered.slice(1)) {
      blocked(claim.intentId, `Target "${key}" is already claimed by a higher-priority intent this turn.`);
    }
  }

  for (const claim of claims) accept(claim.intentId);
  return outcomes;
}
