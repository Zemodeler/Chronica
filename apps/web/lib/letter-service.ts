import "server-only";

import { WorldRevisionConflictError, commitBurst, factRowOf, failBurst, findRunningBurst, getWorldView, instantSortKeyOf, startBurst } from "@chronica/db";
import { inTheSameRegion, lettersAwaitingYou, whoMayBeReached, type Office, type WorldDelta, type WorldState } from "@chronica/shared";
import { applyDeltas, createIdFactory, materializeFacts } from "@chronica/sim";
import { livenessAt } from "./burst-status";
import { resolveContext } from "./simulation-service";

/**
 * Letters written from the letter tray: to somebody out of the player's
 * region, or back to somebody who wrote first.
 *
 * A letter from another power could be answered only at the desk, as an order
 * the model read and turned into an answer -- so a player written to could
 * not simply write back. And anybody in the tray could be spoken with at
 * once, however far off, so a letter to Syracuse was answered before the ink
 * dried. Now both are what they are: a letter goes out now, as one
 * `diplomatic_message_send` or `diplomatic_message_answer` applied by the
 * engine that applies every other one, and the person it is written to
 * answers it when the world next moves (`lettersOwed` wakes them).
 *
 * Neither needs a model, so each is committed as a burst of its own, like an
 * army's new name (`force-revision-service.ts`).
 */

export type LetterReply = "accepted" | "refused" | "countered";

export type LetterOutcome =
  | { readonly status: "sent" }
  | { readonly status: "error"; readonly code: 400 | 401 | 403 | 404 | 409; readonly message: string };

const refuse = (code: 400 | 401 | 403 | 404 | 409, message: string): LetterOutcome => ({ status: "error", code, message });

const BODY_MAX = 1_200;
const SUBJECT_MAX = 240;
const BUSY = "The world is moving on an earlier order. Wait for it to settle, then send it.";

/** A subject in the writer's own words: the first sentence, cut to fit. */
function subjectOf(subject: string | undefined, body: string): string {
  const given = subject?.trim();
  if (given !== undefined && given.length > 0) return given.slice(0, SUBJECT_MAX);
  const first = body.split(/(?<=[.!?])\s/)[0]!.trim();
  return first.length <= 80 ? first : `${first.slice(0, 79).trimEnd()}…`;
}

/** The power a person writes as, or is written to through: their own, or failing one, the one that holds the ground they stand on. */
function polityOfPerson(world: WorldState, characterId: string): string | null {
  const person = world.characters.find((character) => character.id === characterId);
  if (person === undefined) return null;
  if (person.polityId !== null) return person.polityId;
  return world.map.provinces.find((province) => province.id === person.locationProvinceId)?.controllerPolityId ?? null;
}

export interface NewLetter {
  readonly toCharacterId: string;
  readonly subject?: string | undefined;
  readonly body: string;
}

/** A letter to somebody out of the player's region. */
export async function writeLetter(gameId: string, letter: NewLetter): Promise<LetterOutcome> {
  const body = letter.body.trim();
  if (body.length === 0 || body.length > BODY_MAX) return refuse(400, `A letter must be between 1 and ${BODY_MAX} characters.`);
  return withLetterBurst(gameId, (world, characterId, offices) => {
    const writer = world.characters.find((character) => character.id === characterId);
    const reader = world.characters.find((character) => character.id === letter.toCharacterId);
    if (writer === undefined) return refuse(404, "You are not in this world.");
    if (reader === undefined || reader.id === characterId) return refuse(404, "There is no such person to write to.");
    if (!reader.alive) return refuse(409, `${reader.name} is dead.`);
    // Anybody may be written to; whether they answer is their business, in
    // character. Only somebody here who would give you a hearing is spoken
    // with instead.
    if (inTheSameRegion(writer, reader)
      && whoMayBeReached({ world, offices, reacherId: characterId, targetId: reader.id, channel: "correspondence", orderAttempts: world.orderAttempts }).reachable) {
      return refuse(409, `${reader.name} is here. Speak with them instead.`);
    }
    const fromPolityId = polityOfPerson(world, characterId);
    const toPolityId = polityOfPerson(world, reader.id);
    if (fromPolityId === null || toPolityId === null) return refuse(409, `No road carries a letter from you to ${reader.name}.`);
    // The last letter between them, so the world reads this one as the next in the thread.
    const previous = world.diplomacy.filter((message) =>
      (message.fromCharacterId === reader.id && message.toCharacterId === characterId) || (message.fromCharacterId === characterId && message.toCharacterId === reader.id)).at(-1);
    const subject = subjectOf(letter.subject, body);
    return {
      deltas: [{
        op: "diplomatic_message_send",
        localId: "letter",
        kind: "letter",
        fromPolityId,
        fromCharacterRef: characterId,
        toPolityId,
        toCharacterRef: reader.id,
        subject,
        terms: body,
        replyWithinDays: null,
        inReplyToRef: previous?.id ?? null,
        visibility: "private",
        reason: `A letter in ${writer.name}'s own hand.`,
      }],
      orderText: `Write to ${reader.name}: ${body}`,
      title: `${writer.name} writes to ${reader.name}`,
      body: `"${subject}" -- ${body}`,
      subjectIds: [writer.id, reader.id],
    };
  });
}

export interface LetterAnswer {
  readonly messageId: string;
  readonly reply: LetterReply;
  readonly words: string;
  readonly agreementKind?: string | undefined;
}

/**
 * Answering a letter waiting on the player: accepting it, refusing it, or
 * writing back. Writing back is answering it and sending a letter in the same
 * breath, as the cognition prompt tells anybody else to counter; the sender
 * then answers that letter when the world next moves.
 */
export async function answerLetter(gameId: string, answer: LetterAnswer): Promise<LetterOutcome> {
  const words = answer.words.trim();
  if (words.length === 0 || words.length > BODY_MAX) return refuse(400, `An answer must be between 1 and ${BODY_MAX} characters.`);
  return withLetterBurst(gameId, (world, characterId, offices) => {
    const waiting = lettersAwaitingYou(world, characterId, offices).find((letter) => letter.id === answer.messageId);
    const message = world.diplomacy.find((candidate) => candidate.id === answer.messageId);
    if (waiting === undefined || message === undefined) return refuse(404, "That letter is not waiting on your answer.");
    const writer = world.characters.find((character) => character.id === characterId);
    const sender = world.characters.find((character) => character.id === message.fromCharacterId);
    if (writer === undefined) return refuse(404, "You are not in this world.");
    if (answer.reply !== "countered" && !waiting.asksYesOrNo) return refuse(400, "That letter asks for nothing to accept or refuse. Write back to it.");
    const agreementKind = answer.reply === "accepted" && waiting.offers.length > 1
      ? waiting.offers.find((offer) => offer.kind === answer.agreementKind)?.kind
      : undefined;
    if (answer.reply === "accepted" && waiting.offers.length > 1 && agreementKind === undefined) return refuse(400, "Say which of what it offers you take up.");

    const deltas: WorldDelta[] = [{
      op: "diplomatic_message_answer",
      messageRef: message.id,
      answer: answer.reply,
      answerText: words,
      ...(agreementKind === undefined ? {} : { agreementKind }),
      reason: `${writer.name}'s answer, in their own words.`,
    }];
    const fromPolityId = polityOfPerson(world, characterId);
    // Written back to, the letter's sender has a letter of their own to answer.
    if (answer.reply === "countered" && sender !== undefined && sender.alive && fromPolityId !== null) {
      deltas.push({
        op: "diplomatic_message_send",
        localId: "reply",
        kind: "letter",
        fromPolityId,
        fromCharacterRef: characterId,
        toPolityId: message.fromPolityId,
        toCharacterRef: sender.polityId === message.fromPolityId ? sender.id : null,
        subject: `Re: ${message.subject}`.slice(0, SUBJECT_MAX),
        terms: words,
        replyWithinDays: null,
        inReplyToRef: message.id,
        visibility: message.visibility === "public" ? "polity" : message.visibility,
        reason: `${writer.name} writes back.`,
      });
    }
    const verb = answer.reply === "accepted" ? "accepts" : answer.reply === "refused" ? "refuses" : "answers";
    const from = sender?.name ?? "another power";
    return {
      deltas,
      orderText: `Answer ${from}'s letter "${message.subject}" (${answer.reply}): ${words}`,
      title: `${writer.name} ${verb} ${from}'s letter`,
      body: `"${message.subject}" -- ${words}`,
      subjectIds: [writer.id, ...(sender === undefined ? [] : [sender.id])],
    };
  });
}

interface LetterAct {
  readonly deltas: readonly WorldDelta[];
  readonly orderText: string;
  readonly title: string;
  readonly body: string;
  readonly subjectIds: readonly string[];
}

/** Reads the world, lets `write` decide what the letter is, and commits it as a burst of its own. */
async function withLetterBurst(
  gameId: string,
  write: (world: WorldState, characterId: string, offices: readonly Office[]) => LetterAct | LetterOutcome,
): Promise<LetterOutcome> {
  const context = await resolveContext(gameId);
  if (context === null) return refuse(401, "Sign in to your game first.");
  const { db, close, userId, characterId } = context;
  try {
    const [view, running] = await Promise.all([
      getWorldView(db, gameId),
      findRunningBurst(db, gameId, livenessAt(new Date())),
    ]);
    if (view === undefined) return refuse(404, "This world has no state yet.");
    const offices = view.scenarioGovernment?.offices ?? [];
    const act = write(view.world, characterId, offices);
    if ("status" in act) return act;
    if (running !== undefined) return refuse(409, BUSY);

    const burstId = await startBurst(db, { gameId, playerUserId: userId, orderText: act.orderText.slice(0, 2_000) });
    if (burstId === null) return refuse(409, BUSY);
    try {
      const ids = createIdFactory(burstId);
      const result = applyDeltas(view.world, act.deltas, {
        now: view.world.instant,
        actorRef: { kind: "character", id: characterId },
        offices,
        warfare: view.scenarioWarfare,
        ids,
        gameId,
        playerCharacterId: characterId,
      });
      const [rejection] = result.rejected;
      if (rejection !== undefined) {
        await failBurst(db, burstId, rejection.reason);
        return refuse(400, rejection.reason);
      }
      // Answering for a government one has no say in is an order, and its
      // consequences are the desk's to play out; a letter is not the way round them.
      const [breach] = result.breaches;
      if (breach !== undefined) {
        await failBurst(db, burstId, breach.reason);
        return refuse(403, "That is not yours to answer in your government's name. Give it as an order at the desk if you mean to anyway.");
      }

      const materialized = materializeFacts({
        proposals: result.factProposals,
        now: result.world.instant,
        atStep: result.world.elapsedStep,
        ids,
        causalDepth: 0,
        assignedIds: result.assignedIds,
      });
      const at = instantSortKeyOf(result.world);
      await commitBurst(db, {
        gameId,
        expectedRevision: view.revision,
        world: result.world,
        burstId,
        facts: materialized.facts.map((fact) => factRowOf(fact, materialized.significanceByFactId.get(fact.id) ?? 0)),
        rediscoveredFacts: [],
        scheduled: [],
        firedEventIds: [],
        burst: { iterations: 0, modelCalls: 0, outcome: "applied", stopReason: "order_applied", accumulatedSignificance: materialized.significance },
        checkpoints: [{
          kind: "recorded",
          title: act.title.slice(0, 200),
          body: act.body,
          factIds: materialized.facts.map((fact) => fact.id),
          subjects: act.subjectIds.map((id) => ({ kind: "character" as const, id })),
          tags: [],
          changes: [],
          quote: null,
          fromInstantSortKey: at,
          toInstantSortKey: at,
        }],
      });
      return { status: "sent" };
    } catch (error) {
      await failBurst(db, burstId, error instanceof Error ? error.message : String(error)).catch(() => {});
      if (error instanceof WorldRevisionConflictError) return refuse(409, "The world moved while this was being written. Try again.");
      throw error;
    }
  } finally {
    await close();
  }
}
