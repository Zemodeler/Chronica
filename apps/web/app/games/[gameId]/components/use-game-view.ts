"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The one place that talks to the simulation, shared by the two panels.
 *
 * Orders and the Chronicle used to be one component because they were one
 * fetch. They are still one fetch; they are no longer one surface. Giving an
 * order and reading the record are different acts done at different moments --
 * a record you can only see in the same box you type into is a receipt, and a
 * receipt is read once.
 */

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
}

/** One frame of the order stream. Mirrors the route's own `Frame`. */
type Frame =
  | { readonly kind: "progress"; readonly progress: { readonly stage: string; readonly line: string } }
  | {
    readonly kind: "done";
    readonly result:
    | { readonly status: "ok"; readonly outcome: string; readonly entries: readonly { readonly title: string }[]; readonly decision: unknown }
    | { readonly status: "error"; readonly message: string };
  }
  | { readonly kind: "error"; readonly error: string };

export interface GameViewController {
  readonly view: GameView;
  readonly busy: boolean;
  /**
   * What the world is doing, newest last, while an order is being carried out.
   * Cleared when the next order is given; never part of the record.
   */
  readonly progress: readonly string[];
  readonly error: string | null;
  /** Resolves true when a report was committed, so the caller can go and read it. */
  readonly send: (orderText: string) => Promise<boolean>;
  readonly choose: (decisionId: string, optionId: string) => Promise<void>;
  readonly refresh: () => Promise<void>;
}

export function useGameView(gameId: string): GameViewController {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<GameView>({ chronicle: [], decision: null });

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/games/${gameId}/simulate`, { cache: "no-store" });
    if (!response.ok) return;
    const body = (await response.json()) as GameView;
    setView({ chronicle: body.chronicle ?? [], decision: body.decision ?? null });
  }, [gameId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const send = useCallback(async (orderText: string): Promise<boolean> => {
    const text = orderText.trim();
    if (text.length === 0) return false;
    setBusy(true);
    setError(null);
    setProgress([]);
    try {
      const response = await fetch(`/api/games/${gameId}/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderText: text }),
      });
      // A refusal is still a plain JSON body: nothing was started, so there is
      // nothing to stream.
      if (!response.ok || response.body === null) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "The order could not be carried out.");
        return false;
      }

      // Newline-delimited JSON, a frame at a time. The burst is minutes long
      // and each frame is the world saying where it has got to.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      let told = false;
      let reported = false;

      const take = (frame: Frame): void => {
        if (frame.kind === "progress") { setProgress((lines) => [...lines, frame.progress.line]); return; }
        told = true;
        if (frame.kind === "error") { setError(frame.error); return; }
        if (frame.result.status === "error") { setError(frame.result.message); return; }
        reported = frame.result.entries.length > 0;
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        const lines = pending.split("\n");
        // Whatever follows the last newline is half a frame; keep it.
        pending = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim().length === 0) continue;
          try { take(JSON.parse(line) as Frame); } catch { /* a frame we cannot read tells us nothing */ }
        }
      }
      if (pending.trim().length > 0) {
        try { take(JSON.parse(pending) as Frame); } catch { /* ditto */ }
      }

      // The stream ended without saying how it went: the connection dropped
      // mid-burst. The order is still being carried out on the server and will
      // commit, so a refresh is the honest thing to do rather than an error.
      if (!told) setError("The connection dropped while the world was moving. Your order is still being carried out.");

      await refresh();
      return reported;
    } catch {
      setError("The order could not be sent.");
      return false;
    } finally {
      setBusy(false);
    }
  }, [gameId, refresh]);

  const choose = useCallback(async (decisionId: string, optionId: string) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/games/${gameId}/decisions/${decisionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionId }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) setError(body.error ?? "That answer could not be given.");
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [gameId, refresh]);

  return { view, busy, progress, error, send, choose, refresh };
}

/** Everything the newest report produced -- not merely its last passage. */
export function latestReport(chronicle: readonly ChronicleEntry[]): readonly ChronicleEntry[] {
  const last = chronicle[chronicle.length - 1];
  if (last === undefined) return [];
  return chronicle.filter((entry) => (entry.burstId === null ? entry.id === last.id : entry.burstId === last.burstId));
}
