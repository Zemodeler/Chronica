import type { Fact, Office, ScenarioClock, WorldState } from "@chronica/shared";
import { answerALetterNow, applyDeltas, heldAnswersDue, isAnswerableNow, withoutHeldAnswer, type ApplyContext, type IdFactory, type SimModelPort } from "@chronica/sim";

/**
 * What a letter does the moment it is sent: the person it is written to answers it, by the model.
 *
 * Like speaking with a man in the room, writing is asking: one call for the
 * reader of each new letter the player has written, so the answer is decided
 * there and then. The story keeps its own time -- the answer is kept on the
 * letter and given on the day it can have come back (`letter-reply.ts`) -- and
 * so the player is told, at once, when to look for it. Where the call fails or
 * the coins are short the letter goes as it always went and the reader is
 * asked in the next round that is paid for; the player is told that plainly.
 *
 * No `server-only` and no database: the web service hands it the world and a
 * port, so a scripted port tests it (`letter-answer-now.test.ts`).
 */

/** The most letters one act may put in a model's hands: the letter written, and the letter written back with an answer. */
const MOST_LETTERS_AT_ONCE = 2;

export interface LetterSendNote {
  readonly messageId: string;
  readonly readerName: string | null;
  /** `answered`: it is in the record already; `coming`: decided, and arrives on its day; `pending`: not yet answered, the world will ask. */
  readonly state: "answered" | "coming" | "pending";
  /** Days until the answer is in the writer's hands, when it is coming. */
  readonly inDays: number | null;
  /** For the player, in the words of the period. */
  readonly words: string;
  /** What the call, or calls, cost. */
  readonly calls: number;
}

export interface AnsweredAtSend {
  readonly world: WorldState;
  readonly calls: number;
  readonly factProposals: ReturnType<typeof applyDeltas>["factProposals"];
  readonly assignedIds: ReadonlyMap<string, string>;
  readonly notes: readonly LetterSendNote[];
}

const days = (count: number): string => `${count} day${count === 1 ? "" : "s"}`;

export async function answerNewLetters(input: {
  /** The world before the act, so only the letters it wrote are answered. */
  readonly before: WorldState;
  /** The world after the act's own deltas were applied. */
  readonly after: WorldState;
  readonly writerId: string;
  readonly clock: ScenarioClock;
  readonly offices: readonly Office[];
  /** Null where no model can be reached at all: every letter stays pending. */
  readonly port: SimModelPort | null;
  readonly knownFacts: readonly Fact[];
  readonly rules: Pick<ApplyContext, "warfare" | "terrains" | "successionRules" | "wealth" | "gameId">;
  readonly ids: IdFactory;
}): Promise<AnsweredAtSend> {
  const had = new Set(input.before.diplomacy.map((message) => message.id));
  const fresh = input.after.diplomacy.filter((message) => !had.has(message.id) && isAnswerableNow(message, input.writerId)).slice(0, MOST_LETTERS_AT_ONCE);
  let world = input.after;
  let calls = 0;
  const factProposals: AnsweredAtSend["factProposals"][number][] = [];
  const assignedIds = new Map<string, string>();
  const notes: LetterSendNote[] = [];

  for (const letter of fresh) {
    const to = world.characters.find((character) => character.id === letter.toCharacterId)?.name ?? null;
    const pending = (why: string, spent = 0): void => {
      calls += spent;
      notes.push({ messageId: letter.id, readerName: to, state: "pending", inDays: null, calls: spent, words: `The letter is sent. ${why} ${to ?? "They"} will answer it when the world next moves.` });
    };
    if (input.port === null) { pending("No answer could be had just now."); continue; }
    const decided = await answerALetterNow({ world, clock: input.clock, offices: input.offices, port: input.port, messageId: letter.id, knownFacts: input.knownFacts, rules: input.rules });
    if (decided.status === "undecided") {
      world = decided.world;
      pending(decided.coins ? "You have not the coins to have it answered now." : decided.why, decided.calls);
      continue;
    }
    calls += decided.calls;
    world = decided.world;
    const wait = Math.max(0, decided.comesOnDay - world.elapsedStep);
    if (wait > 0) {
      notes.push({ messageId: letter.id, readerName: decided.readerName, state: "coming", inDays: wait, calls: decided.calls, words: `The letter is sent. ${decided.readerName}'s answer will come in ${days(wait)}.` });
      continue;
    }
    // No road to wait for: the answer is in his hand already, and given now as his own act.
    for (const due of heldAnswersDue(world).filter((entry) => entry.messageId === letter.id)) {
      const given = applyDeltas(world, due.deltas, {
        ...input.rules, now: world.instant, actorRef: { kind: "character", id: due.readerId }, offices: input.offices, clock: input.clock, ids: input.ids, playerCharacterId: input.writerId,
      });
      if (given.rejected.length > 0 || due.deltas.length === 0) {
        world = withoutHeldAnswer(world, letter.id);
        notes.push({ messageId: letter.id, readerName: decided.readerName, state: "pending", inDays: null, calls: decided.calls, words: `The letter is sent. ${decided.readerName} will answer it when the world next moves.` });
        continue;
      }
      world = given.world;
      factProposals.push(...given.factProposals);
      for (const [local, id] of given.assignedIds) assignedIds.set(local, id);
      notes.push({ messageId: letter.id, readerName: decided.readerName, state: "answered", inDays: 0, calls: decided.calls, words: `The letter is sent, and ${decided.readerName} has answered it.` });
    }
  }
  return { world, calls, factProposals, assignedIds, notes };
}
