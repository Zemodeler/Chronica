"use client";

import { useRef, useState, useEffect, useCallback, type FormEvent, type KeyboardEvent } from "react";
import { RESOLUTION_PROGRESS_STAGES, STEP_LABELS, type ResolutionStep as PipelineResolutionStep } from "../../../../lib/resolution/types";
import type { OrderDirective } from "@chronica/shared";

interface ResolutionStep {
  readonly step: string;
  readonly label: string;
  readonly done: boolean;
}

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
  const [orders, setOrders] = useState<OrderDirective[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [steps, setSteps] = useState<ResolutionStep[]>([]);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Distinguished from a transient stream `error` (a dropped connection, a
  // momentary lookup miss): this means resolve_attempts is exhausted
  // (MAX_TURN_RESOLVE_ATTEMPTS) and the turn will not change state again on
  // its own. Kept separate so the overlay can persist and offer a retry
  // instead of auto-clearing the way a normal completion does.
  const [resolutionFailed, setResolutionFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [currentOrder, setCurrentOrder] = useState<{ rawText: string } | null>(null);
  const [turnStatus, setTurnStatus] = useState<string | null>(null);
  // Interrupt (docs/22): dismisses the full-screen progress overlay and
  // returns to the normal map/control interface without touching
  // resolution itself, which keeps running server-side and still commits
  // when it finishes -- nothing is undone by looking away from it. The
  // Chronicles button (chronicle-panel.tsx) reads whatever has already
  // committed at any time, resolution running or not.
  const [dismissed, setDismissed] = useState(false);
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
    setResolutionFailed(false);
    setResolving(true);
    setDismissed(false);

    const sse = new EventSource(`/api/games/${encodeURIComponent(gameId)}/resolution/stream`);
    sseRef.current = sse;

    sse.onmessage = (event) => {
      const data = JSON.parse(event.data as string) as ResolutionStep & { error?: string; failed?: boolean; workflowDownloads?: Array<{ fileName: string; content: string }> };
      if (data.error) {
        setError(data.error);
        setResolutionFailed(data.failed === true);
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

  const makeDirective = useCallback((text: string): OrderDirective => ({ kind: "new", text }), []);

  const addOrder = useCallback(() => {
    const trimmed = orderInput.trim();
    if (!trimmed) return;
    setOrders((prev) => [...prev, makeDirective(trimmed)]);
    setOrderInput("");
  }, [orderInput, makeDirective]);

  const handleInputKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
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
    const allOrders = pending ? [...orders, makeDirective(pending)] : orders;

    setSubmitting(true);
    setError(null);

    try {
      const directives = allOrders;
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
        setCurrentOrder({ rawText: allOrders.map(d => "text" in d ? d.text : "Cancel ongoing plan").join("\n") });
        setTurnStatus("queued");
      }
    } catch {
      setError("Failed to submit orders.");
      setSubmitting(false);
    }
  }, [gameId, orderInput, orders, startSseStream, makeDirective]);

  // Gives a permanently failed turn (resolve_attempts exhausted) another
  // MAX_TURN_RESOLVE_ATTEMPTS. The player's orders are untouched server-side
  // (they were never cleared -- only the turn's own status was), so this
  // just asks the server to requeue and resume watching.
  const retryResolution = useCallback(async () => {
    setRetrying(true);
    setError(null);
    try {
      const res = await fetch(`/api/games/${encodeURIComponent(gameId)}/resolution/retry`, { method: "POST" });
      const data = await res.json() as { retried?: boolean; error?: string };
      if (!res.ok || !data.retried) {
        setError(data.error ?? "Could not retry. Reopen Orders and try again.");
        setRetrying(false);
        return;
      }
      setRetrying(false);
      setTurnStatus("queued");
      startSseStream();
    } catch {
      setError("Could not retry. Reopen Orders and try again.");
      setRetrying(false);
    }
  }, [gameId, startSseStream]);

  // If the turn becomes queued (polled from another tab), auto-start resolution
  useEffect(() => {
    if (turnStatus === "queued" && !resolving) {
      startSseStream();
    }
  }, [turnStatus, resolving, startSseStream]);

  useEffect(() => {
    return () => { sseRef.current?.close(); };
  }, []);

  const canSubmit = !submitting && !resolving;
  const isCollecting = turnStatus === "collecting" || turnStatus === null;

  const resolutionDone = !resolving && steps.length > 0 && !resolutionFailed;

  // Leave the final state visible long enough to acknowledge completion, then
  // clear it so the overlay does not remain over the game indefinitely. A
  // failed resolution is deliberately excluded: it stays on screen (offering
  // a retry) until the player acts, rather than silently clearing itself the
  // same way a real completion does.
  useEffect(() => {
    if (!resolutionDone) return;
    const dismissTimeout = window.setTimeout(() => {
      setSteps([]);
      setCurrentStep(null);
      setDismissed(false);
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
                      <span style={{ fontSize: "0.875rem", flex: 1 }}>{"text" in order ? order.text : ""}</span>
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
                <textarea
                  rows={4}
                  maxLength={4_000}
                  aria-label="New plan"
                  value={orderInput}
                  onChange={(e) => setOrderInput(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  placeholder="Describe your plan in your own words: method, conditions, secrecy, any delegate by name, and any spending limit. Ctrl+Enter adds it."
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

              <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                Unfinished plans continue on their own each turn. Method, secrecy, named delegates, and any spending limit are read from your own words above -- naming someone gives them no additional authority or funds, and they can still decline. Mention an ongoing plan by name to revise or cancel it.
              </p>

              <button
                type="submit"
                className="chat-message-send"
                disabled={!canSubmit}
              >
                {submitting ? "Submitting…" : orders.length || orderInput.trim() ? "Submit plans and advance" : "Continue plans and let time pass"}
              </button>
            </form>
          )}

          {!isCollecting && !resolving && turnStatus === "failed" && (
            <section style={{ padding: "0.75rem", background: "var(--surface-raised)", borderRadius: "0.375rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <p style={{ fontSize: "0.875rem", color: "var(--text-error, #e53e3e)", margin: 0 }}>
                This turn failed to resolve. Your orders are still saved -- retry to try again.
              </p>
              <button
                type="button"
                className="chat-message-send"
                onClick={() => { void retryResolution(); }}
                disabled={retrying}
              >
                {retrying ? "Retrying…" : "Retry"}
              </button>
            </section>
          )}

          {!isCollecting && !resolving && turnStatus !== "failed" && (
            <p style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
              {turnStatus === "news" ? "The chronicle is ready to read." : "Orders are locked for this turn."}
            </p>
          )}
        </div>
      </dialog>

      {/* Full-screen resolution overlay -- dismissible (docs/22 interrupt):
          closing it only stops watching; resolution keeps running and still
          commits, so nothing here is ever undone by returning to the map.
          A failed resolution is the one state that does NOT keep running in
          the background -- resolve_attempts is exhausted -- so it stays
          visible (not auto-cleared like `resolutionDone`) until the player
          retries or dismisses it. */}
      {(resolving || resolutionDone || resolutionFailed) && !dismissed && (
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
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "1rem" }}>
              <p
                style={{
                  fontSize: "0.75rem",
                  color: "var(--text-muted)",
                  marginBottom: "0.75rem",
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                }}
              >
                {resolving ? "Resolving your orders…" : resolutionFailed ? "Resolution failed" : "Resolution complete"}
              </p>
              {(resolving || resolutionFailed) && (
                <button
                  type="button"
                  onClick={() => setDismissed(true)}
                  aria-label={resolutionFailed ? "Dismiss; your orders are still saved" : "Return to map; resolution continues in the background"}
                  title={resolutionFailed ? "Dismiss" : "Return to map"}
                  style={{
                    background: "none",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "0.25rem",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: "0.75rem",
                    padding: "0.25rem 0.5rem",
                  }}
                >
                  {resolutionFailed ? "Dismiss" : "Return to map"}
                </button>
              )}
            </div>
            {resolutionFailed && (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "0.5rem" }}>
                <p style={{ fontSize: "0.9375rem", color: "var(--text)", margin: 0 }}>
                  {error ?? "Resolution failed after several attempts."} Your orders are still saved -- retry to try again.
                </p>
                <button
                  type="button"
                  className="chat-message-send"
                  onClick={() => { void retryResolution(); }}
                  disabled={retrying}
                  style={{ alignSelf: "flex-start" }}
                >
                  {retrying ? "Retrying…" : "Retry"}
                </button>
              </div>
            )}
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {RESOLUTION_PROGRESS_STAGES.map(({ step, group }, index) => {
                const stepState = steps.find((s) => s.step === step);
                const currentIndex = RESOLUTION_PROGRESS_STAGES.findIndex((stage) => stage.step === currentStep);
                const currentGroup = currentIndex === -1 ? null : RESOLUTION_PROGRESS_STAGES[currentIndex]?.group;
                const hasAdvancedPastGroup = currentIndex > index && currentGroup !== group;
                const isDone = stepState?.done === true || hasAdvancedPastGroup;
                const isActive = !isDone && currentGroup === group;
                const isPending = !isDone && !isActive;

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
                      {STEP_LABELS[step as PipelineResolutionStep]}
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
