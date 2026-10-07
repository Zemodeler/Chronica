import { offerMetadata } from "./treaty-duties";
import { WorldDeltaSchema, formatWorldDate, isDelivered, settlePeaceTalks, tradeAddresseeFinder, type DiplomaticMessage, type Office, type ScenarioClock, type WorldDelta, type WorldState } from "@chronica/shared";

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
  // One reading for the engine and the page (`trade-desk.ts`): the sheet that says who decides a trade and the rule that
  // addresses the letter are the same function, so what the player is told is who in fact answers.
  return tradeAddresseeFinder(world, offices)(polityId, notFrom)?.characterId ?? null;
}

/**
 * Letters already waiting with nobody named, addressed now: the scenario's own
 * opening letters, and every save written before a letter was addressed when
 * sent. Run once at the top of a burst, before anybody is asked anything.
 */
export function addressWaitingLetters(world: WorldState, offices: readonly Office[]): WorldState {
  world = settlePeaceTalks(world);
  world = { ...world, diplomacy: world.diplomacy.map((message) => ({ ...message, ...offerMetadata(world, message) })) };
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
 * A plain letter between two powers, neither of them the player's.
 *
 * Nothing in it is asked of anybody who matters to the player: no agreement
 * offered, no terms to carry out, no threat behind it. Carthage writing to
 * Syracuse and Syracuse writing back is the world's background, and each reply
 * was a full model call for a line the player reads, if at all, in a Chronicle
 * paragraph. Such a letter no longer wakes its reader: it waits in his section,
 * and he answers it if he is asked about something for another reason. It never
 * lapses into silence unread (`tick`), so nobody is refused for it.
 */
export function isBackgroundLetter(message: DiplomaticMessage, ownPolityId: string | null | undefined): boolean {
  if (ownPolityId === null || ownPolityId === undefined) return false;
  if (message.fromPolityId === ownPolityId || message.toPolityId === ownPolityId || message.fromPolityId === message.toPolityId) return false;
  return message.kind === "letter"
    && (message.proposes ?? []).length === 0
    && (message.clauses ?? []).length === 0
    && (message.onRefusal ?? null) === null;
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
export function lettersOwed(world: WorldState, clock: ScenarioClock, excludeIds: readonly string[] = [], ownPolityId: string | null = null): Map<string, string> {
  const excluded = new Set(excludeIds);
  const polityName = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;
  const owed = new Map<string, string>();
  for (const message of world.diplomacy) {
    if (message.status !== "awaiting_reply" || message.putToRecipientOnDay != null || message.toCharacterId === null || message.heldAnswer !== undefined) continue;
    if (!isDelivered(message, world.instant.day) || isBackgroundLetter(message, ownPolityId)) continue;
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
      // The day an answer decided at send time comes back: the walk stops there, and it is given (`heldAnswersDue`).
      ...(message.heldAnswer === undefined ? [] : [message.heldAnswer.comesOnDay * 1440]),
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
export function aLetterWaitsOnItsReader(world: WorldState, excludeIds: readonly string[] = [], ownPolityId: string | null = null): boolean {
  const excluded = new Set(excludeIds);
  const today = world.instant.day;
  return world.diplomacy.some((message) => {
    if (message.status !== "awaiting_reply" || message.toCharacterId === null || excluded.has(message.toCharacterId) || message.heldAnswer !== undefined) return false;
    if (isBackgroundLetter(message, ownPolityId) && message.putToRecipientOnDay == null) return false;
    // Still on the road: its arrival is on the calendar (`nextReplyDueKey`).
    if (!isDelivered(message, today)) return false;
    if (message.putToRecipientOnDay != null) return message.replyDueByStep !== null && message.replyDueByStep <= today;
    return world.characters.some((character) => character.id === message.toCharacterId && character.alive);
  });
}

/** An answer decided when the letter was sent, now come back to the writer: whose it is, and the acts it is made of. */
export interface HeldAnswerDue {
  readonly messageId: string;
  readonly readerId: string;
  readonly deltas: readonly WorldDelta[];
}

/**
 * Letters whose answer was decided at send time (`letter-reply.ts`) and whose day has come.
 *
 * The model was called when the player wrote, and what it had the reader say was
 * kept on the letter until the road there and back had been walked. Now the
 * story is at that day, and the answer is given as the reader's own act, judged
 * by the engine as any other act of his would be.
 */
export function heldAnswersDue(world: WorldState, day: number = world.instant.day): readonly HeldAnswerDue[] {
  return world.diplomacy.flatMap((message): HeldAnswerDue[] => {
    if (message.status !== "awaiting_reply" || message.heldAnswer === undefined || message.heldAnswer.comesOnDay > day || message.toCharacterId === null) return [];
    // A reader who has died on the road gives no answer: the letter is as any unanswered one, and his successor is asked.
    const reader = world.characters.find((character) => character.id === message.toCharacterId);
    if (reader === undefined || !reader.alive) return [{ messageId: message.id, readerId: message.toCharacterId, deltas: [] }];
    const deltas = message.heldAnswer.deltas.flatMap((raw) => {
      const read = WorldDeltaSchema.safeParse(raw);
      return read.success ? [read.data] : [];
    });
    return [{ messageId: message.id, readerId: message.toCharacterId, deltas }];
  });
}

/** The letter put back as it was before it was answered ahead of time: awaiting its reader, who is asked as anybody is. */
export function withoutHeldAnswer(world: WorldState, messageId: string): WorldState {
  if (!world.diplomacy.some((message) => message.id === messageId && message.heldAnswer !== undefined)) return world;
  return {
    ...world,
    diplomacy: world.diplomacy.map((message) => {
      if (message.id !== messageId) return message;
      const { heldAnswer: _given, ...rest } = message;
      return rest;
    }),
  };
}
