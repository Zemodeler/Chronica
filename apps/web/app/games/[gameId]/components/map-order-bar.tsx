"use client";

import { useState } from "react";
import type { GameViewController } from "./use-game-view";

/**
 * One line, and a door.
 *
 * Moving the order box into the Office cost something real: you could look at
 * Sicily and type "Defend Sicily" without leaving the world you were talking
 * about, and now giving an order means turning your back on it. This is what
 * is paid back -- a single line, pinned to the foot of the map, for the order
 * you think of while looking at the thing it is about.
 *
 * When the world is waiting on your word there is no box, because a decision
 * is not something to answer in a single line while glancing at a map. The bar
 * becomes a door to the desk instead.
 */
export function MapOrderBar({
  controller,
  onGoToDesk,
}: {
  readonly controller: GameViewController;
  readonly onGoToDesk: () => void;
}) {
  const [order, setOrder] = useState("");
  const { view, busy } = controller;

  if (view.decision !== null) {
    return (
      <div className="map-order-bar map-order-bar--waiting">
        <button type="button" onClick={onGoToDesk}>
          The world is waiting on your word.
        </button>
      </div>
    );
  }

  return (
    <form
      className="map-order-bar"
      onSubmit={(event) => {
        event.preventDefault();
        const text = order.trim();
        if (text.length === 0 || busy) return;
        setOrder("");
        void controller.send(text);
      }}
    >
      <label className="visually-hidden" htmlFor="map-order">Your order</label>
      <input
        id="map-order"
        type="text"
        value={order}
        maxLength={2000}
        placeholder={busy ? "The world is moving…" : "Defend Sicily."}
        disabled={busy}
        onChange={(event) => setOrder(event.target.value)}
      />
      <button type="submit" disabled={busy || order.trim().length === 0}>Send</button>
      <button type="button" className="map-order-bar__desk" onClick={onGoToDesk}>At the desk…</button>
    </form>
  );
}
