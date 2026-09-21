"use client";

import { useState } from "react";
import { BooksPanel } from "./books-panel";
import { ChroniclePanel } from "./chronicle-panel";
import { latestReport, useGameView } from "./use-game-view";

/**
 * The player's three surfaces onto the simulation, and the tabs that open them.
 *
 * Council is where you speak to the world: an order, and the rare decision the
 * world puts back to you. Chronicle is where you read what it did. They used to
 * be one panel on the reasoning that with a continuous clock there are no turn
 * phases, only what you told the world and what it sent back -- true, and still
 * the wrong shape, because the two are not done at the same moment. Typing an
 * order and turning back through a reign want different room.
 *
 * What the Council keeps of the record is the headlines of the newest report,
 * as an answer to the order just given. The passages themselves are next door.
 *
 * Treasury is the third, and the newest. VISION §7 opens with a worked monthly
 * statement -- taxes, trade, tribute and estates against army, administration
 * and debt service -- and the engine has computed every line of it since the
 * economy was built while the client showed none of it. A ruler who wanted to
 * know whether he could afford a war had to infer it from a balance.
 */
export function SimulationPanel({ gameId }: { readonly gameId: string }) {
  const controller = useGameView(gameId);
  const [open, setOpen] = useState<"none" | "council" | "chronicle" | "books">("none");
  const [order, setOrder] = useState("");

  const { view, busy, progress, error } = controller;
  const latest = latestReport(view.chronicle);
  const unopened = view.chronicle.length;

  const send = async () => {
    const text = order.trim();
    if (text.length === 0 || busy) return;
    const reported = await controller.send(text);
    setOrder("");
    // Straight into the Chronicle when there is one. The report is the answer
    // to the order, and making the player find it themselves -- in the panel
    // next door, behind a tab -- was asking them to go and look for the thing
    // they had just spent three minutes waiting for.
    if (reported) setOpen("chronicle");
  };

  if (open === "none") {
    return (
      <div className="sim-tabs">
        <button type="button" className="sim-tab" onClick={() => setOpen("council")} aria-label="Open the council">
          Council{view.decision === null ? "" : " •"}
        </button>
        <button type="button" className="sim-tab" onClick={() => setOpen("chronicle")} aria-label="Open the chronicle">
          Chronicle{unopened === 0 ? "" : ` (${unopened})`}
        </button>
        <button type="button" className="sim-tab" onClick={() => setOpen("books")} aria-label="Open the treasury">
          Treasury
        </button>
      </div>
    );
  }

  if (open === "chronicle") return <ChroniclePanel controller={controller} onClose={() => setOpen("none")} />;
  // The books move only when simulated time does, and a new report is the
  // cheapest honest signal that it has.
  if (open === "books") return <BooksPanel gameId={gameId} revision={view.chronicle.length} onClose={() => setOpen("none")} />;

  return (
    <aside className="sim-panel" aria-label="Council">
      <header className="sim-panel__header">
        <h2>Council</h2>
        <div className="sim-panel__header-actions">
          <button type="button" onClick={() => setOpen("books")}>Treasury</button>
          <button type="button" onClick={() => setOpen("chronicle")}>Chronicle</button>
          <button type="button" onClick={() => setOpen("none")} aria-label="Close the council">×</button>
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
        // What the world is doing, while it is still doing it. None of this is
        // the record: it is not kept, and it goes when the next order is given.
        <section className="sim-panel__progress" aria-live="polite">
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
                  <button type="button" onClick={() => setOpen("chronicle")}>{entry.title}</button>
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
            {busy ? (progress[progress.length - 1] ?? "The world is moving…") : "Send"}
          </button>
        </form>
      )}

      {error !== null && <p className="sim-panel__error" role="alert">{error}</p>}
    </aside>
  );
}
