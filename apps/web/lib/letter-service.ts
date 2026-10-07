import "server-only";

import { createAiAdapter, createTimedPort } from "@chronica/ai";
import { WorldRevisionConflictError, commitBurst, factRowOf, failBurst, findRunningBurst, getWorldView, heartbeatBurst, instantSortKeyOf, listRecentFacts, startBurst } from "@chronica/db";
import { FactSchema, PROPOSAL_REPLY_DAYS, composeProposal, inTheSameRegion, lettersAwaitingYou, offeredAgreementKinds, peaceOfferMetadata, readTradeDesk, whoMayBeReached, type Office, type Fact, type TradeProposalRequest, type WorldDelta, type WorldState } from "@chronica/shared";
import { allowanceFromEnv, applyDeltas, createIdFactory, createRequestLedger, materializeFacts, meteredPort, type SimModelPort } from "@chronica/sim";
import { HEARTBEAT_MS, livenessAt } from "./burst-status";
import { answerNewLetters, type LetterSendNote } from "./letter-answer-now";
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
 * engine that applies every other one, each committed as a burst of its own,
 * like an army's new name (`force-revision-service.ts`).
 *
 * And the model is always called: between the player and the people of the
 * world, writing is asking, as speaking is. For each letter the player writes
 * the person it is written to is asked for his answer at once (`letter-reply.ts`
 * through `answerNewLetters`), whoever he is and however far off. The answer is
 * decided then and kept on the letter; it is given, with its effects, on the
 * day the story reaches the road there and back, and the player is told how
 * many days that is. If the call fails or the coins are short the letter goes
 * as it always went, and the person is asked in the next round that is paid
 * for (`lettersOwed`); the player is told that plainly. The burst's commit says
 * how many calls it made.
 */

export type LetterReply = "accepted" | "refused" | "countered";

export type LetterOutcome =
  | { readonly status: "sent"; readonly notes: readonly LetterSendNote[] }
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
  /** Trade put in the letter: a pact, its revision, the lifting of an embargo, or a notice of one (`trade-desk.ts`). */
  readonly proposal?: TradeProposalRequest | undefined;
}

/** A letter to somebody out of the player's region. */
export async function writeLetter(gameId: string, letter: NewLetter): Promise<LetterOutcome> {
  const body = letter.body.trim();
  // A proposal says what it proposes in its terms; the writer's own words with it are his to add.
  if ((body.length === 0 && letter.proposal === undefined) || body.length > BODY_MAX) return refuse(400, `A letter must be between 1 and ${BODY_MAX} characters.`);
  return withLetterBurst(gameId, (world, characterId, offices) => {
    const writer = world.characters.find((character) => character.id === characterId);
    const reader = world.characters.find((character) => character.id === letter.toCharacterId);
    if (writer === undefined) return refuse(404, "You are not in this world.");
    if (reader === undefined || reader.id === characterId) return refuse(404, "There is no such person to write to.");
    if (!reader.alive) return refuse(409, `${reader.name} is dead.`);
    // Anybody may be written to; whether they answer is their business, in
    // character. Only somebody here who would give you a hearing is spoken
    // with instead.
    if (letter.proposal === undefined && inTheSameRegion(writer, reader)
      && whoMayBeReached({ world, offices, reacherId: characterId, targetId: reader.id, channel: "correspondence", orderAttempts: world.orderAttempts }).reachable) {
      return refuse(409, `${reader.name} is here. Speak with them instead.`);
    }
    const fromPolityId = polityOfPerson(world, characterId);
    const toPolityId = polityOfPerson(world, reader.id);
    if (fromPolityId === null || toPolityId === null) return refuse(409, `No road carries a letter from you to ${reader.name}.`);
    // The last letter between them, so the world reads this one as the next in the thread.
    const previous = world.diplomacy.filter((message) =>
      (message.fromCharacterId === reader.id && message.toCharacterId === characterId) || (message.fromCharacterId === characterId && message.toCharacterId === reader.id)).at(-1);
    if (letter.proposal !== undefined) return proposalAct(world, offices, writer, reader, fromPolityId, toPolityId, previous?.id ?? null, letter.proposal, body);
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
      // The subject is the letter's own first sentence when none was given, and
      // printing both printed it twice: '"We are within our right" -- We are
      // within our right' (R78).
      body: body.startsWith(subject.replace(/…$/, "")) ? body : `"${subject}" -- ${body}`,
      subjectIds: [writer.id, reader.id],
    };
  });
}

/**
 * Trade put in a letter. What may be proposed, and to whom it goes, is the desk's to say (`readTradeDesk`), the same reading the
 * sheet drew the form from; the letter is sent to the person the writer chose, and the engine stamps who in fact decides it
 * (`decidedBy`), so a letter to the wrong man is answered by pointing to the right one. Nothing is agreed by sending.
 */
function proposalAct(
  world: WorldState, offices: readonly Office[], writer: WorldState["characters"][number], reader: WorldState["characters"][number],
  fromPolityId: string, toPolityId: string, previousId: string | null, request: TradeProposalRequest, words: string,
): LetterAct | LetterOutcome {
  const desk = readTradeDesk(world, writer.id, offices);
  const power = desk.powers.find((entry) => entry.polityId === toPolityId);
  if (power === undefined) return refuse(409, `You have no dealings with the power ${reader.name} serves, and no way to put a pact to it.`);
  if (!desk.speaksForUs.yes) return refuse(403, desk.speaksForUs.why ?? "You do not treat in your government's name.");
  const allowed = power.proposals[request.kind];
  if (!allowed.allowed) return refuse(409, allowed.why ?? "That cannot be proposed now.");
  const { subject, terms, letterKind } = composeProposal(request, power.label, words);
  const waiting = world.diplomacy.find((message) => message.status === "awaiting_reply" && message.fromCharacterId === writer.id && message.toPolityId === toPolityId
    && message.kind === letterKind && JSON.stringify(message.trade ?? null) === JSON.stringify(request.trade));
  if (waiting !== undefined) return refuse(409, "A letter with these very terms is still waiting on its answer. Change the terms, or wait for it.");
  return {
    deltas: [{
      op: "diplomatic_message_send",
      localId: "proposal",
      kind: letterKind,
      fromPolityId,
      fromCharacterRef: writer.id,
      toPolityId,
      toCharacterRef: reader.id,
      subject,
      terms,
      replyWithinDays: PROPOSAL_REPLY_DAYS[request.kind],
      inReplyToRef: previousId,
      visibility: "polity",
      trade: request.trade,
      ...(request.forDays === null ? {} : { forDays: request.forDays }),
      reason: `${writer.name} puts it in writing.`,
    }],
    orderText: `Write to ${reader.name} (${request.kind}): ${terms}`,
    title: `${writer.name} writes to ${reader.name} of ${power.label}`,
    body: `"${subject}" -- ${terms}`,
    subjectIds: [writer.id, reader.id],
  };
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
        kind: offeredAgreementKinds(peaceOfferMetadata(message)).includes("peace") ? "peace_offer" : "letter",
        ...(offeredAgreementKinds(peaceOfferMetadata(message)).includes("peace") ? { proposes: ["peace" as const] } : {}),
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
  const context = await resolveContext(gameId, true);
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
    // The model is called while this burst is open: it says it is alive, as a turn does, or a slow answer would see it given up.
    const heartbeat = setInterval(() => { void heartbeatBurst(db, burstId).catch(() => undefined); }, HEARTBEAT_MS);
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

      // The letters just written are answered now, by the model, whoever they are written to (`letter-answer-now.ts`).
      const rules = { warfare: view.scenarioWarfare, terrains: view.scenarioMap?.terrains, successionRules: view.scenarioGovernment?.successionRules, wealth: view.scenarioWealth, gameId };
      const answered = await answerNewLetters({
        before: view.world, after: result.world, writerId: characterId, clock: view.scenarioClock, offices,
        port: await modelPort(db, userId, gameId), knownFacts: await recentFactsOf(db, gameId), rules, ids,
      });
      const world = answered.world;
      const materialized = materializeFacts({
        proposals: [...result.factProposals, ...answered.factProposals],
        now: world.instant,
        atStep: world.elapsedStep,
        ids,
        causalDepth: 0,
        assignedIds: new Map([...result.assignedIds, ...answered.assignedIds]),
      });
      const at = instantSortKeyOf(world);
      await commitBurst(db, {
        gameId,
        expectedRevision: view.revision,
        world,
        burstId,
        facts: materialized.facts.map((fact) => factRowOf(fact, materialized.significanceByFactId.get(fact.id) ?? 0)),
        rediscoveredFacts: [],
        scheduled: [],
        firedEventIds: [],
        burst: { iterations: 0, modelCalls: answered.calls, outcome: "applied", stopReason: "order_applied", accumulatedSignificance: materialized.significance },
        checkpoints: [{
          kind: "recorded",
          title: act.title.slice(0, 200),
          body: act.body,
          factIds: materialized.facts.map((fact) => fact.id),
          storylineIds: world.storylines.filter((storyline) => act.subjectIds.length > 1 && act.subjectIds.every((id) => storyline.participantIds.includes(id))).map((storyline) => storyline.id),
          subjects: act.subjectIds.map((id) => ({ kind: "character" as const, id })),
          tags: [],
          changes: [],
          quote: null,
          fromInstantSortKey: at,
          toInstantSortKey: at,
        }],
      });
      return { status: "sent", notes: answered.notes };
    } catch (error) {
      await failBurst(db, burstId, error instanceof Error ? error.message : String(error)).catch(() => {});
      if (error instanceof WorldRevisionConflictError) return refuse(409, "The world moved while this was being written. Try again.");
      throw error;
    } finally {
      clearInterval(heartbeat);
    }
  } finally {
    await close();
  }
}

/** The port the answer is asked through: coin-gated, timed and metered as a turn's is. Null where no model can be reached at all. */
async function modelPort(db: Parameters<typeof createTimedPort>[0]["db"], userId: string, gameId: string): Promise<SimModelPort | null> {
  try {
    const timed = createTimedPort({ db, userId, gameId, adapter: createAiAdapter() });
    return meteredPort(timed.port, createRequestLedger(allowanceFromEnv(process.env.CHRONICA_REQUEST_ALLOWANCE)));
  } catch (error) {
    console.warn(`[game ${gameId}] no model could be reached to answer a letter:`, error);
    return null;
  }
}

/** What has been put on record lately, for the reader to weigh the letter against. */
async function recentFactsOf(db: Parameters<typeof listRecentFacts>[0], gameId: string): Promise<readonly Fact[]> {
  try {
    const rows = await listRecentFacts(db, gameId);
    return rows.flatMap((row) => {
      const parsed = FactSchema.safeParse(row.fact);
      return parsed.success ? [parsed.data] : [];
    });
  } catch {
    return [];
  }
}
