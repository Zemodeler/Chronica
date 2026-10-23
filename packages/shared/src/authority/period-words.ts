/**
 * The words of the age, and the words that do not belong to it (docs/plans/government.md).
 *
 * The state the simulation keeps is a state of the third century before Christ, and every sentence a player or a
 * model reads about it is in the words that age had: a magistrate, a quaestor, an aedile, a censor, a praetor, a
 * tribune, a consul, a suffete, the Hundred and Four, a dioiketes, a strategos, the king's friends, a decree of the
 * Senate (*senatus consultum*), a magistrate's *charge* (*cura*) and his *competence*, the *accounts* rendered at the
 * close of his office. The modern apparatus is not there to be had: no ministers, no cabinet, no portfolios, no
 * mandates, no reports on a quarter, no dashboards, no advice drawn up for a ruler to follow.
 *
 * `MODERN_WORDS` is the list a test scans the strings of each new phase of the government against
 * (`no-modern-words.test.ts`), so that a later phase adds its own strings and its own files to that test
 * and not a new list.
 */
export const PERIOD_TERMS: readonly string[] = [
  "magistrate", "quaestor", "aedile", "censor", "praetor", "tribune", "consul", "suffete", "the Hundred and Four", "dioiketes",
  "strategos", "the king's friends", "senatus consultum", "charge", "competence", "the accounts", "colleague", "intercession",
];

/** Words no player- or model-facing sentence about the state may use. Each is a pattern, read case-insensitively. */
export const MODERN_WORDS: readonly RegExp[] = [
  /\bminist(?:er|ers|ry|ries|erial)\b/i,
  /\bcabinets?\b/i,
  /\bportfolios?\b/i,
  /\bmandates?\b/i,
  /\bmandated\b/i,
  /\bkpis?\b/i,
  /\bdashboards?\b/i,
  /\breports?\b/i,
  /\breporting\b/i,
  /\badvice\b/i,
  /\badvis(?:e|es|ed|er|ers|ing)\b/i,
  /\brecommend(?:s|ed|ing|ation|ations)?\b/i,
  /\bdepartment stores?\b/i,
  /\bstakeholders?\b/i,
  /\bbureaucra(?:t|ts|cy|cies|tic)\b/i,
  /\bprime minister\b/i,
  /\bsecretar(?:y|ies) of state\b/i,
  /\bchief executive\b/i,
  /\bceo\b/i,
  /\bpolicy makers?\b/i,
  /\bmanagement\b/i,
];

/** The modern words found in a text, as written there; empty when the text keeps to the age's own. */
export function modernWordsIn(text: string): string[] {
  const found: string[] = [];
  for (const pattern of MODERN_WORDS) {
    const match = pattern.exec(text);
    if (match !== null) found.push(match[0]);
  }
  return found;
}
