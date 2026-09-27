"use client";

import { useEffect, useState } from "react";
import type { Books } from "@chronica/shared";
import { Sheet, type SheetSide } from "../../../components/ui/sheet";
import { Tabs, type TabSection } from "../../../components/ui/tabs";

/**
 * The treasury, laid out the way VISION §7 lays it out.
 *
 * Income on one side, expenditure on the other, the surplus at the foot. The
 * engine has computed all of this since the economy was built and the client
 * showed none of it -- a ruler who wanted to know whether he could afford a
 * war had to infer it from a balance. Everything here is arithmetic the engine
 * already did; no model is asked for any of it, which is what §7 says.
 *
 * Three ribbons, each offered only when it has something in it: the accounts
 * and the month, then what is owed, then the lands the money comes from. A
 * private purse will usually only ever have the first.
 */

type BooksView = Books & { readonly currencyName: string };

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

  const sections: TabSection[] = books === null ? [] : [
    { id: "accounts", title: "Accounts", marked: books.surplus < 0 || books.pressure?.hard === true, content: <Accounts books={books} /> },
    ...(books.debts.length > 0 || books.behind.length > 0
      ? [{ id: "debts", title: "Debts", marked: books.behind.length > 0 || books.debts.some((debt) => debt.defaulted), content: <Debts books={books} /> }]
      : []),
    ...((books.lands?.length ?? 0) > 0 || books.stopped.length > 0
      ? [{ id: "lands", title: "Lands", marked: (books.lands ?? []).some((land) => land.strained), content: <Lands books={books} /> }]
      : []),
  ];

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
      {books !== null && <Tabs label="The treasury's books" sections={sections} />}
    </Sheet>
  );
}

const money = (amount: number): string => amount.toLocaleString("en-GB");

function Accounts({ books }: { readonly books: BooksView }) {
  return (
    <div className="books">
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
        {books.pressure !== null && (
          <p className={books.pressure.hard ? "books__pressure is-hard" : "books__pressure"}>
            The taxes are {books.pressure.inWords}.
          </p>
        )}
        {books.arrears > 0 && <p className="books__arrears">
          {money(books.arrears)} is owed and has not been paid. A surplus with arrears under it is not a surplus.
        </p>}
        {books.income.length === 0 && books.expenditure.length === 0 && (
          <p className="quiet">Nothing comes in and nothing goes out that you can see.</p>
        )}
      </section>
    </div>
  );
}

function Debts({ books }: { readonly books: BooksView }) {
  return (
    <div className="books">
      {books.behind.length > 0 && (
        <section className="books__side">
          <h3>Fallen behind</h3>
          <ul className="ruled books__list">
            {books.behind.map((line) => (
              <li key={line.key}>
                <strong>{line.label}</strong>
                <span className="is-short">
                  {money(line.arrears)} unpaid{line.missedPeriods > 0 ? `, ${line.missedPeriods === 1 ? "one payment" : `${line.missedPeriods} payments`} missed` : ""}.
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {books.debts.length > 0 && (
        <section className="books__side">
          <h3>Loans</h3>
          <ul className="ruled books__list">
            {books.debts.map((debt) => (
              <li key={debt.id}>
                <strong>{debt.lenderLabel}: {money(debt.outstanding)}</strong>
                <span>
                  {debt.interestLabel}{debt.monthly === null ? "" : `, ${money(debt.monthly)} a month`}.
                  {debt.defaulted && <span className="is-short"> Defaulted.</span>}
                </span>
                <em>{debt.terms}</em>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Lands({ books }: { readonly books: BooksView }) {
  return (
    <div className="books">
      {(books.lands?.length ?? 0) > 0 && (
        <section className="books__side">
          <h3>The most strained of your lands</h3>
          <ul className="ruled books__list">
            {(books.lands ?? []).map((land) => (
              <li key={land.id} className={land.strained ? "is-strained" : undefined}>
                <strong>{land.name}</strong>
                <span>{[capitalise(land.order), land.food, land.damage].filter(Boolean).join(", ")}.</span>
                {land.taxable !== null && <em>Could bear {money(land.taxable)} a month in tax.</em>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {books.stopped.length > 0 && (
        <section className="books__side">
          <h3>Income that has stopped</h3>
          <ul className="ruled books__list">
            {books.stopped.map((line) => (
              <li key={line.key}>
                <strong><s>{line.label}</s></strong>
                <span>Used to bring {money(line.monthly)} a month.</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

const capitalise = (text: string): string => (text.length === 0 ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`);
