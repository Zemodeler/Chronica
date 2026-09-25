/**
 * What a running burst looks like to the page polling it.
 *
 * Pure: the rows come in, the view goes out, and the one judgment here -- is a
 * "running" row actually running -- is made against the heartbeat, not the
 * clock on the wall when it started. A burst can be silent for the length of
 * one model call; it cannot go a minute and a half without beating.
 */

/** How long a burst may go without a heartbeat before it is treated as dead. Three missed beats, and well under one model call's cap. */
export const BURST_STALE_MS = 90_000;
/** How often a running burst says it is alive. */
export const HEARTBEAT_MS = 20_000;
/** A coin hold older than this was taken by a call that can no longer be running: the cap is 150 s, tried at most twice. */
export const STALE_HOLD_MS = 6 * 60_000;

export interface BurstRow {
  readonly id: string;
  readonly status: "running" | "committed" | "failed";
  readonly error: string | null;
  readonly startedAt: Date;
  readonly heartbeatAt: Date | null;
  readonly endedAt: Date | null;
}

export interface ProgressRow {
  readonly id: number;
  readonly kind: string;
  readonly payload: unknown;
  readonly createdAt: Date;
}

/** A passage of the record the burst has written so far, in the shape the page shows entries. */
export interface PendingEntry {
  readonly id: string;
  readonly burstId: string;
  readonly kind: "narrated" | "recorded";
  readonly date: string | null;
  readonly title: string;
  readonly body: string;
  readonly subjects: readonly unknown[];
  readonly tags: readonly unknown[];
  readonly changes: readonly unknown[];
  readonly quote: unknown;
  readonly unread: true;
  /** False until the commit: the page shows it, and the commit is what makes it the record. */
  readonly published: false;
}

export interface BurstStatusView {
  readonly burstId: string;
  readonly status: "running" | "committed" | "failed";
  readonly error: string | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
  /** Progress lines newer than the id the caller already had, oldest first. */
  readonly progress: readonly { readonly id: number; readonly stage: string; readonly line: string; readonly at: string }[];
  /** Passages written since the id the caller already had, in the order they were written, which is the order of the record. */
  readonly entries: readonly PendingEntry[];
  /** The id to ask after next time. */
  readonly cursor: number;
}

export const ABANDONED_ERROR = "The world stopped moving before the order was carried out. Your world is as it was; give the order again.";

export function isStale(row: BurstRow, now: Date, staleMs = BURST_STALE_MS): boolean {
  if (row.status !== "running") return false;
  const lastBeat = row.heartbeatAt ?? row.startedAt;
  return now.getTime() - lastBeat.getTime() > staleMs;
}

export function toBurstStatus(row: BurstRow, rows: readonly ProgressRow[], afterId: number, now: Date): BurstStatusView {
  const stale = isStale(row, now);
  const progress = rows
    .filter((entry) => entry.id > afterId && entry.kind === "progress")
    .map((entry) => {
      const payload = (typeof entry.payload === "object" && entry.payload !== null ? entry.payload : {}) as { stage?: unknown; line?: unknown };
      return { id: entry.id, stage: typeof payload.stage === "string" ? payload.stage : "unknown", line: typeof payload.line === "string" ? payload.line : "", at: entry.createdAt.toISOString() };
    });
  const entries = rows
    .filter((entry) => entry.id > afterId && entry.kind === "chronicle_entry")
    .flatMap((entry): PendingEntry[] => {
      if (typeof entry.payload !== "object" || entry.payload === null) return [];
      const p = entry.payload as Record<string, unknown>;
      if (typeof p.title !== "string" || typeof p.body !== "string") return [];
      return [{
        id: `${row.id}:${entry.id}`,
        burstId: row.id,
        kind: p.kind === "recorded" ? "recorded" : "narrated",
        date: typeof p.date === "string" ? p.date : null,
        title: p.title,
        body: p.body,
        subjects: Array.isArray(p.subjects) ? p.subjects : [],
        tags: Array.isArray(p.tags) ? p.tags : [],
        changes: Array.isArray(p.changes) ? p.changes : [],
        quote: p.quote ?? null,
        unread: true,
        published: false,
      }];
    });
  const cursor = rows.reduce((max, entry) => Math.max(max, entry.id), afterId);
  return {
    burstId: row.id,
    status: stale ? "failed" : row.status,
    error: stale ? ABANDONED_ERROR : row.error,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    progress,
    entries,
    cursor,
  };
}
