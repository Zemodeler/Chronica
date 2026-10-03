"use client";

import type { EntityKey } from "@chronica/shared";
import { TipRoot } from "../../../components/ui/tip";
import { NoteCard, useGlossary } from "./notes";

/** The glossary is station-filtered on the server. Never fetch a hidden entity. */
export function EntityReference({ entityKey, onBack, onClose, onWrite }: { readonly entityKey: string; readonly onBack?: (() => void) | undefined; readonly onClose: () => void; readonly onWrite?: ((name: string) => void) | undefined }) {
  const glossary = useGlossary();
  const note = glossary[entityKey as EntityKey];
  return (
    <aside className="entity-reference on-papyrus" aria-label={note === undefined ? "Linked reference" : `Reference: ${note.name}`}>
      <header className="entity-reference__header">
        {onBack && <button type="button" className="word-button" onClick={onBack}>Back</button>}
        <span>Reference</span>
        <button type="button" className="close-button" onClick={onClose} aria-label="Close reference">Close</button>
      </header>
      <div className="entity-reference__body" key={entityKey}>
        <TipRoot>{note === undefined ? <p className="quiet">You have no current report about this.</p> : <NoteCard note={note} entityKey={entityKey} />}</TipRoot>
        {note !== undefined && onWrite !== undefined && <button type="button" className="btn btn--quiet entity-reference__write" onClick={() => onWrite(note.name)}>Write an order</button>}
      </div>
    </aside>
  );
}
