"use client";

import { useState, useEffect, useCallback } from "react";

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

interface ChroniclePanelProps {
  readonly gameId: string;
  readonly phase: string;
  readonly forceOpen?: boolean;
  readonly onForceOpenConsumed?: () => void;
  readonly onDisplayPatch?: (patch: unknown) => void;
}

export function ChroniclePanel({ gameId, phase, forceOpen, onForceOpenConsumed, onDisplayPatch }: ChroniclePanelProps) {
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

  // Open when triggered from outside (e.g. after resolution completes)
  useEffect(() => {
    if (forceOpen) {
      void fetchChronicle().then(() => setOpen(true));
      onForceOpenConsumed?.();
    }
  }, [forceOpen, fetchChronicle, onForceOpenConsumed]);

  const advance = useCallback(() => {
    if (!chronicle) return;
    const currentEntry = chronicle.entries[cursor];
    if (currentEntry?.displayPatch !== undefined) {
      onDisplayPatch?.(currentEntry.displayPatch);
    }
    setCursor((c) => c + 1);
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
      window.location.reload();
    } catch {
      setError("Failed to mark chronicle as read.");
      setMarking(false);
    }
  }, [gameId]);

  const entries = chronicle?.entries ?? [];
  const totalEntries = entries.length;
  const currentEntry = entries[cursor];
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

      {open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(6, 8, 13, 0.97)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          aria-modal="true"
          aria-label="Chronicle"
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "2rem",
              maxWidth: "36rem",
              width: "calc(100% - 3rem)",
            }}
          >
            <p
              style={{
                fontSize: "0.7rem",
                color: "var(--text-muted)",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                margin: 0,
              }}
            >
              Chronicle — {hasEntries ? `${cursor + 1} / ${totalEntries}` : "Loading…"}
            </p>

            {!hasEntries && (
              <p style={{ color: "var(--text-muted)", fontSize: "0.9375rem", margin: 0 }}>
                Loading chronicle…
              </p>
            )}

            {currentEntry && (
              <article style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                <p
                  style={{
                    fontSize: "1.125rem",
                    lineHeight: 1.7,
                    margin: 0,
                    color: "var(--text)",
                  }}
                >
                  {currentEntry.body}
                </p>

                {error && (
                  <p style={{ color: "var(--text-error, #e53e3e)", fontSize: "0.875rem", margin: 0 }}>{error}</p>
                )}

                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  {!isAtEnd && (
                    <button
                      type="button"
                      className="chat-message-send"
                      onClick={advance}
                    >
                      Continue ›
                    </button>
                  )}
                  {isAtEnd && (
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
              </article>
            )}
          </div>
        </div>
      )}
    </>
  );
}
