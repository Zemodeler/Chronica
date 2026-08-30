"use client";

import { useRef, useState, useEffect, useCallback, type FormEvent } from "react";

interface ResolutionStep {
  readonly step: string;
  readonly label: string;
  readonly done: boolean;
}

const ALL_STEPS = [
  { step: "interpret", label: "Interpreting your orders…" },
  { step: "assess", label: "Assessing feasibility…" },
  { step: "adjudicate", label: "Calculating consequences…" },
  { step: "world_sim", label: "Simulating the world…" },
  { step: "execute", label: "Applying changes…" },
  { step: "chronicle", label: "Writing the chronicle…" },
  { step: "commit", label: "Saving the new world…" },
] as const;

interface OrdersPanelProps {
  readonly gameId: string;
  readonly onResolutionComplete?: () => void;
}

export function OrdersPanel({ gameId, onResolutionComplete }: OrdersPanelProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [orderText, setOrderText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [steps, setSteps] = useState<ResolutionStep[]>([]);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentOrder, setCurrentOrder] = useState<{ rawText: string; submittedAt?: string } | null>(null);
  const [turnStatus, setTurnStatus] = useState<string | null>(null);
  const sseRef = useRef<EventSource | null>(null);

  const fetchCurrentOrder = useCallback(async () => {
    try {
      const res = await fetch(`/api/games/${encodeURIComponent(gameId)}/orders`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json() as { order: { rawText: string; submittedAt?: string } | null; turnStatus: string | null };
      setCurrentOrder(data.order);
      setTurnStatus(data.turnStatus);
    } catch {
      // Silently ignore
    }
  }, [gameId]);

  useEffect(() => {
    if (open) {
      void fetchCurrentOrder();
    }
  }, [open, fetchCurrentOrder]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
    } else {
      if (dialog.open) dialog.close();
    }
  }, [open]);

  const startSseStream = useCallback(() => {
    sseRef.current?.close();
    setSteps([]);
    setCurrentStep(null);
    setError(null);
    setResolving(true);

    const sse = new EventSource(`/api/games/${encodeURIComponent(gameId)}/resolution/stream`);
    sseRef.current = sse;

    sse.onmessage = (event) => {
      const data = JSON.parse(event.data as string) as ResolutionStep & { error?: string };
      if (data.error) {
        setError(data.error);
        setResolving(false);
        sse.close();
        return;
      }
      if (data.step === "done") {
        setResolving(false);
        sse.close();
        setOpen(false);
        onResolutionComplete?.();
        return;
      }
      setCurrentStep(data.step);
      setSteps((prev) => {
        const existing = prev.findIndex((s) => s.step === data.step);
        if (existing >= 0) {
          const updated = [...prev];
          updated[existing] = data;
          return updated;
        }
        return [...prev, data];
      });
    };

    sse.onerror = () => {
      setError("Connection lost during resolution.");
      setResolving(false);
      sse.close();
    };
  }, [gameId, onResolutionComplete]);

  const handleSubmit = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    const lines = orderText.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;

    setSubmitting(true);
    setError(null);

    try {
      const directives = lines.map((text) => ({ kind: "new" as const, text }));
      const res = await fetch(`/api/games/${encodeURIComponent(gameId)}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ directives }),
      });
      const data = await res.json() as { accepted?: boolean; enqueued?: boolean; error?: string };
      if (!res.ok || !data.accepted) {
        setError(data.error ?? "Order rejected.");
        setSubmitting(false);
        return;
      }
      setOrderText("");
      setSubmitting(false);
      // If the turn was enqueued (all players submitted), start resolution stream
      if (data.enqueued) {
        startSseStream();
      } else {
        setCurrentOrder({ rawText: lines.join("\n") });
        setTurnStatus("queued");
      }
    } catch {
      setError("Failed to submit orders.");
      setSubmitting(false);
    }
  }, [gameId, orderText, startSseStream]);

  // If the turn becomes queued (polled from another tab), auto-start resolution
  useEffect(() => {
    if (turnStatus === "queued" && !resolving) {
      startSseStream();
    }
  }, [turnStatus, resolving, startSseStream]);

  useEffect(() => {
    return () => { sseRef.current?.close(); };
  }, []);

  const canSubmit = orderText.trim().length > 0 && !submitting && !resolving;
  const isCollecting = turnStatus === "collecting" || turnStatus === null;

  return (
    <>
      <button
        type="button"
        className="chat-panel-toggle"
        style={{ right: "calc(4rem + 3.5rem + 1rem)" }}
        onClick={() => setOpen((v) => !v)}
        aria-label="Open orders panel"
        title="Orders"
      >
        ⚔
      </button>

      <dialog
        ref={dialogRef}
        className="chat-panel-dialog"
        aria-label="Orders"
        onClose={() => setOpen(false)}
      >
        <div className="chat-panel-header">
          <h2 className="chat-panel-title">Orders</h2>
          <button
            type="button"
            className="chat-panel-close"
            onClick={() => setOpen(false)}
            aria-label="Close orders panel"
          >
            ×
          </button>
        </div>

        <div className="chat-panel-body" style={{ flexDirection: "column", gap: "1rem", overflowY: "auto" }}>

          {/* Active order display */}
          {currentOrder && (
            <section style={{ padding: "0.75rem", background: "var(--surface-raised)", borderRadius: "0.375rem" }}>
              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>
                Orders submitted
              </p>
              <p style={{ fontSize: "0.875rem", whiteSpace: "pre-wrap" }}>{currentOrder.rawText}</p>
            </section>
          )}

          {/* Resolution progress */}
          {resolving || steps.length > 0 ? (
            <section>
              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                {resolving ? "Resolving your orders…" : "Resolution complete"}
              </p>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                {ALL_STEPS.map(({ step, label }) => {
                  const stepState = steps.find((s) => s.step === step);
                  const isActive = currentStep === step && !stepState?.done;
                  const isDone = stepState?.done;
                  const isPending = !stepState && !isActive;

                  return (
                    <li key={step} style={{ display: "flex", alignItems: "center", gap: "0.5rem", opacity: isPending ? 0.4 : 1 }}>
                      <span style={{ width: "1rem", textAlign: "center", fontSize: "0.75rem" }}>
                        {isDone ? "✓" : isActive ? "⟳" : "○"}
                      </span>
                      <span style={{ fontSize: "0.875rem" }}>{label}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {error && (
            <p style={{ color: "var(--text-error, #e53e3e)", fontSize: "0.875rem" }}>{error}</p>
          )}

          {/* Order composer — shown only when the turn is still collecting */}
          {isCollecting && !resolving && (
            <form onSubmit={(e) => { void handleSubmit(e); }} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <label style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                Write your orders (one per line)
              </label>
              <textarea
                value={orderText}
                onChange={(e) => setOrderText(e.target.value)}
                rows={4}
                placeholder={"March the legion toward Carthage's position\nBuild a granary in Rhegium"}
                style={{
                  resize: "vertical",
                  fontFamily: "inherit",
                  fontSize: "0.875rem",
                  padding: "0.5rem",
                  borderRadius: "0.25rem",
                  border: "1px solid var(--border-subtle)",
                  background: "var(--surface-base)",
                  color: "var(--text-body)",
                }}
                disabled={submitting}
              />
              <button
                type="submit"
                className="chat-message-send"
                disabled={!canSubmit}
              >
                {submitting ? "Submitting…" : "Submit Orders"}
              </button>
            </form>
          )}

          {!isCollecting && !resolving && steps.length === 0 && (
            <p style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
              {turnStatus === "news" ? "The chronicle is ready to read." : "Orders are locked for this turn."}
            </p>
          )}
        </div>
      </dialog>
    </>
  );
}
