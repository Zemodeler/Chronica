import { aiMaxMs, aiMaxRetries, getSelectedLocalAiProvider } from "@chronica/ai";

/**
 * What a running burst looks like to the page polling it.
 *
 * Pure: the rows come in, the view goes out, and the one judgment here -- is a
 * "running" row actually running -- is made against the heartbeat, not the
 * clock on the wall when it started. A burst can be silent for the length of
 * one model call; it cannot go a minute and a half without beating, nor eight
 * minutes without getting anywhere.
 */

/** How long a burst may go without a heartbeat before it is treated as dead. Three missed beats, and well under one model call's cap. */
export const BURST_STALE_MS = 90_000;
/** How often a running burst says it is alive. */
export const HEARTBEAT_MS = 20_000;
/** A coin hold older than this was taken by a call that can no longer be running: the cap is 150 s, tried at most twice. */
export const STALE_HOLD_MS = 6 * 60_000;

/**
 * The age past which a hold with no turn to answer for it -- a conversation's
 * call, a letter's, one written before holds had owners -- is abandoned: the
 * longest such a call can run as configured (`CHRONICA_AI_MAX_MS`, tried
 * `CHRONICA_AI_MAX_RETRIES` more times), with a minute's grace, and never
 * under `STALE_HOLD_MS`. A durable turn's hold is not judged by age at all,
 * but by its attempt's lease (`expireStaleHolds`).
 */
export function staleHoldMs(maxMs: number = aiMaxMs(), retries: number = aiMaxRetries()): number {
  return Math.max(STALE_HOLD_MS, (retries + 1) * maxMs + 60_000);
}
/**
 * How long a burst may go without getting anywhere -- no stage reported, no
 * call answered, no passage written -- before it is treated as stuck, however
 * steadily its process beats. Above the longest honest silence (one call at
 * its 150 s cap, tried twice, and its repair) and below the player's patience.
 */
export const BURST_NO_PROGRESS_MS = 8 * 60_000;
/**
 * How long the simulation may run before it is told to stop and commit what
 * it has (see `burstDeadlineMs` in burst-runner.ts). A measured turn is
 * 80-130 s; this is the ceiling on a pathological one, not a budget.
 */
export const BURST_DEADLINE_MS = 12 * 60_000;
/**
 * How long a durable turn's lease runs without being renewed. Renewed with
 * every heartbeat, so a live worker never lets it lapse; one that dies lets
 * it lapse within this, and another worker takes the turn up.
 */
export const TURN_LEASE_MS = BURST_STALE_MS;
/** A queued turn no worker has taken up in this long is failed: no worker is running. */
export const UNCLAIMED_TURN_MS = 10 * 60_000;

/** Long enough for any person answering by hand, short enough to be a date. */
const HAND_NO_PROGRESS_MS = 100 * 365 * 24 * 60 * 60_000;

/** The cutoffs a running burst is judged alive by, at `now`. */
export function livenessAt(now: Date, noProgressMs = noProgressAllowedMs()): { readonly aliveAfter: Date; readonly progressAfter: Date } {
  return { aliveAfter: new Date(now.getTime() - BURST_STALE_MS), progressAfter: new Date(now.getTime() - noProgressMs) };
}

/**
 * A burst answered by hand waits on a person writing the answer, which can
 * take far longer than eight minutes; only a stopped heartbeat reaps it.
 */
export function noProgressAllowedMs(env: Readonly<Record<string, string | undefined>> = process.env, freeAdapter = env === process.env && getSelectedLocalAiProvider() === "codex"): number {
  // A century, not Number.MAX_SAFE_INTEGER / 2: that is 142,000 years, and
  // `now` minus it is a date Postgres refuses ("time zone displacement out of
  // range"), which failed every read of a hand-mode save's running burst.
  return env.CHRONICA_AI_MODE === "hand" || freeAdapter ? HAND_NO_PROGRESS_MS : BURST_NO_PROGRESS_MS;
}

export interface BurstRow {
  readonly id: string;
  readonly status: "running" | "committed" | "failed";
  readonly error: string | null;
  readonly startedAt: Date;
  readonly heartbeatAt: Date | null;
  /** Last time the burst got somewhere; null on rows written before 0042. */
  readonly progressAt?: Date | null | undefined;
  readonly endedAt: Date | null;
  /** The durable job carrying the burst (0043), absent or null for one run in-process. */
  readonly jobStatus?: "queued" | "leased" | "committed" | "failed" | null | undefined;
  /** Leases the job has taken: the attempt now running, or the last one. */
  readonly attempt?: number | null | undefined;
  readonly maxAttempts?: number | null | undefined;
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
  /** Which attempt of a durable turn wrote it; a later attempt's passages replace it. Absent in-process. */
  readonly attempt?: number | undefined;
}

export interface BurstStatusView {
  readonly burstId: string;
  readonly status: "running" | "committed" | "failed";
  /**
   * While running: waiting for a worker, being carried out, or being carried
   * out again after an attempt was interrupted. Absent once it has ended.
   */
  readonly phase?: "queued" | "running" | "retrying" | undefined;
  /** The attempt the passages below belong to, and how many a turn may take; absent in-process. */
  readonly attempt?: number | undefined;
  readonly maxAttempts?: number | undefined;
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

export const STUCK_ERROR = "The world stopped getting anywhere with the order, so it was given up. Your world is as it was; give the order again.";

export const EXHAUSTED_ERROR = "The order was interrupted more often than it may be taken up again, so it was given up. Your world is as it was; give the order again.";

export const UNCLAIMED_ERROR = "No one took the order up: the server that carries orders out is not running. Your world is as it was; give the order again once it is.";

/** Why a "running" row is not running: its process fell silent, or it stopped getting anywhere. Null while it is alive. */
export function abandonment(row: BurstRow, now: Date, staleMs = BURST_STALE_MS, noProgressMs = BURST_NO_PROGRESS_MS): "silent" | "stuck" | null {
  if (row.status !== "running") return null;
  const lastBeat = row.heartbeatAt ?? row.startedAt;
  if (now.getTime() - lastBeat.getTime() > staleMs) return "silent";
  const lastProgress = row.progressAt ?? row.startedAt;
  if (now.getTime() - lastProgress.getTime() > noProgressMs) return "stuck";
  return null;
}

export function isStale(row: BurstRow, now: Date, staleMs = BURST_STALE_MS): boolean {
  return abandonment(row, now, staleMs) !== null;
}

export function toBurstStatus(row: BurstRow, rows: readonly ProgressRow[], afterId: number, now: Date): BurstStatusView {
  // A durable turn still queued or leased is judged by its lease, not by the
  // row's heartbeat: a worker that died is replaced, not mourned
  // (`settleTurnJobs` fails it when it cannot be).
  const durable = row.jobStatus !== undefined && row.jobStatus !== null;
  const active = durable && (row.jobStatus === "queued" || row.jobStatus === "leased");
  const abandoned = active ? null : abandonment(row, now, BURST_STALE_MS, noProgressAllowedMs());
  const stale = abandoned !== null;
  const attempt = durable && typeof row.attempt === "number" ? row.attempt : undefined;
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
      // Only the attempt now carrying the turn: what an interrupted one wrote
      // was never the record and will be written again.
      const writtenBy = typeof p.attempt === "number" ? p.attempt : undefined;
      if (attempt !== undefined && writtenBy !== undefined && writtenBy !== attempt) return [];
      return [{
        // Stable for the passage: the attempt and its place in that attempt's
        // writing, so a page that asks again never shows it twice.
        id: writtenBy === undefined || typeof p.ordinal !== "number" ? `${row.id}:${entry.id}` : `${row.id}:${writtenBy}:${p.ordinal}`,
        burstId: row.id,
        kind: p.kind === "recorded" ? "recorded" : "narrated",
        date: typeof p.date === "string" ? p.date : null,
        title: p.title,
        body: p.body,
        subjects: Array.isArray(p.subjects) ? p.subjects : [],
        tags: Array.isArray(p.tags) ? p.tags : [],
        // Money that moved waits for the published entry, which checks the
        // reader may open the purse; a live line is not the place to leak it.
        changes: Array.isArray(p.changes) ? p.changes.filter((change: unknown) => (change as { kind?: unknown } | null)?.kind !== "account") : [],
        quote: p.quote ?? null,
        unread: true,
        published: false,
        ...(writtenBy === undefined ? {} : { attempt: writtenBy }),
      }];
    });
  const cursor = rows.reduce((max, entry) => Math.max(max, entry.id), afterId);
  const status = stale ? "failed" : row.status;
  return {
    burstId: row.id,
    status,
    ...(status !== "running" ? {} : { phase: row.jobStatus === "queued" ? (attempt !== undefined && attempt > 0 ? "retrying" : "queued") : attempt !== undefined && attempt > 1 ? "retrying" : "running" }),
    ...(attempt === undefined ? {} : { attempt, ...(typeof row.maxAttempts === "number" ? { maxAttempts: row.maxAttempts } : {}) }),
    error: abandoned === "silent" ? ABANDONED_ERROR : abandoned === "stuck" ? STUCK_ERROR : row.error,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    progress,
    entries,
    cursor,
  };
}
