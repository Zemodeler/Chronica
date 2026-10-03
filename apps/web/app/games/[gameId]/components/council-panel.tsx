"use client";

import { useEffect, useRef, useState } from "react";
import type { StandingOrders, UnderWayItem } from "@chronica/shared";
import { Sheet } from "../../../components/ui/sheet";
import { useWindowState } from "../../../components/ui/window-workspace";
import { Era } from "../../../components/ui/era";
import { Tip, TipCard } from "../../../components/ui/tip";
import { Fact, Facts, Registry, RegistryRow } from "./registry";
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
  standingOrders = null,
  focusKey,
}: {
  readonly gameId: string;
  readonly controller: GameViewController;
  /** What his orders are doing, from the room (`ordersUnderWay`). */
  readonly underWay?: readonly UnderWayItem[];
  /** His conditional orders, from the room (`readStandingOrders`). */
  readonly standingOrders?: StandingOrders | null;
  /** A standing order to open on arrival, when the agenda sent him to it. */
  readonly focusKey?: string | undefined;
  /** Words another sheet has begun for the order box. */
  readonly draft?: string | null;
  readonly onDraftTaken?: () => void;
  readonly onClose: () => void;
  readonly onOpenChronicle: () => void;
}) {
  const { view, busy, error, progress } = controller;
  const [order, setOrder] = useWindowState("desk:draft", "");
  // Taken once, with the caret after it, so the player writes straight on.
  useEffect(() => {
    if (draft === null) return;
    setOrder((current) => current.trim() === "" ? draft : current.endsWith(draft) ? current : `${current}\n\n${draft}`);
    onDraftTaken?.();
    requestAnimationFrame(() => {
      const box = document.getElementById("sim-order") as HTMLTextAreaElement | null;
      box?.setSelectionRange(box.value.length, box.value.length);
    });
    // Only on arrival: the draft is what the desk was opened with.
  }, []);
  // Empty means "as far as the order takes it", which the engine judges.
  const [span, setSpan] = useWindowState<number | "">("desk:span", "");
  const latest = latestReport(view.chronicle, view.latestBurstId);
  const spanDays = span === "" ? undefined : span;
  const { elapsed, stamps: receivedStamps } = useMovingClock(busy, progress.length);
  const stamps = controller.progressSeconds ?? receivedStamps;
  // Nothing can be sent from an empty purse; say so before the click, not after.
  const spentOut = purseIsSpent(view.coins);

  const send = async () => {
    const text = order.trim();
    if (text.length === 0 || busy || spentOut) return;
    const sent = await controller.send(text, { spanDays });
    if (sent) setOrder((current) => current.trim() === text ? "" : current);
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
            {order.length > 0 && <p className="quiet desk__draft" role="status">Draft saved. You can put this down and consult another document.</p>}
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

        {!busy && (
          <section className="desk__report">
            {latest.length === 0 ? (
              <p className="quiet">Nothing has been recorded yet. Give an order and the world will answer.</p>
            ) : (
              <p className="desk__latest">
                <span className="desk__kicker">Since your last order</span>{" "}
                {latest[0]!.date !== null && <span className="desk__date"><Era text={latest[0]!.date} /> </span>}
                <button type="button" className="word-button" onClick={onOpenChronicle}>{latest[0]!.title}</button>
                {latest.length > 1 && <> · <button type="button" className="word-button desk__more" onClick={onOpenChronicle}>{latest.length - 1} more</button></>}
              </p>
            )}
          </section>
        )}

        {!busy && <UnderWay items={underWay} />}

        {!busy && standingOrders !== null && standingOrders.rows.length > 0 && (
          <StandingOrdersRegister
            orders={standingOrders}
            focusKey={focusKey}
            canWrite={view.decision === null && !spentOut}
            onDraft={(words) => {
              setOrder(words);
              requestAnimationFrame(() => {
                const box = document.getElementById("sim-order") as HTMLTextAreaElement | null;
                box?.focus();
                box?.setSelectionRange(box.value.length, box.value.length);
              });
            }}
          />
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
  const spentLine = purse.spent !== null && purse.cap !== null
    ? `This save has spent ${purse.spent} of its ${purse.cap} coins; you have ${purse.available} in your wallet.`
    : `You have ${purse.available} coins in your wallet.`;
  return (
    <p className="tablet__purse">
      <Tip label="What the coins stand at" note={() => <TipCard title="The coins">{spentLine}</TipCard>}>
        {lastTurnCost !== null ? <>Your last order cost {lastTurnCost} {lastTurnCost === "1" ? "coin" : "coins"}.</> : "Your coins"}
      </Tip>
    </p>
  );
}

/**
 * What the player's orders are doing: one line each, a stalled one marked in
 * the seal colour. Nothing under way, nothing shown.
 */
function UnderWay({ items }: { readonly items: readonly UnderWayItem[] }) {
  if (items.length === 0) return null;
  const stalled = items.filter((item) => item.stalled).length;
  return (
    <p className="under-way">
      <Tip
        label="Orders under way"
        note={() => (
          <TipCard kicker="Your orders" title="Under way">
            <ul className="under-way__list">
              {items.map((item) => (
                <li key={item.key} className={item.stalled ? "is-stalled" : undefined}>
                  <strong>{item.stalled && <span className="seal-dot"><span className="visually-hidden">Stalled: </span></span>}{item.label}</strong>
                  <span>{item.detail}{item.secret === true && " Known only to you."}</span>
                </li>
              ))}
            </ul>
          </TipCard>
        )}
      >
        {items.length === 1 ? "One order under way" : `${items.length} orders under way`}
        {stalled > 0 && <> · {stalled} stalled <span className="seal-dot"><span className="visually-hidden">stalled</span></span></>}
      </Tip>
    </p>
  );
}

/**
 * The register of conditional orders: "If the enemy reaches the crossing,
 * withdraw the garrison."
 *
 * One line each, with its status; opened, its trigger, its instructions, who
 * answers for it and where it stands. A change is an order like any other: the
 * buttons only begin the words at the order box ("Call off my standing order
 * ..."), and sending them is what changes anything, through the same reader
 * and the same rules as everything else the player says.
 */
const STATUS_WORD = { waiting: "Waiting", triggered: "Triggered", completed: "Completed", cancelled: "Cancelled" } as const;

function StandingOrdersRegister({ orders, focusKey, canWrite, onDraft }: {
  readonly orders: StandingOrders;
  readonly focusKey: string | undefined;
  readonly canWrite: boolean;
  readonly onDraft: (words: string) => void;
}) {
  return (
    <section className="standing-orders" aria-labelledby="standing-orders-heading">
      <h3 id="standing-orders-heading">Standing orders{orders.waiting > 0 && <small>{orders.waiting} waiting</small>}</h3>
      <Registry label="Standing orders">
        {orders.rows.map((row) => (
          <RegistryRow
            key={row.key}
            id={row.key}
            title={row.summary}
            meta={STATUS_WORD[row.status]}
            marked={row.status === "triggered"}
            openOnArrival={row.key === focusKey}
          >
            <Facts>
              <Fact term="Trigger">{row.detail.trigger}</Fact>
              <Fact term="Instructions">{row.detail.instructions}</Fact>
              <Fact term="Answers for it">{row.detail.responsible}</Fact>
              <Fact term="Status">{STATUS_WORD[row.status]}. {row.detail.statusNote}</Fact>
              {row.detail.layer.length > 0 && <Fact term="Also">{row.detail.layer.map((line) => <span key={line} className="registry__line">{line}</span>)}</Fact>}
            </Facts>
            {row.detail.changeable && (
              <div className="registry__actions">
                <button type="button" className="btn btn--quiet" disabled={!canWrite} onClick={() => onDraft(`Amend my standing order "${row.label}": `)}>Amend</button>
                <button type="button" className="btn btn--quiet" disabled={!canWrite} onClick={() => onDraft(`Call off my standing order "${row.label}".`)}>Call off</button>
              </div>
            )}
          </RegistryRow>
        ))}
      </Registry>
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
