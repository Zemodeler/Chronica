import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema, VisibilitySchema, type MaterialWorldState } from "../material-state";
import type { Character } from "../characters/character";
import { createPressure, type CharacterPressure } from "../characters/pressures";

// Canonical commitments (character-sim phase 3).
//
// A commitment is a real obligation, not a line of dialogue. It names what
// was promised, who owes it, what it costs to keep, and what happens if it
// is not kept. Dialogue may only *propose* one (`CommitmentProposal`, via the
// `CharacterSocialEvent` ledger, same as a belief or a pressure change); this
// module is what turns an accepted proposal into canonical state and later
// resolves it -- the only place a commitment is created, fulfilled, deferred,
// or broken.
//
// A promisor cannot promise resources or authority they do not hold: creation
// itself checks `requiredAccountId`/`requiredAmount`/`requiredOfficeId`
// against the promisor's actual account balance and office, exactly the way
// the workflow policy layer already checks treasury permissions for player
// actions (`packages/shared/src/workflows/policy.ts`). Fulfillment spends the
// resource for real; it does not merely flip a status.

export const CommitmentActionKindSchema = z.enum([
  "payment",
  "military_support",
  "political_support",
  "information_sharing",
  "protection",
  "office_favour",
  "other",
]);
export type CommitmentActionKind = z.infer<typeof CommitmentActionKindSchema>;

export const CommitmentStatusSchema = z.enum([
  "pending",
  "prepared",
  "fulfilled",
  "partially_fulfilled",
  "deferred",
  "failed",
  "cancelled",
  "broken",
]);
export type CommitmentStatus = z.infer<typeof CommitmentStatusSchema>;

const RequiredResourceSchema = z
  .object({ accountId: EntityIdSchema, minAmount: z.number().int().positive() })
  .strict();

export const CommitmentSchema = z
  .object({
    id: EntityIdSchema,
    promisorCharacterId: EntityIdSchema,
    beneficiaryCharacterId: EntityIdSchema,
    actionKind: CommitmentActionKindSchema,
    description: z.string().trim().min(1).max(400),
    conditions: z.string().trim().max(400).default(""),
    /** Authority the promisor must hold to keep this at all -- an office they must currently occupy. */
    requiredOfficeId: EntityIdSchema.nullable().default(null),
    /** Resource the promisor must actually have on hand to keep this. */
    requiredResource: RequiredResourceSchema.nullable().default(null),
    visibility: VisibilitySchema,
    sourceEventId: EntityIdSchema.nullable(),
    /** What happens to the promisor's standing if this is broken rather than fulfilled. */
    breachPressureKind: z.enum(["humiliation", "debt", "political_danger"]).default("humiliation"),
    status: CommitmentStatusSchema,
    createdAtStep: ElapsedStepSchema,
    reviewAtStep: ElapsedStepSchema,
    resolvedAtStep: ElapsedStepSchema.nullable().default(null),
    resolutionReason: z.string().trim().max(400).nullable().default(null),
  })
  .strict();
export type Commitment = z.infer<typeof CommitmentSchema>;

export interface CommitmentWorldView {
  readonly characters: readonly Character[];
  readonly commitments: readonly Commitment[];
  readonly characterPressures: readonly CharacterPressure[];
  readonly material: MaterialWorldState;
}

/** True only if the promisor currently holds the office and resource this commitment names. */
export function checkCommitmentAuthority(
  world: Pick<CommitmentWorldView, "characters" | "material">,
  promisorCharacterId: string,
  requiredOfficeId: string | null,
  requiredResource: { accountId: string; minAmount: number } | null,
): { ok: true } | { ok: false; reason: string } {
  const promisor = world.characters.find((c) => c.id === promisorCharacterId);
  if (promisor === undefined) return { ok: false, reason: "Promisor is not a known character." };
  if (requiredOfficeId !== null && promisor.officeId !== requiredOfficeId) {
    return { ok: false, reason: `Promisor does not hold office "${requiredOfficeId}".` };
  }
  if (requiredResource !== null) {
    const account = world.material.accounts.find((a) => a.id === requiredResource.accountId);
    if (account === undefined) return { ok: false, reason: "Required account does not exist." };
    const controlsAccount = account.owner.kind === "character" && account.owner.id === promisorCharacterId;
    if (!controlsAccount) return { ok: false, reason: "Promisor does not control the required account." };
    if (account.balance < requiredResource.minAmount) {
      return { ok: false, reason: "Promisor's account lacks the required balance." };
    }
  }
  return { ok: true };
}

export interface CreateCommitmentInput {
  readonly id: string;
  readonly promisorCharacterId: string;
  readonly beneficiaryCharacterId: string;
  readonly actionKind: CommitmentActionKind;
  readonly description: string;
  readonly conditions?: string;
  readonly requiredOfficeId?: string | null;
  readonly requiredResource?: { accountId: string; minAmount: number } | null;
  readonly visibility: z.infer<typeof VisibilitySchema>;
  readonly sourceEventId: string | null;
  readonly breachPressureKind?: Commitment["breachPressureKind"];
  readonly atStep: number;
  readonly reviewInSteps: number;
}

/**
 * Validates authority/resources and, if the promisor genuinely controls what
 * they are promising, creates the commitment. Returns `null` (with a reason)
 * rather than creating an unenforceable promise.
 */
export function createCommitment(
  world: Pick<CommitmentWorldView, "characters" | "commitments" | "material">,
  input: CreateCommitmentInput,
): { commitment: Commitment } | { rejectionReason: string } {
  const requiredOfficeId = input.requiredOfficeId ?? null;
  const requiredResource = input.requiredResource ?? null;
  const authority = checkCommitmentAuthority(world, input.promisorCharacterId, requiredOfficeId, requiredResource);
  if (!authority.ok) return { rejectionReason: authority.reason };

  const commitment: Commitment = {
    id: input.id,
    promisorCharacterId: input.promisorCharacterId,
    beneficiaryCharacterId: input.beneficiaryCharacterId,
    actionKind: input.actionKind,
    description: input.description,
    conditions: input.conditions ?? "",
    requiredOfficeId,
    requiredResource,
    visibility: input.visibility,
    sourceEventId: input.sourceEventId,
    breachPressureKind: input.breachPressureKind ?? "humiliation",
    status: "pending",
    createdAtStep: input.atStep,
    reviewAtStep: input.atStep + input.reviewInSteps,
    resolvedAtStep: null,
    resolutionReason: null,
  };
  return { commitment };
}

/** Two commitments conflict if the same promisor's same account cannot cover both simultaneously. */
export interface CommitmentConflict {
  readonly losingCommitmentId: string;
  readonly winningCommitmentId: string;
  readonly reason: string;
}

/**
 * Deterministic conflict detection across every still-pending commitment.
 * A conflict is resolved in favour of the earlier-created commitment
 * (ties broken by id), never by score or AI judgement -- a promise made
 * first has first claim on the resource that backs it.
 */
export function detectConflictingCommitments(
  world: Pick<CommitmentWorldView, "material">,
  commitments: readonly Commitment[],
): readonly CommitmentConflict[] {
  const conflicts: CommitmentConflict[] = [];
  const byAccount = new Map<string, Commitment[]>();
  for (const commitment of commitments) {
    if (commitment.status !== "pending" && commitment.status !== "prepared") continue;
    if (commitment.requiredResource === null) continue;
    const list = byAccount.get(commitment.requiredResource.accountId) ?? [];
    list.push(commitment);
    byAccount.set(commitment.requiredResource.accountId, list);
  }
  for (const [accountId, claims] of byAccount) {
    if (claims.length < 2) continue;
    const account = world.material.accounts.find((a) => a.id === accountId);
    const balance = account?.balance ?? 0;
    const ordered = [...claims].sort((a, b) => {
      if (a.createdAtStep !== b.createdAtStep) return a.createdAtStep - b.createdAtStep;
      return a.id.localeCompare(b.id);
    });
    let committed = 0;
    for (const claim of ordered) {
      const amount = claim.requiredResource?.minAmount ?? 0;
      if (committed + amount > balance) {
        conflicts.push({
          losingCommitmentId: claim.id,
          winningCommitmentId: ordered[0]!.id,
          reason: `Account "${accountId}" cannot cover both commitments; the earlier one has first claim.`,
        });
      } else {
        committed += amount;
      }
    }
  }
  return conflicts;
}

function patchCommitment(
  commitments: readonly Commitment[],
  id: string,
  patch: Partial<Commitment>,
): readonly Commitment[] {
  return commitments.map((c) => (c.id === id ? { ...c, ...patch } : c));
}

export interface CommitmentResolutionResult {
  readonly characters: readonly Character[];
  readonly commitments: readonly Commitment[];
  readonly characterPressures: readonly CharacterPressure[];
  readonly material: MaterialWorldState;
}

/** Spends the promised resource for real and marks the commitment fulfilled. */
export function fulfillCommitment(
  world: CommitmentWorldView,
  commitmentId: string,
  atStep: number,
): CommitmentResolutionResult {
  const commitment = world.commitments.find((c) => c.id === commitmentId);
  if (commitment === undefined) return world;
  let material = world.material;
  if (commitment.requiredResource !== null && commitment.actionKind === "payment") {
    const { accountId, minAmount } = commitment.requiredResource;
    const beneficiaryAccountId = world.characters.find((c) => c.id === commitment.beneficiaryCharacterId)?.personalAccountId;
    material = {
      ...material,
      accounts: material.accounts.map((account) => {
        if (account.id === accountId) return { ...account, balance: account.balance - minAmount };
        if (account.id === beneficiaryAccountId) return { ...account, balance: account.balance + minAmount };
        return account;
      }),
    };
  }
  return {
    characters: world.characters,
    commitments: patchCommitment(world.commitments, commitmentId, {
      status: "fulfilled", resolvedAtStep: atStep, resolutionReason: "Fulfilled with the promised resource.",
    }),
    characterPressures: world.characterPressures,
    material,
  };
}

/** Defers the commitment to a later review step without penalty. */
export function deferCommitment(
  world: CommitmentWorldView,
  commitmentId: string,
  atStep: number,
  reason: string,
  reviewInSteps = 4,
): CommitmentResolutionResult {
  return {
    characters: world.characters,
    commitments: patchCommitment(world.commitments, commitmentId, {
      status: "deferred", reviewAtStep: atStep + reviewInSteps, resolutionReason: reason,
    }),
    characterPressures: world.characterPressures,
    material: world.material,
  };
}

/**
 * Proposes new terms for a commitment the promisor can no longer keep as
 * originally made -- unilateral, the same way `deferCommitment` is: the
 * beneficiary is not asked to agree, only informed. Re-validated through
 * `checkCommitmentAuthority` against the *new* terms, so this cannot become
 * a way to promise something the promisor still does not actually control.
 * Stays `pending`, with a fresh `reviewAtStep`.
 */
export function renegotiateCommitment(
  world: CommitmentWorldView,
  commitmentId: string,
  atStep: number,
  newTerms: { readonly description: string; readonly requiredResource?: { accountId: string; minAmount: number } | null | undefined; readonly requiredOfficeId?: string | null | undefined },
  reviewInSteps = 4,
): CommitmentResolutionResult | { rejectionReason: string } {
  const commitment = world.commitments.find((c) => c.id === commitmentId);
  if (commitment === undefined) return world;
  const requiredOfficeId = newTerms.requiredOfficeId ?? null;
  const requiredResource = newTerms.requiredResource ?? null;
  const authority = checkCommitmentAuthority(world, commitment.promisorCharacterId, requiredOfficeId, requiredResource);
  if (!authority.ok) return { rejectionReason: authority.reason };
  return {
    characters: world.characters,
    commitments: patchCommitment(world.commitments, commitmentId, {
      status: "pending",
      description: newTerms.description,
      requiredOfficeId,
      requiredResource,
      reviewAtStep: atStep + reviewInSteps,
      resolutionReason: null,
    }),
    characterPressures: world.characterPressures,
    material: world.material,
  };
}

/** Marks the commitment broken, and creates the pressure that follows a broken promise. */
export function breakCommitment(
  world: CommitmentWorldView,
  commitmentId: string,
  atStep: number,
  reason: string,
): CommitmentResolutionResult {
  const commitment = world.commitments.find((c) => c.id === commitmentId);
  if (commitment === undefined) return world;
  const pressureResult = createPressure(
    { characters: world.characters, characterPressures: world.characterPressures },
    {
      id: `${commitment.id}:breach-pressure`,
      characterId: commitment.promisorCharacterId,
      kind: commitment.breachPressureKind,
      intensity: 55,
      label: `Broke a commitment to another character: ${commitment.description}`,
      sourceEventId: commitment.sourceEventId,
      atStep,
      reviewInSteps: 4,
      expiresInSteps: 20,
      visibility: commitment.visibility,
    },
  );
  return {
    characters: pressureResult.characters,
    commitments: patchCommitment(world.commitments, commitmentId, {
      status: "broken", resolvedAtStep: atStep, resolutionReason: reason,
    }),
    characterPressures: pressureResult.characterPressures,
    material: world.material,
  };
}

/** Cancels the commitment by mutual understanding -- no breach penalty. */
export function cancelCommitment(
  world: CommitmentWorldView,
  commitmentId: string,
  atStep: number,
  reason: string,
): CommitmentResolutionResult {
  return {
    characters: world.characters,
    commitments: patchCommitment(world.commitments, commitmentId, {
      status: "cancelled", resolvedAtStep: atStep, resolutionReason: reason,
    }),
    characterPressures: world.characterPressures,
    material: world.material,
  };
}

/** Commitments whose review step has arrived and are still pending -- candidates for this turn's intent formation. */
export function dueCommitments(commitments: readonly Commitment[], atStep: number): readonly Commitment[] {
  return commitments.filter((c) => (c.status === "pending" || c.status === "deferred") && c.reviewAtStep <= atStep);
}
