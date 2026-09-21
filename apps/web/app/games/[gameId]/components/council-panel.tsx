"use client";

import { useState } from "react";
import { latestReport, type GameViewController } from "./use-game-view";

/**
 * The Council: where you speak to the world.
 *
 * It used to carry its own rail of tabs at the left edge of the map, and the
 * Chronicle and the Treasury hung off it. The Office is that rail now, so what
 * is left here is the one thing the Council actually is -- an order, and the
 * rare decision the world puts back to you.
 *
 * What it keeps of the record is the headlines of the newest report, as an
 * answer to the order just given. The passages themselves are next door, on a
 * shelf, because typing an order and turning back through a reign want
 * different room.
 */
export function CouncilPanel({
  controller,
  onClose,
  onOpenChronicle,
}: {
  readonly controller: GameViewController;
  readonly onClose: () => void;
  readonly onOpenChronicle: () => void;
}) {
  const { view, busy, error, progress } = controller;
  const [order, setOrder] = useState("");
  const latest = latestReport(view.chronicle);

  const send = async () => {
    const text = order.trim();
    if (text.length === 0 || busy) return;
    await controller.send(text);
    setOrder("");
  };

  return (
    <aside className="sim-panel" aria-label="Council">
      <header className="sim-panel__header">
        <h2>Council</h2>
        <div className="sim-panel__header-actions">
          <button type="button" onClick={onClose} aria-label="Close the council">×</button>
        </div>
      </header>

      {view.decision !== null && (
        <section className="sim-panel__decision">
          <h3>This needs your word</h3>
          <p>{view.decision.prompt}</p>
          <div className="sim-panel__options">
            {view.decision.options.map((option) => (
              <button key={option.id} type="button" disabled={busy} onClick={() => void controller.choose(view.decision!.id, option.id)}>
                <strong>{option.label}</strong>
                <span>{option.summary}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {busy && progress.length > 0 && (
        <section className="sim-panel__progress">
          <h3>The world is moving</h3>
          <ol>
            {progress.map((line, index) => (
              <li key={`${index}-${line}`} className={index === progress.length - 1 ? "sim-panel__progress-now" : undefined}>{line}</li>
            ))}
          </ol>
        </section>
      )}

      <section className="sim-panel__report">
        {latest.length === 0 ? (
          <p className="sim-panel__empty">Nothing has been recorded yet. Give an order and the world will answer.</p>
        ) : (
          <>
            <h3>Since your last order</h3>
            <ul className="sim-panel__headlines">
              {latest.map((entry) => (
                <li key={entry.id}>
                  {entry.date !== null && <span>{entry.date}</span>}
                  <button type="button" onClick={onOpenChronicle}>{entry.title}</button>
                </li>
              ))}
            </ul>
          </>
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
