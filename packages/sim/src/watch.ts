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
 * Some conditions are about a *change* rather than a state -- a province
 * changing hands, an army arriving somewhere it already was. Those are answered
 * against the world as it stood when the order was given, which is why the
 * opening state is carried through rather than only the current one.
 */

const fitStrength = (force: { readonly personnel: readonly { readonly fit: number }[] }): number =>
  force.personnel.reduce((sum, category) => sum + category.fit, 0);

export function isWatchSatisfied(predicate: WatchPredicate, opening: WorldState, now: WorldState): boolean {
  switch (predicate.kind) {
    case "force_enters_province": {
      const matches = (world: WorldState): boolean =>
        world.material.forces.some(
          (force) =>
            force.locationId === predicate.provinceId &&
            (predicate.polityId === undefined ? true : force.polityId === predicate.polityId),
        );
      // Arrival, not presence: an army already standing there would otherwise
      // satisfy the watch on the first hop and end the order it was given with.
      return matches(now) && !matches(opening);
    }
    case "province_control_changes": {
      const controllerIn = (world: WorldState): string | null | undefined =>
        world.map.provinces.find((province) => province.id === predicate.provinceId)?.controllerPolityId;
      return controllerIn(now) !== controllerIn(opening);
    }
    case "polity_strength_above": {
      const headcount = now.material.forces
        .filter((force) => force.polityId === predicate.polityId)
        .reduce((sum, force) => sum + fitStrength(force), 0);
      return headcount > predicate.headcount;
    }
    case "force_strength_below": {
      const force = now.material.forces.find((candidate) => candidate.id === predicate.forceId);
      return force !== undefined && fitStrength(force) < predicate.headcount;
    }
    case "account_below": {
      const account = now.material.accounts.find((candidate) => candidate.id === predicate.accountId);
      return account !== undefined && account.balance < predicate.amount;
    }
    case "arrears_reach": {
      const obligation = now.material.obligations.find((candidate) => candidate.id === predicate.obligationId);
      return obligation !== undefined && obligation.missedPeriods >= predicate.periods;
    }
    case "character_dies": {
      const character = now.characters.find((candidate) => candidate.id === predicate.characterId);
      return character !== undefined && !character.alive;
    }
    case "office_vacant": {
      const seats = now.material.officeSeats.filter((seat) => seat.officeId === predicate.officeId);
      if (seats.length === 0) return false;
      const anyVacant = seats.some((seat) => seat.holderCharacterId === null);
      return anyVacant === predicate.vacant;
    }
    default:
      return false;
  }
}
