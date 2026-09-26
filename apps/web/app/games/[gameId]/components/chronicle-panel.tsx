"use client";

import { useMemo, useState } from "react";
import { Sheet, type SheetSide } from "../../../components/ui/sheet";
import { Era } from "../../../components/ui/era";
import type { ChronicleEntry, EntryTag, GameViewController } from "./use-game-view";

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

function Entry({ entry, onTag }: { readonly entry: ChronicleEntry; readonly onTag: (tag: EntryTag) => void }) {
  return (
    <article className={entry.published ? "chronicle-entry" : "chronicle-entry is-unfolding"}>
      <header>
        {entry.date !== null && <p className="chronicle-entry__date"><Era text={entry.date} /></p>}
        <h3>{entry.title}</h3>
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

      {entry.kind === "recorded"
        ? <LedgerBody body={entry.body} />
        : <div className="chronicle-entry__body">{entry.body.split("\n\n").map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>}

      {entry.quote !== null && (
        <figure className="chronicle-entry__quote">
          <blockquote>{`“${entry.quote.line}”`}</blockquote>
          <figcaption>{`${entry.quote.speaker}, ${entry.quote.occasion}`}</figcaption>
        </figure>
      )}

      {entry.changes.length > 0 && (
        <section className="chronicle-entry__changes">
          <h4>{`${entry.changes.length} change${entry.changes.length === 1 ? "" : "s"} on the map`}</h4>
          <ul>
            {entry.changes.map((change) => (
              <li key={`${change.kind}:${change.id}:${change.detail}`}>
                <strong>{change.label}</strong>
                <span>{change.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

export function ChroniclePanel({ controller, onClose, side }: { readonly controller: GameViewController; readonly onClose: () => void; readonly side: SheetSide }) {
  const [filter, setFilter] = useState<EntryTag | null>(null);

  // Newest first: a reader opening the record wants where it has got to, and
  // can turn back from there.
  const entries = useMemo(() => {
    const newestFirst = [...controller.view.chronicle].reverse();
    if (filter === null) return newestFirst;
    const wanted = tagKey(filter);
    return newestFirst.filter((entry) => entry.subjects.some((subject) => tagKey(subject) === wanted));
  }, [controller.view.chronicle, filter]);

  return (
    <Sheet label="the chronicle" title="Chronicle" width="reading" side={side} onClose={onClose} className="chronicle-panel">
      {filter !== null && (
        <div className="chronicle-filter">
          <span>Everything touching <strong>{filter.label}</strong></span>
          <button type="button" className="word-button" onClick={() => setFilter(null)}>Show all</button>
        </div>
      )}
      {controller.busy && (
        <p className="chronicle-unfolding" aria-live="polite">The season is still unfolding. What follows is written as it happens; nothing already shown will move.</p>
      )}
      {entries.length === 0 ? (
        <p className="quiet">
          {filter === null
            ? "Nothing has been recorded yet. Give an order and the world will answer."
            : "Nothing in the record touches that."}
        </p>
      ) : (
        entries.map((entry) => <Entry key={entry.id} entry={entry} onTag={setFilter} />)
      )}
    </Sheet>
  );
}
