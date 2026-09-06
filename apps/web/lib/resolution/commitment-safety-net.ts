import "server-only";

import type { FactualEvent, WorldState } from "@chronica/shared";
import { deferCommitment } from "@chronica/shared";

/**
 * Deterministic, non-LLM guarantee (docs/30): a due commitment must not sit
 * `pending`/`deferred` forever just because nothing this turn -- not a
 * formed proposal, not the Game Master originating its own action -- ever
 * resolved it. Before this step existed, `fulfillCommitment`/`deferCommitment`/
 * `breakCommitment` ran automatically every turn a commitment came due; now
 * that resolving one is the Game Master's own choice
 * (`fulfill_commitment`/`defer_commitment`/`break_commitment`, docs/30), an
 * ignored commitment would otherwise never move again.
 *
 * Deliberately narrow, the same shape as `military-emergency-fallback.ts`:
 * it only ever auto-defers -- never auto-fulfills (that would spend a
 * resource on the promisor's behalf) and never auto-breaks (that is a
 * reputational penalty, a real strategic consequence) -- and only once a
 * commitment has sat unresolved for `GRACE_WINDOW_STEPS` past its own review
 * step, so the Game Master has real turns to address it first. This is a
 * deliberate, temporary exception to the command contract (docs/27): remove
 * it once shadow-turn or production evidence shows the Game Master reliably
 * resolves every due commitment without this backstop ever firing.
 */
export interface CommitmentSafetyNetResult {
  readonly world: WorldState;
  readonly events: readonly Omit<FactualEvent, "id">[];
}

const GRACE_WINDOW_STEPS = 3;
const DEFAULT_REVIEW_STEPS = 4;

export function applyCommitmentSafetyNet(world: WorldState, atStep: number): CommitmentSafetyNetResult {
  const events: Omit<FactualEvent, "id">[] = [];
  let next = world;

  for (const commitment of world.commitments) {
    if (commitment.status !== "pending" && commitment.status !== "deferred") continue;
    if (atStep - commitment.reviewAtStep < GRACE_WINDOW_STEPS) continue;

    const reason = "No one acted on this commitment before its review window closed; deferred by default.";
    const result = deferCommitment(next, commitment.id, atStep, reason, DEFAULT_REVIEW_STEPS);
    next = { ...next, characters: [...result.characters], commitments: [...result.commitments], characterPressures: [...result.characterPressures], material: result.material };
    events.push({
      atStep,
      kind: "action",
      actionId: "defer_commitment",
      actorId: commitment.promisorCharacterId,
      parameters: { commitmentId: commitment.id, reason },
      summary: `A commitment to ${commitment.beneficiaryCharacterId} goes unaddressed and is deferred by default: ${commitment.description}`,
      materialConsequence: false,
    });
  }

  return { world: next, events };
}
