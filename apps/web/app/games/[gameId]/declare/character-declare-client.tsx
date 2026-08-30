"use client";

import { useState, useTransition, useEffect } from "react";
import { submitCharacterDeclaration, reviseCharacterDeclaration, confirmCharacterDeclaration } from "../../../actions";

interface Props {
  readonly gameId: string;
  readonly gameTitle: string;
}

type Step =
  | { kind: "input" }
  | { kind: "draft"; confirmationDraft: string; canonicalName: string; origin: string }
  | { kind: "revising"; confirmationDraft: string; canonicalName: string; origin: string }
  | { kind: "confirmed" };

export function CharacterDeclareClient({ gameId, gameTitle }: Props) {
  const [step, setStep] = useState<Step>({ kind: "input" });
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [coins, setCoins] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/account/coins", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { coins: string | null }) => { if (data.coins !== null) setCoins(data.coins); })
      .catch(() => { /* non-critical */ });
  }, []);

  function handleDeclare(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await submitCharacterDeclaration(formData);
      if (result.status === "draft" && result.confirmationDraft) {
        setStep({ kind: "draft", confirmationDraft: result.confirmationDraft, canonicalName: result.canonicalName ?? "", origin: result.origin ?? "invented" });
        setCoins(null); // refresh after spending coins
        void fetch("/api/account/coins", { cache: "no-store" }).then((r) => r.json()).then((d: { coins: string | null }) => { if (d.coins !== null) setCoins(d.coins); }).catch(() => {});
      } else if (result.status === "insufficient_coins") {
        setError("You don't have enough coins. Top up your wallet in the Account page.");
      } else {
        setError(result.error ?? "Something went wrong. Please try again.");
      }
    });
  }

  function handleRevise(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await reviseCharacterDeclaration(formData);
      if (result.status === "draft" && result.confirmationDraft) {
        setStep({ kind: "draft", confirmationDraft: result.confirmationDraft, canonicalName: result.canonicalName ?? "", origin: result.origin ?? "invented" });
        void fetch("/api/account/coins", { cache: "no-store" }).then((r) => r.json()).then((d: { coins: string | null }) => { if (d.coins !== null) setCoins(d.coins); }).catch(() => {});
      } else {
        setError(result.error ?? "Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", background: "var(--background)" }}>
      {/* Top bar */}
      <header style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)", padding: "0 1.5rem", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ color: "var(--text-title)", fontWeight: 800, fontSize: "1.1rem" }}>{gameTitle}</span>
        {coins !== null && (
          <span style={{ color: "var(--text-meta)", fontSize: "0.85rem" }}>
            Coins: <strong style={{ color: "var(--text)" }}>{coins}</strong>
          </span>
        )}
      </header>

      {/* Main content */}
      <main style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem 1rem" }}>
        <div style={{ width: "min(42rem, 100%)" }}>

          {step.kind === "input" && (
            <form action={handleDeclare}>
              <input type="hidden" name="gameId" value={gameId} />
              <div style={{ marginBottom: "1.5rem" }}>
                <h1 style={{ color: "var(--text-title)", fontSize: "1.5rem", margin: "0 0 0.5rem" }}>Who do you want to play as?</h1>
                <p style={{ color: "var(--text-meta)", margin: 0, fontSize: "0.95rem" }}>
                  Describe any character — a real historical figure, an invented person, or just a role. The more you write, the better.
                </p>
                <p style={{ color: "var(--text-muted)", margin: "0.4rem 0 0", fontSize: "0.83rem" }}>
                  Examples: <em>"Appius Claudius Caudex"</em> · <em>"ANTUVI, a fierce warrior"</em> · <em>"A grain merchant in Alexandria"</em>
                </p>
              </div>

              <textarea
                name="playerInput"
                required
                minLength={2}
                rows={5}
                disabled={isPending}
                placeholder="Describe your character here…"
                style={{
                  width: "100%",
                  padding: "0.75rem 1rem",
                  background: "var(--surface-raised)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-control)",
                  color: "var(--text)",
                  fontSize: "1rem",
                  resize: "vertical",
                  fontFamily: "inherit",
                  outline: "none",
                }}
              />

              {error && (
                <p style={{ color: "var(--danger)", marginTop: "0.75rem", fontSize: "0.9rem" }}>{error}</p>
              )}

              <div style={{ marginTop: "1rem", display: "flex", gap: "0.75rem", alignItems: "center" }}>
                <button
                  type="submit"
                  disabled={isPending}
                  style={{
                    padding: "0.6rem 1.4rem",
                    background: isPending ? "var(--surface-raised)" : "var(--accent)",
                    color: "var(--text-title)",
                    border: "none",
                    borderRadius: "var(--radius-pill)",
                    cursor: isPending ? "default" : "pointer",
                    fontWeight: 600,
                    fontSize: "0.95rem",
                  }}
                >
                  {isPending ? "Researching…" : "Research this character"}
                </button>
                {isPending && (
                  <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>This may take a few seconds</span>
                )}
              </div>
            </form>
          )}

          {(step.kind === "draft" || step.kind === "revising") && (
            <div>
              <div style={{ marginBottom: "1.25rem" }}>
                <span style={{
                  display: "inline-block",
                  padding: "0.2rem 0.65rem",
                  background: "var(--surface-raised)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-pill)",
                  color: "var(--text-muted)",
                  fontSize: "0.78rem",
                  marginBottom: "0.75rem",
                }}>
                  {step.origin === "historical" ? "Historical figure" : step.origin === "hybrid" ? "Historical figure (extended)" : "Invented character"}
                </span>
                <h1 style={{ color: "var(--text-title)", fontSize: "1.4rem", margin: "0 0 0.75rem" }}>{step.canonicalName}</h1>
                <div style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-card)",
                  padding: "1.25rem 1.5rem",
                  color: "var(--text)",
                  lineHeight: 1.7,
                  whiteSpace: "pre-wrap",
                  fontSize: "0.97rem",
                }}>
                  {step.confirmationDraft}
                </div>
              </div>

              {error && (
                <p style={{ color: "var(--danger)", marginBottom: "0.75rem", fontSize: "0.9rem" }}>{error}</p>
              )}

              {step.kind === "revising" ? (
                <form action={handleRevise}>
                  <input type="hidden" name="gameId" value={gameId} />
                  <textarea
                    name="revision"
                    required
                    rows={3}
                    disabled={isPending}
                    placeholder="What would you like to change or add?…"
                    style={{
                      width: "100%",
                      padding: "0.75rem 1rem",
                      background: "var(--surface-raised)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-control)",
                      color: "var(--text)",
                      fontSize: "1rem",
                      resize: "vertical",
                      fontFamily: "inherit",
                      outline: "none",
                      marginBottom: "0.75rem",
                    }}
                  />
                  <div style={{ display: "flex", gap: "0.75rem" }}>
                    <button
                      type="submit"
                      disabled={isPending}
                      style={{ padding: "0.6rem 1.4rem", background: isPending ? "var(--surface-raised)" : "var(--accent)", color: "var(--text-title)", border: "none", borderRadius: "var(--radius-pill)", cursor: isPending ? "default" : "pointer", fontWeight: 600, fontSize: "0.95rem" }}
                    >
                      {isPending ? "Updating…" : "Update character"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setStep({ ...step, kind: "draft" })}
                      disabled={isPending}
                      style={{ padding: "0.6rem 1.2rem", background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: "var(--radius-pill)", cursor: "pointer", fontSize: "0.9rem" }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                  <form action={confirmCharacterDeclaration}>
                    <input type="hidden" name="gameId" value={gameId} />
                    <button
                      type="submit"
                      disabled={isPending}
                      style={{ padding: "0.6rem 1.6rem", background: "var(--accent)", color: "var(--text-title)", border: "none", borderRadius: "var(--radius-pill)", cursor: "pointer", fontWeight: 600, fontSize: "0.95rem" }}
                    >
                      Play as {step.canonicalName}
                    </button>
                  </form>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => setStep({ ...step, kind: "revising" })}
                    style={{ padding: "0.6rem 1.2rem", background: "transparent", color: "var(--text-meta)", border: "1px solid var(--border)", borderRadius: "var(--radius-pill)", cursor: "pointer", fontSize: "0.9rem" }}
                  >
                    Revise
                  </button>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => { setStep({ kind: "input" }); setError(null); }}
                    style={{ padding: "0.6rem 1.2rem", background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-pill)", cursor: "pointer", fontSize: "0.9rem" }}
                  >
                    Start over
                  </button>
                </div>
              )}

              {coins !== null && (
                <p style={{ marginTop: "1rem", color: "var(--text-muted)", fontSize: "0.83rem" }}>
                  Wallet: <strong>{coins}</strong> coins remaining
                </p>
              )}
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
