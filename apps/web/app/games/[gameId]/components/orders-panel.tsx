"use client";

import { useRef, useState, useEffect, useCallback, type FormEvent, type KeyboardEvent } from "react";
import { RESOLUTION_PROGRESS_STAGES, STEP_LABELS, type ResolutionStep as PipelineResolutionStep } from "../../../../lib/resolution/types";
import type { OrderDirective, PlayerPlan } from "@chronica/shared";

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
  const [plans, setPlans] = useState<PlayerPlan[]>([]);
  const [delegates, setDelegates] = useState<{ id: string; name: string }[]>([]);
  const [accounts, setAccounts] = useState<{ id: string; label: string }[]>([]);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [method, setMethod] = useState("");
  const [constraints, setConstraints] = useState("");
  const [secrecy, setSecrecy] = useState<"public" | "discreet" | "secret">("public");
  const [delegateIds, setDelegateIds] = useState<string[]>([]);
  const [accountId, setAccountId] = useState("");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [steps, setSteps] = useState<ResolutionStep[]>([]);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      const data = await res.json() as { order: { rawText: string } | null; turnStatus: string | null; plans?: PlayerPlan[]; delegates?: { id: string; name: string }[]; accounts?: { id: string; label: string }[] };
      setCurrentOrder(data.order);
      setTurnStatus(data.turnStatus);
      setPlans(data.plans ?? []);
      setDelegates(data.delegates ?? []);
      setAccounts(data.accounts ?? []);
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
    setDismissed(false);

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

  const makeDirective = useCallback((text: string): OrderDirective => editingPlanId
    ? { kind: "revise", actionId: editingPlanId, text }
    : { kind: "new", text, planOptions: { method, constraints, secrecy, delegateIds, budget: accountId && budgetAmount !== "" ? { accountId, amount: Number(budgetAmount) } : null } },
  [editingPlanId, method, constraints, secrecy, delegateIds, accountId, budgetAmount]);

  const addOrder = useCallback(() => {
    const trimmed = orderInput.trim();
    if (!trimmed) return;
    if (!editingPlanId && accountId && (budgetAmount === "" || !Number.isSafeInteger(Number(budgetAmount)) || Number(budgetAmount) < 0)) { setError("Enter a whole-number spending limit of zero or more."); return; }
    setOrders((prev) => [...prev, makeDirective(trimmed)]);
    setOrderInput("");
    setEditingPlanId(null);
  }, [orderInput, makeDirective, editingPlanId, accountId, budgetAmount]);

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
      setEditingPlanId(null);
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

  const resolutionDone = !resolving && steps.length > 0;

  // Leave the final state visible long enough to acknowledge completion, then
  // clear it so the overlay does not remain over the game indefinitely.
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
          {plans.length > 0 && <section aria-label="Continuing plans">
            <h3>Continuing plans</h3>
            <p>Unfinished work continues each turn. People have their own time; delegates must agree and have the means to act.</p>
            {plans.slice().sort((a, b) => Number(b.status === "active") - Number(a.status === "active") || b.updatedAtStep - a.updatedAtStep).slice(0, 40).map(plan => <details key={plan.id} open={plan.status === "active"} style={{ marginBottom: "0.75rem" }}>
              <summary>{plan.rawText.slice(0, 100)} — {plan.status}</summary>
              <p>{plan.interpretation || "Awaiting interpretation"}</p>
              {plan.options.method && <p>Method: {plan.options.method}</p>}
              {plan.options.constraints && <p>Conditions: {plan.options.constraints}</p>}
              {plan.options.budget && <p>Spent {plan.spent} of {plan.options.budget.amount}</p>}
              <ol>{plan.stages.map(stage => <li key={stage.id}>{stage.objective} — {stage.status}{stage.repeatEverySteps ? ` (repeats every ${stage.repeatEverySteps} turns)` : ""}{stage.reason ? `: ${stage.reason}` : ""}</li>)}</ol>
              {plan.assignments.map(a => <p key={a.actorId}>{delegates.find(d => d.id === a.actorId)?.name ?? "Delegate"}: {a.accepted ? "accepted" : "declined"} — {a.reason}</p>)}
              {plan.status === "active" && isCollecting && !resolving && <div>
                <button type="button" disabled={submitting} onClick={() => { setEditingPlanId(plan.id); setOrderInput(plan.rawText); }}>Revise plan</button>{" "}
                <button type="button" disabled={submitting || orders.some(d => d.kind === "cancel" && d.actionId === plan.id)} onClick={() => setOrders(prev => [...prev.filter(d => d.kind === "new" || d.actionId !== plan.id), { kind: "cancel", actionId: plan.id }])}>Cancel plan next turn</button>
              </div>}
            </details>)}
          </section>}
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
                      <span style={{ fontSize: "0.875rem", flex: 1 }}>{order.kind === "cancel" ? "Cancel ongoing plan" : `${order.kind === "revise" ? "Revise: " : ""}${order.text}`}</span>
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
                  aria-label={editingPlanId ? "Revised plan" : "New plan"}
                  value={orderInput}
                  onChange={(e) => setOrderInput(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  placeholder="Describe your plan, priorities, and conditions. Ctrl+Enter adds it."
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

              {editingPlanId ? <p>Completed stages and existing limits are preserved. <button type="button" onClick={() => { setEditingPlanId(null); setOrderInput(""); }}>Discard revision</button></p> : <details>
                <summary>Method, delegates, and limits for each new plan</summary>
                <label>Method <input value={method} maxLength={400} onChange={e => setMethod(e.target.value)} /></label>
                <label>Conditions and limits <textarea value={constraints} maxLength={800} onChange={e => setConstraints(e.target.value)} /></label>
                <label>Visibility <select value={secrecy} onChange={e => setSecrecy(e.target.value as typeof secrecy)}><option value="public">Public</option><option value="discreet">Discreet</option><option value="secret">Secret</option></select></label>
                <label>Invite delegates <select multiple value={delegateIds} onChange={e => setDelegateIds(Array.from(e.target.selectedOptions, option => option.value).slice(0, 8))}>{delegates.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
                <p>Delegates can decline. Selecting someone gives them no additional authority or funds.</p>
                <label>Budget account <select value={accountId} onChange={e => setAccountId(e.target.value)}><option value="">No additional spending cap</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
                {accountId && <label>Total spending limit <input type="number" min={0} step={1} required value={budgetAmount} onChange={e => setBudgetAmount(e.target.value)} /></label>}
              </details>}

              <button
                type="submit"
                className="chat-message-send"
                disabled={!canSubmit}
              >
                {submitting ? "Submitting…" : orders.length || orderInput.trim() ? "Submit plans and advance" : "Continue plans and let time pass"}
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

      {/* Full-screen resolution overlay -- dismissible (docs/22 interrupt):
          closing it only stops watching; resolution keeps running and still
          commits, so nothing here is ever undone by returning to the map. */}
      {(resolving || resolutionDone) && !dismissed && (
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
                {resolving ? "Resolving your orders…" : "Resolution complete"}
              </p>
              {resolving && (
                <button
                  type="button"
                  onClick={() => setDismissed(true)}
                  aria-label="Return to map; resolution continues in the background"
                  title="Return to map"
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
                  Return to map
                </button>
              )}
            </div>
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
