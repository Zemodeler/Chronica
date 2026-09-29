"use client";

import { useRef } from "react";
import { deleteSaveSlot } from "../actions";

/**
 * Deleting a save, asked on papyrus rather than in a browser alert: the same
 * document the account's other questions are written on. Nothing is sent
 * until the player chooses to delete it in the dialog.
 */
export function DeleteSaveForm({ gameId, title, returnTo = "/" }: { gameId: string; title: string; returnTo?: "/" | "/account" }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = `delete-${gameId}`;
  return (
    <>
      <button className="btn btn--quiet btn--small" type="button" onClick={() => dialog.current?.showModal()}>Delete</button>
      <dialog ref={dialog} className="account-dialog" aria-labelledby={headingId}>
        <div className="dialog-header">
          <h2 className="dialog-title" id={headingId}>Delete “{title}”?</h2>
          <button type="button" className="dialog-close" onClick={() => dialog.current?.close()}>Close</button>
        </div>
        <form className="dialog-body" action={deleteSaveSlot}>
          <input type="hidden" name="gameId" value={gameId} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <p>The save, its world and everything its Chronicle recorded are removed for good. This cannot be undone.</p>
          <div className="dialog-actions">
            <button type="button" className="btn btn--quiet" autoFocus onClick={() => dialog.current?.close()}>Keep it</button>
            <button type="submit" className="btn btn--danger">Delete for good</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
