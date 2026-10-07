"use client";

import { useState, type FormEvent } from "react";
import { TRADE_GOODS, type TradeAddressee, type TradeDeskPower, type TradeProposalKind, type TradeProposalRequest } from "@chronica/shared";

/**
 * What a letter may propose in trade: a pact, new terms for the one that stands,
 * the lifting of an embargo, or a notice of one.
 *
 * The terms start from what the desk says stands (`readTradeDesk`): a new pact
 * from half the writer's own customs, a revision from the pact in force, a notice
 * from nothing. The form says who decides the matter, and why, before a word is
 * written; if the one written to is not he, it says so and offers to write to him.
 * Sending agrees nothing. The one written to answers, and only his yes makes a pact.
 */

const KIND_WORDS: Readonly<Record<TradeProposalKind, string>> = {
  pact: "A pact of trade",
  revise: "New terms for our pact",
  lift: "That the embargo be lifted",
  embargo: "A notice of embargo",
};
const KINDS: readonly TradeProposalKind[] = ["pact", "revise", "lift", "embargo"];

const DURATIONS: readonly { readonly days: number | null; readonly label: string }[] = [
  { days: null, label: "Until one of us ends it" },
  { days: 365, label: "For a year" },
  { days: 1_825, label: "For five years" },
];

/** Basis points as the percent the player types: 500 is "5", 250 is "2.5". */
const toPercent = (bps: number | null): string => (bps === null ? "" : String(bps / 100));
const fromPercent = (text: string): number | null => {
  const value = Number(text.trim());
  return text.trim() === "" || !Number.isFinite(value) ? null : Math.max(0, Math.min(5_000, Math.round(value * 100)));
};

export function TradeProposalForm({ power, toId, toName, initialKind, posting, error, sent, onSend, onWriteTo }: {
  readonly power: TradeDeskPower;
  /** The person this letter goes to. */
  readonly toId: string;
  readonly toName: string;
  readonly initialKind?: TradeProposalKind | undefined;
  readonly posting: boolean;
  readonly error: string | null;
  readonly sent: string | null;
  readonly onSend: (request: TradeProposalRequest, words: string) => void;
  /** Turn to the person who decides it instead. */
  readonly onWriteTo?: ((addressee: TradeAddressee) => void) | undefined;
}) {
  const firstAllowed = KINDS.find((candidate) => power.proposals[candidate].allowed);
  const [kind, setKind] = useState<TradeProposalKind | null>(initialKind !== undefined && power.proposals[initialKind].allowed ? initialKind : firstAllowed ?? null);
  const start = kind === null ? null : power.proposals[kind].start;
  const [cap, setCap] = useState(toPercent(start?.tariffCapBps ?? null));
  const [favoured, setFavoured] = useState(start?.mostFavoured ?? false);
  const [exempt, setExempt] = useState<readonly string[]>(start?.exempt ?? []);
  const [goods, setGoods] = useState<readonly string[]>(start?.goods ?? []);
  const [days, setDays] = useState<number | null>(null);
  const [demand, setDemand] = useState("");
  const [words, setWords] = useState("");

  function choose(next: TradeProposalKind) {
    const from = power.proposals[next].start;
    setKind(next);
    setCap(toPercent(from.tariffCapBps));
    setFavoured(from.mostFavoured);
    setExempt(from.exempt);
    setGoods(from.goods);
  }
  const toggle = (list: readonly string[], good: string): string[] => (list.includes(good) ? list.filter((id) => id !== good) : [...list, good]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (kind === null || posting) return;
    const embargo = kind === "embargo";
    onSend({
      kind,
      trade: {
        tariffCapBps: embargo ? null : fromPercent(cap),
        mostFavoured: embargo ? false : favoured,
        exempt: (embargo ? [] : exempt) as TradeProposalRequest["trade"]["exempt"],
        goods: (embargo ? goods : []) as TradeProposalRequest["trade"]["goods"],
      },
      forDays: days,
      ...(embargo && demand.trim().length > 0 ? { demand: demand.trim() } : {}),
    }, words);
  }

  const addressee = power.addressee;
  const wrongMan = addressee !== null && addressee.characterId !== toId;
  const embargo = kind === "embargo";

  return (
    <form className="letters-form trade-proposal" onSubmit={submit} aria-label={`A proposal of trade to ${power.label}`}>
      <h4>Put trade to {power.label}</h4>
      {addressee === null ? (
        <p className="mirror__note">Nobody is left in {power.label} to write to.</p>
      ) : (
        <p className="trade-proposal__who">
          {addressee.name}{addressee.officeLabel !== null && <>, {addressee.officeLabel},</>} decides this: {addressee.why}.
          {wrongMan && (
            <> You are writing to {toName}, who does not. The letter may go to {toName} all the same, and will be answered by saying where it belongs.{" "}
              {onWriteTo !== undefined && <button type="button" className="word-button" onClick={() => onWriteTo(addressee)}>Write to {addressee.name} instead</button>}
            </>
          )}
        </p>
      )}

      <fieldset className="letters-form__choices">
        <legend>What you put to them</legend>
        {KINDS.map((candidate) => {
          const option = power.proposals[candidate];
          return (
            <label key={candidate} title={option.why ?? undefined}>
              <input type="radio" name="trade-proposal-kind" checked={kind === candidate} disabled={!option.allowed || posting} onChange={() => choose(candidate)} />
              {KIND_WORDS[candidate]}{!option.allowed && option.why !== null && <span className="mirror__note"> {option.why}</span>}
            </label>
          );
        })}
      </fieldset>

      {kind !== null && !embargo && (
        <fieldset className="trade-proposal__terms">
          <legend>The terms</legend>
          <label>
            Customs on either power&rsquo;s goods may not pass, in a hundred
            <input type="number" min={0} max={50} step={0.5} value={cap} onChange={(event) => setCap(event.target.value)} disabled={posting} placeholder="no cap" />
          </label>
          <label className="trade-proposal__check">
            <input type="checkbox" checked={favoured} onChange={(event) => setFavoured(event.target.checked)} disabled={posting} />
            Each gives the other the best terms it gives anybody
          </label>
          <div role="group" aria-label="Goods that come in free of customs">
            <span className="mirror__note">Free of customs</span>
            {TRADE_GOODS.map((good) => (
              <label key={good.id} className="trade-proposal__check">
                <input type="checkbox" checked={exempt.includes(good.id)} onChange={() => setExempt((list) => toggle(list, good.id))} disabled={posting} />
                {good.name}
              </label>
            ))}
          </div>
          <label>
            How long it holds
            <select value={days === null ? "" : String(days)} onChange={(event) => setDays(event.target.value === "" ? null : Number(event.target.value))} disabled={posting}>
              {DURATIONS.map((option) => <option key={option.label} value={option.days === null ? "" : String(option.days)}>{option.label}</option>)}
            </select>
          </label>
        </fieldset>
      )}

      {embargo && (
        <fieldset className="trade-proposal__terms">
          <legend>The notice</legend>
          <label>
            What you ask of them, which spares them the embargo
            <input type="text" value={demand} maxLength={300} onChange={(event) => setDemand(event.target.value)} disabled={posting} placeholder="that you lower the customs on our goods" />
          </label>
          <div role="group" aria-label="Goods the embargo would forbid">
            <span className="mirror__note">Goods it forbids; none chosen forbids every good</span>
            {TRADE_GOODS.map((good) => (
              <label key={good.id} className="trade-proposal__check">
                <input type="checkbox" checked={goods.includes(good.id)} onChange={() => setGoods((list) => toggle(list, good.id))} disabled={posting} />
                {good.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {kind !== null && (
        <>
          <label>
            Your own words with it, if you would add any
            <textarea rows={3} maxLength={600} value={words} onChange={(event) => setWords(event.target.value)} disabled={posting} />
          </label>
          <p className="mirror__note">
            {embargo
              ? "Nothing is shut by sending it. If they refuse, or send no answer by the day, your markets are shut to theirs."
              : "Sending it agrees nothing. They are asked for their answer at once, and it comes back on the day the road allows; only a yes makes the pact. They may answer with other terms."}
          </p>
        </>
      )}
      {kind === null && <p className="mirror__note">There is nothing to put to {power.label} just now.</p>}
      {error !== null && <p className="letters-form__error" role="alert">{error}</p>}
      {sent !== null && error === null && <p className="mirror__note" role="status">{sent}</p>}
      <div className="letters-form__actions letters-form__actions--start">
        <button type="submit" className="btn btn--primary" disabled={posting || kind === null || addressee === null}>{posting ? "Sealing it…" : "Send the proposal"}</button>
      </div>
    </form>
  );
}
