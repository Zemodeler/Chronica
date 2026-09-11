import { stableHash } from "../determinism";
import type { LifeStage } from "./age";
import type { Character } from "./character";

// Deterministic life-event scheduling and review (character-sim phase 5).
//
// A life event is never left to AI narration: a roll is computed here,
// deterministically, from the character's life stage and the scenario's own
// authored rates (which default to 0 -- a scenario that authors none gets no
// automatic death/incapacity at all). AI may narrate what a committed roll
// produced; it never invents the roll itself.

export type LifeEventKind = "death" | "incapacitation" | "recovery";

export interface LifeEventResult {
  readonly kind: LifeEventKind;
  readonly cause: string;
}

/**
 * Deterministic via `stableHash` -- never `Math.random()`. Two identical
 * worlds at the same step always roll the same outcome.
 */
export function rollLifeEvent(
  character: Pick<Character, "id" | "disqualifyingStatuses">,
  lifeStage: LifeStage | undefined,
  atStep: number,
): LifeEventResult | null {
  if (lifeStage === undefined) return null;
  const incapacitated = character.disqualifyingStatuses.includes("incapacitated");

  if (incapacitated) {
    if (lifeStage.recoveryRatePerYearBps <= 0) return null;
    const roll = stableHash([character.id, atStep, "life-event", "recovery"]) % 10_000;
    return roll < lifeStage.recoveryRatePerYearBps ? { kind: "recovery", cause: "A period of recovery." } : null;
  }

  if (lifeStage.mortalityRatePerYearBps > 0) {
    const mortalityRoll = stableHash([character.id, atStep, "life-event", "mortality"]) % 10_000;
    if (mortalityRoll < lifeStage.mortalityRatePerYearBps) {
      return { kind: "death", cause: `Natural causes, in the ${lifeStage.label} of life.` };
    }
  }
  if (lifeStage.incapacityRatePerYearBps > 0) {
    const incapacityRoll = stableHash([character.id, atStep, "life-event", "incapacity"]) % 10_000;
    if (incapacityRoll < lifeStage.incapacityRatePerYearBps) {
      return { kind: "incapacitation", cause: `Failing health, in the ${lifeStage.label} of life.` };
    }
  }
  return null;
}

/** Characters whose scheduled life review has arrived -- the same `(collection, atStep)` idiom `dueCommitments` uses. */
export function dueLifeReviews(characters: readonly Character[], atStep: number): readonly Character[] {
  return characters.filter((c) => c.alive && c.nextLifeReviewAtStep !== null && c.nextLifeReviewAtStep <= atStep);
}

/** The step at which this character's next life review falls due. */
export function nextReviewStep(atStep: number, reviewIntervalSteps: number): number {
  return atStep + reviewIntervalSteps;
}
