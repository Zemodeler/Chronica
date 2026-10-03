"use client";

import { useState, type ReactNode } from "react";
import type { ConstitutionReading, LawsReading, StateOffice, StateReading } from "@chronica/shared";
import { Sheet, type SheetSide } from "../../../components/ui/sheet";
import { Tabs, type TabSection } from "../../../components/ui/tabs";
import { Era } from "../../../components/ui/era";
import { TreatiesSheet } from "./treaties-sheet";
import { PeaceTableSheet } from "./peace-table-sheet";
import type { PeaceTablesView } from "@chronica/sim";
import { Tip, TipCard } from "../../../components/ui/tip";
import { Explains, Linkify, Name, useGlossary } from "./notes";
import { PermissionRequirements, LeavingOffice, useOfficeInsights } from "./office-insights";
import { ConstitutionSheet } from "./constitution-sheet";
import { LawsSheet } from "./laws-sheet";

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

export function StandingPanel({ standing, state, constitution, laws, peace, gameId, onChanged, focus, onClose, side, onWriteTo, onOpenLetters }: {
  readonly standing: Standing | null;
  /** The peace tables his power sits at (`readPeaceTables`). */
  readonly peace?: PeaceTablesView | null | undefined;
  readonly gameId?: string | undefined;
  /** The room is read again after an act at the table. */
  readonly onChanged?: (() => void) | undefined;
  readonly state: StateReading | null;
  readonly constitution: ConstitutionReading | null;
  readonly laws: LawsReading | null;
  /** Where the player was sent from elsewhere: a tab, and a measure to open on it. */
  readonly focus?: { readonly tab: string; readonly key?: string | undefined } | undefined;
  readonly onClose: () => void;
  readonly side: SheetSide;
  readonly onWriteTo?: ((polityLabel: string) => void) | undefined;
  readonly onOpenLetters?: (() => void) | undefined;
}) {
  // A link inside one page can turn to another: a change to the constitution
  // back to the measure that made it.
  const [tab, setTab] = useState<string | undefined>(focus?.tab);
  const [lawKey, setLawKey] = useState<string | undefined>(focus?.tab === "laws" ? focus.key : undefined);
  const theState = state !== null && (state.government !== null || state.legitimacy !== null || state.offices.length > 0 || state.institutions.length > 0 || state.factions.length > 0);
  const abroad = state !== null && (state.abroad.powers.length > 0 || state.abroad.between.length > 0);
  const history = state !== null && constitution !== null && (state.government !== null || constitution.entries.length > 0);
  const anyLaws = laws !== null && (laws.inForce.length > 0 || laws.before.length > 0);
  // A citizen who holds nothing has no "You" page, only the state they live under.
  const sections: TabSection[] = standing === null ? [] : [
    ...(standing.nothing === null ? [{ id: "you", title: "You", content: <You standing={standing} /> }] : []),
    ...(theState && state !== null
      ? [{ id: "state", title: "The state", marked: state.legitimacy?.shaky === true, content: <TheState state={state} showGovernment={!history} /> }]
      : []),
    ...(history && state !== null && constitution !== null
      ? [{ id: "constitution", title: "Constitution", content: <ConstitutionSheet state={state} constitution={constitution} onOpenLaw={(id) => { setLawKey(id); setTab("laws"); }} /> }]
      : []),
    ...(anyLaws && laws !== null
      ? [{
        id: "laws",
        title: "Laws",
        marked: laws.before.some((row) => row.marked) || laws.inForce.some((row) => row.marked),
        content: <LawsSheet key={lawKey ?? "laws"} laws={laws} focusKey={lawKey} />,
      }]
      : []),
    ...(abroad && state !== null
      ? [{
        id: "treaties",
        title: "Treaties",
        marked: state.abroad.powers.some((power) => power.posture === "war" || power.letters.length > 0),
        content: <TreatiesSheet abroad={state.abroad} onWriteTo={onWriteTo} onOpenLetters={onOpenLetters} />,
      }]
      : []),
    ...(peace != null && gameId !== undefined && (peace.tables.length > 0 || peace.wars.length > 0)
      ? [{
        id: "peace",
        title: "Peace table",
        marked: peace.tables.some((table) => table.status === "open" && (table.theirDemand !== null || table.nextSessionInDays === 0)),
        content: <PeaceTableSheet gameId={gameId} peace={peace} onChanged={onChanged ?? (() => undefined)} />,
      }]
      : []),
  ];
  const wanted = focus !== undefined && sections.some((section) => section.id === focus.tab) ? focus.tab : undefined;

  return (
    <Sheet label="your standing" title="Your standing" width="desk" side={side} onClose={onClose} className="standing-panel">
      {standing === null && <p className="quiet">Sending for the record…</p>}
      {standing !== null && sections.length === 0 && <p className="quiet">{standing.nothing ?? "Nothing is recorded that you may read."}</p>}
      {standing !== null && <Tabs label="Your standing" sections={sections} initial={wanted} selected={tab} onSelect={setTab} />}
    </Sheet>
  );
}

function You({ standing }: { readonly standing: Standing }) {
  const insights = useOfficeInsights();
  if (standing.nothing !== null) return <p className="quiet">{standing.nothing}</p>;
  const seatNote = (seat: SeatReading) => {
    const own = standing.powers.filter((power) => power.overLabel === seat.polityLabel);
    const powers = sentencesByHolding(own.length > 0 ? own : standing.powers);
    const leaves = insights.departures.some((departure) => departure.office === seat.officeLabel);
    if (powers.length === 0 && insights.permissions.length === 0 && !leaves) return null;
    return () => (
      <TipCard kicker={seat.polityLabel} title={seat.officeLabel}>
        {powers.length > 0 && <ul className="standing__powers">{powers.map(({ over, said }) => <li key={over}><b>Over {over}.</b> {said}</li>)}</ul>}
        <PermissionRequirements />
        <LeavingOffice office={seat.officeLabel} />
      </TipCard>
    );
  };
  return (
    <div className="standing">
      {standing.seats.length > 0 && (
        <section className="standing__section sheet-section">
          <h3>What you hold</h3>
          <ul>
            {standing.seats.map((seat) => {
              const note = seatNote(seat);
              return (
                <li key={seat.seatId} className={seat.claimed ? "standing__seat standing__seat--claimed" : "standing__seat"}>
                  <strong>{note === null ? seat.officeLabel : <Tip label={seat.officeLabel} note={note}>{seat.officeLabel}</Tip>}</strong>
                  <span>{seat.polityLabel}</span>
                  {seat.termLabel !== null && <em><Era text={seat.termLabel} /></em>}
                </li>
              );
            })}
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

function TheState({ state, showGovernment }: { readonly state: StateReading; readonly showGovernment: boolean }) {
  const government = state.government;
  return (
    <div className="standing">
      {showGovernment && government !== null && state.polityLabel !== null && (
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

      {(state.offices.length > 0 || state.institutions.length > 0) && <OfficeLedger state={state} />}

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

/** One line per office or chamber; its name is the note. */
function OfficeLedger({ state }: { readonly state: StateReading }) {
  const glossary = useGlossary();
  const institutionNote = (institution: StateReading["institutions"][number]) => () => (
    <TipCard kicker={franchiseLabel(institution.franchise)} title={institution.name}>
      {institution.advisory && <p>Its counsel is advisory; the ruler decides.</p>}
      {institution.fillsOfficeIds.length > 0 && <p>Fills: {institution.fillsOfficeIds.map((id, index) => {
        const office = state.offices.find((candidate) => candidate.key === id);
        return office === undefined ? null : <span key={id}>{index > 0 && ", "}<Name k={`office:${id}`}>{office.officeLabel}</Name></span>;
      })}.</p>}
      {institution.powers.length > 0 && <p>May decide: {listed(institution.powers.map((power) => power.replace(/_/g, " ")))}.</p>}
      {institution.votingBlocs.length > 0 && <ul>{institution.votingBlocs.map((bloc) => <li key={bloc.name}>{bloc.name}: {bloc.weight} voting weight</li>)}</ul>}
    </TipCard>
  );
  const row = (key: string, name: ReactNode, meta: string, yours = false) => (
    <li key={key} className={yours ? "is-yours" : undefined}>
      <span className="office-ledger__name">{name}{yours && <small>you</small>}</span>
      <span className="office-ledger__meta">{meta}</span>
    </li>
  );
  const offices = (kind: StateOffice["kind"], title: string) => {
    const entries = state.offices.filter((office) => office.kind === kind);
    if (entries.length === 0) return null;
    return <section className="office-ledger__group"><h3>{title}</h3><ul className="standing__offices">
      {entries.map((office) => row(
        `office:${office.key}`,
        glossary[`office:${office.key}`] === undefined ? office.officeLabel : <Name k={`office:${office.key}`}>{office.officeLabel}</Name>,
        officeSummary(office),
        office.yours,
      ))}
    </ul></section>;
  };
  return <section className="office-ledger" aria-label="Offices and institutions">
    {offices("magistracy", "Magistracies")}
    {state.institutions.length > 0 && <section className="office-ledger__group"><h3>Councils and assemblies</h3><ul>
      {state.institutions.map((institution) => row(
        `institution:${institution.key}`,
        <Tip label={institution.name} note={institutionNote(institution)}>{institution.name}</Tip>,
        institution.advisory ? "advisory" : franchiseLabel(institution.franchise),
      ))}
    </ul></section>}
    {offices("membership", "Memberships")}
    {offices("priesthood", "Priesthoods")}
  </section>;
}

function officeSummary(office: StateOffice): string {
  if (office.holders.length === 0) {
    if (office.recordedVacancies > 0) return `${office.recordedVacancies} recorded vacant${office.seats > office.recordedVacancies ? `, of ${office.seats} seats` : ""}`;
    if (office.seats > 1 || office.kind !== "magistracy") return `${office.seats} seats · no named holders recorded`;
    return "Not currently appointed";
  }
  return `${office.seats} ${office.seats === 1 ? "seat" : "seats"}${office.termLabel === null ? "" : ` · ${office.termLabel}`}`;
}

function franchiseLabel(franchise: string | null): string {
  const labels: Record<string, string> = { council: "Council members", citizens: "Citizen assembly", soldiers: "Assembly of soldiers", chiefs: "Gathering of chiefs", cities: "Delegates of the cities", priests: "College of priests" };
  return franchise === null ? "Recorded institution" : labels[franchise] ?? capitalise(franchise.replace(/_/g, " "));
}

const capitalise = (text: string): string => (text.length === 0 ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`);
const lowerFirst = (text: string): string => (text.length === 0 ? text : `${text.charAt(0).toLowerCase()}${text.slice(1)}`);
