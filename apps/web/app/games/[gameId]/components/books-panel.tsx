"use client";

import { useEffect, useState } from "react";
import { Sheet, type SheetSide } from "../../../components/ui/sheet";

/**
 * The treasury, laid out the way VISION §7 lays it out.
 *
 * Income on one side, expenditure on the other, the surplus at the foot. The
 * engine has computed all of this since the economy was built and the client
 * showed none of it -- a ruler who wanted to know whether he could afford a
 * war had to infer it from a balance. Everything here is arithmetic the engine
 * already did; no model is asked for any of it, which is what §7 says.
 */

interface LedgerLine {
  readonly key: string;
  readonly label: string;
  readonly monthly: number;
  readonly detail: readonly { readonly label: string; readonly monthly: number }[];
}

interface BooksView {
  readonly income: readonly LedgerLine[];
  readonly expenditure: readonly LedgerLine[];
  readonly totalIncome: number;
  readonly totalExpenditure: number;
  readonly surplus: number;
  readonly arrears: number;
  readonly accounts: readonly { readonly id: string; readonly label: string; readonly balance: number }[];
  readonly theirGovernments: boolean;
  readonly currencyName: string;
}

export function BooksPanel({ gameId, revision, onClose, side }: { readonly gameId: string; readonly revision: number; readonly onClose: () => void; readonly side: SheetSide }) {
  const [books, setBooks] = useState<BooksView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void fetch(`/api/games/${encodeURIComponent(gameId)}/books`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("no books"))))
      .then((data: BooksView) => { if (live) setBooks(data); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
    // Refetched when simulated time moves, which is the only thing that changes them.
  }, [gameId, revision]);

  const money = (amount: number): string => amount.toLocaleString();

  return (
    <Sheet
      label="the treasury"
      title={books?.theirGovernments === true ? "The Treasury" : "Your Means"}
      width="ledger"
      side={side}
      onClose={onClose}
      className="books-panel"
    >
      {failed && <p className="quiet">There are no books you may read.</p>}
      {books === null && !failed && <p className="quiet">Sending for the quaestor…</p>}

      {books !== null && <div className="books">
        <section className="books__accounts">
          {books.accounts.length === 0
            ? <p className="quiet">You have nothing anybody keeps an account of.</p>
            : <ul>{books.accounts.map((account) => (
              <li key={account.id}><span>{account.label}</span><strong>{money(account.balance)}</strong></li>
            ))}</ul>}
        </section>

        <section className="books__side">
          <h3>Every month, in <em>{books.currencyName}</em></h3>
          <table className="books__table ledger">
            <tbody>
              <tr className="ledger__head"><th scope="rowgroup" colSpan={2}>Coming in</th></tr>
              {books.income.map((line) => (
                <tr key={line.key} className="books__in">
                  <th scope="row" title={line.detail.map((entry) => `${entry.label}: ${entry.monthly}`).join("\n")}>{line.label}</th>
                  <td>{money(line.monthly)}</td>
                </tr>
              ))}
              <tr className="books__total ledger__total"><th scope="row">Income</th><td>{money(books.totalIncome)}</td></tr>
              <tr className="ledger__head"><th scope="rowgroup" colSpan={2}>Going out</th></tr>
              {books.expenditure.map((line) => (
                <tr key={line.key} className="books__out">
                  <th scope="row" title={line.detail.map((entry) => `${entry.label}: ${entry.monthly}`).join("\n")}>{line.label}</th>
                  <td>−{money(line.monthly)}</td>
                </tr>
              ))}
              <tr className="books__total ledger__total"><th scope="row">Expenditure</th><td>−{money(books.totalExpenditure)}</td></tr>
              <tr className={`ledger__foot ${books.surplus >= 0 ? "books__surplus" : "books__deficit is-short"}`}>
                <th scope="row">{books.surplus >= 0 ? "Surplus" : "Shortfall"}</th>
                <td>{books.surplus >= 0 ? "+" : "−"}{money(Math.abs(books.surplus))}</td>
              </tr>
            </tbody>
          </table>
          {books.arrears > 0 && <p className="books__arrears">
            {money(books.arrears)} is owed and has not been paid. A surplus with arrears under it is not a surplus.
          </p>}
          {books.income.length === 0 && books.expenditure.length === 0 && (
            <p className="quiet">Nothing comes in and nothing goes out that you can see.</p>
          )}
        </section>
      </div>}
    </Sheet>
  );
}
