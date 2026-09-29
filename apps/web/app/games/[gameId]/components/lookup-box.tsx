"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { explanationOf, lookUp, lookupCandidates, type LookupCandidate } from "@chronica/shared";
import { Tip, TipCard, TipRoot } from "../../../components/ui/tip";
import { NoteCard, ThreadCard, useGlossary, useThreads } from "./notes";

/**
 * Look a name or a word up, from the top bar, on the Map or in the Office.
 *
 * It finds what the player could already open a note on (`lookUp`): the
 * people, places, armies, powers and offices the glossary holds, the threads
 * he may know of, and what the game's words mean. Each hit is a word with
 * its note behind it, opened beside the list, so a note's own names open
 * notes of their own as they do anywhere else.
 *
 * "/" puts the cursor in it, the arrow keys walk the hits, Escape clears it.
 */
export function LookupBox() {
  const glossary = useGlossary();
  const { threads } = useThreads();
  const candidates = useMemo(() => lookupCandidates(glossary, threads), [glossary, threads]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const hits = useMemo(() => lookUp(query, candidates), [query, candidates]);
  const asked = query.trim().length >= 2;
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const listId = useId();

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable='true']") != null) return;
      event.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Put down on a press anywhere else. The notes opened from it live inside
  // the box in the DOM (they are its TipRoot's), so reading one keeps it up.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (event.target instanceof Node && box.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const hitButtons = (): HTMLButtonElement[] => [...(list.current?.querySelectorAll<HTMLButtonElement>(".lookup__hit") ?? [])];

  const onInputKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && hits.length > 0) {
      event.preventDefault();
      setOpen(true);
      requestAnimationFrame(() => hitButtons()[0]?.focus());
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (query !== "") setQuery("");
      else { setOpen(false); input.current?.blur(); }
    }
  };

  const onListKey = (event: KeyboardEvent<HTMLUListElement>) => {
    const buttons = hitButtons();
    const at = buttons.findIndex((button) => button === document.activeElement);
    if (at === -1) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      buttons[Math.min(at + 1, buttons.length - 1)]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (at === 0) input.current?.focus();
      else buttons[at - 1]?.focus();
    }
  };

  const shown = open && asked;
  return (
    <div className={shown ? "lookup is-open" : "lookup"} ref={box}>
      <TipRoot>
        <label className="visually-hidden" htmlFor={`${listId}-input`}>Look up a name or a word</label>
        <input
          ref={input}
          id={`${listId}-input`}
          className="lookup__input"
          type="search"
          role="combobox"
          aria-expanded={shown}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          placeholder="Look up…"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onInputKey}
        />
        {shown && (
          <div className="lookup__panel">
            {hits.length === 0
              ? <p className="lookup__none" role="status">Nothing you know of by that name.</p>
              : (
                <ul ref={list} id={listId} className="lookup__hits" aria-label="What you know of by that name" onKeyDown={onListKey}>
                  {hits.map((hit) => <li key={`${hit.source}:${hit.id}`}><Hit hit={hit} /></li>)}
                </ul>
              )}
          </div>
        )}
      </TipRoot>
    </div>
  );
}

function Hit({ hit }: { readonly hit: LookupCandidate }) {
  const glossary = useGlossary();
  const { threads } = useThreads();
  const face = (
    <>
      <strong>{hit.label}</strong>
      <span>{hit.kicker}</span>
    </>
  );
  const note = (): ReactNode => {
    if (hit.source === "thread") {
      const thread = threads[hit.id];
      return thread === undefined ? null : <ThreadCard thread={thread} />;
    }
    if (hit.source === "explanation") {
      const entry = explanationOf(hit.id);
      return entry === null ? null : <TipCard kicker="What the word means" title={entry.title}><p>{entry.text}</p></TipCard>;
    }
    const entityNote = glossary[hit.id as keyof typeof glossary];
    return entityNote === undefined ? null : <NoteCard note={entityNote} />;
  };
  return <Tip label={hit.label} className="lookup__hit" beside note={note}>{face}</Tip>;
}
