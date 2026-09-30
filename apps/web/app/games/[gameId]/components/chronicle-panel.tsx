"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Sheet, type SheetSide } from "../../../components/ui/sheet";
import { Era } from "../../../components/ui/era";
import { unreadCount, type ChronicleEntry, type EntryTag, type GameViewController } from "./use-game-view";
import { Linkify, Name, ThreadName, useThreads } from "./notes";
import type { EntityKey } from "@chronica/shared";

/**
 * The record, as something to read rather than something to be notified of.
 *
 * The old panel fetched the whole Chronicle and displayed the last report,
 * throwing the rest away. That is not a chronicle; it is a receipt for the last
 * order. This is the other half: every entry the reign has produced, newest
 * first, each under the day it entered the record, and filterable by the
 * subjects the entries themselves are tagged with.
 *
 * Two kinds of entry render differently on purpose. A narrated entry is a
 * historian's passage. A recorded one -- the books, struck at the turn of the
 * year -- is a table, because putting a balance sheet through a narrator
 * produces prose about precision it does not have.
 */

const KIND_LABEL: Readonly<Record<string, string>> = {
  polity: "power",
  province: "place",
  character: "person",
  force: "army",
};

const tagKey = (tag: { readonly kind: string; readonly id: string }): string => `${tag.kind}:${tag.id}`;

function LedgerBody({ body }: { readonly body: string }) {
  const rows = body.split("\n").map((line) => {
    const at = line.indexOf(": ");
    return at === -1 ? { label: line, value: "", indented: false } : {
      label: line.slice(0, at).trim(),
      value: line.slice(at + 2).trim(),
      indented: line.startsWith("  "),
    };
  });
  return (
    <dl className="chronicle-entry__ledger">
      {rows.map((row, index) => (
        <div key={index} className={row.indented ? "chronicle-entry__ledger-row is-detail" : "chronicle-entry__ledger-row"}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The engine's account of what each part of the order came to, set under the passage (`withOrderOutcomes` in the sim). */
const OUTCOME_HEADING = "What came of the order:";

function Outcomes({ block }: { readonly block: string }) {
  const lines = block.split("\n").slice(1).map((line) => line.replace(/^- /, "")).filter((line) => line.trim() !== "");
  return (
    <section className="chronicle-entry__outcomes" aria-label="What came of the order">
      <h4>What came of the order</h4>
      <ul>{lines.map((line, index) => <li key={index}><Linkify text={line} /></li>)}</ul>
    </section>
  );
}

function EntryBody({ entry }: { readonly entry: ChronicleEntry }) {
  const at = entry.body.indexOf(OUTCOME_HEADING);
  const prose = at < 0 ? entry.body : entry.body.slice(0, at).trimEnd();
  const outcomes = at < 0 ? null : entry.body.slice(at);
  return (
    <>
      {prose !== "" && (entry.kind === "recorded"
        ? <LedgerBody body={prose} />
        : <div className="chronicle-entry__body">{prose.split("\n\n").map((paragraph, index) => <p key={index}><Linkify text={paragraph} /></p>)}</div>)}
      {outcomes !== null && <Outcomes block={outcomes} />}
    </>
  );
}

/** Which note a change's subject opens: a province is a place, a polity a power. A purse has none. */
const NOTE_KIND: Readonly<Record<string, string>> = { province: "place", force: "force", character: "person", polity: "power" };
const noteKeyOf = (change: { readonly kind: string; readonly id: string }): EntityKey | null =>
  NOTE_KIND[change.kind] === undefined ? null : (`${NOTE_KIND[change.kind]}:${change.id}` as EntityKey);

function Entry({ entry, onTag, focused }: { readonly entry: ChronicleEntry; readonly onTag: (tag: EntryTag) => void; readonly focused: boolean }) {
  const { threads } = useThreads();
  const threadsOf = (of: ChronicleEntry): readonly string[] => (of.storylineIds ?? []).filter((id) => threads[id] !== undefined);
  return (
    <article
      id={`chronicle-entry-${entry.id}`}
      data-entry-id={entry.id}
      data-unread={entry.unread && entry.published ? "true" : undefined}
      className={`chronicle-entry${entry.published ? "" : " is-unfolding"}${focused ? " is-focused" : ""}`}
    >
      <header>
        {(entry.date !== null || entry.unread) && (
          <p className="chronicle-entry__date">
            {entry.date !== null && <Era text={entry.date} />}
            {entry.happened != null && <span className="chronicle-entry__happened"> (events from <Era text={entry.happened} />)</span>}
            {entry.unread && entry.published && <span className="chronicle-entry__new">New</span>}
          </p>
        )}
        <h3>{entry.title}</h3>
        {threadsOf(entry).length > 0 && (
          <p className="chronicle-entry__threads">
            {threadsOf(entry).map((id, index) => <span key={id}>{index > 0 && " · "}<ThreadName id={id} /></span>)}
          </p>
        )}
        {entry.tags.length > 0 && (
          <ul className="chronicle-entry__tags" aria-label="Show everything touching">
            {entry.tags.map((tag) => (
              <li key={tagKey(tag)}>
                <button type="button" className="word-button" onClick={() => onTag(tag)} title={`Everything touching this ${KIND_LABEL[tag.kind] ?? tag.kind}`}>
                  {tag.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </header>

      <EntryBody entry={entry} />

      {entry.quote !== null && (
        <figure className="chronicle-entry__quote">
          <blockquote>{`“${entry.quote.line}”`}</blockquote>
          <figcaption>{`${entry.quote.speaker}, ${entry.quote.occasion}`}</figcaption>
        </figure>
      )}

      {entry.changes.length > 0 && (
        <section className="chronicle-entry__changes">
          <h4>What this changed, as far as you know</h4>
          <ul>
            {entry.changes.map((change) => (
              <li key={`${change.kind}:${change.id}:${change.detail}`}>
                <strong><Name k={noteKeyOf(change)}>{change.label}</Name></strong>
                <span><Linkify text={change.detail} /></span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

/**
 * Where to open the record: already filtered to someone, and with one entry
 * brought into view. The mirror opens it this way -- "everything about you",
 * or the entry behind one line of the player's life.
 */
export interface ChronicleFocus {
  readonly filter: EntryTag | null;
  readonly entryId: string | null;
}

export function ChroniclePanel({ controller, onClose, side, focus = null }: {
  readonly controller: GameViewController;
  readonly onClose: () => void;
  readonly side: SheetSide;
  readonly focus?: ChronicleFocus | null;
}) {
  const [filter, setFilter] = useState<EntryTag | null>(focus?.filter ?? null);
  const focusedId = focus?.entryId ?? null;
  // A note inside the open record can ask for another place in it: a
  // thread's entry, a matter's person. Take the new filter when it does.
  useEffect(() => { if (focus !== null) setFilter(focus.filter); }, [focus]);
  useEffect(() => {
    if (focusedId === null) return;
    requestAnimationFrame(() => document.getElementById(`chronicle-entry-${focusedId}`)?.scrollIntoView({ block: "start" }));
  }, [focusedId]);

  // "Only what is unread" keeps the entries that were unread when it was
  // chosen: reading one must not make it vanish from under the reader.
  const [unreadOnly, setUnreadOnly] = useState<ReadonlySet<string> | null>(null);
  const unread = unreadCount(controller.view.chronicle);

  // Newest first: a reader opening the record wants where it has got to, and
  // can turn back from there.
  const entries = useMemo(() => {
    let shown = [...controller.view.chronicle].reverse();
    if (unreadOnly !== null) shown = shown.filter((entry) => unreadOnly.has(entry.id));
    if (filter === null) return shown;
    const wanted = tagKey(filter);
    return shown.filter((entry) => entry.subjects.some((subject) => tagKey(subject) === wanted));
  }, [controller.view.chronicle, filter, unreadOnly]);

  const list = useRef<HTMLDivElement>(null);
  useReadingMarks(list, entries, controller.markRead);

  return (
    <Sheet label="the chronicle" title="Chronicle" width="reading" side={side} onClose={onClose} className="chronicle-panel">
            {filter !== null && (
              <div className="chronicle-filter">
                <span>Everything touching <strong>{filter.label}</strong></span>
                <button type="button" className="word-button" onClick={() => setFilter(null)}>Show all</button>
              </div>
            )}
            <div className="chronicle-reading" aria-live="polite">
              <span>
                {unread === 0
                  ? "You have read everything recorded."
                  : `${unread} ${unread === 1 ? "entry" : "entries"} you have not read yet, marked New.`}
              </span>
              {unreadOnly === null && unread > 0 && (
                <button type="button" className="word-button" onClick={() => setUnreadOnly(new Set(controller.view.chronicle.filter((entry) => entry.unread).map((entry) => entry.id)))}>
                  Only what is unread
                </button>
              )}
              {unreadOnly !== null && <button type="button" className="word-button" onClick={() => setUnreadOnly(null)}>Show everything</button>}
              {unread > 0 && <button type="button" className="word-button" onClick={() => void controller.markRead()}>Mark all as read</button>}
            </div>
            {controller.busy && (
              <p className="chronicle-unfolding" aria-live="polite">The season is still unfolding. What follows is written as it happens; nothing already shown will move.</p>
            )}
            {entries.length === 0 ? (
              <p className="quiet">
                {filter !== null
                  ? "Nothing in the record touches that."
                  : unreadOnly !== null
                    ? "Nothing unread."
                    : "Nothing has been recorded yet. Give an order and the world will answer."}
              </p>
            ) : (
              <div ref={list}>
                {entries.map((entry) => <Entry key={entry.id} entry={entry} onTag={setFilter} focused={entry.id === focusedId} />)}
              </div>
            )}
    </Sheet>
  );
}

/** How long an entry must stay on the page before it counts as read. */
const READ_AFTER_MS = 1500;

/**
 * Marks entries read as the player reads them.
 *
 * An unread entry counts as read once it has held most of itself -- or, for a
 * long one, half the view -- on the page for a moment and a half. Scrolling
 * past does not count. Reads are sent together, so a quick run through the
 * record is one request rather than one per entry.
 */
function useReadingMarks(
  list: React.RefObject<HTMLDivElement | null>,
  entries: readonly ChronicleEntry[],
  markRead: (entryIds?: readonly string[]) => Promise<void>,
): void {
  const unreadIds = entries.filter((entry) => entry.unread && entry.published).map((entry) => entry.id).join(",");
  useEffect(() => {
    const root = list.current;
    if (root === null || unreadIds.length === 0 || typeof IntersectionObserver === "undefined") return;
    const inViewSince = new Map<string, number>();
    const sent = new Set<string>();
    const observer = new IntersectionObserver((records) => {
      for (const record of records) {
        const id = (record.target as HTMLElement).dataset.entryId;
        if (id === undefined) continue;
        const viewHeight = record.rootBounds?.height ?? window.innerHeight;
        const reading = record.intersectionRatio >= 0.6 || record.intersectionRect.height >= viewHeight * 0.5;
        if (reading) { if (!inViewSince.has(id)) inViewSince.set(id, performance.now()); }
        else inViewSince.delete(id);
      }
    }, { threshold: [0, 0.25, 0.5, 0.6, 0.75, 1] });
    for (const element of root.querySelectorAll<HTMLElement>("[data-unread='true']")) observer.observe(element);
    const tick = window.setInterval(() => {
      const now = performance.now();
      const read = [...inViewSince].filter(([id, since]) => !sent.has(id) && now - since >= READ_AFTER_MS).map(([id]) => id);
      if (read.length === 0) return;
      for (const id of read) { sent.add(id); inViewSince.delete(id); }
      void markRead(read);
    }, 500);
    return () => { observer.disconnect(); window.clearInterval(tick); };
  }, [list, unreadIds, markRead]);
}
