import type { WatchPredicate, WorldState } from "@chronica/shared";

/**
 * Evaluating what the ruler asked to be woken for (VISION §23's
 * `watch_condition`).
 *
 * `world/watch.ts` defined the language years ago and nothing ever read it, so
 * "wake me when the army reaches Boii country" was prose the world could not
 * act on: each order was one burst with one budget, and a forty-five-day march
 * had to be re-authorised four times to cross. This is the missing half.
 *
 * Deterministic and free, per that module's own reasoning: no model call is made
 * to decide whether a watch has fired, so a burst can test it after every hop
 * without the elastic clock becoming the most expensive thing in the design.
 *
 * **Every condition is about a change, not a state.** A watch is a thing to be
 * woken *for*; a condition that was already true when the order was given has
 * not happened, and waking for it ends the order in the act of giving it. Two
 * arms guarded against that and the rest did not, so "wake me when the north
 * is eight thousand strong" -- said by a ruler who already had eight thousand
 * men -- fired on the first hop, and the order it was attached to carried the
 * world two days and did nothing. That is what the whole watch mechanism
 * exists to prevent: it was built so a forty-five-day march need not be
 * re-authorised four times to cross.
 *
 * So the predicate is evaluated twice -- against the world as it stands and
 * against the world as it stood when the order was given -- and it has fired
 * only if it holds now and did not hold then.
 */

const fitStrength = (force: { readonly personnel: readonly { readonly fit: number }[] }): number =>
  force.personnel.reduce((sum, category) => sum + category.fit, 0);

/** Whether the condition holds of one world, said without reference to any other. */
function holdsIn(predicate: WatchPredicate, world: WorldState): boolean {
  switch (predicate.kind) {
    case "force_enters_province":
      return world.material.forces.some(
        (force) =>
          force.locationId === predicate.provinceId &&
          (predicate.polityId === undefined ? true : force.polityId === predicate.polityId),
      );
    case "polity_strength_above": {
      const headcount = world.material.forces
        .filter((force) => force.polityId === predicate.polityId)
        .reduce((sum, force) => sum + fitStrength(force), 0);
      return headcount > predicate.headcount;
    }
    case "force_strength_below": {
      const force = world.material.forces.find((candidate) => candidate.id === predicate.forceId);
      return force !== undefined && fitStrength(force) < predicate.headcount;
    }
    case "account_below": {
      const account = world.material.accounts.find((candidate) => candidate.id === predicate.accountId);
      return account !== undefined && account.balance < predicate.amount;
    }
    case "arrears_reach": {
      const obligation = world.material.obligations.find((candidate) => candidate.id === predicate.obligationId);
      return obligation !== undefined && obligation.missedPeriods >= predicate.periods;
    }
    case "character_dies": {
      const character = world.characters.find((candidate) => candidate.id === predicate.characterId);
      return character !== undefined && !character.alive;
    }
    case "office_vacant": {
      const seats = world.material.officeSeats.filter((seat) => seat.officeId === predicate.officeId);
      if (seats.length === 0) return false;
      return seats.some((seat) => seat.holderCharacterId === null) === predicate.vacant;
    }
    // Not a state anybody can hold: it is the comparison itself.
    case "province_control_changes":
      return false;
    default:
      return false;
  }
}

export function isWatchSatisfied(predicate: WatchPredicate, opening: WorldState, now: WorldState): boolean {
  // Its own kind of change, and the only one that cannot be phrased as a
  // state: who holds the ground now against who held it then.
  if (predicate.kind === "province_control_changes") {
    const controllerIn = (world: WorldState): string | null | undefined =>
      world.map.provinces.find((province) => province.id === predicate.provinceId)?.controllerPolityId;
    return controllerIn(now) !== controllerIn(opening);
  }
  // Everything else: it has to have *become* true.
  return holdsIn(predicate, now) && !holdsIn(predicate, opening);
}
