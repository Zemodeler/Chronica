import {
  factsVisibleTo,
  formatWorldDate,
  type Fact,
  type OrderPartyRef,
  type ScenarioClock,
  type WorldInstant,
} from "@chronica/shared";
import type { SimModelPort } from "./ports";

/**
 * The Chronicle (VISION §25).
 *
 * A historical reconstruction of what happened since the last checkpoint --
 * and, crucially, only of what the player's government could actually have
 * learned. The engine knows the senator is plotting; the Chronicle must not say
 * so until someone discovers it.
 *
 * That constraint is enforced here rather than asked for in the prompt. The
 * model is only ever handed facts that passed `factsVisibleTo`, so it cannot
 * leak what it was never shown -- a prompt instruction not to mention secrets
 * would eventually be disobeyed, and nobody would notice.
 */

export const CHRONICLE_SYSTEM_PROMPT = `You are a historian writing a short passage about a reign, from surviving record.

You will be given a date range and a list of things known to have happened. Write
two or three short paragraphs of plain historical prose covering them.

Write only from what you are given. You have no other sources: if something is not
in the list, it is not known to have happened, and you must not imply it, foreshadow
it, or hint that anything is being concealed. Absence of evidence is not something
the passage should gesture at.

Do not address the reader, do not use headings or lists, and do not offer advice on
what should be done next. You are recording what happened, not advising a ruler.

Answer with the passage itself and nothing else.`;

export interface ChronicleInput {
  readonly port: SimModelPort;
  readonly clock: ScenarioClock;
  readonly observer: OrderPartyRef;
  readonly facts: readonly Fact[];
  readonly from: WorldInstant;
  readonly to: WorldInstant;
  /** What the actors said they were doing, for colour the bare facts lack. */
  readonly narrative: readonly string[];
  readonly frictions: readonly string[];
}

export interface ChronicleResult {
  readonly title: string;
  readonly body: string;
  /** Exactly the facts the passage was allowed to draw on. */
  readonly factIds: readonly string[];
  readonly calls: number;
}

export async function composeChronicle(input: ChronicleInput): Promise<ChronicleResult> {
  const visible = factsVisibleTo(input.facts, input.observer, input.to);
  const title = `${formatWorldDate(input.from, input.clock)} – ${formatWorldDate(input.to, input.clock)}`;
  const factIds = visible.map((fact) => fact.id);

  if (visible.length === 0) {
    return { title, body: "Nothing of note was recorded in this period.", factIds, calls: 0 };
  }

  const userMessage = [
    `Period: ${title}.`,
    "",
    "Known to have happened:",
    ...visible.map((fact) => `- ${fact.summary}`),
    ...(input.narrative.length === 0 ? [] : ["", "Accounts given at the time:", ...input.narrative.map((line) => `- ${line}`)]),
    ...(input.frictions.length === 0 ? [] : ["", "Difficulties reported:", ...input.frictions.map((line) => `- ${line}`)]),
  ].join("\n");

  try {
    const body = await input.port.complete("compose_chronicle", CHRONICLE_SYSTEM_PROMPT, userMessage);
    return { title, body: body.trim(), factIds, calls: 1 };
  } catch {
    // A failed narration must not cost the player the record itself: fall back
    // to the plain facts rather than losing the period entirely.
    return { title, body: visible.map((fact) => fact.summary).join("\n\n"), factIds, calls: 1 };
  }
}
