"use client";

import type { UnderWayItem } from "@chronica/shared";
import { Sheet } from "../../../components/ui/sheet";
import { Tabs } from "../../../components/ui/tabs";
import { useWindowState } from "../../../components/ui/window-workspace";
import { Era } from "../../../components/ui/era";
import { Linkify } from "./notes";
import type { ChronicleEntry } from "./use-game-view";
import type { OrderHistoryView } from "../../../../lib/room-service";

export function OrdersPanel({ items, record, orderHistory = [], loading, focusKey, onClose, onDraft, onOpenEntry }: {
  readonly items: readonly UnderWayItem[];
  readonly record: readonly ChronicleEntry[];
  readonly orderHistory?: readonly OrderHistoryView[];
  readonly loading: boolean;
  readonly focusKey?: string | undefined;
  readonly onClose: () => void;
  readonly onDraft: (text: string) => void;
  readonly onOpenEntry: (id: string) => void;
}) {
  const [expanded, setExpanded] = useWindowState<string | null>("orders:expanded", null);
  const selected = focusKey ?? expanded;
  const history = [...record].filter((entry) => entry.published).reverse().slice(0, 30);
  return (
    <Sheet label="your orders" title="Orders under way" width="desk" side="center" onClose={onClose}>
      <Tabs label="Your orders" initial={focusKey === undefined ? undefined : "active"} sections={[
        { id: "active", title: "Active", marked: items.some((item) => item.stalled), content: (
          <div className="orders-register">
            {loading && <p className="quiet" role="status">Sending for your orders…</p>}
            {!loading && items.length === 0 && <p className="quiet">Nothing is under way. Give an order at the writing desk.</p>}
            {items.map((item) => (
              <article key={item.key} className="orders-register__row">
                <div className="orders-register__head"><h3><Linkify text={item.label} /></h3><span className={item.stalled ? "orders-register__status is-stalled" : "orders-register__status"}>{item.stalled ? "Needs your word" : "Under way"}</span></div>
                <p><Linkify text={item.detail} /></p>
                {item.secret && <p className="quiet">Known only to you.</p>}
                <button type="button" className="word-button" aria-expanded={selected === item.key} onClick={() => setExpanded(selected === item.key ? null : item.key)}>Review this instruction</button>
                {selected === item.key && <div className="orders-register__detail"><p>These are the latest reports available to you. A new instruction can clarify or change what you want done.</p><button type="button" className="btn btn--primary" onClick={() => onDraft(`Regarding ${item.label}: `)}>Write a further instruction</button></div>}
              </article>
            ))}
          </div>
        ) },
        { id: "history", title: "History", content: (
          <div className="orders-register">
            <p className="quiet">Your instructions and what came of them, newest first.</p>
            {orderHistory.map((order) => <article className="orders-register__row" key={order.id}>
              <p className="quiet"><Era text={order.when} /></p>
              <h3><Linkify text={order.text} /></h3>
              <ul>{order.parts.map((part, index) => <li key={index}><strong><Linkify text={part.label} /></strong>: {part.status}{part.detail !== null && <>. <Linkify text={part.detail} /></>}</li>)}</ul>
            </article>)}
            {orderHistory.length === 0 && <p className="quiet">No instructions have been recorded yet.</p>}
            {history.length > 0 && <h3>Reports in the Chronicle</h3>}
            {history.map((entry) => <article className="orders-register__row" key={entry.id}>{entry.date && <p className="quiet"><Era text={entry.date} /></p>}<button type="button" className="word-button" onClick={() => onOpenEntry(entry.id)}>{entry.title}</button></article>)}
          </div>
        ) },
      ]} />
    </Sheet>
  );
}
