import { allOffices, buildAuthorityIndex, type Office, type WorldState } from "@chronica/shared";

/**
 * Who answers a letter sent to a power.
 *
 * A letter addressed to a power named no person, so it was put to every one of
 * that power's people: three Romans read "Protection for Messana" in the same
 * round and all three answered it, and two were refused as already answered --
 * thirty such refusals in one evening's eval, each an answer written and paid
 * for. It was also a leak: a private citizen was handed his government's
 * correspondence as if it were his own.
 *
 * A power's letters go to whoever holds its diplomatic authority: the grant
 * with the most powers over that power, the office holder's before anybody
 * else's. Failing any, the first of its people to hold an office; failing
 * that, nobody, and the letter stays addressed to the power as it always was.
 */
export function diplomaticAnswererOf(world: WorldState, polityId: string, offices: readonly Office[], notFrom: string | null = null): string | null {
  const members = new Set(world.characters.filter((character) => character.alive && character.polityId === polityId && character.id !== notFrom).map((character) => character.id));
  if (members.size === 0) return null;
  const index = buildAuthorityIndex(
    { officeSeats: world.material.officeSeats, forces: world.material.forces, accounts: world.material.accounts },
    world.authorityGrants,
    allOffices(world, offices),
    world.elapsedStep,
  );
  const diplomats = index.grants
    .filter((grant) => grant.domain === "diplomatic" && grant.scope.kind === "polity" && grant.scope.id === polityId
      && grant.holder.kind === "character" && members.has(grant.holder.id))
    .sort((a, b) => b.powers.length - a.powers.length || a.holder.id.localeCompare(b.holder.id));
  if (diplomats.length > 0) return diplomats[0]!.holder.id;
  const officeHolders = world.characters
    .filter((character) => members.has(character.id) && character.officeId !== null)
    .map((character) => character.id)
    .sort();
  return officeHolders[0] ?? null;
}

/**
 * Letters already waiting with nobody named, addressed now: the scenario's own
 * opening letters, and every save written before a letter was addressed when
 * sent. Run once at the top of a burst, before anybody is asked anything.
 */
export function addressWaitingLetters(world: WorldState, offices: readonly Office[]): WorldState {
  if (!world.diplomacy.some((message) => message.status === "awaiting_reply" && message.toCharacterId === null)) return world;
  return {
    ...world,
    diplomacy: world.diplomacy.map((message) => {
      if (message.status !== "awaiting_reply" || message.toCharacterId !== null) return message;
      const answerer = diplomaticAnswererOf(world, message.toPolityId, offices, message.fromCharacterId);
      return answerer === null ? message : { ...message, toCharacterId: answerer };
    }),
  };
}
