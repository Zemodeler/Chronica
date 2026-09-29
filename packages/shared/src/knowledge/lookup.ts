import { explanations } from "./explanations";
import type { Glossary } from "./glossary";
import type { ThreadNote } from "./threads";

/**
 * Looking a word up: the box in the top bar.
 *
 * It searches only what the player could already open a note on. The
 * glossary is scoped by station on the server, so a name the player has no
 * note for is not found, and a secret stays one. The fixed explanations are
 * the same for everybody, and threads are only those the player may know of.
 *
 * Nothing here calls a model. What it cannot find, it says it cannot find.
 */

export type LookupSource = "note" | "explanation" | "thread";

export interface LookupCandidate {
  /** The glossary key, explanation key or thread id. */
  readonly id: string;
  readonly source: LookupSource;
  readonly label: string;
  /** "A person · censor, about 58". */
  readonly kicker: string;
  /** Other words it answers to: "siege" for "Sieges". */
  readonly also?: readonly string[] | undefined;
}

const SHORTEST_QUERY = 2;

export function lookupCandidates(glossary: Glossary, threads: Readonly<Record<string, ThreadNote>> = {}): LookupCandidate[] {
  const notes = Object.entries(glossary).flatMap(([id, note]): LookupCandidate[] =>
    note === undefined ? [] : [{ id, source: "note", label: note.name, kicker: note.kicker }]);
  const words = explanations().map((entry): LookupCandidate => ({
    id: entry.key,
    source: "explanation",
    label: entry.title,
    kicker: "What the word means",
    // "rule:siege" answers to "siege", "form:league" to "league".
    also: [entry.key.slice(entry.key.indexOf(":") + 1).replace(/_/g, " ")],
  }));
  const followed = Object.values(threads).map((thread): LookupCandidate => ({
    id: thread.id, source: "thread", label: thread.title, kicker: `A thread · ${thread.phaseLabel}`,
  }));
  return [...notes, ...words, ...followed];
}

/** Lower case, without accents, so "Hieron" finds "Hiéron" and the other way round. */
export function foldForLookup(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

/**
 * The best matches, best first: the whole name, then a name that starts
 * with it, then a word of the name that does, then anywhere. Shorter names
 * first among equals, because "Rome" is likelier meant than "Rome's allies".
 */
export function lookUp(query: string, candidates: readonly LookupCandidate[], limit = 8): LookupCandidate[] {
  const q = foldForLookup(query);
  if (q.length < SHORTEST_QUERY) return [];
  const scored: { candidate: LookupCandidate; score: number }[] = [];
  for (const candidate of candidates) {
    const score = scoreOf(q, candidate);
    if (score !== null) scored.push({ candidate, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.candidate.label.length - b.candidate.label.length || a.candidate.label.localeCompare(b.candidate.label))
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}

function scoreOf(q: string, candidate: LookupCandidate): number | null {
  const label = foldForLookup(candidate.label);
  if (label === q) return 0;
  if (label.startsWith(q)) return 1;
  if (wordsOf(label).some((word) => word.startsWith(q))) return 2;
  const also = (candidate.also ?? []).map(foldForLookup);
  if (also.some((word) => word === q || wordsOf(word).some((part) => part.startsWith(q)))) return 3;
  if (label.includes(q) || also.some((word) => word.includes(q))) return 4;
  return null;
}

const wordsOf = (text: string): string[] => text.split(/[\s,.'’()·-]+/).filter((word) => word.length > 0);
