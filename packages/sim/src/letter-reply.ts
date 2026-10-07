import {
  allOffices, buildAuthorityIndex, buildStation, factsKnownToStation, formatWorldDate,
  type Character, type DiplomaticAnswer, type DiplomaticMessage, type Fact, type Office, type ScenarioClock, type WorldDelta, type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import type { RoutedActor } from "./attention";
import { runCognition } from "./cognition";
import { diplomaticAnswererOf } from "./letters";
import { holdAnswerToAuthority } from "./nature";
import { createIdFactory, type SimModelPort } from "./ports";

/**
 * A letter is answered by the model, as speaking is, the moment it is sent.
 *
 * Between the player and the people of the world the model is always called.
 * Speaking with a man in the room already did: one call, his answer, at once.
 * A letter used to be sent and then left until the world next moved and its
 * reader happened to be picked for a round -- so it was answered, or not,
 * under the round's caps (`maxAskedPerRound`, `ORDER_RESERVE_CALLS`, the
 * burst's call budget), by rule for the ones the rules play. Now writing is
 * the asking: one call for the one it is written to, whoever he is -- a king
 * far off, a man nobody has met, a clerk -- and what he answers is decided
 * there and then.
 *
 * The story keeps its own time. The answer is decided now but is not in the
 * writer's hands, nor are its effects in the world, until the letter has gone
 * to him and the answer come back: the road there and the road back
 * (`answerComesOn`). Until that day the letter stays awaiting its reply and the
 * answer is kept on it (`heldAnswer`); nobody is asked it again, and when the
 * story reaches the day the burst gives it as the reader's own act
 * (`heldAnswersDue`), judged by the engine like any other act of his.
 *
 * The rules advise and do not decide. What the reader's interests and nature
 * say is in front of the model as counsel (`adviceOnALetter`), and its yes or
 * no or terms of its own stand. Only what he cannot do is refused by the
 * engine: not his to decide (`holdAnswerToAuthority`), or an act `applyDeltas`
 * will not carry out -- which is tried here, so a letter is not promised an
 * answer the world would refuse when it came.
 *
 * Nothing here may fail the writer's letter. A call that fails, a coin gate that
 * refuses, a model that says nothing readable: the letter goes as it always
 * went, still awaiting its reader, who is asked in the next round that is
 * paid for (`lettersOwed`), and the writer is told so plainly.
 */

/** The days after which the answer is in the writer's hands: the road to the reader, and the road back. */
export function answerComesOn(message: Pick<DiplomaticMessage, "sentAtStep" | "deliveredOnDay">): number {
  const arrives = message.deliveredOnDay ?? message.sentAtStep;
  return arrives + Math.max(0, arrives - message.sentAtStep);
}

export interface LetterAnswerNowInput {
  /** The world with the letter already in it, sent today. */
  readonly world: WorldState;
  readonly clock: ScenarioClock;
  readonly offices: readonly Office[];
  readonly port: SimModelPort;
  readonly messageId: string;
  /** What the reader has heard of the world, for him to weigh the letter against. */
  readonly knownFacts?: readonly Fact[] | undefined;
  /** The scenario rules the answer is tried against before it is promised. */
  readonly rules: Pick<ApplyContext, "warfare" | "terrains" | "successionRules" | "wealth" | "gameId">;
}

export type LetterAnswerNow =
  | {
    readonly status: "decided";
    /** The world with the answer kept on the letter. */
    readonly world: WorldState;
    readonly calls: number;
    readonly answer: DiplomaticAnswer;
    readonly readerId: string;
    readonly readerName: string;
    /** The day the answer is in the writer's hands: today, or later. */
    readonly comesOnDay: number;
    /** What the engine held the model's answer to, if it did. */
    readonly held: string | null;
  }
  | {
    readonly status: "undecided";
    readonly world: WorldState;
    readonly calls: number;
    /** Plainly, for the writer. */
    readonly why: string;
    /** The coins ran out, or the call was refused for want of them. */
    readonly coins: boolean;
  };

/** Whether a letter is one the model answers at send time: written by somebody to somebody else, awaiting its reply. */
export function isAnswerableNow(message: DiplomaticMessage | undefined, writerId: string): message is DiplomaticMessage {
  return message !== undefined && message.status === "awaiting_reply" && message.fromCharacterId === writerId && message.heldAnswer === undefined;
}

/**
 * Calls the model for the answer to one letter, and keeps what it says on the letter.
 *
 * One call, for one person, by the same machinery that asks the world's people
 * what they do (`runCognition`), with a section that asks them one thing: this
 * letter. Every other act it might write is let go; the answer, and a letter
 * sent back in the same breath with it, are what is kept.
 */
export async function answerALetterNow(input: LetterAnswerNowInput): Promise<LetterAnswerNow> {
  const { world, messageId } = input;
  const unanswered = (why: string, calls = 0, coins = false): LetterAnswerNow => ({ status: "undecided", world, calls, why, coins });
  const message = world.diplomacy.find((candidate) => candidate.id === messageId);
  if (message === undefined || message.status !== "awaiting_reply") return unanswered("That letter is not waiting on an answer.");
  const readerId = message.toCharacterId ?? diplomaticAnswererOf(world, message.toPolityId, input.offices, message.fromCharacterId);
  const reader: Character | undefined = readerId === null ? undefined : world.characters.find((character) => character.id === readerId);
  if (reader === undefined || !reader.alive) return unanswered("There is nobody living to read it.");

  // The letter as it will lie in front of him, which it does not yet if the road is long: his section is written from the day it reaches him.
  const today = world.instant.day;
  const shown: WorldState = {
    ...world,
    diplomacy: world.diplomacy.map((candidate) => (candidate.id === message.id
      ? { ...candidate, toCharacterId: reader.id, deliveredOnDay: Math.min(candidate.deliveredOnDay ?? candidate.sentAtStep, today) }
      : candidate)),
  };
  const polityName = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;
  const authority = buildAuthorityIndex(
    { officeSeats: world.material.officeSeats, forces: world.material.forces, accounts: world.material.accounts },
    world.authorityGrants, allOffices(world, input.offices), world.elapsedStep,
  );
  const heard = (input.knownFacts ?? []).length === 0 ? [] : factsKnownToStation(input.knownFacts!, buildStation({ world, characterId: reader.id, offices: input.offices, authority }), world.instant, world).slice(-6);
  const travel = (message.deliveredOnDay ?? message.sentAtStep) - message.sentAtStep;
  const actor: RoutedActor = {
    ref: { kind: "character", id: reader.id },
    characterId: reader.id,
    name: reader.name,
    level: "focused",
    impetus: "reaction",
    score: 100,
    pressing: true,
    knownFacts: heard,
    why: `a letter from ${polityName(message.fromPolityId)} has been put into your hands ("${message.subject}"), and it is yours to answer`,
    note: [
      `The letter [${message.id}] reached you ${travel > 0 ? `after ${travel} day${travel === 1 ? "" : "s"} on the road, ` : ""}on ${formatWorldDate(world.instant, input.clock)}. Answer it now, and only it: write one "diplomatic_message_answer" naming ${message.id}, in your own words, as you judge best.`,
      "If you counter, send your own letter back in the same answer with \"diplomatic_message_send\", naming the original in \"inReplyToRef\". Nothing else is asked of you today.",
    ].join("\n"),
  };

  let calls = 0;
  let proposal: Awaited<ReturnType<typeof runCognition>>["output"]["actors"][number] | undefined;
  try {
    const asked = await runCognition(input.port, [actor], shown, input.clock);
    calls = asked.calls;
    proposal = asked.output.actors.find((entry) => entry.actorRef.id === reader.id);
    if (proposal === undefined) {
      return unanswered(asked.parseFailure === null ? `${reader.name} sent no answer that could be read.` : `${reader.name}'s answer could not be read.`, calls);
    }
  } catch (error) {
    // The coin gate refuses by name; anything else is a call that failed, and either way the letter goes as it always went.
    const coins = error instanceof Error && error.name === "InsufficientCoinsError";
    return unanswered(coins ? "There are not enough coins to have it answered now." : "The answer could not be had just now.", coins ? 0 : 1, coins);
  }

  const answers = proposal.proposal.deltas.filter((delta): delta is Extract<WorldDelta, { op: "diplomatic_message_answer" }> => delta.op === "diplomatic_message_answer" && delta.messageRef === message.id);
  const answered = answers[0];
  if (answered === undefined) return unanswered(`${reader.name} did not answer it.`, calls);
  const held = holdAnswerToAuthority(shown, reader.id, answered);
  // A letter sent back in the same breath goes with a counter, and only then.
  const back = held.act.op === "diplomatic_message_answer" && held.act.answer === "countered" && held.act.counterTrade === undefined
    ? proposal.proposal.deltas.filter((delta) => delta.op === "diplomatic_message_send" && delta.inReplyToRef === message.id).slice(0, 1)
    : [];
  const acts: WorldDelta[] = [held.act, ...back];

  // Tried now against the world as it stands, so the writer is never promised an answer the engine would refuse when it came.
  const trial = applyDeltas(shown, acts, {
    ...input.rules,
    now: shown.instant,
    actorRef: { kind: "character", id: reader.id },
    offices: input.offices,
    clock: input.clock,
    ids: createIdFactory(`answer-trial-${message.id}`),
  });
  const [refused] = trial.rejected;
  if (refused !== undefined) return unanswered(`${reader.name}'s answer was one the world would not carry out (${refused.reason.slice(0, 160)}).`, calls);

  const comesOnDay = answerComesOn(message);
  const kept = {
    decidedOnDay: world.elapsedStep,
    comesOnDay,
    deltas: acts.map((act) => ({ ...act }) as Record<string, unknown>),
  };
  return {
    status: "decided",
    world: { ...world, diplomacy: world.diplomacy.map((candidate) => (candidate.id === message.id ? { ...candidate, toCharacterId: reader.id, heldAnswer: kept } : candidate)) },
    calls,
    answer: held.act.op === "diplomatic_message_answer" ? held.act.answer : answered.answer,
    readerId: reader.id,
    readerName: reader.name,
    comesOnDay,
    held: held.brought,
  };
}

