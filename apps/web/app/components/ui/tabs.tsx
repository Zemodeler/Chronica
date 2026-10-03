"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useWindowState } from "./window-workspace";

/**
 * Ribbons in a ledger: a document with more than one section to turn to.
 *
 * A tab with nothing to show is not offered, and a document with one section
 * shows it with no ribbons at all -- most players' ledgers will only ever
 * have the one. Arrow keys move between ribbons, as a tablist should.
 */
export interface TabSection {
  readonly id: string;
  readonly title: string;
  /** Set when this section wants attention: shows the seal dot on its ribbon. */
  readonly marked?: boolean;
  readonly content: ReactNode;
}

export function Tabs({ label, sections, initial, selected, onSelect }: {
  readonly label: string;
  readonly sections: readonly TabSection[];
  /** The ribbon to open on, where the player was sent to a particular one. */
  readonly initial?: string | undefined;
  /** Set to let the caller move the ribbons too: a link in one page that turns to another. */
  readonly selected?: string | undefined;
  readonly onSelect?: ((id: string) => void) | undefined;
}) {
  const base = useId();
  const [remembered, setRemembered] = useWindowState<string | null>(`tabs:${label}`, null);
  const [own, setOwn] = useState<string | null>(initial ?? remembered);
  const chosen = selected ?? own;
  const setChosen = (id: string) => { setOwn(id); setRemembered(id); onSelect?.(id); };
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  if (sections.length === 0) return null;
  if (sections.length === 1) return <>{sections[0]!.content}</>;
  const current = sections.find((section) => section.id === (chosen ?? remembered)) ?? sections[0]!;

  const onKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const to = event.key === "Home" ? 0 : event.key === "End" ? sections.length - 1 : step === 0 ? null : (index + step + sections.length) % sections.length;
    if (to === null) return;
    event.preventDefault();
    setChosen(sections[to]!.id);
    buttons.current[to]?.focus();
  };

  return (
    <div className="tabs">
      <div className="tabs__list" role="tablist" aria-label={label}>
        {sections.map((section, index) => (
          <button
            key={section.id}
            ref={(node) => { buttons.current[index] = node; }}
            type="button"
            role="tab"
            id={`${base}-${section.id}-tab`}
            aria-controls={`${base}-${section.id}`}
            aria-selected={section.id === current.id}
            tabIndex={section.id === current.id ? 0 : -1}
            onClick={() => setChosen(section.id)}
            onKeyDown={(event) => onKey(event, index)}
          >
            {section.title}
            {section.marked === true && <span className="seal-dot"><span className="visually-hidden"> (wants your word)</span></span>}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-${current.id}`} aria-labelledby={`${base}-${current.id}-tab`} className="tabs__panel">
        {current.content}
      </div>
    </div>
  );
}
