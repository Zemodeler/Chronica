"use client";

import type { Administration, Books } from "@chronica/shared";
import { Sheet, type SheetSide } from "../../../components/ui/sheet";
import { Tabs, type TabSection } from "../../../components/ui/tabs";
import { Tip, TipCard } from "../../../components/ui/tip";
import { spanInWords } from "@chronica/shared";
import { Why } from "./notes";
import { FinancialExposure } from "./office-insights";
import { AdministrationSheet } from "./administration-sheet";

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
 *
 * One panel for two objects, reading two different sets of books: the
 * strongbox (`which="own"`) opens what is in the player's own name, and the
 * ledger stand (`which="kept"`) what he keeps for somebody else -- a treasury,
 * an army's chest, a guild's fund.
 */

export type BooksView = Books & { readonly currencyName: string };

/** `books` is null until the room has been read; the stand and the strongbox are not drawn before then. */
export function BooksPanel({ which, books, administration = null, focus, onClose, side }: {
  readonly which: "own" | "kept";
  readonly books: BooksView | null;
  /** The departments of the state he keeps books for. Only the ledger stand has them. */
  readonly administration?: Administration | null;
  readonly focus?: { readonly tab: string; readonly key?: string | undefined } | undefined;
  readonly onClose: () => void;
  readonly side: SheetSide;
}) {
  const departments = which === "kept" && administration !== null && administration.departments.length > 0;
  const sections: TabSection[] = books === null ? [] : [
    { id: "accounts", title: "Accounts", marked: books.surplus < 0 || books.pressure?.hard === true, content: <><Accounts books={books} /><FinancialExposure which={which} /></> },
    ...(books.debts.length > 0 || books.behind.length > 0
      ? [{ id: "debts", title: "Debts", marked: books.behind.length > 0 || books.debts.some((debt) => debt.defaulted), content: <Debts books={books} /> }]
      : []),
    ...((books.lands?.length ?? 0) > 0 || books.stopped.length > 0
      ? [{ id: "lands", title: "Lands", marked: (books.lands ?? []).some((land) => land.strained), content: <Lands books={books} /> }]
      : []),
    ...(departments && administration !== null
      ? [{ id: "administration", title: "Administration", marked: administration.wanting > 0, content: <AdministrationSheet administration={administration} focusKey={focus?.tab === "administration" ? focus.key : undefined} /> }]
      : []),
  ];
  const wanted = focus !== undefined && sections.some((section) => section.id === focus.tab) ? focus.tab : undefined;

  return (
    <Sheet
      label={which === "own" ? "your means" : "the books you keep"}
      title={which === "own" ? "Your means" : books?.theirGovernments === true ? "The treasury" : "The books you keep"}
      width="ledger"
      side={side}
      onClose={onClose}
      className="books-panel"
    >
      {books === null && <p className="quiet">{which === "own" ? "Opening the strongbox…" : "Sending for the quaestor…"}</p>}
      {books !== null && <Tabs label={which === "own" ? "Your own books" : "The books you keep"} sections={sections} initial={wanted} />}
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
                <th scope="row"><LineWhy line={line} /></th>
                <td>{money(line.monthly)}</td>
              </tr>
            ))}
            <tr className="books__total ledger__total"><th scope="row">Income</th><td>{money(books.totalIncome)}</td></tr>
            <tr className="ledger__head"><th scope="rowgroup" colSpan={2}>Going out</th></tr>
            {books.expenditure.map((line) => (
              <tr key={line.key} className="books__out">
                <th scope="row"><LineWhy line={line} /></th>
                <td>−{money(line.monthly)}</td>
              </tr>
            ))}
            <tr className="books__total ledger__total"><th scope="row">Expenditure</th><td>−{money(books.totalExpenditure)}</td></tr>
            <tr className={`ledger__foot ${books.surplus >= 0 ? "books__surplus" : "books__deficit is-short"}`}>
              <th scope="row"><SurplusMark books={books} /></th>
              <td>{books.surplus >= 0 ? "+" : "−"}{money(Math.abs(books.surplus))}</td>
            </tr>
          </tbody>
        </table>
        {books.pressure !== null && (
          <p className={books.pressure.hard ? "books__pressure is-hard" : "books__pressure"}>
            The taxes are <Why word={books.pressure.inWords} why={books.pressure.why} kicker="Why the taxes are" />.
          </p>
        )}
      </section>
    </div>
  );
}

/** The foot of the month: Surplus or Shortfall, marked where money runs out or arrears lie under it, with the sentence in a note. */
function SurplusMark({ books }: { readonly books: BooksView }) {
  const word = books.surplus >= 0 ? "Surplus" : "Shortfall";
  const spent = books.runsOutInDays !== null;
  if (!spent && books.arrears <= 0) return <>{word}</>;
  return (
    <Tip label={word} note={() => (
      <TipCard kicker="Why it is marked" title={word}>
        {spent && (
          <p>If nothing changes, what is in hand {books.runsOutInDays! <= 0 ? "is already spent" : `runs out in ${books.runsOutInDays! < 14 ? "days" : `about ${spanInWords(books.runsOutInDays!)}`}`}.</p>
        )}
        {books.arrears > 0 && <p>{money(books.arrears)} is owed and has not been paid. A surplus with arrears under it is not a surplus.</p>}
      </TipCard>
    )}>{word}<span className="seal-dot"><span className="visually-hidden"> (marked)</span></span></Tip>
  );
}

/** A line of the books, and what it is made of: "Pay of the legions", and which legions. */
function LineWhy({ line }: { readonly line: { readonly label: string; readonly detail: readonly { readonly label: string; readonly monthly: number }[] } }) {
  if (line.detail.length <= 1) return <>{line.label}</>;
  return (
    <Tip label={line.label} note={() => (
      <TipCard kicker="Made up of" title={line.label}>
        <ul className="why">
          {line.detail.map((entry) => <li key={entry.label} className="why__sum"><span>{entry.label}</span><span>{money(entry.monthly)}</span></li>)}
        </ul>
      </TipCard>
    )}>{line.label}</Tip>
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
                <strong>
                  <Tip label={debt.lenderLabel} note={() => (
                    <TipCard kicker="The terms" title={debt.lenderLabel}>
                      <p>{debt.interestLabel}{debt.monthly === null ? "" : `, ${money(debt.monthly)} a month`}.</p>
                      <p>{debt.terms}</p>
                    </TipCard>
                  )}>{debt.lenderLabel}</Tip>: {money(debt.outstanding)}
                  {debt.defaulted && <span className="is-short"> Defaulted.</span>}
                </strong>
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
                <strong>
                  {land.taxable === null ? land.name : (
                    <Tip label={land.name} note={() => (
                      <TipCard kicker="In tax" title={land.name}>
                        <p>Could bear {money(land.taxable!)} a month in tax.</p>
                      </TipCard>
                    )}>{land.name}</Tip>
                  )}
                </strong>
                <span>{[capitalise(land.order), land.food, land.damage].filter(Boolean).join(", ")}.</span>
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
