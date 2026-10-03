"use client";

import { useMemo, useState } from "react";
import type { PeaceTerm } from "@chronica/shared";
import type { PeaceTableView, PeaceTablesView, PeaceTermOption } from "@chronica/sim";

/**
 * The peace table (docs/plans/a-living-world.md §8), after Hearts of Iron IV.
 *
 * Each war the player's power is in that has come to talks is a table: how
 * the war stands, what the other side will bear of what we ask (and we of
 * theirs), the sessions so far, their demand on us, what they said they would
 * sign of ours, and a list of everything we might ask with its price. The
 * other side answers by rule, as soon as the terms are put; the next session
 * sits when the envoys have travelled. A man who cannot speak for his power
 * may only watch -- and pay.
 */

const GROUP_TITLES: Readonly<Record<PeaceTermOption["group"], string>> = {
  ground: "Ground",
  money: "Money and trade",
  power: "Power",
  people: "People",
};

const ANSWER_WORDS: Readonly<Record<string, string>> = {
  accepted: "Signed",
  countered: "Countered",
  refused: "Refused",
  walked_out: "They walked out",
};

const keyOf = (term: PeaceTerm): string => JSON.stringify(term);

export function PeaceTableSheet({ gameId, peace, onChanged }: {
  readonly gameId: string;
  readonly peace: PeaceTablesView;
  readonly onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ readonly kind: "answer" | "error"; readonly text: string } | null>(null);

  const act = async (body: Record<string, unknown>): Promise<void> => {
    setBusy(true);
    setSaid(null);
    try {
      const response = await fetch(`/api/games/${gameId}/peace-table`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({})) as { answer?: string; words?: string; error?: string };
      if (!response.ok) setSaid({ kind: "error", text: result.error ?? "The table could not sit." });
      else {
        setSaid({ kind: "answer", text: result.words ?? "Done." });
        onChanged();
      }
    } finally {
      setBusy(false);
    }
  };

  if (peace.tables.length === 0 && peace.wars.length === 0) {
    return <p className="quiet">Your power is at war with nobody, and there is no peace to make.</p>;
  }

  return (
    <div className="peace-table">
      {!peace.speaks && (
        <p className="quiet peace-table__watching">You do not speak for your power at the table. You may watch, and your purse ({peace.purse}) may speak for you.</p>
      )}
      {said !== null && <p className={said.kind === "error" ? "peace-table__said is-error" : "peace-table__said"} role="status">{said.text}</p>}
      {peace.tables.map((table) => <Table key={table.id} table={table} speaks={peace.speaks} purse={peace.purse} busy={busy} act={act} />)}
      {peace.wars.length > 0 && (
        <section className="dossier__section">
          <h4>Wars with no talks yet</h4>
          <ul className="peace-table__wars">
            {peace.wars.map((war) => (
              <li key={war.enemyId}>
                <span>{war.label}</span>
                <WarScale score={war.warScore} />
                {peace.speaks && <button type="button" className="word-button" disabled={busy} onClick={() => void act({ action: "open", enemyId: war.enemyId })}>Propose talks</button>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function WarScale({ score }: { readonly score: number }) {
  // A bar from -100 (lost) to 100 (won), ours to the right.
  const width = Math.min(50, Math.abs(score) / 2);
  return (
    <span className="peace-scale" aria-label={`How the war stands: ${score > 0 ? "going our way" : score < 0 ? "going theirs" : "even"} (${score})`}>
      <span className={score >= 0 ? "peace-scale__fill is-ours" : "peace-scale__fill is-theirs"} style={score >= 0 ? { left: "50%", width: `${width}%` } : { right: "50%", width: `${width}%` }} />
      <span className="peace-scale__mid" />
    </span>
  );
}

function Table({ table, speaks, purse, busy, act }: {
  readonly table: PeaceTableView;
  readonly speaks: boolean;
  readonly purse: number;
  readonly busy: boolean;
  readonly act: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [bribeTo, setBribeTo] = useState<string>(table.negotiators[0]?.id ?? "");
  const [bribeAmount, setBribeAmount] = useState<string>("100");
  const groups = useMemo(() => {
    const byGroup = new Map<PeaceTermOption["group"], PeaceTermOption[]>();
    for (const option of table.catalogue) byGroup.set(option.group, [...(byGroup.get(option.group) ?? []), option]);
    return [...byGroup.entries()];
  }, [table.catalogue]);
  const picked = table.catalogue.filter((option) => chosen.has(keyOf(option.term)));
  const total = picked.reduce((sum, option) => sum + option.price, 0);
  const open = table.status === "open";
  const sitting = open && table.nextSessionInDays === 0;
  const toggle = (option: PeaceTermOption): void => {
    const key = keyOf(option.term);
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    <article className="peace-table__table" aria-label={`Peace talks with ${table.theirLabel}`}>
      <header className="dossier__header">
        <p className="dossier__kicker">{open ? (sitting ? "The table is sitting" : `The next session sits in ${table.nextSessionInDays} days`) : table.status === "signed" ? "Peace was signed" : "The talks broke down"}</p>
        <h3 className="dossier__title">Peace with {table.theirLabel}</h3>
        <p className="peace-table__standing">
          <WarScale score={table.warScore} />
          <span>{table.warParts.slice(0, 4).join("; ") || "Neither side has the better of it."}</span>
        </p>
        <p className="peace-table__budget">They will bear up to <strong>{table.weCanAsk}</strong> of what we ask. We would bear up to <strong>{table.theyCanAsk}</strong> of theirs.</p>
      </header>

      {table.theirDemand !== null && open && (
        <section className="dossier__section peace-table__demand">
          <h4>Their terms ({table.theirDemand.price})</h4>
          <ul>{table.theirDemand.terms.map((term) => <li key={term}>{term}</li>)}</ul>
          {speaks && <button type="button" className="btn" disabled={busy} onClick={() => void act({ action: "accept", tableId: table.id })}>Accept these terms</button>}
        </section>
      )}

      {table.counterOffer !== null && open && (
        <section className="dossier__section peace-table__demand">
          <h4>What they would sign ({table.counterOffer.price})</h4>
          <ul>{table.counterOffer.labels.map((term) => <li key={term}>{term}</li>)}</ul>
          {speaks && <button type="button" className="btn" disabled={busy || !sitting} onClick={() => void act({ action: "take_offer", tableId: table.id })}>Take it</button>}
        </section>
      )}

      {speaks && open && (
        <section className="dossier__section peace-table__ask">
          <h4>What we ask</h4>
          {groups.map(([group, options]) => (
            <fieldset key={group} className="peace-table__group">
              <legend>{GROUP_TITLES[group]}</legend>
              {options.map((option) => (
                <label key={keyOf(option.term)} className="peace-term">
                  <input type="checkbox" checked={chosen.has(keyOf(option.term))} onChange={() => toggle(option)} />
                  <span className="peace-term__label">{option.label}</span>
                  <span className="peace-term__price">{option.price}</span>
                </label>
              ))}
            </fieldset>
          ))}
          <p className={total > table.weCanAsk ? "peace-table__total is-over" : "peace-table__total"}>
            Asking <strong>{total}</strong> of the {table.weCanAsk} they will bear{total > table.weCanAsk ? ": more than they will give" : ""}.
          </p>
          <button type="button" className="btn btn--primary" disabled={busy || !sitting} onClick={() => void act({ action: "put", tableId: table.id, terms: picked.map((option) => option.term) })}>
            {picked.length === 0 ? "Offer peace as things stand" : "Put these terms"}
          </button>
        </section>
      )}

      {open && table.negotiators.length > 0 && (
        <section className="dossier__section peace-table__bribe">
          <h4>A word in an ear</h4>
          <p className="quiet">Money for a man at the table moves what his side will bear. An honest man refuses, and says so.</p>
          <div className="peace-table__bribe-row">
            <select value={bribeTo} onChange={(event) => setBribeTo(event.target.value)} aria-label="Whom to pay">
              {table.negotiators.map((man) => <option key={man.id} value={man.id}>{man.name}, for {man.sideLabel}</option>)}
            </select>
            <input inputMode="numeric" value={bribeAmount} onChange={(event) => setBribeAmount(event.target.value.replace(/[^0-9]/g, ""))} aria-label="How much" />
            <button type="button" className="word-button" disabled={busy || bribeTo === "" || Number(bribeAmount) <= 0 || Number(bribeAmount) > purse}
              onClick={() => void act({ action: "bribe", tableId: table.id, targetId: bribeTo, amount: Number(bribeAmount) })}>Pay</button>
          </div>
          {table.bribes.length > 0 && <ul className="peace-table__bribes">{table.bribes.map((bribe) => <li key={`${bribe.when}-${bribe.toName}`}>{bribe.when}: {bribe.amount} to {bribe.toName} -- {bribe.outcome === "taken" ? "taken" : bribe.outcome === "found_out" ? "taken, and found out" : "refused"}</li>)}</ul>}
        </section>
      )}

      {table.sessions.length > 0 && (
        <section className="dossier__section">
          <h4>The sessions</h4>
          <ol className="peace-table__sessions">
            {table.sessions.map((session, index) => (
              <li key={`${session.when}-${index}`} className={session.ours ? "is-ours" : "is-theirs"}>
                <p><strong>{session.when}</strong>: {session.byLabel} asked {session.terms.length === 0 ? "peace as things stood" : session.terms.join("; ")} ({session.price}).</p>
                {session.answer !== null && <p className="peace-table__answer">{ANSWER_WORDS[session.answer] ?? session.answer}{session.words !== null ? `: "${session.words}"` : ""}</p>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {speaks && open && <button type="button" className="word-button peace-table__leave" disabled={busy} onClick={() => void act({ action: "leave", tableId: table.id })}>Bring our envoys home</button>}
    </article>
  );
}
