"use client";

import { useState, useEffect, useCallback } from "react";

interface DirectConsequence {
  readonly kind: string;
  readonly label: string;
  readonly entityId: string | null;
  readonly quantified: boolean;
}

interface ChronicleEntry {
  readonly id: string;
  readonly sequence: number;
  readonly body: string;
  readonly audience: "all_players" | "knowledge_scoped";
  readonly atStep: number;
  readonly materialConsequence?: boolean;
  readonly displayPatch?: unknown;
  /** Calendar date of this action, projected by the chronicle endpoint. */
  readonly dateLabel: string;
  // Extended Chronicle fields
  readonly eventDate?: string | null;
  readonly location?: string | null;
  readonly chainId?: string | null;
  readonly chainPosition?: "root" | "reaction" | "spread" | "distant" | "pressure" | null;
  readonly directConsequences?: readonly DirectConsequence[];
  readonly openPressure?: boolean;
  readonly sourceDirector?: string;
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

function EntryHeader({ entry }: { entry: ChronicleEntry }) {
  const parts: string[] = [];
  if (entry.location) parts.push(entry.location);
  if (parts.length === 0) return null;
  return (
    <p
      style={{
        fontSize: "0.7rem",
        color: "var(--text-muted)",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        margin: 0,
      }}
    >
      {parts.join(" · ")}
    </p>
  );
}

function DirectConsequencesSection({ consequences }: { consequences: readonly DirectConsequence[] }) {
  const [open, setOpen] = useState(false);
  if (consequences.length === 0) return null;
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.currentTarget).open)}
      style={{ borderTop: "1px solid var(--border, rgba(255,255,255,0.08))", paddingTop: "0.75rem" }}
    >
      <summary
        style={{
          cursor: "pointer",
          fontSize: "0.7rem",
          color: "var(--text-muted)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          listStyle: "none",
          display: "flex",
          alignItems: "center",
          gap: "0.4rem",
          userSelect: "none",
        }}
      >
        <span style={{ transition: "transform 0.15s", display: "inline-block", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}>›</span>
        Direct consequences
      </summary>
      {open && (
        <ul
          style={{
            marginTop: "0.6rem",
            paddingLeft: "1rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.3rem",
          }}
        >
          {consequences.map((c, i) => (
            <li
              key={i}
              style={{
                fontSize: "0.8125rem",
                color: "var(--text-secondary, var(--text-muted))",
                lineHeight: 1.5,
              }}
            >
              {c.label}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
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

  useEffect(() => {
    if (phase === "news") {
      void fetchChronicle().then(() => setOpen(true));
    }
  }, [phase, fetchChronicle]);

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
  const hasConsequences = (currentEntry?.directConsequences?.length ?? 0) > 0;

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
              {currentEntry && ` · ${currentEntry.dateLabel}`}
            </p>

            {!hasEntries && (
              <p style={{ color: "var(--text-muted)", fontSize: "0.9375rem", margin: 0 }}>
                Loading chronicle…
              </p>
            )}

            {currentEntry && (
              <article style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <EntryHeader entry={currentEntry} />

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

                {currentEntry.openPressure && (
                  <p
                    style={{
                      fontSize: "0.75rem",
                      color: "var(--text-muted)",
                      margin: 0,
                      fontStyle: "italic",
                      letterSpacing: "0.04em",
                    }}
                  >
                    ↳ situation unresolved
                  </p>
                )}

                {hasConsequences && (
                  <DirectConsequencesSection consequences={currentEntry.directConsequences!} />
                )}

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
