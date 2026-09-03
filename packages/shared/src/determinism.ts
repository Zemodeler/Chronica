// Deterministic tie-break hashing (character-sim phase 3).
//
// Every decision the agency system makes must be reproducible from the same
// world state and the same step: no `Math.random()`, no wall-clock, no
// per-process entropy. Scoring (`character-agency/scoring.ts`) already sorts
// candidates by a documented formula; this module exists only for the rare
// case where two candidates score exactly equal and something still has to
// break the tie in a way that varies sensibly across characters and turns
// without ever being "random" in the sense a replay could disagree with.
//
// FNV-1a over the joined, colon-separated parts. Not cryptographic, not meant
// to be: only meant to be stable and cheap.

/** Stable, non-negative 32-bit hash of the given parts, joined by ":". */
export function stableHash(parts: readonly (string | number)[]): number {
  const input = parts.join(":");
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Deterministically picks one index from `[0, count)` given seed parts.
 * Used only to break exact score ties -- never to introduce variance into an
 * otherwise-determined outcome.
 */
export function stableChoice(parts: readonly (string | number)[], count: number): number {
  if (count <= 0) throw new Error("stableChoice requires count > 0");
  return stableHash(parts) % count;
}
