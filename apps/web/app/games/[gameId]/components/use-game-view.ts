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

export interface GameViewController {
  readonly view: GameView;
  readonly busy: boolean;
  readonly error: string | null;
  readonly send: (orderText: string) => Promise<void>;
  readonly choose: (decisionId: string, optionId: string) => Promise<void>;
  readonly refresh: () => Promise<void>;
}

export function useGameView(gameId: string): GameViewController {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<GameView>({ chronicle: [], decision: null });

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/games/${gameId}/simulate`, { cache: "no-store" });
    if (!response.ok) return;
    const body = (await response.json()) as GameView;
    setView({ chronicle: body.chronicle ?? [], decision: body.decision ?? null });
  }, [gameId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const send = useCallback(async (orderText: string) => {
    const text = orderText.trim();
    if (text.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/games/${gameId}/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderText: text }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? "The order could not be carried out.");
        return;
      }
      await refresh();
    } catch {
      setError("The order could not be sent.");
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

  return { view, busy, error, send, choose, refresh };
}

/** Everything the newest report produced -- not merely its last passage. */
export function latestReport(chronicle: readonly ChronicleEntry[]): readonly ChronicleEntry[] {
  const last = chronicle[chronicle.length - 1];
  if (last === undefined) return [];
  return chronicle.filter((entry) => (entry.burstId === null ? entry.id === last.id : entry.burstId === last.burstId));
}
