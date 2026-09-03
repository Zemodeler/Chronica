// Lightweight causal-chain references (character-sim phase 6).
//
// Built entirely from fields the Chronicle already tracks (`chainId`,
// `chainPosition`) -- no new provenance tracking. Bounded by `maxChainDepth`
// so a long-running chain never grows an unbounded "consequences" list.

export interface CausalChainEntry {
  readonly sequence: number;
  readonly title: string;
  readonly chainId?: string | null;
}

export interface CausalRefs {
  readonly earlier?: { readonly sequence: number; readonly title: string };
  readonly consequences: readonly { readonly sequence: number; readonly title: string }[];
}

/** The immediately-earlier and up to `maxChainDepth` later entries sharing `entry.chainId`. */
export function resolveCausalRefs(
  entry: CausalChainEntry,
  entriesInSameChain: readonly CausalChainEntry[],
  maxChainDepth = 5,
): CausalRefs {
  if (entry.chainId == null) return { consequences: [] };

  const chainEntries = entriesInSameChain
    .filter((candidate) => candidate.chainId === entry.chainId)
    .sort((a, b) => a.sequence - b.sequence);
  const index = chainEntries.findIndex((candidate) => candidate.sequence === entry.sequence);
  if (index === -1) return { consequences: [] };

  const earlier = index > 0 ? chainEntries[index - 1] : undefined;
  const consequences = chainEntries.slice(index + 1, index + 1 + Math.max(0, maxChainDepth));

  return {
    ...(earlier !== undefined ? { earlier: { sequence: earlier.sequence, title: earlier.title } } : {}),
    consequences: consequences.map((candidate) => ({ sequence: candidate.sequence, title: candidate.title })),
  };
}
