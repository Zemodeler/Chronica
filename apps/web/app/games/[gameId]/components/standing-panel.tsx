"use client";

import type { StateOffice, StateReading } from "@chronica/shared";
import { Sheet, type SheetSide } from "../../../components/ui/sheet";
import { Tabs, type TabSection } from "../../../components/ui/tabs";
import { Era } from "../../../components/ui/era";
import { TreatiesSheet } from "./treaties-sheet";
import { Explains, Linkify } from "./notes";

/**
 * What a person holds: the offices, the powers, and the land -- and the state
 * they hold them in.
 *
 * `describeAuthority` has produced "propose, spend in fiscal matters, over the
 * Rome treasury" since the authority index was written, and only ever wrote it
 * into prompts. The character sheet showed the office's *name* and stopped, so
 * a player could not find out what holding it actually permitted.
 *
 * A seat the world has not written down says so. A declared player can name an
 * office the scenario has no free seat for, and being quietly shown a consul's
 * view is worse than being told Rome has not agreed.
 *
 * Three ribbons: what you hold, the state you hold it in, and that state's
 * dealings with other powers. The second and third are offered only when
 * there is something the player may know in them (see `readTheState`).
 */

interface SeatReading {
  readonly seatId: string;
  readonly officeLabel: string;
  readonly polityLabel: string;
  readonly termLabel: string | null;
  readonly claimed: boolean;
}

interface PowerReading {
  readonly powers: readonly string[];
  readonly domain: string;
  readonly overLabel: string;
}

interface HoldingReading {
  readonly id: string;
  readonly title: string;
  readonly territoryLabel: string;
  readonly controlLabel: string;
  readonly incomeLabel: string;
}

export interface Standing {
  readonly seats: readonly SeatReading[];
  readonly powers: readonly PowerReading[];
  readonly holdings: readonly HoldingReading[];
  readonly nothing: string | null;
}

const listed = (items: readonly string[]): string =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/**
 * "Propose and spend in fiscal matters; appoint in judicial matters." One
 * sentence per thing held power over, rather than eight lines that all end
 * "over the Roman Republic".
 */
function sentencesByHolding(powers: readonly PowerReading[]): { over: string; said: string }[] {
  const byOver = new Map<string, string[]>();
  for (const power of powers) {
    const clause = `${listed(power.powers)} in ${power.domain} matters`;
    byOver.set(power.overLabel, [...(byOver.get(power.overLabel) ?? []), clause]);
  }
  return [...byOver].map(([over, clauses]) => {
    const said = clauses.join("; ");
    return { over, said: `${said.charAt(0).toUpperCase()}${said.slice(1)}.` };
  });
}

export function StandingPanel({ standing, state, onClose, side, onWriteTo, onOpenLetters }: {
  readonly standing: Standing | null;
  readonly state: StateReading | null;
  readonly onClose: () => void;
  readonly side: SheetSide;
  readonly onWriteTo?: ((polityLabel: string) => void) | undefined;
  readonly onOpenLetters?: (() => void) | undefined;
}) {
  const theState = state !== null && (state.government !== null || state.legitimacy !== null || state.offices.length > 0 || state.business.length > 0 || state.factions.length > 0);
  const abroad = state !== null && (state.abroad.powers.length > 0 || state.abroad.between.length > 0);
  const sections: TabSection[] = standing === null ? [] : [
    { id: "you", title: "You", content: <You standing={standing} /> },
    ...(theState && state !== null
      ? [{ id: "state", title: "The state", marked: state.legitimacy?.shaky === true || state.business.some((item) => item.yours), content: <TheState state={state} /> }]
      : []),
    ...(abroad && state !== null
      ? [{
        id: "treaties",
        title: "Treaties",
        marked: state.abroad.powers.some((power) => power.posture === "war" || power.letters.length > 0),
        content: <TreatiesSheet abroad={state.abroad} onWriteTo={onWriteTo} onOpenLetters={onOpenLetters} />,
      }]
      : []),
  ];

  return (
    <Sheet label="your standing" title="Your standing" width="desk" side={side} onClose={onClose} className="standing-panel">
      {standing === null && <p className="quiet">Sending for the record…</p>}
      {standing !== null && <Tabs label="Your standing" sections={sections} />}
    </Sheet>
  );
}

function You({ standing }: { readonly standing: Standing }) {
  if (standing.nothing !== null) return <p className="quiet">{standing.nothing}</p>;
  return (
    <div className="standing">
      {standing.seats.length > 0 && (
        <section className="standing__section sheet-section">
          <h3>What you hold</h3>
          <ul>
            {standing.seats.map((seat) => (
              <li key={seat.seatId} className={seat.claimed ? "standing__seat standing__seat--claimed" : "standing__seat"}>
                <strong>{seat.officeLabel}</strong>
                <span>{seat.polityLabel}</span>
                {seat.termLabel !== null && <em><Era text={seat.termLabel} /></em>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {standing.powers.length > 0 && (
        <section className="standing__section sheet-section">
          <h3>What it lets you do</h3>
          <ul className="standing__powers">
            {sentencesByHolding(standing.powers).map(({ over, said }) => (
              <li key={over}><b>Over {over}.</b> {said}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="standing__section sheet-section">
        <h3>Your land</h3>
        {standing.holdings.length === 0
          ? <p className="quiet">No land that anyone has written down.</p>
          : <ul>
            {standing.holdings.map((holding) => (
              <li key={holding.id} className="standing__holding">
                <strong>{holding.title}</strong>
                <span>{holding.territoryLabel}, {holding.controlLabel}</span>
                <em>{holding.incomeLabel}</em>
              </li>
            ))}
          </ul>}
      </section>
    </div>
  );
}

function TheState({ state }: { readonly state: StateReading }) {
  const government = state.government;
  return (
    <div className="standing">
      {government !== null && state.polityLabel !== null && (
        <section className="standing__section sheet-section">
          <h3>How {state.polityLabel} is governed</h3>
          <p>
            It is <Explains k={`form:${government.form}`}>{government.formLabel}</Explains>
            {government.rulerLabel !== null ? <>, headed by its <Linkify text={government.rulerLabel} /></> : null}.
            {government.sovereignLabel !== null && <> The <Linkify text={government.sovereignLabel} /> may change how it is governed.</>}
          </p>
        </section>
      )}

      {state.legitimacy !== null && (
        <section className="standing__section sheet-section">
          <h3>The right to rule</h3>
          <p className={state.legitimacy.shaky ? "standing__legitimacy is-shaky" : "standing__legitimacy"}>
            {capitalise(state.legitimacy.inWords)}.
          </p>
          {state.legitimacy.causes.length > 0 && <p className="quiet">Because of {listed(state.legitimacy.causes.map(lowerFirst))}.</p>}
        </section>
      )}

      {state.business.length > 0 && (
        <section className="standing__section sheet-section">
          <h3><Explains k="rule:vote">Before the councils</Explains></h3>
          <ul>
            {state.business.map((item) => (
              <li key={item.key} className={item.yours ? "standing__seat standing__business is-yours" : "standing__seat standing__business"}>
                <strong>{item.label}</strong>
                {item.deadlineLabel !== null && <span>Decided by <Era text={item.deadlineLabel} />.</span>}
                {item.tally !== null && <em>{item.tally}</em>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {state.offices.length > 0 && (
        <section className="standing__section sheet-section">
          <h3>Its offices</h3>
          <ul className="standing__offices">
            {state.offices.map((office) => (
              <li key={office.key} className={office.yours ? "is-yours" : undefined}>
                <strong><Linkify text={office.officeLabel} /></strong>
                <span>{howFilled(office)}</span>
                <em><Holders office={office} /></em>
              </li>
            ))}
          </ul>
        </section>
      )}

      {state.factions.length > 0 && (
        <section className="standing__section sheet-section">
          <h3>Factions</h3>
          <ul>
            {state.factions.map((faction) => (
              <li key={faction.key} className="standing__seat">
                <strong>{faction.name}</strong>
                <span>{capitalise(faction.kindLabel)}, {faction.members === 1 ? "one member" : `${faction.members} members`}.</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

const capitalise = (text: string): string => (text.length === 0 ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`);
const lowerFirst = (text: string): string => (text.length === 0 ? text : `${text.charAt(0).toLowerCase()}${text.slice(1)}`);

/** "Election by the Centuriate Assembly, for a year". */
function howFilled(office: StateOffice): string {
  const parts = [office.filledLabel, office.termLabel === null ? null : `for ${office.termLabel}`].filter((part) => part !== null);
  return parts.length === 0 ? "" : capitalise(parts.join(", "));
}

/**
 * Who sits in it. Only named people have seats, so a college is its named
 * members out of its number, and a Senate of three hundred is a count.
 */
function Holders({ office }: { readonly office: StateOffice }) {
  const { holders, seats } = office;
  if (holders.length === 0) return <>{seats > 1 ? "None of note" : "Vacant"}</>;
  if (holders.length > 3) return <>{holders.length} of note, of {seats}{office.yours ? "; you among them" : ""}</>;
  return (
    <>
      {holders.map((holder, index) => (
        <span key={holder.key} className="standing__holder">
          {index > 0 && ", "}
          <Linkify text={holder.label} />{holder.yours ? " (you)" : ""}
          {holder.untilLabel !== null && (seats === 1 || holder.yours) && <>, <Era text={holder.untilLabel} /></>}
        </span>
      ))}
      {seats > holders.length && <>, of {seats}</>}
    </>
  );
}
