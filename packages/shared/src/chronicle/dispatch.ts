import type { ChronicleKnowledgeStatus } from "./knowledge";

// Current Chronicle dispatch (character-sim phase 6).
//
// A compact, deterministic per-turn header -- modeled on the existing
// (player-invisible) `summarizeResolvedTurn` in apps/web/lib/resolution/pipeline.ts,
// but built from the already-projected, knowledge-safe entry set and actually
// surfaced to the player as the Chronicle panel's top strip. No AI call.

export interface DispatchEntryInput {
  readonly title: string;
  readonly body: string;
  readonly playerRelevance: "high" | "medium" | "low" | "none";
  readonly knowledgeStatus: ChronicleKnowledgeStatus;
  /**
   * Only the countable, checkable consequences. A consequence that is simply
   * the entry's own sentence restated belongs in the entry, not in the brief:
   * repeating it here made the strip read as a second copy of what the reader
   * had just finished reading.
   */
  readonly consequences: readonly string[];
}

export interface CurrentDispatch {
  readonly headline: string;
  readonly items: readonly string[];
  readonly uncertaintyNote: string | null;
}

const RELEVANCE_RANK: Record<DispatchEntryInput["playerRelevance"], number> = {
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
};

/** Bounded, deterministic priority ordering: most player-relevant first, ties broken by input order. */
function rankEntries(entries: readonly DispatchEntryInput[]): readonly DispatchEntryInput[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => RELEVANCE_RANK[b.entry.playerRelevance] - RELEVANCE_RANK[a.entry.playerRelevance] || a.index - b.index)
    .map(({ entry }) => entry);
}

export function buildCurrentDispatch(input: {
  readonly entriesThisTurn: readonly DispatchEntryInput[];
  readonly authorityChangesForPlayer: readonly string[];
  readonly maxLength?: number;
}): CurrentDispatch {
  const maxLength = input.maxLength ?? 600;
  const ranked = rankEntries(input.entriesThisTurn);

  const headline = ranked[0]?.title ?? input.authorityChangesForPlayer[0] ?? "A quiet turn passes.";

  // The strip is a factual brief, not a second copy of the prose -- only
  // authority changes and concrete direct consequences belong here. A title
  // (often a truncated body) reads as garbled filler alongside real facts.
  const items: string[] = [];
  let used = headline.length;
  const candidates = [
    ...input.authorityChangesForPlayer,
    ...ranked.filter((entry) => entry.playerRelevance !== "none").flatMap((entry) => entry.consequences),
  ];
  for (const candidate of candidates) {
    if (items.includes(candidate)) continue;
    const projected = used + candidate.length + 2;
    if (projected > maxLength) continue;
    items.push(candidate);
    used = projected;
  }

  const uncertaintyNote = ranked.some((entry) => entry.knowledgeStatus !== "confirmed")
    ? "Some of what follows is unconfirmed."
    : null;

  return { headline, items, uncertaintyNote };
}
