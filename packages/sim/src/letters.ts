import { allOffices, buildAuthorityIndex, formatWorldDate, isDelivered, type DiplomaticMessage, type Office, type ScenarioClock, type WorldState } from "@chronica/shared";

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

/**
 * Whom an unanswered letter is in front of: the person it names, or, for one
 * still addressed to a power at large, every one of that power's people -- the
 * same reading the cognition portrait uses to show it. Once it has reached
 * them: a letter on the road is in front of nobody.
 */
function isPutTo(message: DiplomaticMessage, characterId: string, polityId: string | null, day: number): boolean {
  if (!isDelivered(message, day)) return false;
  return message.toCharacterId === characterId || (message.toCharacterId === null && polityId !== null && message.toPolityId === polityId);
}

/**
 * Who owes a letter an answer and has not yet been shown it, with why.
 *
 * A letter is as pressing as a plan's step: an unanswered one is answered by
 * silence, and silence is a refusal. Left to the router alone, seven of Rome's
 * allies were crowded out of three rounds by the Romans reacting to the order
 * that sent the letters, and then the depth cap asked only men with plans --
 * so none of them ever read what Rome asked. Each letter wakes its reader
 * once; after that his silence is his own.
 */
export function lettersOwed(world: WorldState, clock: ScenarioClock, excludeIds: readonly string[] = []): Map<string, string> {
  const excluded = new Set(excludeIds);
  const polityName = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;
  const owed = new Map<string, string>();
  for (const message of world.diplomacy) {
    if (message.status !== "awaiting_reply" || message.putToRecipientOnDay != null || message.toCharacterId === null) continue;
    if (!isDelivered(message, world.instant.day)) continue;
    const reader = world.characters.find((character) => character.id === message.toCharacterId);
    if (reader === undefined || !reader.alive || excluded.has(reader.id) || owed.has(reader.id)) continue;
    const due = message.replyDueByStep === null ? "" : `, the answer due by ${formatWorldDate({ day: message.replyDueByStep, minute: 0 }, clock)}`;
    owed.set(reader.id, `a letter from ${polityName(message.fromPolityId)} awaits their answer ("${message.subject}"${due})`);
  }
  return owed;
}

/** Every unanswered letter in front of someone in this round's cast, marked as read today. */
export function markLettersPut(world: WorldState, castIds: ReadonlySet<string>): WorldState {
  const cast = world.characters.filter((character) => castIds.has(character.id));
  if (cast.length === 0) return world;
  const today = world.instant.day;
  let changed = false;
  const diplomacy = world.diplomacy.map((message) => {
    if (message.status !== "awaiting_reply" || message.putToRecipientOnDay != null) return message;
    if (!cast.some((character) => isPutTo(message, character.id, character.polityId, today))) return message;
    changed = true;
    return { ...message, putToRecipientOnDay: today };
  });
  return changed ? { ...world, diplomacy } : world;
}

/**
 * The next letter date still to come, as a sort key: a reply date, or the day
 * a letter reaches its reader. The burst may not jump past either. The tick
 * decides silence on the reply date, and a war an ultimatum threatened opens
 * on it -- not two months later, when the calendar's next project happened to
 * fall; and a letter arriving is somebody's business the day it arrives.
 */
export function nextReplyDueKey(world: WorldState, afterKey: number): number | undefined {
  return world.diplomacy
    .filter((message) => message.status === "awaiting_reply")
    .flatMap((message) => [
      ...(message.replyDueByStep === null ? [] : [message.replyDueByStep * 1440]),
      ...(message.deliveredOnDay == null ? [] : [message.deliveredOnDay * 1440]),
    ])
    .filter((key) => key > afterKey)
    .sort((a, b) => a - b)[0];
}

/**
 * A letter is still waiting on its reader: nobody has shown it to him yet, or
 * he has read it and its term is already up. Either way the next few days
 * settle it, and the burst should not jump a month before they do -- two
 * allies left out of a crowded first round were otherwise first asked on the
 * reply date itself, and their silence was then dated to whatever came next
 * on the calendar, fifty days on.
 */
export function aLetterWaitsOnItsReader(world: WorldState, excludeIds: readonly string[] = []): boolean {
  const excluded = new Set(excludeIds);
  const today = world.instant.day;
  return world.diplomacy.some((message) => {
    if (message.status !== "awaiting_reply" || message.toCharacterId === null || excluded.has(message.toCharacterId)) return false;
    // Still on the road: its arrival is on the calendar (`nextReplyDueKey`).
    if (!isDelivered(message, today)) return false;
    if (message.putToRecipientOnDay != null) return message.replyDueByStep !== null && message.replyDueByStep <= today;
    return world.characters.some((character) => character.id === message.toCharacterId && character.alive);
  });
}
