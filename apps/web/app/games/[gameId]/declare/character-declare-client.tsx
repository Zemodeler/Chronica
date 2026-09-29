"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { submitCharacterDeclaration, reviseCharacterDeclaration, confirmCharacterDeclaration } from "../../../actions";
import { LampWait } from "../../../components/ui/lamp-wait";
import { Era } from "../../../components/ui/era";
import type { NotablePerson } from "../../../../lib/notable-people";

const PUNIC_WARS_SCENARIO_ID = "00000000-0000-4000-8000-000000000102";
const HISTORY_IMAGE_ROOT = "/images/history-270bc";

interface Props {
  readonly gameId: string;
  readonly gameTitle: string;
  /** The world's date, so the player knows when they are choosing to live. */
  readonly dateLabel: string;
  readonly scenarioId: string;
  /** The scenario's leading people, as starting points. */
  readonly people: readonly NotablePerson[];
}

/**
 * Stations anyone could hold, whatever the scenario: the other half of "play
 * anyone". A starting point to edit, not a menu -- each fills the box.
 */
const STATIONS = [
  "A senator of an old family, short of money",
  "A merchant with ships in a busy harbour",
  "A legionary in the ranks",
  "An outlaw with nothing left to lose",
] as const;

const ILLUSTRATED_STARTERS = [
  { label: "Roman consul", description: "A Roman consul", image: `${HISTORY_IMAGE_ROOT}/roman-consul.png` },
  { label: "Indebted senator", description: STATIONS[0], image: `${HISTORY_IMAGE_ROOT}/indebted-senator.png` },
  { label: "Carthaginian merchant", description: "A Carthaginian merchant with ships in the harbour at Carthage", image: `${HISTORY_IMAGE_ROOT}/carthaginian-merchant.png` },
  { label: "Roman legionary", description: STATIONS[2], image: `${HISTORY_IMAGE_ROOT}/roman-legionary.png` },
] as const;

/**
 * "Roman consul", or "suffete of Carthage" -- the office, with the power named
 * only when the office does not already say it.
 */
function stationOf(person: NotablePerson): string {
  if (person.role === null) return person.polity === null ? "" : `of the ${person.polity}`;
  const people = person.polity?.split(" ")[0] ?? "";
  if (person.polity === null || (people.length > 0 && person.role.includes(people))) return person.role;
  return `${person.role}, ${person.polity}`;
}

/** Where the unsent description is kept, so a trip to the wallet does not lose it. */
const draftKey = (gameId: string) => `chronica:declare-draft:${gameId}`;

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
export function CharacterDeclareClient({ gameId, gameTitle, dateLabel, scenarioId, people }: Props) {
  const [step, setStep] = useState<Step>({ kind: "input" });
  const [who, setWho] = useState("");
  const whoRef = useRef<HTMLTextAreaElement>(null);
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

  // The description survives leaving for the wallet and coming back. Storage
  // can be refused (a private window); the page works the same without it.
  useEffect(() => {
    try { const kept = window.localStorage.getItem(draftKey(gameId)); if (kept !== null) setWho(kept); } catch { /* no storage */ }
  }, [gameId]);
  useEffect(() => {
    try {
      if (who.trim().length === 0) window.localStorage.removeItem(draftKey(gameId));
      else window.localStorage.setItem(draftKey(gameId), who);
    } catch { /* no storage */ }
  }, [gameId, who]);

  const begin = (text: string) => {
    setWho(text);
    whoRef.current?.focus();
  };
  const empty = coins === "0";
  const hasIllustratedStarters = scenarioId === PUNIC_WARS_SCENARIO_ID;

  function handleDeclare(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await submitCharacterDeclaration(formData);
      if (result.status === "draft" && result.confirmationDraft) {
        setStep({ kind: "draft", confirmationDraft: result.confirmationDraft, canonicalName: result.canonicalName ?? "", origin: result.origin ?? "invented", startingMoney: result.startingMoney ?? 0, currencyName: result.currencyName ?? "money" });
        setCoins(null); // refresh after spending coins
        refreshCoins();
      } else if (result.status === "insufficient_coins") {
        setError("insufficient_coins");
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
        <nav className="declare__way" aria-label="Leave">
          <a className="declare__home" href="/">Your games</a>
          <span className="declare__title">{gameTitle}</span>
        </nav>
        {coins !== null && (
          <a className="declare__coins" href="/account" data-empty={empty ? "true" : undefined}>
            {empty ? "Your wallet is empty" : `${coins} coins`}
          </a>
        )}
      </header>

      <main className="declare__main" id="main-content">
        <div className="declare__column">
          {step.kind === "input" && (
            <form action={handleDeclare}>
              <input type="hidden" name="gameId" value={gameId} />
              <h1>Who do you want to play as?</h1>
              <label className="declare__intro" htmlFor="declare-who">
                It is <Era text={dateLabel} />. Describe anyone: a real historical figure, a person of your own invention, or simply a role. The more you write, the better.
              </label>
              <textarea
                id="declare-who"
                ref={whoRef}
                name="playerInput"
                required
                minLength={2}
                rows={5}
                value={who}
                onChange={(event) => setWho(event.target.value)}
                disabled={isPending}
                placeholder="A senator of an old family, short of money…"
              />
              {error === "insufficient_coins" ? (
                <p className="declare__error" role="alert">
                  Your wallet does not have enough coins for the research. <a href="/account">Add coins on your account page</a>; what you wrote will still be here when you come back.
                </p>
              ) : error && <p className="declare__error" role="alert">{error}</p>}
              <div className="declare__actions">
                <button type="submit" className="btn btn--primary" disabled={isPending || empty}>
                  {isPending ? "Researching…" : "Research this character"}
                </button>
                <span className="declare__price">
                  {isPending
                    ? "The historians are at work. This may take a few seconds."
                    : empty
                      ? <>Research is paid from your wallet, and it is empty. <a href="/account">Add coins</a> first.</>
                      : "Research is paid from your wallet, by how much the historians write."}
                </span>
              </div>

              {!isPending && (
                <div className="declare__starters">
                  {(hasIllustratedStarters || people.length > 0) && (
                    <section className="declare__people" aria-labelledby="declare-people">
                      <h2 id="declare-people">People of this world</h2>
                      {hasIllustratedStarters && <p>Choose a starting point, then make it your own in the box above.</p>}
                      {hasIllustratedStarters && <ul className="declare__illustrated">
                        {ILLUSTRATED_STARTERS.map((starter) => (
                          <li key={starter.label}>
                            <button type="button" className="declare__illustrated-button" onClick={() => begin(`${starter.description}.`)}>
                              <img src={starter.image} alt="" loading="lazy" />
                              <span>{starter.label}</span>
                            </button>
                          </li>
                        ))}
                      </ul>}
                      {people.length > 0 && <ul className="declare__named-people">
                        {people.map((person) => {
                          const station = stationOf(person);
                          return (
                            <li key={person.name}>
                              <button type="button" className="word-button" onClick={() => begin(station.length > 0 ? `${person.name}, ${station}` : person.name)}>
                                {person.name}
                              </button>
                              {station.length > 0 && <span>{station}</span>}
                            </li>
                          );
                        })}
                      </ul>}
                    </section>
                  )}
                  <section aria-labelledby="declare-stations">
                    <h2 id="declare-stations">Or a station of your own</h2>
                    <ul>
                      {STATIONS.filter((station) => !hasIllustratedStarters || station === STATIONS[3]).map((station) => (
                        <li key={station}>
                          <button type="button" className="word-button" onClick={() => begin(`${station}.`)}>{station}</button>
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>
              )}
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
                      try { window.localStorage.removeItem(draftKey(gameId)); } catch { /* no storage */ }
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
