import type { WorldState } from "@chronica/shared";

/** How long a settled pressure is kept after it was last touched: two game years. */
export const SETTLED_PRESSURE_KEPT_DAYS = 730;

/**
 * A man's pressures that ended long ago -- resolved or expired, last touched
 * more than two years back and not one of the few his mind still points at --
 * are let go. They were never read again, and the list only ever grew, every
 * scan over it a little longer than the last. Pressures still active, and
 * every procedure, vote and promise, are left as they are.
 */
export function forgetSettledPressures(world: WorldState, toDay: number): WorldState {
  const cutoff = toDay - SETTLED_PRESSURE_KEPT_DAYS;
  const pointedAt = new Set(world.characters.flatMap((character) => character.mind.currentPressures));
  const keep = (pressure: WorldState["characterPressures"][number]): boolean =>
    pressure.status === "active" || pointedAt.has(pressure.id)
    || Math.max(pressure.createdAtStep, pressure.reviewAtStep, pressure.expiresAtStep ?? 0) > cutoff;
  if (world.characterPressures.every(keep)) return world;
  return { ...world, characterPressures: world.characterPressures.filter(keep) };
}
