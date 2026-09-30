import { letterKindLabel } from "../authority/letters-awaiting";
import { formatWorldDate, type ScenarioClock } from "../world/clock";
import { isDelivered, type DiplomaticAnswer, type DiplomaticMessage } from "../world/diplomacy";
import type { WorldState } from "../world/world-state";

/**
 * The letters between the player and each person they write to, in the order
 * they were written: the letter tray's record of a correspondence.
 *
 * A letter and its answer are one object in the world (`DiplomaticMessage`),
 * so each reads here as up to two pages -- the letter, and the answer when it
 * came. Only letters with a person on both ends are a correspondence. One
 * addressed to a power at large is the government's business, and stands in
 * the tray as a letter waiting on an answer (`lettersAwaitingYou`) instead.
 */

export interface LetterPage {
  readonly id: string;
  /** The letter this page is, or answers. */
  readonly messageId: string;
  readonly fromYou: boolean;
  /** "A letter", "An offer of alliance"; for an answer, what the answer was. */
  readonly label: string;
  /** The letter's subject. Null on an answer. */
  readonly subject: string | null;
  readonly body: string;
  readonly dateLabel: string;
  /** A letter nobody has answered yet. */
  readonly awaiting: boolean;
  /** Its time to be answered ran out with no answer: said on the letter, never as a page somebody wrote (R56). */
  readonly lapsed?: string | null;
}

export interface Correspondence {
  readonly withCharacterId: string;
  readonly withName: string;
  readonly pages: readonly LetterPage[];
  /** Whose answer is owed: yours, theirs, or nobody's. */
  readonly waitingOn: "you" | "them" | null;
  /** When the last page was written, for putting the most recent first. */
  readonly lastStep: number;
}

const ANSWER_WORDS: Readonly<Record<DiplomaticAnswer, string>> = {
  accepted: "Accepted",
  refused: "Refused",
  countered: "Answered",
  ignored: "No answer came",
};

export function correspondenceOf(world: WorldState, characterId: string, clock?: ScenarioClock): readonly Correspondence[] {
  const dateOf = (step: number): string => clock === undefined ? `day ${step}` : formatWorldDate({ day: step, minute: 0 }, clock);
  const nameOf = (id: string): string => world.characters.find((character) => character.id === id)?.name ?? "Someone";
  const withWhom = (message: DiplomaticMessage): string | null =>
    message.fromCharacterId === characterId ? message.toCharacterId : message.toCharacterId === characterId ? message.fromCharacterId : null;

  // An answer that sent a letter back in the same words is that letter; it is
  // read once, as the letter.
  const repliedInALetter = new Set(world.diplomacy
    .filter((message) => message.inReplyToMessageId !== null)
    .map((message) => {
      const original = world.diplomacy.find((candidate) => candidate.id === message.inReplyToMessageId);
      return original !== undefined && original.answerText !== null && original.answerText === message.terms && original.toCharacterId === message.fromCharacterId
        ? original.id
        : null;
    })
    .filter((id): id is string => id !== null));

  const threads = new Map<string, { pages: (LetterPage & { order: number; step: number })[] }>();
  world.diplomacy.forEach((message, index) => {
    const other = withWhom(message);
    if (other === null || other === characterId) return;
    // Written to you and still on the road: it has not come yet.
    if (message.toCharacterId === characterId && !isDelivered(message, world.elapsedStep)) return;
    const thread = threads.get(other) ?? { pages: [] };
    const fromYou = message.fromCharacterId === characterId;
    thread.pages.push({
      id: message.id,
      messageId: message.id,
      fromYou,
      label: letterKindLabel(message.kind),
      subject: message.subject,
      body: message.terms,
      dateLabel: dateOf(message.sentAtStep),
      awaiting: message.status === "awaiting_reply",
      lapsed: message.answer === "ignored" ? `${fromYou ? "No answer came" : "You sent no answer"}, ${dateOf(message.answeredAtStep ?? message.sentAtStep)}` : null,
      order: index * 2,
      step: message.sentAtStep,
    });
    // Silence is not a letter: an unanswered letter to the player was shown
    // as one he had written, "No answer came", under "You wrote".
    if (message.status === "answered" && message.answer !== null && message.answer !== "ignored" && !repliedInALetter.has(message.id)) {
      const step = message.answeredAtStep ?? message.sentAtStep;
      thread.pages.push({
        id: `${message.id}:answer`,
        messageId: message.id,
        fromYou: !fromYou,
        label: ANSWER_WORDS[message.answer],
        subject: null,
        body: message.answerText ?? "",
        dateLabel: dateOf(step),
        awaiting: false,
        order: index * 2 + 1,
        step,
      });
    }
    threads.set(other, thread);
  });

  return [...threads]
    .map(([withCharacterId, { pages }]): Correspondence => {
      const sorted = pages.sort((a, b) => a.step - b.step || a.order - b.order);
      const open = sorted.filter((page) => page.awaiting);
      return {
        withCharacterId,
        withName: nameOf(withCharacterId),
        pages: sorted.map(({ order: _order, step: _step, ...page }) => page),
        waitingOn: open.some((page) => !page.fromYou) ? "you" : open.length > 0 ? "them" : null,
        lastStep: sorted.at(-1)?.step ?? 0,
      };
    })
    .sort((a, b) => b.lastStep - a.lastStep || a.withName.localeCompare(b.withName));
}
