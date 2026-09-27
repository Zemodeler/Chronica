"use client";

import { useState, useTransition, useEffect } from "react";
import { submitCharacterDeclaration, reviseCharacterDeclaration, confirmCharacterDeclaration } from "../../../actions";
import { LampWait } from "../../../components/ui/lamp-wait";

interface Props {
  readonly gameId: string;
  readonly gameTitle: string;
}

type Step =
  | { kind: "input" }
  | { kind: "draft"; confirmationDraft: string; canonicalName: string; origin: string; startingMoney: number; currencyName: string }
  | { kind: "revising"; confirmationDraft: string; canonicalName: string; origin: string; startingMoney: number; currencyName: string }
  | { kind: "confirmed" };

function originLabel(origin: string): string {
  return origin === "historical" ? "A historical figure" : origin === "hybrid" ? "A historical figure, extended" : "An invented character";
}

/**
 * Who the player will be: they describe someone, the world researches them
 * and writes back a draft, and they revise it or take it.
 */
export function CharacterDeclareClient({ gameId, gameTitle }: Props) {
  const [step, setStep] = useState<Step>({ kind: "input" });
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [coins, setCoins] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const refreshCoins = () => {
    void fetch("/api/account/coins", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { coins: string | null }) => { if (data.coins !== null) setCoins(data.coins); })
      .catch(() => { /* non-critical */ });
  };

  useEffect(refreshCoins, []);

  function handleDeclare(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await submitCharacterDeclaration(formData);
      if (result.status === "draft" && result.confirmationDraft) {
        setStep({ kind: "draft", confirmationDraft: result.confirmationDraft, canonicalName: result.canonicalName ?? "", origin: result.origin ?? "invented", startingMoney: result.startingMoney ?? 0, currencyName: result.currencyName ?? "money" });
        setCoins(null); // refresh after spending coins
        refreshCoins();
      } else if (result.status === "insufficient_coins") {
        setError("You don't have enough coins. Top up your wallet on the Account page.");
      } else {
        setError(result.error ?? "Something went wrong. Try again.");
      }
    });
  }

  function handleRevise(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await reviseCharacterDeclaration(formData);
      if (result.status === "draft" && result.confirmationDraft) {
        setStep({ kind: "draft", confirmationDraft: result.confirmationDraft, canonicalName: result.canonicalName ?? "", origin: result.origin ?? "invented", startingMoney: result.startingMoney ?? 0, currencyName: result.currencyName ?? "money" });
        refreshCoins();
      } else {
        setError(result.error ?? "Something went wrong. Try again.");
      }
    });
  }

  if (confirming !== null) {
    return <LampWait kicker="Entering the world as" name={confirming} note="Preparing your chronicle…" />;
  }

  return (
    <div className="declare">
      <header className="declare__bar">
        <span className="declare__title">{gameTitle}</span>
        {coins !== null && <span className="declare__coins">{coins} coins</span>}
      </header>

      <main className="declare__main" id="main-content">
        <div className="declare__column">
          {step.kind === "input" && (
            <form action={handleDeclare}>
              <input type="hidden" name="gameId" value={gameId} />
              <h1>Who do you want to play as?</h1>
              <label className="declare__intro" htmlFor="declare-who">
                Describe anyone: a real historical figure, a person of your own invention, or simply a role. The more you write, the better.
              </label>
              <textarea
                id="declare-who"
                name="playerInput"
                required
                minLength={2}
                rows={5}
                disabled={isPending}
                placeholder="A senator of an old family, short of money…"
              />
              {error && <p className="declare__error" role="alert">{error}</p>}
              <div className="declare__actions">
                <button type="submit" className="btn btn--primary" disabled={isPending}>
                  {isPending ? "Researching…" : "Research this character"}
                </button>
                {isPending && <span className="declare__wait">This may take a few seconds.</span>}
              </div>
            </form>
          )}

          {(step.kind === "draft" || step.kind === "revising") && (
            <>
              <div>
                <p className="declare__origin">{originLabel(step.origin)}</p>
                <h1>{step.canonicalName}</h1>
              </div>
              <p className="declare__money">
                Starting money: <strong>{step.startingMoney.toLocaleString()} {step.currencyName}</strong>
              </p>
              <div className="declare__draft">{step.confirmationDraft}</div>

              {error && <p className="declare__error" role="alert">{error}</p>}

              {step.kind === "revising" ? (
                <form action={handleRevise}>
                  <input type="hidden" name="gameId" value={gameId} />
                  <label className="declare__intro" htmlFor="declare-revision">What would you change or add?</label>
                  <textarea id="declare-revision" name="revision" required rows={3} disabled={isPending} placeholder="Ten years older, and in debt…" />
                  <div className="declare__actions">
                    <button type="submit" className="btn btn--primary" disabled={isPending}>
                      {isPending ? "Updating…" : "Update character"}
                    </button>
                    <button type="button" className="btn btn--quiet" onClick={() => setStep({ ...step, kind: "draft" })} disabled={isPending}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="declare__actions">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const formData = new FormData(e.currentTarget);
                      setConfirming(step.canonicalName);
                      startTransition(async () => { await confirmCharacterDeclaration(formData); });
                    }}
                  >
                    <input type="hidden" name="gameId" value={gameId} />
                    <button type="submit" className="btn btn--primary" disabled={isPending}>
                      Play as {step.canonicalName}
                    </button>
                  </form>
                  <button type="button" className="btn btn--quiet" disabled={isPending} onClick={() => setStep({ ...step, kind: "revising" })}>
                    Revise
                  </button>
                  <button type="button" className="btn btn--quiet" disabled={isPending} onClick={() => { setStep({ kind: "input" }); setError(null); }}>
                    Start over
                  </button>
                </div>
              )}

              {coins !== null && <p className="declare__wallet">{coins} coins left in your wallet.</p>}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
