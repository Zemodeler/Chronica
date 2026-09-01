"use client";

import { useRef, useState, useEffect, useCallback, type FormEvent, type KeyboardEvent } from "react";

interface ResolutionStep {
  readonly step: string;
  readonly label: string;
  readonly done: boolean;
}

const ALL_STEPS = [
  { step: "interpret", label: "Interpreting your orders…" },
  { step: "assess", label: "Assessing feasibility…" },
  { step: "adjudicate", label: "Calculating consequences…" },
  { step: "preview_player", label: "Forecasting immediate effects…" },
  { step: "reaction", label: "Observing reactions…" },
  { step: "simulate", label: "Simulating the world…" },
  { step: "character_advise", label: "Consulting character intentions…" },
  { step: "consolidate", label: "Consolidating proposals…" },
  { step: "world_direct", label: "World Director deciding…" },
  { step: "manage", label: "Reviewing proposed actions…" },
  { step: "execute_world", label: "Applying world changes…" },
  { step: "chronicle", label: "Writing the chronicle…" },
  { step: "commit", label: "Saving the new world…" },
] as const;

interface OrdersPanelProps {
  readonly gameId: string;
  readonly onResolutionComplete?: () => void;
}

function downloadWorkflowReport(fileName: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function OrdersPanel({ gameId, onResolutionComplete }: OrdersPanelProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [orderInput, setOrderInput] = useState("");
  const [orders, setOrders] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [steps, setSteps] = useState<ResolutionStep[]>([]);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentOrder, setCurrentOrder] = useState<{ rawText: string } | null>(null);
  const [turnStatus, setTurnStatus] = useState<string | null>(null);
  const sseRef = useRef<EventSource | null>(null);

  const fetchCurrentOrder = useCallback(async () => {
    try {
      const res = await fetch(`/api/games/${encodeURIComponent(gameId)}/orders`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json() as { order: { rawText: string } | null; turnStatus: string | null };
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
      const data = JSON.parse(event.data as string) as ResolutionStep & { error?: string; workflowDownloads?: Array<{ fileName: string; content: string }> };
      if (data.error) {
        setError(data.error);
        setResolving(false);
        sse.close();
        return;
      }
      for (const report of data.workflowDownloads ?? []) {
        downloadWorkflowReport(report.fileName, report.content);
      }
      if (data.step === "done") {
        setResolving(false);
        sse.close();
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

  const addOrder = useCallback(() => {
    const trimmed = orderInput.trim();
    if (!trimmed) return;
    setOrders((prev) => [...prev, trimmed]);
    setOrderInput("");
  }, [orderInput]);

  const handleInputKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addOrder();
    }
  }, [addOrder]);

  const removeOrder = useCallback((idx: number) => {
    setOrders((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleSubmit = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    const pending = orderInput.trim();
    const allOrders = pending ? [...orders, pending] : orders;
    if (allOrders.length === 0) return;

    setSubmitting(true);
    setError(null);

    try {
      const directives = allOrders.map((text) => ({ kind: "new" as const, text }));
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
      setOrderInput("");
      setOrders([]);
      setSubmitting(false);
      setOpen(false);
      if (data.enqueued) {
        startSseStream();
      } else {
        setCurrentOrder({ rawText: allOrders.join("\n") });
        setTurnStatus("queued");
      }
    } catch {
      setError("Failed to submit orders.");
      setSubmitting(false);
    }
  }, [gameId, orderInput, orders, startSseStream]);

  // If the turn becomes queued (polled from another tab), auto-start resolution
  useEffect(() => {
    if (turnStatus === "queued" && !resolving) {
      startSseStream();
    }
  }, [turnStatus, resolving, startSseStream]);

  useEffect(() => {
    return () => { sseRef.current?.close(); };
  }, []);

  const canSubmit = (orders.length > 0 || orderInput.trim().length > 0) && !submitting && !resolving;
  const isCollecting = turnStatus === "collecting" || turnStatus === null;

  const resolutionDone = !resolving && steps.length > 0;

  // Leave the final state visible long enough to acknowledge completion, then
  // clear it so the overlay does not remain over the game indefinitely.
  useEffect(() => {
    if (!resolutionDone) return;
    const dismissTimeout = window.setTimeout(() => {
      setSteps([]);
      setCurrentStep(null);
    }, 1_500);
    return () => window.clearTimeout(dismissTimeout);
  }, [resolutionDone]);

  return (
    <>
      <button
        type="button"
        className="chat-panel-toggle orders-panel-toggle"
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

          {/* Already-submitted order display */}
          {currentOrder && (
            <section style={{ padding: "0.75rem", background: "var(--surface-raised)", borderRadius: "0.375rem" }}>
              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                Orders submitted
              </p>
              {currentOrder.rawText.split("\n").map((line, i) => (
                <p key={i} style={{ fontSize: "0.875rem", margin: "0 0 0.25rem" }}>{line}</p>
              ))}
            </section>
          )}

          {error && (
            <p style={{ color: "var(--text-error, #e53e3e)", fontSize: "0.875rem" }}>{error}</p>
          )}

          {/* Order composer */}
          {isCollecting && !resolving && (
            <form onSubmit={(e) => { void handleSubmit(e); }} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {/* Ordered list of added orders */}
              {orders.length > 0 && (
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {orders.map((order, idx) => (
                    <li
                      key={idx}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        background: "var(--surface-raised)",
                        borderRadius: "0.375rem",
                        padding: "0.625rem 0.75rem",
                      }}
                    >
                      <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", minWidth: "1.25rem" }}>
                        {idx + 1}.
                      </span>
                      <span style={{ fontSize: "0.875rem", flex: 1 }}>{order}</span>
                      <button
                        type="button"
                        onClick={() => removeOrder(idx)}
                        aria-label={`Remove order ${idx + 1}`}
                        style={{
                          background: "none",
                          border: "none",
                          color: "var(--text-muted)",
                          cursor: "pointer",
                          padding: "0 0.25rem",
                          fontSize: "1rem",
                          lineHeight: 1,
                        }}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {/* New order input */}
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  type="text"
                  value={orderInput}
                  onChange={(e) => setOrderInput(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  placeholder="Type an order and press Enter…"
                  disabled={submitting}
                  style={{
                    flex: 1,
                    fontFamily: "inherit",
                    fontSize: "0.875rem",
                    padding: "0.5rem 0.625rem",
                    borderRadius: "0.25rem",
                    border: "1px solid var(--border-subtle)",
                    background: "var(--surface-base, var(--surface))",
                    color: "var(--text-body, var(--text))",
                    outline: "none",
                  }}
                />
                <button
                  type="button"
                  onClick={addOrder}
                  disabled={!orderInput.trim() || submitting}
                  style={{
                    padding: "0.5rem 0.75rem",
                    borderRadius: "0.25rem",
                    border: "1px solid var(--border-subtle)",
                    background: "var(--surface-raised)",
                    color: "var(--text-muted)",
                    cursor: orderInput.trim() ? "pointer" : "default",
                    fontSize: "0.875rem",
                  }}
                >
                  +
                </button>
              </div>

              <button
                type="submit"
                className="chat-message-send"
                disabled={!canSubmit}
              >
                {submitting ? "Submitting…" : "Submit Orders"}
              </button>
            </form>
          )}

          {!isCollecting && !resolving && (
            <p style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
              {turnStatus === "news" ? "The chronicle is ready to read." : "Orders are locked for this turn."}
            </p>
          )}
        </div>
      </dialog>

      {/* Full-screen resolution overlay */}
      {(resolving || resolutionDone) && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(6, 8, 13, 0.96)",
            zIndex: 9998,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          aria-live="polite"
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
              minWidth: "20rem",
            }}
          >
            <p
              style={{
                fontSize: "0.75rem",
                color: "var(--text-muted)",
                marginBottom: "0.75rem",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
              }}
            >
              {resolving ? "Resolving your orders…" : "Resolution complete"}
            </p>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {ALL_STEPS.map(({ step, label }) => {
                const stepState = steps.find((s) => s.step === step);
                const isActive = currentStep === step && !stepState?.done;
                const isDone = stepState?.done;
                const isPending = !stepState && !isActive;

                return (
                  <li
                    key={step}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.625rem",
                      opacity: isPending ? 0.35 : 1,
                      transition: "opacity 0.2s",
                    }}
                  >
                    <span style={{ width: "1rem", textAlign: "center", fontSize: "0.75rem", color: isDone ? "var(--success)" : "var(--text-muted)" }}>
                      {isDone ? "✓" : isActive ? "⟳" : "○"}
                    </span>
                    <span style={{ fontSize: "0.9375rem", color: isDone ? "var(--text)" : isActive ? "var(--text)" : "var(--text-muted)" }}>
                      {label}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
