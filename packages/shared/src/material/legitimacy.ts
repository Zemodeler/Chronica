import { boundedId } from "../determinism";
import type { PolityLegitimacy } from "../material-state";

// Shared polity-legitimacy adjustment (docs/14 Phase 6): battles and
// taxation both move a polity's standing, and both need the same
// create-on-first-use, bounded, cause-recording behavior -- factored out
// once rather than duplicated per call site.

/** Nudge a polity's legitimacy by a signed basis-point delta, creating its record on first use. */
export function adjustPolityLegitimacy(
  list: readonly PolityLegitimacy[],
  polityId: string,
  deltaBps: number,
  causeLabel: string,
  causeSourceId: string,
): PolityLegitimacy[] {
  const cause = {
    id: boundedId(causeSourceId, polityId),
    label: causeLabel,
    score: Math.max(-100, Math.min(100, Math.round(deltaBps / 10))),
    sourceId: causeSourceId,
  };
  const existing = list.find((entry) => entry.polityId === polityId);
  if (!existing) {
    return [...list, { polityId, legitimacyBps: Math.max(0, Math.min(10_000, 5_000 + deltaBps)), institutionalConfidenceBps: 5_000, causes: [cause] }];
  }
  return list.map((entry) =>
    entry.polityId === polityId
      ? { ...entry, legitimacyBps: Math.max(0, Math.min(10_000, entry.legitimacyBps + deltaBps)), causes: [...entry.causes, cause] }
      : entry,
  );
}
