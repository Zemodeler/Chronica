"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * A register: a list of things, each one line until it is opened.
 *
 * The seal case's constitution and laws, the desk's standing orders and the
 * ledger stand's departments are the same shape of page: a name, a plain
 * sentence, a mark where something is wrong, and behind it the recorded
 * detail. One disclosure per row, a real button with `aria-expanded`, so the
 * keyboard and a screen reader get it for free; and a row can be opened on
 * arrival, scrolled to, when another page sent the player here for it.
 */
export function Registry({ label, children, className }: { readonly label: string; readonly children: ReactNode; readonly className?: string }) {
  return <ul className={className === undefined ? "registry" : `registry ${className}`} aria-label={label}>{children}</ul>;
}

export function RegistryRow({ id, title, sentence, meta, marked = false, yours = false, openOnArrival = false, children }: {
  /** The thing's key, so a destination can find it. */
  readonly id: string;
  readonly title: ReactNode;
  /** One plain sentence under the title. */
  readonly sentence?: ReactNode;
  /** A short fact beside the title: a date, a status. */
  readonly meta?: ReactNode;
  readonly marked?: boolean;
  readonly yours?: boolean;
  readonly openOnArrival?: boolean;
  /** The recorded detail. Rendered only while open. */
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(openOnArrival);
  const regionId = useId();
  const row = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (openOnArrival) row.current?.scrollIntoView({ block: "nearest" });
    // Only on arrival: after that the player's own clicks decide.
  }, []);
  return (
    <li ref={row} className={`registry__row${marked ? " is-marked" : ""}${yours ? " is-yours" : ""}`} data-registry-id={id}>
      <button type="button" className="registry__head" aria-expanded={open} aria-controls={regionId} onClick={() => setOpen((was) => !was)}>
        <span className="registry__title">
          {marked && <span className="seal-dot"><span className="visually-hidden">Wants your word: </span></span>}
          {title}
        </span>
        {meta !== undefined && meta !== null && <span className="registry__meta">{meta}</span>}
        {sentence !== undefined && sentence !== null && <span className="registry__sentence">{sentence}</span>}
      </button>
      {open && <div id={regionId} className="registry__detail" role="region">{children}</div>}
    </li>
  );
}

/** A labelled fact inside an opened row. */
export function Fact({ term, children }: { readonly term: string; readonly children: ReactNode }) {
  return <div className="registry__fact"><dt>{term}</dt><dd>{children}</dd></div>;
}

export function Facts({ children }: { readonly children: ReactNode }) {
  return <dl className="registry__facts">{children}</dl>;
}

/** What the record does not say, kept visibly apart from what it does. */
export function Unknown({ lines }: { readonly lines: readonly string[] }) {
  if (lines.length === 0) return null;
  return <ul className="registry__unknown">{lines.map((line) => <li key={line}>{line}</li>)}</ul>;
}
