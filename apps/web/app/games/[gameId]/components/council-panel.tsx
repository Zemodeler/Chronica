"use client";

import { useEffect, useRef, useState } from "react";
import type { UnderWayItem } from "@chronica/shared";
import { Sheet } from "../../../components/ui/sheet";
import { Era } from "../../../components/ui/era";
import { TIME_SPANS, coinDifference, latestReport, purseIsSpent, type GameViewController, type Purse } from "./use-game-view";

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
 *
 * The order is written on wax, at the desk, and a decision arrives as a
 * sealed letter. While the world moves -- seventeen seconds or eleven minutes,
 * nobody can say which in advance -- the desk says what is happening and how
 * long it has been, rather than spinning.
 */
export function CouncilPanel({
  controller,
  draft = null,
  onDraftTaken,
  onClose,
  onOpenChronicle,
  underWay = [],
}: {
  readonly gameId: string;
  readonly controller: GameViewController;
  /** What his orders are doing, from the room (`ordersUnderWay`). */
  readonly underWay?: readonly UnderWayItem[];
  /** Words another sheet has begun for the order box. */
  readonly draft?: string | null;
  readonly onDraftTaken?: () => void;
  readonly onClose: () => void;
  readonly onOpenChronicle: () => void;
}) {
  const { view, busy, error, progress } = controller;
  const [order, setOrder] = useState(draft ?? "");
  // Taken once, with the caret after it, so the player writes straight on.
  useEffect(() => {
    if (draft === null) return;
    onDraftTaken?.();
    requestAnimationFrame(() => {
      const box = document.getElementById("sim-order") as HTMLTextAreaElement | null;
      box?.setSelectionRange(box.value.length, box.value.length);
    });
    // Only on arrival: the draft is what the desk was opened with.
  }, []);
  // Empty means "as far as the order takes it", which the engine judges.
  const [span, setSpan] = useState<number | "">("");
  const latest = latestReport(view.chronicle, view.latestBurstId);
  const spanDays = span === "" ? undefined : span;
  const { elapsed, stamps } = useMovingClock(busy, progress.length);
  // Nothing can be sent from an empty purse; say so before the click, not after.
  const spentOut = purseIsSpent(view.coins);

  const send = async () => {
    const text = order.trim();
    if (text.length === 0 || busy || spentOut) return;
    await controller.send(text, { spanDays });
    setOrder("");
  };

  // Time let pass with no order at all. It still moves the world and its
  // people, so it still costs what their answers cost.
  const wait = async () => {
    if (busy || spentOut) return;
    await controller.send("", { wait: true, spanDays: spanDays ?? 30 });
  };

  return (
    <Sheet label="the council" title="Council" width="desk" side="center" tone="umber" onClose={onClose}>
      <div className="desk">
        {view.decision !== null && (
          <section className="decision on-papyrus" aria-labelledby="decision-heading">
            <h3 id="decision-heading">This needs your word</h3>
            <p className="decision__prompt">{view.decision.prompt}</p>
            <div className="decision__options">
              {view.decision.options.map((option) => (
                <button key={option.id} type="button" className="decision__option" disabled={busy} onClick={() => void controller.choose(view.decision!.id, option.id)}>
                  <strong>{option.label}</strong>
                  <span>{option.summary}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {busy && (
          <section className="moving" aria-live="polite">
            <div className="moving__head">
              <h3>The world is moving</h3>
              <span className="moving__elapsed">{clock(elapsed)} so far</span>
            </div>
            {progress.length > 0 && (
              <ol className="moving__trail">
                {progress.map((line, index) => (
                  <li key={`${index}-${line}`} className={index === progress.length - 1 ? "is-now" : "is-done"}>
                    <time>{clock(stamps[index] ?? elapsed)}</time>
                    <span>{line}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}

        {!busy && (
          <section className="desk__report">
            {latest.length === 0 ? (
              <p className="quiet">Nothing has been recorded yet. Give an order and the world will answer.</p>
            ) : (
              <>
                <h3>Since your last order</h3>
                <ul className="desk__headlines">
                  {latest.map((entry) => (
                    <li key={entry.id}>
                      {entry.date !== null && <span className="desk__date"><Era text={entry.date} /></span>}
                      <button type="button" className="word-button" onClick={onOpenChronicle}>{entry.title}</button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}

        {!busy && <UnderWay items={underWay} />}

        {view.decision === null && (
          <form className="tablet" onSubmit={(event) => { event.preventDefault(); void send(); }}>
            <label htmlFor="sim-order">Your order</label>
            <textarea
              id="sim-order"
              data-autofocus
              value={order}
              rows={3}
              maxLength={2000}
              placeholder="Raise two new legions."
              disabled={busy}
              onChange={(event) => setOrder(event.target.value)}
              onKeyDown={(event) => {
                // The order is the whole form: Cmd or Ctrl and Enter sends it.
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send(); }
              }}
            />
            <div className="tablet__then">
              <label htmlFor="sim-order-span">Then let</label>
              <select
                id="sim-order-span"
                value={span}
                disabled={busy}
                onChange={(event) => setSpan(event.target.value === "" ? "" : Number(event.target.value))}
              >
                <option value="">as long as it takes</option>
                {TIME_SPANS.map((choice) => <option key={choice.days} value={choice.days}>{choice.label}</option>)}
              </select>
              <span>pass.</span>
            </div>
            <div className="tablet__actions">
              <button type="button" className="btn btn--quiet" disabled={busy || spentOut} onClick={() => void wait()}>
                Let {TIME_SPANS.find((choice) => choice.days === (spanDays ?? 30))?.label ?? "a month"} pass
              </button>
              <button type="submit" className="btn btn--primary" disabled={busy || spentOut || order.trim().length === 0}>
                {busy ? "The world is moving…" : "Send"}
              </button>
            </div>
            <Reckoning purse={view.coins} lastTurnCost={controller.lastTurnCost} />
          </form>
        )}

        {error !== null && <p className="desk__error" role="alert">{error}</p>}
      </div>
    </Sheet>
  );
}

/**
 * What turns have cost, under the order. A turn is billed by what the world's
 * people had to think, so it has no price until it is over; the desk says
 * what the last one came to and how much of the save's allowance is left.
 */
function Reckoning({ purse, lastTurnCost }: { readonly purse: Purse | undefined; readonly lastTurnCost: string | null }) {
  if (purse === undefined) return null;
  if (purse.available === "0") {
    return <p className="tablet__purse is-empty" role="status">Your wallet is empty, so nothing more can be sent. <a href="/account">Add coins</a> and come back to the desk.</p>;
  }
  if (purse.spent !== null && purse.cap !== null && coinDifference(purse.cap, purse.spent) === "0") {
    return <p className="tablet__purse is-empty" role="status">This save has spent all {purse.cap} of the coins it was allowed, so nothing more can be sent.</p>;
  }
  return (
    <p className="tablet__purse">
      {lastTurnCost !== null && <>Your last order cost {lastTurnCost} {lastTurnCost === "1" ? "coin" : "coins"}. </>}
      {purse.spent !== null && purse.cap !== null
        ? <>This save has spent {purse.spent} of its {purse.cap} coins; you have {purse.available} in your wallet.</>
        : <>You have {purse.available} coins in your wallet.</>}
    </p>
  );
}

/**
 * What the player's orders are doing: one line each, a stalled one marked in
 * the seal colour. Nothing under way, nothing shown.
 */
function UnderWay({ items }: { readonly items: readonly UnderWayItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="under-way" aria-labelledby="under-way-heading">
      <h3 id="under-way-heading">Under way</h3>
      <ul>
        {items.map((item) => (
          <li key={item.key} className={item.stalled ? "is-stalled" : undefined}>
            <strong>{item.stalled && <span className="seal-dot"><span className="visually-hidden">Stalled: </span></span>}{item.label}</strong>
            <span>{item.detail}{item.secret === true && " Known only to you."}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Seconds since the world started moving, and when each progress line came
 * in. Kept here, not in the controller: it is how long the player has been
 * waiting, which only the desk shows.
 */
function useMovingClock(busy: boolean, lines: number): { elapsed: number; stamps: readonly number[] } {
  const startedAt = useRef<number | null>(null);
  const [stamps, setStamps] = useState<number[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!busy) { startedAt.current = null; setStamps([]); return; }
    startedAt.current ??= Date.now();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [busy]);

  useEffect(() => {
    if (!busy || startedAt.current === null) return;
    const at = Math.round((Date.now() - startedAt.current) / 1000);
    setStamps((current) => (current.length >= lines ? current : [...current, ...Array<number>(lines - current.length).fill(at)]));
  }, [busy, lines]);

  const elapsed = startedAt.current === null ? 0 : Math.max(0, Math.round((now - startedAt.current) / 1000));
  return { elapsed, stamps };
}

function clock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
