import type { WorldState } from "@chronica/shared";

/**
 * What the player's power has been given a day to answer, or has a term running out on.
 *
 * An ultimatum that names war on refusal, a demand for tribute, and a truce about to lapse were all only lines in a
 * letter list: a burst ran past them, the day passed, and Carthage "made war on Syracuse, as its ultimatum had said it
 * would if no answer came" (hand run of 2026-10-22). They stop the burst when they arrive and are listed with their day.
 */

/** A truce is told of this many days before it lapses. */
export const TRUCE_WARNING_DAYS = 30;

// A protest asks for an answer by a day too ("wanting an answer by 17 April"); a burst that ran past one let it lapse in silence.
const DEMANDS: ReadonlySet<string> = new Set(["ultimatum", "tribute_demand", "protest"]);

export interface Deadline {
  readonly kind: "ultimatum" | "tribute_demand" | "protest" | "truce_ends";
  /** The letter, or the agreement that lapses. */
  readonly id: string;
  readonly otherPolityId: string;
  readonly subject: string;
  /** The day it falls due; null where the sender named none. */
  readonly dueStep: number | null;
  /** What follows if it is let pass, as the sender said it. */
  readonly onRefusal: string | null;
}

/** Every open deadline of one power, soonest first. */
export function deadlinesFor(world: WorldState, polityId: string | null): readonly Deadline[] {
  if (polityId === null) return [];
  const found: Deadline[] = [];
  for (const message of world.diplomacy) {
    if (message.status !== "awaiting_reply" || message.toPolityId !== polityId || !DEMANDS.has(message.kind)) continue;
    found.push({
      kind: message.kind as "ultimatum" | "tribute_demand" | "protest", id: message.id, otherPolityId: message.fromPolityId, subject: message.subject,
      dueStep: message.replyDueByStep, onRefusal: message.onRefusal ?? null,
    });
  }
  for (const agreement of world.polityAgreements) {
    if (agreement.status !== "active" || agreement.kind !== "truce" || agreement.untilStep === null) continue;
    if (agreement.polityId !== polityId && agreement.otherPolityId !== polityId) continue;
    if (agreement.untilStep - world.elapsedStep > TRUCE_WARNING_DAYS) continue;
    found.push({
      kind: "truce_ends", id: agreement.id, otherPolityId: agreement.polityId === polityId ? agreement.otherPolityId : agreement.polityId,
      subject: "The truce runs out", dueStep: agreement.untilStep, onRefusal: null,
    });
  }
  return found.sort((a, b) => (a.dueStep ?? Infinity) - (b.dueStep ?? Infinity));
}

/** The deadlines in `after` that `before` did not have: what arrived while the world ran. */
export function newDeadlines(before: WorldState, after: WorldState, polityId: string | null): readonly Deadline[] {
  const had = new Set(deadlinesFor(before, polityId).map((deadline) => deadline.id));
  return deadlinesFor(after, polityId).filter((deadline) => !had.has(deadline.id));
}
