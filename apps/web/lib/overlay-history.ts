import "server-only";

import type { DynamicMapOverlay } from "@chronica/shared";

/**
 * The last few overlays sent to each viewer of each game, by world revision.
 *
 * The overlay poll answers with what changed since the revision the client
 * holds, which needs that revision's overlay to compare against. A process that
 * has restarted, or a second server, simply lacks it, and the poll then sends
 * the whole overlay: the history is an optimisation, never a source of truth.
 */
const REVISIONS_PER_VIEWER = 4;
const VIEWERS_KEPT = 64;
const _history = new Map<string, Map<string, DynamicMapOverlay>>();

export function overlayHistoryKey(userId: string, gameId: string): string {
  return `${userId}:${gameId}`;
}

export function rememberOverlay(key: string, stamp: string, overlay: DynamicMapOverlay): void {
  const revisions = _history.get(key) ?? new Map<string, DynamicMapOverlay>();
  _history.delete(key);
  _history.set(key, revisions);
  revisions.delete(stamp);
  revisions.set(stamp, overlay);
  if (revisions.size > REVISIONS_PER_VIEWER) revisions.delete(revisions.keys().next().value as string);
  if (_history.size > VIEWERS_KEPT) _history.delete(_history.keys().next().value as string);
}

export function recallOverlay(key: string, stamp: string): DynamicMapOverlay | undefined {
  return _history.get(key)?.get(stamp);
}
