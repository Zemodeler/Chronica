"use client";

import { deleteSaveSlot } from "../actions";

export function DeleteSaveForm({ gameId, title, returnTo = "/" }: { gameId: string; title: string; returnTo?: "/" | "/account" }) {
  return (
    <form action={deleteSaveSlot} onSubmit={(event) => {
      if (!window.confirm(`Permanently delete “${title}”? This cannot be undone.`)) event.preventDefault();
    }}>
      <input type="hidden" name="gameId" value={gameId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <button className="button sm secondary delete-save" type="submit">Delete save</button>
    </form>
  );
}
