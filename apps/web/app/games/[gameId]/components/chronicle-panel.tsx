"use client";

import { useRef, useState, useEffect, useCallback } from "react";

interface ChronicleEntry {
  readonly id: string;
  readonly sequence: number;
  readonly body: string;
  readonly audience: "all_players" | "knowledge_scoped";
  readonly atStep: number;
  readonly materialConsequence?: boolean;
  readonly displayPatch?: unknown;
}

interface ChronicleData {
  readonly turnId: string;
  readonly turnIndex: number;
  readonly entries: readonly ChronicleEntry[];
}

interface ChronicleDisplayPatch {
  readonly entries: readonly { readonly displayPatch?: unknown }[];
}

interface ChroniclePanelProps {
  readonly gameId: string;
  readonly phase: string;
  readonly onDisplayPatch?: (patch: unknown) => void;
}

export function ChroniclePanel({ gameId, phase, onDisplayPatch }: ChroniclePanelProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [chronicle, setChronicle] = useState<ChronicleData | null>(null);
  const [cursor, setCursor] = useState(0);
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchChronicle = useCallback(async () => {
    try {
      const res = await fetch(`/api/games/${encodeURIComponent(gameId)}/chronicle`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json() as ChronicleData;
      setChronicle(data);
      setCursor(0);
    } catch {
      // Silently ignore
    }
  }, [gameId]);

  // Auto-open when the turn phase transitions to news
  useEffect(() => {
    if (phase === "news") {
      void fetchChronicle().then(() => setOpen(true));
    }
  }, [phase, fetchChronicle]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
    } else {
      if (dialog.open) dialog.close();
    }
  }, [open]);

  const advance = useCallback(() => {
    if (!chronicle) return;
    const nextCursor = cursor + 1;

    // Fire display patch for the entry we just revealed
    const currentEntry = chronicle.entries[cursor];
    if (currentEntry?.displayPatch !== undefined) {
      onDisplayPatch?.(currentEntry.displayPatch);
    }

    setCursor(nextCursor);
  }, [chronicle, cursor, onDisplayPatch]);

  const handleDone = useCallback(async () => {
    setMarking(true);
    setError(null);
    try {
      const res = await fetch(`/api/games/${encodeURIComponent(gameId)}/chronicle/read`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setError(data.error ?? "Failed to mark chronicle as read.");
        setMarking(false);
        return;
      }
      setOpen(false);
      // Reload the page to reflect the new turn
      window.location.reload();
    } catch {
      setError("Failed to mark chronicle as read.");
      setMarking(false);
    }
  }, [gameId]);

  const entries = chronicle?.entries ?? [];
  const totalEntries = entries.length;
  const visibleEntries = entries.slice(0, cursor + 1);
  const isAtEnd = cursor >= totalEntries - 1;
  const hasEntries = totalEntries > 0;

  return (
    <>
      {phase === "news" && (
        <button
          type="button"
          className="chat-panel-toggle"
          style={{ right: "calc(4rem + 7rem + 1rem)" }}
          onClick={() => { void fetchChronicle().then(() => setOpen(true)); }}
          aria-label="Open chronicle"
          title="Chronicle"
        >
          📜
        </button>
      )}

      <dialog
        ref={dialogRef}
        className="chat-panel-dialog"
        aria-label="Chronicle"
        onClose={() => setOpen(false)}
      >
        <div className="chat-panel-header">
          <h2 className="chat-panel-title">Chronicle</h2>
          <button
            type="button"
            className="chat-panel-close"
            onClick={() => setOpen(false)}
            aria-label="Close chronicle"
          >
            ×
          </button>
        </div>

        <div
          className="chat-panel-body"
          style={{ flexDirection: "column", gap: "1rem", overflowY: "auto", padding: "1rem" }}
        >
          {!hasEntries && (
            <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
              Loading chronicle…
            </p>
          )}

          {visibleEntries.map((entry, idx) => (
            <article
              key={entry.id}
              style={{
                borderLeft: "2px solid var(--border-subtle)",
                paddingLeft: "0.75rem",
                opacity: idx < visibleEntries.length - 1 ? 0.7 : 1,
              }}
            >
              <p style={{ fontSize: "0.9375rem", lineHeight: 1.6, margin: 0 }}>{entry.body}</p>
            </article>
          ))}

          {error && (
            <p style={{ color: "var(--text-error, #e53e3e)", fontSize: "0.875rem" }}>{error}</p>
          )}

          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "auto", paddingTop: "0.5rem" }}>
            {hasEntries && !isAtEnd && (
              <button
                type="button"
                className="chat-message-send"
                onClick={advance}
              >
                Continue ›
              </button>
            )}
            {isAtEnd && hasEntries && (
              <button
                type="button"
                className="chat-message-send"
                onClick={() => { void handleDone(); }}
                disabled={marking}
              >
                {marking ? "Closing…" : "Done reading"}
              </button>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
