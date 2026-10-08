"use client";

import { useState } from "react";
import { draftText, type ActDraft, type ActLine, type BodyRelation, type BodyView, type ChargeView, type NeighbourRelation, type OfficeNeighbour, type OfficeView } from "@chronica/shared";
import { LinkedName } from "./notes";
import { Fact, Facts, Registry, RegistryRow } from "./registry";

/**
 * Your charge: the office you hold, as the constitution reads it (`readOffice`, docs/plans/government.md "H5 as built").
 *
 * What is yours alone, what you do with a colleague, what must be laid before a chamber and what is not yours; the chambers you sit in or
 * answer to and what is open before them; the men who hold the charges beside and beneath you and what each last did; the accounts of the charge;
 * and the acts open to you, written as the orders the desk already takes. Nothing is decided here and nothing is urged: a button drafts an order
 * at the desk, to be read and sent there, as the lands' tax is.
 *
 * It is the same page for every office. A consul reads his colleague, the Senate, the quaestors and the tribunes' reach; a king his friends and
 * his officers; a suffete his colleague, the Elders and the Hundred and Four; a man with no office reads what binds him and who could move a body.
 */

const RELATION_WORDS: Readonly<Record<BodyRelation, string>> = {
  sits: "You sit in it",
  convenes: "You may put a question to it",
  "elects you": "It chooses you",
  "answers to": "You answer to it",
  "counsels you": "It counsels you",
  "lays before": "You lay matters before it",
  citizen: "You are of its people",
};

const NEIGHBOUR_ORDER: readonly NeighbourRelation[] = ["colleague", "counsel", "above", "beside", "beneath"];

function neighbourHeading(relation: NeighbourRelation, king: boolean): string {
  switch (relation) {
    case "colleague": return "Your colleagues";
    case "counsel": return king ? "The king's friends" : "Those who counsel";
    case "above": return "Of higher rank";
    case "beside": return "Beside you";
    case "beneath": return "Of lower rank";
  }
}

const money = (amount: number): string => amount.toLocaleString("en-GB");
const upper = (text: string): string => (text.length === 0 ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`);

export function OfficeSheet({ office, powers = [], onDraft, onOpenBooks }: {
  readonly office: OfficeView;
  /** The other powers he knows of, for the orders that name one. */
  readonly powers?: readonly string[] | undefined;
  /** Put an order, written for him, on the desk. Absent for those who cannot give orders. */
  readonly onDraft?: ((text: string) => void) | undefined;
  /** Open a tab of the ledger stand. */
  readonly onOpenBooks?: ((tab: string, key?: string) => void) | undefined;
}) {
  if (office.polityId === null) return <p className="quiet">You belong to no power that has written down how it is governed.</p>;
  const king = office.style === "king";
  const holds = office.charges.length > 0;
  return (
    <div className="standing office-sheet">
      <section className="standing__section sheet-section">
        <h3>{holds ? office.headings.charge : `Your place in ${office.polityLabel}`}</h3>
        {office.form !== null && <p className="quiet">{upper(office.polityLabel ?? "")} is {office.form}.</p>}
        {office.private !== null && <PrivateMan reading={office.private} />}
        {office.charges.map((charge) => <Charge key={charge.officeId} charge={charge} />)}
        {office.charges.length === 0 && office.seats.length > 0 && (
          <ul className="office-sheet__plain">
            {office.seats.map((seat) => <li key={seat.officeId}><strong>{seat.label}</strong>{seat.body === null ? "" : <>, in the {seat.body.replace(/^the\s+/iu, "")}</>}. It is a voice and a seat, and carries no charge of its own.</li>)}
          </ul>
        )}
        {holds && office.seats.length > 0 && <p className="quiet">You also hold the seat of {office.seats.map((seat) => seat.label).join(" and ")}{office.seats[0]!.body === null ? "" : `, in the ${office.seats[0]!.body.replace(/^the\s+/iu, "")}`}.</p>}
      </section>

      {office.bodies.length > 0 && (
        <section className="standing__section sheet-section">
          <h3>{office.headings.bodies}</h3>
          <Registry label="Chambers">{office.bodies.map((body) => <Body key={body.id} body={body} />)}</Registry>
          {office.reach.length > 0 && (
            <div className="office-sheet__reach">
              <h4>Whose word reaches over you</h4>
              <ul className="office-sheet__plain">
                {office.reach.map((reach) => (
                  <li key={reach.officeId}>
                    <strong>{reach.label}</strong>{reach.count > 1 ? ` (${reach.count})` : ""}
                    {reach.holders.length > 0 && <>: {reach.holders.map((holder, index) => <span key={holder.label}>{index > 0 && ", "}<LinkedName linked={holder} /></span>)}{reach.count > reach.holders.length ? " and others" : ""}</>}
                    <span className="office-sheet__small">{reach.sentence}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {office.neighbours.length > 0 && (
        <section className="standing__section sheet-section">
          <h3>{office.headings.neighbours}</h3>
          {NEIGHBOUR_ORDER.map((relation) => {
            const group = office.neighbours.filter((neighbour) => neighbour.relation === relation);
            if (group.length === 0) return null;
            return (
              <div key={relation} className="office-sheet__group">
                <h4>{neighbourHeading(relation, king)}</h4>
                <ul className="office-sheet__neighbours">{group.map((neighbour) => <Neighbour key={neighbour.officeId} neighbour={neighbour} />)}</ul>
              </div>
            );
          })}
          {holds && <p className="quiet">The men who keep a charge act in it by themselves, within their competence; what is yours is done only when you give the word.</p>}
        </section>
      )}

      {office.accounts !== null && (office.accounts.chests.length > 0 || office.accounts.monthlyIn !== null || office.accounts.departments.length > 0 || onOpenBooks !== undefined) && (
        <section className="standing__section sheet-section">
          <h3>{office.headings.accounts}</h3>
          <Accounts accounts={office.accounts} onOpenBooks={onOpenBooks} />
        </section>
      )}

      {office.drafts.length > 0 && (
        <section className="standing__section sheet-section">
          <h3>{office.headings.acts}</h3>
          <p className="quiet">Each button writes the order at the desk, in plain words, for you to read and send. Where it is not yours to do, the order lays it before the chamber.</p>
          <ul className="office-sheet__drafts">
            {office.drafts.map((draft) => <Draft key={draft.key} draft={draft} powers={powers} onDraft={onDraft} />)}
          </ul>
        </section>
      )}
    </div>
  );
}

// ── The charge ─────────────────────────────────────────────────────────────

function ActList({ title, lines }: { readonly title: string; readonly lines: readonly ActLine[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="office-sheet__group">
      <h4>{title}</h4>
      <ul className="office-sheet__acts">
        {lines.map((line) => (
          <li key={line.act}>
            <span className="office-sheet__deed">{line.deed}</span>
            {(line.withinWords !== null || line.now !== null) && <span className="office-sheet__figure">{[line.withinWords === null ? null : upper(line.withinWords), line.now].filter((part) => part !== null).join(" · ")}</span>}
            {line.beyondWords !== null && <span className="office-sheet__small">{line.beyondWords}</span>}
            {line.stoppedBy.length > 0 && <span className="office-sheet__small">May be stopped by {line.stoppedBy.join(" and ")}.</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Charge({ charge }: { readonly charge: ChargeView }) {
  const held = [charge.holding.how, charge.holding.term === null ? null : `for ${charge.holding.term}`, charge.holding.until === null ? null : `until ${charge.holding.until}`, charge.holding.daysLeft === null ? null : `${charge.holding.daysLeft} days left`]
    .filter((part): part is string => part !== null);
  const body = charge.byTheBody[0]?.body ?? null;
  return (
    <article className="office-sheet__charge" aria-label={charge.label}>
      <h4 className="office-sheet__office">{charge.label}{charge.seats > 1 ? <small> one of {charge.seats}</small> : null}</h4>
      <p>{charge.summary}</p>
      {held.length > 0 && <p className="quiet">{upper(held.join(" · "))}.{charge.holding.designate !== null && <> {charge.holding.designate} is chosen to follow.</>}</p>}
      {charge.colleagues.length > 0 && <p className="quiet">{charge.collegial ? "Your colleague in it: " : "Others who hold it: "}{charge.colleagues.map((person, index) => <span key={person.label}>{index > 0 && ", "}<LinkedName linked={person} /></span>)}.</p>}
      <ActList title="Yours alone" lines={charge.alone} />
      <ActList title="With your colleague" lines={charge.withColleague} />
      <ActList title={body === null ? "Laid before the chamber" : `Laid before the ${body.replace(/^the\s+/iu, "")}`} lines={charge.byTheBody} />
      {charge.mayStop.length > 0 && <div className="office-sheet__group"><h4>Yours to stop</h4><p>Your word stops {charge.mayStop.join(", ")} when another does it.</p></div>}
      {charge.forbidden.length > 0 && (
        <details className="office-sheet__forbidden">
          <summary>Not yours ({charge.forbidden.length})</summary>
          <ul className="office-sheet__plain">{charge.forbidden.map((line) => <li key={line.act}>{line.deed}</li>)}</ul>
        </details>
      )}
      {charge.allowance !== null && <p className="office-sheet__allowance">{charge.allowance.words}</p>}
      {charge.levers.length > 0 && (
        <div className="office-sheet__group">
          <h4>What the charge keeps{charge.department === null ? "" : ` (${charge.department.name})`}</h4>
          <ul className="office-sheet__plain">
            {charge.levers.map((lever) => (
              <li key={lever.lever}>
                <span className="office-sheet__deed">{upper(lever.words)}</span>
                <span className="office-sheet__figure">{lever.skillWords}</span>
                {lever.byRule !== null && <span className="office-sheet__small">In another man's hands it {lever.byRule}. In yours, nothing is done but what you order.</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <details className="office-sheet__law">
        <summary>The charge in the words of the law</summary>
        <ul className="office-sheet__plain">{charge.acts.map((line) => <li key={line.act}>{line.sentence}</li>)}</ul>
      </details>
    </article>
  );
}

function PrivateMan({ reading }: { readonly reading: NonNullable<OfficeView["private"]> }) {
  return (
    <div className="office-sheet__private">
      <p>{reading.noCharge}</p>
      <ul className="office-sheet__plain">{reading.boundBy.map((line) => <li key={line}>{line}</li>)}</ul>
      {reading.movedBy.length > 0 && (
        <>
          <h4>What a patron could move</h4>
          <ul className="office-sheet__plain">
            {reading.movedBy.map((entry) => (
              <li key={entry.body}>
                The {entry.body.replace(/^the\s+/iu, "")}, by a {entry.through.toLowerCase()}
                {entry.holders.length > 0 && <>: {entry.holders.map((holder, index) => <span key={holder.label}>{index > 0 && ", "}<LinkedName linked={holder} /></span>)}</>}.
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ── The bodies ─────────────────────────────────────────────────────────────

function Body({ body }: { readonly body: BodyView }) {
  const relations = body.relations.map((relation, index) => (index === 0 ? RELATION_WORDS[relation] : RELATION_WORDS[relation].charAt(0).toLowerCase() + RELATION_WORDS[relation].slice(1)));
  const sentence = body.holds.length > 0
    ? `You bring before it: ${body.holds.slice(0, 3).map((hold) => hold.deed.charAt(0).toLowerCase() + hold.deed.slice(1)).join("; ")}${body.holds.length > 3 ? "; and more" : ""}.`
    : body.note ?? undefined;
  return (
    <RegistryRow id={body.id} title={body.name} meta={`${upper(body.kindWords)}${body.advisory ? ", advisory" : ""}${body.openCount > 0 ? ` · ${body.openCount} open` : ""}`} sentence={sentence}>
      <Facts>
        <Fact term="You">{relations.join("; ")}.{body.yourSeat !== null && <> {body.yourSeat}</>}</Fact>
        {body.powers.length > 0 && <Fact term="It may decide">{body.advisory ? "Nothing: its word is counsel." : `${upper(body.powers.join(", "))}.`}</Fact>}
        {body.holds.length > 0 && <Fact term="Laid before it">{body.holds.map((hold) => <span key={hold.deed} className="registry__line">{hold.deed}: {hold.when}.</span>)}</Fact>}
        <Fact term="Open before it">
          {body.open.length === 0 ? "Nothing is open." : body.open.map((question) => (
            <span key={question.key} className="registry__line">
              <strong>{question.label}</strong>{question.yours ? " (yours)" : ""}
              {question.deadline !== null && <> to be put by {question.deadline}</>}.
              {question.tally !== null && <> {question.tally}</>}
            </span>
          ))}
          {body.openCount > body.open.length && <span className="registry__line">And {body.openCount - body.open.length} more.</span>}
        </Fact>
        {body.lately.length > 0 && (
          <Fact term="Lately">
            {body.lately.map((item) => (
              <span key={`${item.label}-${item.when}`} className="registry__line">{item.label}: {item.outcome}{item.when !== null ? `, ${item.when}` : ""}.{item.why !== null && item.why !== "" ? ` ${item.why}` : ""}</span>
            ))}
          </Fact>
        )}
        {body.note !== null && body.holds.length > 0 && <Fact term="Of it">{body.note}</Fact>}
      </Facts>
    </RegistryRow>
  );
}

// ── The men beside and beneath ─────────────────────────────────────────────

function Neighbour({ neighbour }: { readonly neighbour: OfficeNeighbour }) {
  return (
    <li className="office-sheet__neighbour">
      <strong>{neighbour.label}</strong>{neighbour.seats > 1 ? <small> one of {neighbour.seats}</small> : null}
      {neighbour.keeps.length > 0 && <span className="office-sheet__small">He {neighbour.keeps.join("; ")}.</span>}
      <ul className="office-sheet__people">
        {neighbour.holders.map((holder) => (
          <li key={holder.person.label}>
            <LinkedName linked={holder.person} />
            <span className="office-sheet__figure">{holder.toYou === "neutral" ? "neutral to you" : `${holder.toYou} to you`}{holder.yours === holder.toYou ? "" : `; you hold him ${holder.yours}`}</span>
            {holder.lastDone !== null && <span className="office-sheet__small">{holder.lastDone.when === null ? "" : `${holder.lastDone.when}: `}{holder.lastDone.text}</span>}
          </li>
        ))}
        {neighbour.more > 0 && <li className="quiet">And {neighbour.more} more.</li>}
      </ul>
    </li>
  );
}

// ── The accounts ───────────────────────────────────────────────────────────

function Accounts({ accounts, onOpenBooks }: { readonly accounts: NonNullable<OfficeView["accounts"]>; readonly onOpenBooks?: ((tab: string, key?: string) => void) | undefined }) {
  return (
    <div className="office-sheet__accounts">
      {accounts.chests.length > 0 && (
        <ul className="office-sheet__plain">
          {accounts.chests.map((chest) => <li key={chest.label}><span className="office-sheet__deed">{chest.label}</span><span className="office-sheet__figure">{money(Math.round(chest.balance))} {accounts.currency}</span></li>)}
        </ul>
      )}
      {accounts.monthlyIn !== null && accounts.monthlyOut !== null && (
        <p>It takes in about {money(accounts.monthlyIn)} a month and pays out about {money(accounts.monthlyOut)}{accounts.runsOutInDays !== null ? `; at this rate the chest is empty in ${accounts.runsOutInDays} days` : ""}.</p>
      )}
      {accounts.departments.map((department) => (
        <div key={department.key} className="office-sheet__group">
          <h4>{department.name}</h4>
          {department.issue !== null && <p className="office-sheet__small">{department.issue}</p>}
          {department.spending.map((line) => <p key={line} className="office-sheet__small">{line}</p>)}
          {department.works.length > 0 && (
            <ul className="office-sheet__plain">
              {department.works.map((work) => <li key={work.label} className={work.stalled ? "is-stalled" : undefined}><strong>{work.label}</strong> {work.detail}</li>)}
            </ul>
          )}
        </div>
      ))}
      {onOpenBooks !== undefined && accounts.links.length > 0 && (
        <p className="registry__actions">
          {accounts.links.map((link) => <button key={link.tab} type="button" className="btn btn--quiet btn--small" onClick={() => onOpenBooks(link.tab, link.key)}>{link.label}</button>)}
        </p>
      )}
    </div>
  );
}

// ── The acts open to him ───────────────────────────────────────────────────

function Draft({ draft, powers, onDraft }: { readonly draft: ActDraft; readonly powers: readonly string[]; readonly onDraft?: ((text: string) => void) | undefined }) {
  const [power, setPower] = useState<string>(powers[0] ?? "");
  const [figure, setFigure] = useState<string>(draft.needs.figure === null ? "" : String(draft.needs.figure.initial));
  const number = Number(figure);
  const figured = draft.needs.figure === null ? undefined : (Number.isFinite(number) && number >= 0 ? number : draft.needs.figure.initial);
  const ready = draft.needs.power ? powers.length > 0 : true;
  const preview = draftText(draft, { power: power === "" ? undefined : power, figure: figured });
  const deed = draft.key === "pacts:alliance" ? "Make an alliance" : draft.key === "pacts:trade" ? "Make a pact of trade" : draft.deed;
  const label = draft.kind === "stop" || draft.grade !== "by_the_body" ? deed : `${deed}: lay it before the ${draft.body?.replace(/^the\s+/iu, "") ?? "chamber"}`;
  return (
    <li className="office-sheet__draft">
      <form
        className="regions__form"
        onSubmit={(event) => { event.preventDefault(); if (onDraft !== undefined && ready) onDraft(preview.text); }}
        aria-label={label}
      >
        <span className="office-sheet__deed">{label}</span>
        {draft.needs.power && (
          <label>
            <span>Power</span>
            <select value={power} onChange={(event) => setPower(event.target.value)} disabled={powers.length === 0}>
              {powers.length === 0 ? <option value="">none known</option> : powers.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
        )}
        {draft.needs.figure !== null && (
          <label>
            <span>{draft.needs.figure.label}, {draft.needs.figure.unit}</span>
            <input type="number" min={0} step={draft.needs.figure.step} value={figure} onChange={(event) => setFigure(event.target.value)} />
          </label>
        )}
        {onDraft !== undefined && <button type="submit" className="btn btn--small" disabled={!ready}>{draft.open ? "Begin the order" : "Draft the order"}</button>}
      </form>
      <span className="office-sheet__small">{draft.note}</span>
      {preview.laid !== null && draft.grade !== "by_the_body" && <span className="office-sheet__small">At this figure it is laid before the {preview.laid.replace(/^the\s+/iu, "")}.</span>}
    </li>
  );
}
