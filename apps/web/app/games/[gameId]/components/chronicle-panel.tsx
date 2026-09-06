"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

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
  // Chronicle-first legibility fields (character-sim phase 6)
  readonly title?: string;
  readonly knowledgeStatus?: "confirmed" | "report" | "rumour" | "suspicion";
}

interface ChronicleDispatch {
  readonly headline: string;
  readonly items: readonly string[];
  readonly uncertaintyNote: string | null;
}

interface ChronicleData {
  readonly turnId: string;
  readonly turnIndex: number;
  readonly entries: readonly ChronicleEntry[];
  readonly dispatch?: ChronicleDispatch;
}

const KNOWLEDGE_STATUS_LABEL: Record<NonNullable<ChronicleEntry["knowledgeStatus"]>, string> = {
  confirmed: "Confirmed",
  report: "Reported",
  rumour: "Rumour",
  suspicion: "Suspected",
};

/** Earlier/Consequences links within the same chronicle chain, resolved client-side from what's already loaded. */
function causalNeighbors(entry: ChronicleEntry, allEntries: readonly ChronicleEntry[]): { earlier?: ChronicleEntry; consequences: readonly ChronicleEntry[] } {
  if (entry.chainId == null) return { consequences: [] };
  const chain = allEntries.filter((candidate) => candidate.chainId === entry.chainId).sort((a, b) => a.sequence - b.sequence);
  const index = chain.findIndex((candidate) => candidate.sequence === entry.sequence);
  if (index === -1) return { consequences: [] };
  const earlier = chain[index - 1];
  return { ...(earlier !== undefined ? { earlier } : {}), consequences: chain.slice(index + 1, index + 6) };
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
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [chronicle, setChronicle] = useState<ChronicleData | null>(null);
  const [cursor, setCursor] = useState(0);
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Distinct from `error`: a 404 here just means no turn has resolved yet
  // (e.g. a brand-new game), not a failure worth alarming the player about.
  const [notYetAvailable, setNotYetAvailable] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchChronicle = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/games/${encodeURIComponent(gameId)}/chronicle`, { cache: "no-store" });
      if (!res.ok) {
        setLoading(false);
        if (res.status === 404) {
          setNotYetAvailable(true);
        } else {
          setError("Failed to load the chronicle. Try again in a moment.");
        }
        return;
      }
      const data = await res.json() as ChronicleData;
      setChronicle(data);
      setCursor(0);
      setNotYetAvailable(false);
      setError(null);
      setLoading(false);
      // Defensive: a fresh chronicle load always starts from "Done reading",
      // never stuck showing "Closing…" from a stale state.
      setMarking(false);
    } catch {
      setLoading(false);
      setError("Failed to load the chronicle. Try again in a moment.");
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
      setMarking(false);
      router.refresh();
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
  const causal = currentEntry ? causalNeighbors(currentEntry, entries) : { consequences: [] };
  const dispatch = chronicle?.dispatch;
  // The dispatch headline is usually the title of the first chronicle entry.
  // Showing it again as an unlabelled strip makes the Chronicle look clipped
  // or duplicated, especially when it has no supporting items.
  const showDispatch = hasEntries && isAtEnd && dispatch !== undefined && (
    dispatch.headline !== currentEntry?.title
    || dispatch.items.length > 0
    || dispatch.uncertaintyNote !== null
  );

  return (
    <>
      {/*
        Persistent, directly beneath Orders (docs/22): available between
        turns to read the last completed turn's chronicle, and while a
        resolution is paused/dismissed mid-flow to read what has already
        committed -- opening it never resumes simulation, it only reads
        already-persisted chronicle entries.
      */}
      <button
        type="button"
        className="chat-panel-toggle chronicle-panel-toggle"
        onClick={() => { void fetchChronicle().then(() => setOpen(true)); }}
        aria-label="Open chronicle"
        title="Chronicle"
      >
        📜
      </button>

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
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "1rem" }}>
              <p
                style={{
                  fontSize: "0.7rem",
                  color: "var(--text-muted)",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  margin: 0,
                }}
              >
                Chronicle — {hasEntries ? `${cursor + 1} / ${totalEntries}` : "No entries yet"}
                {currentEntry && ` · ${currentEntry.dateLabel}`}
              </p>
              {!hasEntries && (
                <button
                  type="button"
                  className="chat-panel-close"
                  onClick={() => setOpen(false)}
                  aria-label="Close chronicle"
                >
                  ×
                </button>
              )}
            </div>

            {!hasEntries && loading && (
              <p style={{ color: "var(--text-muted)", fontSize: "0.9375rem", margin: 0 }}>
                Loading chronicle…
              </p>
            )}

            {!hasEntries && !loading && notYetAvailable && (
              <p style={{ color: "var(--text-muted)", fontSize: "0.9375rem", margin: 0 }}>
                No chronicle yet — nothing has happened in this world until you submit your first orders.
              </p>
            )}

            {!hasEntries && !loading && error && (
              <p style={{ color: "var(--text-error, #e53e3e)", fontSize: "0.9375rem", margin: 0 }}>
                {error}
              </p>
            )}

            {/* A resolved turn can legitimately have no player-facing news --
                for example, when it contained only internal audit records.
                It must still be possible to acknowledge the turn and move on. */}
            {!hasEntries && !loading && !notYetAvailable && !error && phase === "news" && (
              <article style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <p style={{ color: "var(--text-muted)", fontSize: "0.9375rem", margin: 0 }}>
                  No reportable events occurred this turn.
                </p>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    className="chat-message-send"
                    onClick={() => { void handleDone(); }}
                    disabled={marking}
                  >
                    {marking ? "Closing…" : "Done reading"}
                  </button>
                </div>
              </article>
            )}

            {currentEntry && (
              <article style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <EntryHeader entry={currentEntry} />

                {currentEntry.title && (
                  <header style={{ display: "flex", alignItems: "baseline", gap: "0.6rem" }}>
                    <h3 style={{ margin: 0, fontSize: "1rem", color: "var(--text)" }}>{currentEntry.title}</h3>
                    {currentEntry.knowledgeStatus && currentEntry.knowledgeStatus !== "confirmed" && (
                      <span style={{ fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", border: "1px solid var(--border, rgba(255,255,255,0.2))", borderRadius: "0.25rem", padding: "0.1rem 0.4rem" }}>
                        {KNOWLEDGE_STATUS_LABEL[currentEntry.knowledgeStatus]}
                      </span>
                    )}
                  </header>
                )}

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

                {(causal.earlier || causal.consequences.length > 0) && (
                  <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: 0 }}>
                    {causal.earlier && (
                      <button type="button" onClick={() => setCursor(entries.findIndex((e) => e.sequence === causal.earlier!.sequence))} style={{ background: "none", border: "none", padding: 0, color: "inherit", textDecoration: "underline", cursor: "pointer", font: "inherit" }}>
                        Earlier: {causal.earlier.title ?? causal.earlier.body.slice(0, 60)}
                      </button>
                    )}
                    {causal.earlier && causal.consequences.length > 0 && " · "}
                    {causal.consequences.length > 0 && (
                      <span>Consequences: {causal.consequences.map((c) => c.title ?? c.body.slice(0, 40)).join("; ")}</span>
                    )}
                  </p>
                )}

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

                {showDispatch && dispatch && (
                  <section aria-label="Turn summary" style={{ borderTop: "1px solid var(--border, rgba(255,255,255,0.08))", paddingTop: "0.75rem" }}>
                    <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 0.35rem" }}>Turn summary</p>
                    <p style={{ fontSize: "0.9375rem", fontWeight: 600, margin: 0, color: "var(--text)" }}>{dispatch.headline}</p>
                    {dispatch.items.length > 0 && (
                      <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.1rem", fontSize: "0.8125rem", color: "var(--text-secondary, var(--text-muted))" }}>
                        {dispatch.items.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    )}
                    {dispatch.uncertaintyNote && (
                      <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontStyle: "italic", margin: "0.4rem 0 0" }}>{dispatch.uncertaintyNote}</p>
                    )}
                  </section>
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
