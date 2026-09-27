import type { WorldState } from "../world/world-state";
import { formatWorldDate, type ScenarioClock } from "../world/clock";

/**
 * What the player has promised, and what has been promised to them.
 *
 * A promise made in conversation becomes a commitment the world holds the
 * promisor to (product guide, "Conversations"): broken, it costs standing,
 * money or political safety. The player could make them and never see them
 * again, so the first they heard of a promise was the price of breaking it.
 *
 * Only the player's own, either way round -- promises between other people
 * are theirs. Only those still open.
 */

export interface PromiseReading {
  readonly id: string;
  /** "You promised Hieron of Syracuse" or "Hieron of Syracuse promised you". */
  readonly between: string;
  readonly description: string;
  readonly conditions: string | null;
  readonly dueLabel: string | null;
  /** Due within a fortnight, or already past its day. */
  readonly pressing: boolean;
  readonly yours: boolean;
}

const OPEN = new Set(["pending", "prepared", "deferred", "partially_fulfilled"]);
const PRESSING_DAYS = 14;

export function promisesOf(world: WorldState, characterId: string | null, clock?: ScenarioClock): readonly PromiseReading[] {
  if (characterId === null) return [];
  const nameOf = (id: string): string => world.characters.find((character) => character.id === id)?.name ?? "someone";
  const today = world.elapsedStep;
  return world.commitments
    .filter((commitment) => OPEN.has(commitment.status))
    .filter((commitment) => commitment.promisorCharacterId === characterId || commitment.beneficiaryCharacterId === characterId)
    .sort((a, b) => a.reviewAtStep - b.reviewAtStep)
    .map((commitment) => {
      const yours = commitment.promisorCharacterId === characterId;
      return {
        id: commitment.id,
        between: yours ? `You promised ${nameOf(commitment.beneficiaryCharacterId)}` : `${nameOf(commitment.promisorCharacterId)} promised you`,
        description: commitment.description,
        conditions: commitment.conditions.length > 0 ? commitment.conditions : null,
        dueLabel: clock === undefined ? null : formatWorldDate({ day: commitment.reviewAtStep, minute: 0 }, clock),
        pressing: yours && commitment.reviewAtStep - today <= PRESSING_DAYS,
        yours,
      };
    });
}
