"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The player's whole interface to the simulation: a box to write an order in,
 * the Chronicle that comes back, and the rare decision that needs their own
 * authority.
 *
 * Deliberately one panel rather than the two it replaces. The old shell had an
 * Orders panel and a Chronicle panel because orders and news happened in
 * separate turn phases; with a continuous clock there are no phases, only what
 * you told the world and what the world sent back.
 */

interface ChronicleEntry {
  readonly id: string;
  /** The burst that wrote it: one order's answer may run to several entries. */
  readonly burstId: string | null;
  readonly title: string;
  readonly body: string;
}

interface DecisionOption {
  readonly id: string;
  readonly label: string;
  readonly summary: string;
}

interface OpenDecision {
  readonly id: string;
  readonly prompt: string;
  readonly options: readonly DecisionOption[];
}

interface GameView {
  readonly chronicle: readonly ChronicleEntry[];
  readonly decision: OpenDecision | null;
}

export function SimulationPanel({ gameId }: { readonly gameId: string }) {
  const [open, setOpen] = useState(false);
  const [order, setOrder] = useState("");
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

  const send = useCallback(async () => {
    const text = order.trim();
    if (text.length === 0 || busy) return;
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
      setOrder("");
      await refresh();
    } catch {
      setError("The order could not be sent.");
    } finally {
      setBusy(false);
    }
  }, [busy, gameId, order, refresh]);

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

  // Everything the last order produced, not merely its final passage: a span
  // that held a war and an embassy is two entries, and both are the answer.
  const last = view.chronicle[view.chronicle.length - 1];
  const latest = last === undefined
    ? []
    : view.chronicle.filter((entry) => (entry.burstId === null ? entry.id === last.id : entry.burstId === last.burstId));

  if (!open) {
    return (
      <button type="button" className="sim-tab" onClick={() => setOpen(true)} aria-label="Open the council">
        Council{view.decision === null ? "" : " •"}
      </button>
    );
  }

  return (
    <aside className="sim-panel" aria-label="Council">
      <header className="sim-panel__header">
        <h2>Council</h2>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close the council">×</button>
      </header>

      {view.decision !== null && (
        <section className="sim-panel__decision">
          <h3>This needs your word</h3>
          <p>{view.decision.prompt}</p>
          <div className="sim-panel__options">
            {view.decision.options.map((option) => (
              <button key={option.id} type="button" disabled={busy} onClick={() => void choose(view.decision!.id, option.id)}>
                <strong>{option.label}</strong>
                <span>{option.summary}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="sim-panel__chronicle">
        {latest.length === 0 ? (
          <p className="sim-panel__empty">Nothing has been recorded yet. Give an order and the world will answer.</p>
        ) : (
          latest.map((entry) => (
            <article key={entry.id}>
              <h3>{entry.title}</h3>
              {entry.body.split("\n\n").map((paragraph, index) => <p key={index}>{paragraph}</p>)}
            </article>
          ))
        )}
      </section>

      {view.decision === null && (
        <form
          className="sim-panel__order"
          onSubmit={(event) => { event.preventDefault(); void send(); }}
        >
          <label htmlFor="sim-order">Your order</label>
          <textarea
            id="sim-order"
            value={order}
            rows={3}
            maxLength={2000}
            placeholder="Raise two new legions."
            disabled={busy}
            onChange={(event) => setOrder(event.target.value)}
          />
          <button type="submit" disabled={busy || order.trim().length === 0}>
            {busy ? "The world is moving…" : "Send"}
          </button>
        </form>
      )}

      {error !== null && <p className="sim-panel__error" role="alert">{error}</p>}
    </aside>
  );
}
