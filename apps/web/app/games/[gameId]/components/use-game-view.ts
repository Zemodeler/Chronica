"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * The one place that talks to the simulation, shared by the two panels.
 *
 * Orders and the Chronicle used to be one component because they were one
 * fetch. They are still one fetch; they are no longer one surface. Giving an
 * order and reading the record are different acts done at different moments --
 * a record you can only see in the same box you type into is a receipt, and a
 * receipt is read once.
 *
 * An order no longer holds a connection open for the length of the turn. The
 * server answers with a burst id at once and the world moves on its own; this
 * hook follows it by polling until the burst has committed or failed, and a
 * page opened mid-turn picks the burst up again from the view's `running`.
 */

/**
 * How far the player may ask the world to run, in days: the choices the
 * server accepts (`TIME_SPANS` in `lib/simulation-service.ts`, which this
 * client cannot import).
 */
export const TIME_SPANS = [
  { days: 7, label: "a week" },
  { days: 30, label: "a month" },
  { days: 90, label: "a season" },
  { days: 180, label: "half a year" },
  { days: 365, label: "a year" },
] as const;

/** How often a running burst is asked where it has got to. */
const POLL_MS = 1_500;
/** How many polls in a row may fail before the page gives up following. */
const POLL_FAILURES_TOLERATED = 5;

export interface SendOptions {
  readonly spanDays?: number | undefined;
  readonly wait?: boolean | undefined;
}

export interface PartyRef {
  readonly kind: string;
  readonly id: string;
}

/** A subject printed on the entry's face, already named by the server. */
export interface EntryTag {
  readonly kind: string;
  readonly id: string;
  readonly label: string;
}

export interface MapChange {
  readonly kind: string;
  readonly id: string;
  readonly label: string;
  readonly detail: string;
}

export interface EntryQuote {
  readonly line: string;
  readonly speaker: string;
  readonly occasion: string;
}

export interface ChronicleEntry {
  readonly id: string;
  /** The burst that wrote it: one order's answer may run to several entries. */
  readonly burstId: string | null;
  readonly kind: "narrated" | "recorded";
  /** Already formatted in the scenario's own calendar. */
  readonly date: string | null;
  readonly title: string;
  readonly body: string;
  readonly subjects: readonly PartyRef[];
  readonly tags: readonly EntryTag[];
  readonly changes: readonly MapChange[];
  readonly quote: EntryQuote | null;
  /** Whether the player has yet opened the record since this was written. */
  readonly unread: boolean;
  /**
   * False while the burst that wrote it is still running: the passage is
   * shown as it is written, and the commit is what makes it the record.
   */
  readonly published: boolean;
}

export interface DecisionOption {
  readonly id: string;
  readonly label: string;
  readonly summary: string;
}

export interface OpenDecision {
  readonly id: string;
  readonly prompt: string;
  readonly options: readonly DecisionOption[];
}

export interface GameView {
  readonly chronicle: readonly ChronicleEntry[];
  readonly decision: OpenDecision | null;
  /** A burst still moving the world when the view was read. */
  readonly running: { readonly burstId: string } | null;
}

/** One answer from `/bursts/<id>`. Mirrors the server's `BurstStatusView`. */
interface BurstStatus {
  readonly status: "running" | "committed" | "failed";
  readonly error: string | null;
  readonly progress: readonly { readonly id: number; readonly stage: string; readonly line: string }[];
  readonly entries: readonly ChronicleEntry[];
  readonly cursor: number;
}

export interface GameViewController {
  /**
   * The record as committed, followed by the passages of a running burst as
   * they are written (`published: false`). Nothing already shown is ever
   * reordered: the burst writes in time order and the commit keeps it.
   */
  readonly view: GameView;
  readonly busy: boolean;
  /**
   * What the world is doing, newest last, while an order is being carried out.
   * Cleared when the next order is given; never part of the record.
   */
  readonly progress: readonly string[];
  readonly error: string | null;
  /**
   * An order, or -- with `wait` and no words -- time let pass. `spanDays` is
   * how far the world is to run; omitted, the engine decides. Resolves true
   * when the burst committed, so the caller can go and read the record.
   */
  readonly send: (orderText: string, options?: SendOptions) => Promise<boolean>;
  readonly choose: (decisionId: string, optionId: string) => Promise<void>;
  readonly refresh: () => Promise<void>;
  /**
   * The player has opened the record.
   *
   * Marks server-side and locally in the same breath, so the badge clears as
   * the panel opens rather than after a round trip.
   */
  readonly markRead: () => Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

export function useGameView(gameId: string): GameViewController {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [committed, setCommitted] = useState<GameView>({ chronicle: [], decision: null, running: null });
  /** Passages of the running burst, in the order they were written. Dropped once the commit is read back. */
  const [pending, setPending] = useState<readonly ChronicleEntry[]>([]);
  /** The burst being followed, so a second follow of the same one is not started. */
  const following = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/games/${gameId}/simulate`, { cache: "no-store" });
    if (!response.ok) return;
    const body = (await response.json()) as GameView;
    setCommitted({
      chronicle: (body.chronicle ?? []).map((entry) => ({ ...entry, published: true })),
      decision: body.decision ?? null,
      running: body.running ?? null,
    });
  }, [gameId]);
  const view = useMemo<GameView>(
    () => (pending.length === 0 ? committed : { ...committed, chronicle: [...committed.chronicle, ...pending] }),
    [committed, pending],
  );

  /**
   * Follows a burst to its end: progress lines as they come, then the record
   * re-read from the server once it has committed. Nothing is trusted from
   * the burst itself; the Chronicle is what the commit wrote.
   */
  const follow = useCallback(async (burstId: string): Promise<boolean> => {
    if (following.current === burstId) return false;
    following.current = burstId;
    setBusy(true);
    setError(null);
    setProgress([]);
    setPending([]);
    let cursor = 0;
    let failures = 0;
    try {
      for (;;) {
        let status: BurstStatus | null = null;
        try {
          const response = await fetch(`/api/games/${gameId}/bursts/${burstId}?after=${cursor}`, { cache: "no-store" });
          if (response.status === 404) { setError("That order is no longer being carried out."); return false; }
          if (response.ok) status = (await response.json()) as BurstStatus;
        } catch {
          // The network, not the world: keep asking for a while.
        }
        if (status === null) {
          failures += 1;
          if (failures >= POLL_FAILURES_TOLERATED) { setError("Lost contact with the world while your order was being carried out. It is still being carried out; reload to catch up."); return false; }
        } else {
          failures = 0;
          cursor = status.cursor;
          if (status.progress.length > 0) setProgress((lines) => [...lines, ...status.progress.map((line) => line.line)]);
          if (status.entries.length > 0) setPending((entries) => [...entries, ...status.entries]);
          // The commit is what makes the passages the record: read it back and
          // let the committed copies replace the ones shown while it ran.
          if (status.status === "committed") { await refresh(); setPending([]); return true; }
          if (status.status === "failed") { setError(status.error ?? "The order could not be carried out."); setPending([]); await refresh(); return false; }
        }
        await sleep(POLL_MS);
      }
    } finally {
      following.current = null;
      setBusy(false);
    }
  }, [gameId, refresh]);

  useEffect(() => { void refresh(); }, [refresh]);

  // A page opened while the world is moving picks the burst up rather than
  // showing a record that is about to change under it.
  useEffect(() => {
    if (committed.running !== null && following.current === null) void follow(committed.running.burstId);
  }, [committed.running, follow]);

  const start = useCallback(async (path: string, body: unknown): Promise<boolean> => {
    setError(null);
    let response: Response;
    try {
      response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch {
      setError("The order could not be sent.");
      return false;
    }
    const answer = (await response.json().catch(() => ({}))) as { burstId?: string; error?: string };
    if (!response.ok || typeof answer.burstId !== "string") {
      setError(answer.error ?? "The order could not be carried out.");
      return false;
    }
    return follow(answer.burstId);
  }, [follow]);

  const send = useCallback(async (orderText: string, options: SendOptions = {}): Promise<boolean> => {
    const text = orderText.trim();
    const waiting = options.wait === true;
    if (text.length === 0 && !waiting) return false;
    return start(`/api/games/${gameId}/simulate`, {
      orderText: text,
      ...(options.spanDays === undefined ? {} : { spanDays: options.spanDays }),
      ...(waiting ? { wait: true } : {}),
    });
  }, [gameId, start]);

  const choose = useCallback(async (decisionId: string, optionId: string) => {
    await start(`/api/games/${gameId}/decisions/${decisionId}`, { optionId });
  }, [gameId, start]);

  const markRead = useCallback(async () => {
    setCommitted((current) => (current.chronicle.some((entry) => entry.unread)
      ? { ...current, chronicle: current.chronicle.map((entry) => ({ ...entry, unread: false })) }
      : current));
    // A badge that fails to clear is a small thing; an error dialog over a
    // panel the player has just opened is not. Swallowed on purpose.
    await fetch(`/api/games/${gameId}/chronicle/read`, { method: "POST" }).catch(() => undefined);
  }, [gameId]);

  return { view, busy, progress, error, send, choose, refresh, markRead };
}

/** How many entries the player has not yet turned back to. */
export const unreadCount = (chronicle: readonly ChronicleEntry[]): number =>
  chronicle.reduce((n, entry) => n + (entry.unread ? 1 : 0), 0);

/** Everything the newest report produced -- not merely its last passage. */
export function latestReport(chronicle: readonly ChronicleEntry[]): readonly ChronicleEntry[] {
  const last = chronicle[chronicle.length - 1];
  if (last === undefined) return [];
  return chronicle.filter((entry) => (entry.burstId === null ? entry.id === last.id : entry.burstId === last.burstId));
}
