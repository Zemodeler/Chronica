import { isMagistracy, type Character, type Office } from "./character";
import { resolveEligibility } from "./political-authority";
import type { WorldState } from "../world/world-state";

/**
 * Who could hold an office: the rules an election uses to find its men, kept
 * where both the election (`sim/elections.ts`) and the office's note can
 * read them, so the note's "who could be next" is the election's own answer.
 */

/** The standing below which the electors do not think of a man unprompted. */
export const ELECTABLE_MIN_PRESTIGE_BPS = 5_000;

/** What the office's own requirements ask, for eligibility and for standing. */
export function officeRequirements(world: Pick<WorldState, "material">, office: Office): { readonly requirementIds: readonly string[]; readonly minStanding: number } {
  const seat = world.material.officeSeats.find((candidate) => candidate.officeId === office.id);
  const requirementIds = seat?.eligibilityRequirementIds ?? office.eligibilityRequirementIds;
  const minStanding = world.material.eligibilityRequirements
    .filter((requirement) => requirement.kind === "min_prestige" && requirementIds.includes(requirement.id))
    .map((requirement) => (requirement.params.minPrestigeBps as number | undefined) ?? 0)[0] ?? ELECTABLE_MIN_PRESTIGE_BPS;
  return { requirementIds, minStanding };
}

/**
 * Beneath him: a man who holds a magistracy as high as this one, or has held
 * one two rungs above it. A former consul does not stand for quaestor, and
 * the Senate does not think of him for it, though he may put himself
 * forward. A censor might be consul again; it happened.
 */
export function isBeneath(world: Pick<WorldState, "material">, office: Office, officesById: ReadonlyMap<string, Office>, character: Character): boolean {
  if (office.rank === undefined) return false;
  const rank = office.rank;
  // What he sits in today as well as what is written down: a man elected
  // consul this morning has no tenure on record until tomorrow.
  return [
    ...character.officesHeld.map((tenure) => tenure.officeId),
    ...world.material.officeSeats.filter((seat) => seat.holderCharacterId === character.id && seat.status === "held").map((seat) => seat.officeId),
  ].some((officeId) => {
    const held = officesById.get(officeId);
    if (held === undefined || held.polityId !== office.polityId || !isMagistracy(held) || held.rank === undefined) return false;
    const sitting = world.material.officeSeats.some((seat) => seat.officeId === held.id && seat.holderCharacterId === character.id && seat.status === "held");
    return held.rank >= rank + 2 || (sitting && held.rank >= rank);
  });
}

/**
 * Who could hold it: eligible, alive, and not already sitting in it. Only
 * those sitting in this office are kept out: a man cannot hold two seats of
 * one college. Anyone holding some other office used to be kept out as well,
 * so nobody could rise -- a quaestor could never become consul, nor a
 * tribune a praetor.
 */
export function isEligibleFor(world: WorldState, office: Office, requirementIds: readonly string[], character: Character, toDay: number): boolean {
  const sitting = world.material.officeSeats.some((seat) => seat.officeId === office.id && seat.status === "held" && seat.holderCharacterId === character.id);
  return character.alive && !sitting && resolveEligibility({ ...world, elapsedStep: toDay }, character.id, requirementIds, office.id).eligible;
}

/** Who the electors would think of unprompted: eligible, of standing, not above it, highest standing first. */
export function electableFor(
  world: WorldState,
  office: Office,
  officesById: ReadonlyMap<string, Office>,
  toDay: number,
  excludeId: string | null = null,
): Character[] {
  const { requirementIds, minStanding } = officeRequirements(world, office);
  return world.characters
    .filter((character) => character.id !== excludeId && character.prestigeBps >= minStanding && !isBeneath(world, office, officesById, character) && isEligibleFor(world, office, requirementIds, character, toDay))
    .sort((a, b) => b.prestigeBps - a.prestigeBps || a.id.localeCompare(b.id));
}
