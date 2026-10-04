/**
 * The clerk's register, which the Chronicle is meant not to use (plan
 * chronicle-and-order-truth, phase 3.2): "recognized", "authorized strength",
 * "was recorded as" and the hedges of a ledger. Checked locally on each
 * passage before any request is spent; a passage that has them is written
 * once more with the offending sentences quoted, and the better of the two
 * stands.
 */
export const CLERK_PHRASES: readonly RegExp[] = [
  /\brecognized\b/gi,
  /\bauthori[sz]ed strength\b/gi,
  /\bwas recorded as\b/gi,
  /\bwere recorded as\b/gi,
  /\bit is recorded that\b/gi,
  /\bno [a-z ]{3,40} (?:is|was) recorded\b/gi,
  /\bappears to have\b/gi,
  /\bis said to have\b/gi,
  /\bin accordance with\b/gi,
  /\bpursuant to\b/gi,
];

/** How many clerk phrases a text holds. */
export function clerkPhraseCount(text: string): number {
  return CLERK_PHRASES.reduce((sum, pattern) => sum + (text.match(pattern)?.length ?? 0), 0);
}

/** The sentences of a passage that use the clerk's register. */
export function clerkSentences(body: string): string[] {
  return body.split(/(?<=[.!?])\s+/).filter((sentence) => clerkPhraseCount(sentence) > 0);
}

/** The instruction sent with the retry: the sentences, quoted, and what is wanted instead. */
export function clerkRetryMessage(userMessage: string, sentences: readonly string[]): string {
  const quoted = sentences.slice(0, 4).map((sentence) => `- "${sentence.trim().slice(0, 300)}"`).join("\n");
  return `${userMessage}\n\nYour passage used a clerk's register in these sentences:\n${quoted}\nWrite the passage again as a historian would: who did what, in plain past tense, from the same facts, with nothing added and nothing the facts do not say.`;
}
