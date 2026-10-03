"use client";

import { MilitaryReadiness } from "./office-insights";

import { useState } from "react";
import { useWindowState } from "../../../components/ui/window-workspace";
import { Sheet, type SheetSide } from "../../../components/ui/sheet";
import { Tabs, type TabSection } from "../../../components/ui/tabs";
import { moraleWhy } from "@chronica/shared";
import { Tip, TipCard } from "../../../components/ui/tip";
import { Linkify, Why } from "./notes";

/**
 * The muster, as the man responsible for it can read it.
 *
 * The only army a player could ever inspect was one whose standard they
 * happened to click on the map, and what it showed them was
 * `authorizedStrength` -- the establishment on paper. A legion that lost half
 * its men at Agrigentum still read as four thousand strong.
 *
 * Condition is in words throughout. A commander knows his men are sullen and
 * short of supply; he does not know they are at 3,500 of 10,000. The one
 * number worth printing is how many men are actually there -- or, for a
 * fleet, how many ships: a squadron's count is hulls, and fifty ships used to
 * read here as "50 men".
 *
 * Two ribbons, Armies and Ships, always both: a consul with no fleet should
 * read that he has none, not wonder where the ships are kept. Each force is
 * its name, and opens to the rest when it is clicked.
 */

interface ForceReading {
  readonly id: string;
  readonly name: string;
  readonly commanderLabel: string;
  readonly authorizedStrength: number;
  readonly fitStrength: number;
  readonly unavailable: number;
  readonly moraleLabel: string;
  readonly provisionLabel: string;
  readonly provisionedThroughLabel: string;
  readonly payStatus: string;
  readonly changeExplanation: string;
  readonly locationLabel: string;
  readonly destinationLabel: string;
  readonly arrivalLabel: string | null;
  readonly naval?: boolean;
  readonly carries?: number;
  /** What it is made of, in a line ("one legion, one ala"). */
  readonly make?: string | null;
  readonly formations?: readonly FormationRow[];
  readonly doctrines?: readonly { readonly id: string; readonly label: string; readonly description: string; readonly own: boolean }[];
  readonly drilling?: boolean;
  readonly commandedByYou?: boolean;
}

interface FormationRow {
  readonly id: string;
  readonly label: string;
  readonly bodyLabel: string;
  readonly line: string;
  readonly men: number;
  readonly units: string;
  readonly quality: string;
  readonly drilling: boolean;
  readonly refittingUntilLabel: string | null;
}

interface ServicePerson { readonly id: string; readonly name: string; readonly rank: string }

/** His own place in an army's ranks (`readService`). */
export interface ServiceView {
  readonly forceId: string;
  readonly forceName: string;
  readonly commander: ServicePerson | null;
  readonly formationLabel: string;
  readonly bodyLabel: string;
  readonly line: string;
  readonly unitLabel: string | null;
  readonly unitMen: number | null;
  readonly formationMen: number;
  readonly rank: string;
  readonly officers: readonly ServicePerson[];
  readonly comrades: readonly ServicePerson[];
  readonly quality: string;
  readonly fightsBy: readonly string[];
  readonly keptBy: readonly string[];
  readonly drilling: boolean;
  readonly campaigns: number;
  readonly campaignsOwed: number | null;
  readonly battles: number;
  readonly wounds: number;
  readonly decorations: readonly { readonly label: string; readonly reason: string }[];
  readonly punishments: readonly { readonly label: string; readonly reason: string }[];
  readonly conduct: "steady" | "glory" | "cautious";
  readonly honours: readonly { readonly label: string; readonly kind: "decoration" | "punishment"; readonly for: string }[];
  readonly campaignsForOffice: number;
}

export interface MusterView {
  readonly forces: readonly ForceReading[];
  readonly theirGovernments: boolean;
}

const count = (n: number): string => n.toLocaleString("en-GB");
const shipsWord = (n: number): string => (n === 1 ? "ship" : "ships");

/** "Men in good heart, fed and paid." Three labels, read as a sentence; the first says why. */
function Condition({ force }: { readonly force: ForceReading }) {
  const who = force.naval === true ? "Crews" : "Men";
  return <>{who} <Why word={force.moraleLabel} why={moraleWhy(force)} kicker={force.naval === true ? "Why the crews are" : "Why the men are"} />, {force.provisionLabel.toLowerCase()} and {force.payStatus.toLowerCase()}.</>;
}

/** The one line a closed entry shows: how many, and where. */
function summaryOf(force: ForceReading): string {
  const strength = force.naval === true ? `${count(force.fitStrength)} ${shipsWord(force.fitStrength)}` : `${count(force.fitStrength)} men`;
  return `${strength}, at ${force.locationLabel}`;
}

/** Only when the men on parade fall short of the books: a warning mark whose note gives the figures. */
function Shortfall({ force }: { readonly force: ForceReading }) {
  const short = force.fitStrength < force.authorizedStrength;
  if (!short && force.unavailable === 0) return null;
  const unit = force.naval === true ? "ships" : "men";
  const label = short ? `Below strength` : force.naval === true ? "Some laid up" : "Some unfit";
  return (
    <p className="muster__strength">
      <Tip label={label} note={() => (
        <TipCard kicker="Strength" title={force.name}>
          <p>
            {count(force.fitStrength)} {unit} fit{short ? `, of ${count(force.authorizedStrength)} on the books` : ""}
            {force.unavailable > 0 ? `, and ${count(force.unavailable)} ${force.naval === true ? "laid up" : "unfit"}` : ""}.
            {(force.carries ?? 0) > 0 ? ` Room aboard for about ${count(force.carries!)} men.` : ""}
          </p>
        </TipCard>
      )}><span className="is-short">{label}</span></Tip>
    </p>
  );
}

/**
 * What an army is made of: its formations, line by line, each with its
 * strength, its units and how good its men are -- and the ways of fighting it
 * practises. Its commander may set it to drill from here; anything more is
 * an order, given in the usual way.
 */
function Make({ force, gameId, onChanged }: { readonly force: ForceReading; readonly gameId: string; readonly onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formations = force.formations ?? [];
  if (formations.length === 0 && (force.doctrines ?? []).length === 0) return null;
  const drill = async (drilling: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/games/${encodeURIComponent(gameId)}/forces/${encodeURIComponent(force.id)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ drilling }),
      });
      if (!response.ok) setError(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? "The order could not be given.");
      else onChanged();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="muster__make">
      {force.make != null && <p className="muster__bodies">{force.make.charAt(0).toUpperCase()}{force.make.slice(1)}.</p>}
      {formations.length > 0 && (
        <ul className="muster__formations">
          {formations.map((formation) => (
            <li key={formation.id}>
              <strong>{formation.label}</strong>
              <span>{count(formation.men)} {force.naval === true ? shipsWord(formation.men) : "men"}, {formation.units}, in {formation.line}</span>
              <em>{formation.quality}{formation.drilling ? ", drilling" : ""}{formation.refittingUntilLabel === null ? "" : `, refitting until ${formation.refittingUntilLabel}`}</em>
            </li>
          ))}
        </ul>
      )}
      {(force.doctrines ?? []).length > 0 && (
        <p className="muster__doctrines">
          Its ways of war:{" "}
          {(force.doctrines ?? []).map((doctrine, index, all) => (
            <span key={doctrine.id}>
              <Tip label={doctrine.label} note={() => (
                <TipCard kicker={doctrine.own ? "This army's own practice" : "Its country's way of war"} title={doctrine.label}>
                  <p>{doctrine.description}</p>
                </TipCard>
              )}>{doctrine.label}</Tip>
              {index < all.length - 2 ? ", " : index === all.length - 2 ? " and " : ""}
            </span>
          ))}.
        </p>
      )}
      {force.commandedByYou === true && formations.length > 0 && (
        <p className="muster__drill">
          <button type="button" className="word-button" disabled={busy} onClick={() => void drill(force.drilling !== true)}>
            {force.drilling === true ? "Stand the men down from drill" : "Set the men to drill in camp"}
          </button>
          {error !== null && <span className="is-short"> {error}</span>}
        </p>
      )}
    </div>
  );
}

/** "The triplex acies" inside a sentence is "the triplex acies". */
const lowerThe = (label: string): string => label.replace(/^The /u, "the ");
/** A label that may or may not begin with its own article, given one. */
const withThe = (label: string): string => (/^the /iu.test(label) ? lowerThe(label) : `the ${label.charAt(0).toLowerCase()}${label.slice(1)}`);
/** "a, b and c". */
const listOf = (items: readonly string[]): string => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

const CONDUCT_WORDS: Readonly<Record<ServiceView["conduct"], { readonly label: string; readonly note: string }>> = {
  steady: { label: "Keep my place", note: "Stand where you are put and do what the men beside you do." },
  glory: { label: "Win glory", note: "Be where the fighting is hardest, and be seen there. The bold are decorated, and the bold are killed." },
  cautious: { label: "Keep my head down", note: "Come home. Men who hang back live longer, and are sometimes seen to hang back." },
};

/** A man's own place in the ranks: his unit, the men over him and beside him, his record, and how he means to fight. */
function YourPlace({ service, gameId, onChanged }: { readonly service: ServiceView; readonly gameId: string; readonly onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choose = async (conduct: ServiceView["conduct"]) => {
    if (conduct === service.conduct) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/games/${encodeURIComponent(gameId)}/service`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conduct }),
      });
      if (!response.ok) setError(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? "That could not be said.");
      else onChanged();
    } finally {
      setBusy(false);
    }
  };
  const owed = service.campaignsOwed === null ? "" : ` of the ${service.campaignsOwed} you owe`;
  return (
    <div className="service">
      <p className="service__place">
        <strong>{service.rank.charAt(0).toUpperCase()}{service.rank.slice(1).toLowerCase()}</strong>
        {service.unitLabel !== null && <>, in {service.unitLabel} ({count(service.unitMen ?? 0)} men)</>}
        {" "}of the {service.formationLabel} of {service.bodyLabel}, in {service.line} of {service.forceName}
        {service.commander !== null && <> under <Linkify text={service.commander.name} /></>}.
      </p>
      <p className="muster__condition">
        The {service.formationLabel.toLowerCase()} are {service.quality}{service.drilling ? ", and drilling" : ""}
        {service.fightsBy.length > 0 && `; they fight by ${listOf(service.fightsBy.map(lowerThe))}`}
        {service.keptBy.length > 0 && `; the army is kept by ${listOf(service.keptBy.map(lowerThe))}`}.
      </p>
      {service.officers.length > 0 && (
        <section className="service__people">
          <h3>Over you</h3>
          <ul>{service.officers.map((person) => <li key={person.id}><Linkify text={person.name} />, {person.rank.toLowerCase()}</li>)}</ul>
        </section>
      )}
      {service.comrades.length > 0 && (
        <section className="service__people">
          <h3>Beside you</h3>
          <ul>{service.comrades.map((person) => <li key={person.id}><Linkify text={person.name} /></li>)}</ul>
        </section>
      )}
      <section className="service__record">
        <h3>Your record</h3>
        <p>
          {service.campaigns} {service.campaigns === 1 ? "campaign" : "campaigns"}{owed}, {service.battles} {service.battles === 1 ? "battle" : "battles"}, {service.wounds} {service.wounds === 1 ? "wound" : "wounds"}.
          {service.campaignsForOffice > 0 && service.campaigns < service.campaignsForOffice && ` Custom expects ${service.campaignsForOffice} before a man stands for office: ${service.campaignsForOffice - service.campaigns} more.`}
        </p>
        {service.decorations.length > 0 && <p>Decorated: {service.decorations.map((entry) => entry.label).join(", ")}.</p>}
        {service.punishments.length > 0 && <p className="is-short">Punished: {service.punishments.map((entry) => entry.label).join(", ")}.</p>}
      </section>
      <section className="service__conduct">
        <h3>In the next battle</h3>
        <div className="registry__switch" role="group" aria-label="How you mean to bear yourself">
          {(Object.keys(CONDUCT_WORDS) as ServiceView["conduct"][]).map((conduct) => (
            <button key={conduct} type="button" aria-pressed={service.conduct === conduct} disabled={busy} onClick={() => void choose(conduct)}>
              {CONDUCT_WORDS[conduct].label}
            </button>
          ))}
        </div>
        <p className="quiet">{CONDUCT_WORDS[service.conduct].note}</p>
        {error !== null && <p className="is-short">{error}</p>}
        {service.honours.length > 0 && (
          <p className="quiet">
            The army gives {listOf(service.honours.filter((honour) => honour.kind === "decoration").map((honour) => `${withThe(honour.label)} for ${honour.for}`))}
            {service.honours.some((honour) => honour.kind === "punishment") && `, and punishes ${listOf(service.honours.filter((honour) => honour.kind === "punishment").map((honour) => `${honour.for} with ${lowerThe(honour.label)}`))}`}.
          </p>
        )}
      </section>
    </div>
  );
}

function Roll({ forces, empty, gameId, onChanged }: { readonly forces: readonly ForceReading[]; readonly empty: string; readonly gameId: string; readonly onChanged: () => void }) {
  const [open, setOpen] = useWindowState<string | null>("forces:expanded", null);
  if (forces.length === 0) return <p className="quiet">{empty}</p>;
  return (
    <ul className="muster ruled">
      {forces.map((force) => {
        const isOpen = open === force.id;
        const fresh = !force.changeExplanation.startsWith("Nothing has changed");
        return (
          <li key={force.id} className={isOpen ? "muster__force is-open" : "muster__force"}>
            <button
              type="button"
              className="muster__name"
              aria-expanded={isOpen}
              aria-controls={`muster-${force.id}`}
              onClick={() => setOpen(isOpen ? null : force.id)}
            >
              <span className="muster__title">{force.name}{fresh && <span className="seal-dot"><span className="visually-hidden"> (news)</span></span>}</span>
              <span className="muster__summary">{summaryOf(force)}</span>
            </button>
            {isOpen && (
              <div id={`muster-${force.id}`} className="muster__details">
                <p className="muster__commander">Under <Linkify text={force.commanderLabel} /></p>
                <Shortfall force={force} />
                <p className="muster__condition"><Condition force={force} /></p>
                <p className="muster__where">
                  <Linkify text={force.destinationLabel.replace(/^Marching on/, force.naval === true ? "Sailing for" : "Marching on")} />
                  {force.arrivalLabel !== null && `, expected ${force.arrivalLabel}`}
                </p>
                <Make force={force} gameId={gameId} onChanged={onChanged} />
                <MilitaryReadiness forceId={force.id} />
                <p className={fresh ? "muster__change is-new" : "muster__change"}>{force.changeExplanation}</p>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function ForcesPanel({ muster, service, gameId, onChanged, onClose, side }: {
  readonly muster: MusterView | null;
  readonly service: ServiceView | null;
  readonly gameId: string;
  /** Read the room again: the men were set to drill, or he chose how to fight. */
  readonly onChanged: () => void;
  readonly onClose: () => void;
  readonly side: SheetSide;
}) {
  const armies = muster?.forces.filter((force) => force.naval !== true) ?? [];
  const fleets = muster?.forces.filter((force) => force.naval === true) ?? [];
  const men = armies.reduce((sum, force) => sum + force.fitStrength, 0);
  const ships = fleets.reduce((sum, force) => sum + force.fitStrength, 0);
  const ours = muster?.theirGovernments === true;
  const sections: TabSection[] = [
    // A man in the ranks reads his own place first: it is the army he lives in.
    ...(service === null ? [] : [{
      id: "place",
      title: "Your place",
      marked: false,
      content: <YourPlace key="place" service={service} gameId={gameId} onChanged={onChanged} />,
    }]),
    {
      id: "armies",
      title: armies.length === 0 ? "Armies" : `Armies · ${count(men)} men`,
      marked: armies.some((force) => !force.changeExplanation.startsWith("Nothing has changed")),
      content: <Roll key="armies" forces={armies} gameId={gameId} onChanged={onChanged} empty={ours ? "No army is under your hand." : "You command no men."} />,
    },
    {
      id: "ships",
      title: fleets.length === 0 ? "Ships" : `Ships · ${count(ships)}`,
      marked: fleets.some((force) => !force.changeExplanation.startsWith("Nothing has changed")),
      content: <Roll key="ships" forces={fleets} gameId={gameId} onChanged={onChanged} empty={ours ? "No ships sail under your hand." : "You have no ships."} />,
    },
  ];

  return (
    <Sheet
      label="your forces"
      title={ours ? "The army and the fleet" : "Your men"}
      width="ledger"
      side={side}
      onClose={onClose}
      className="forces-panel"
    >
      {muster === null && <p className="quiet">Sending for the muster roll…</p>}
      {muster !== null && muster.forces.length === 0 && service === null && <p className="quiet">You command no one.</p>}
      {muster !== null && (muster.forces.length > 0 || service !== null) && <Tabs label="Your forces" sections={sections} />}
    </Sheet>
  );
}
