import type { CastSeat, WorldState } from "@chronica/shared";
import { layPlan } from "./plans";
import { createIdFactory } from "./ports";

/**
 * A kit for the tests that need people the model may be asked about.
 *
 * Far people are never asked (`cognition-policy.ts`): the model is spent on the player's circle, the near with plots, and the standing cast. A test of how a burst
 * spends its calls, its time or its rounds needs somebody to ask, so it seats him: the first `count` living people of rank (an office or a command), the player
 * aside, are put in the cast, as a burst's own review would seat the ones with a plot.
 */
export function withACast(world: WorldState, playerId: string, count = 6): WorldState {
  const commanders = new Set(world.material.forces.map((force) => force.commanderCharacterId));
  const chosen = world.characters
    .filter((character) => character.alive && character.id !== playerId && (character.officeId !== null || commanders.has(character.id)))
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, count);
  const seats: CastSeat[] = ["chain", "world", "open"];
  return {
    ...world,
    cast: {
      ...world.cast,
      members: chosen.map((character, index) => ({
        characterId: character.id, seat: seats[index % seats.length]!, sinceStep: world.elapsedStep, salience: 60, why: "has a plot of his own", belowFor: 0, reviews: 0,
      })),
    },
  };
}

/**
 * The same, for a rotation with nobody pressing: the first `count` living people are brought to the province the player stands in, each with a plan of his own, its first
 * step still `inDays` off (past the days a step wakes its owner): which is what makes a man near the player askable on his own business (`cognition-policy.ts`).
 */
export function withPlans(world: WorldState, playerId: string, count = 4, inDays = 20): WorldState {
  const player = world.characters.find((character) => character.id === playerId);
  if (player === undefined) return world;
  const chosen = world.characters
    .filter((character) => character.alive && character.id !== playerId && !world.material.forces.some((force) => force.commanderCharacterId === character.id))
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, count)
    .map((character) => character.id);
  let next: WorldState = { ...world, characters: world.characters.map((character) => (chosen.includes(character.id) ? { ...character, locationProvinceId: player.locationProvinceId } : character)) };
  for (const id of chosen) {
    next = layPlan(next, id, { ambition: "See to his own affairs", kind: "office", steps: [{ act: "Look to his own affairs", inDays, when: null }] }, createIdFactory(`plan-${id}`)).world;
  }
  return next;
}
