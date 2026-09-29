"use client";

import { useState } from "react";
import { Sheet, type SheetSide } from "../../../components/ui/sheet";
import { Tabs, type TabSection } from "../../../components/ui/tabs";
import { moraleWhy } from "@chronica/shared";
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

function Strength({ force }: { readonly force: ForceReading }) {
  if (force.naval === true) {
    return (
      <p className="muster__strength">
        <strong>{count(force.fitStrength)} {shipsWord(force.fitStrength)}</strong>
        {force.fitStrength < force.authorizedStrength && <span>, of {count(force.authorizedStrength)} on the books</span>}
        {force.unavailable > 0 && <span>, and {count(force.unavailable)} laid up</span>}
        {(force.carries ?? 0) > 0 && <span>. Room aboard for about {count(force.carries!)} men</span>}
      </p>
    );
  }
  return (
    <p className="muster__strength">
      <strong>{count(force.fitStrength)} men</strong>
      {force.fitStrength < force.authorizedStrength && <span>, of {count(force.authorizedStrength)} on the books</span>}
      {force.unavailable > 0 && <span>, and {count(force.unavailable)} unfit</span>}
    </p>
  );
}

function Roll({ forces, empty }: { readonly forces: readonly ForceReading[]; readonly empty: string }) {
  const [open, setOpen] = useState<string | null>(null);
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
                <Strength force={force} />
                <p className="muster__condition"><Condition force={force} /></p>
                <p className="muster__where">
                  At <Linkify text={force.locationLabel} />. <Linkify text={force.destinationLabel.replace(/^Marching on/, force.naval === true ? "Sailing for" : "Marching on")} />
                  {force.arrivalLabel !== null && `, expected ${force.arrivalLabel}`}
                </p>
                <p className={fresh ? "muster__change is-new" : "muster__change"}>{force.changeExplanation}</p>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function ForcesPanel({ muster, onClose, side }: { readonly muster: MusterView | null; readonly onClose: () => void; readonly side: SheetSide }) {
  const armies = muster?.forces.filter((force) => force.naval !== true) ?? [];
  const fleets = muster?.forces.filter((force) => force.naval === true) ?? [];
  const men = armies.reduce((sum, force) => sum + force.fitStrength, 0);
  const ships = fleets.reduce((sum, force) => sum + force.fitStrength, 0);
  const ours = muster?.theirGovernments === true;
  const sections: TabSection[] = [
    {
      id: "armies",
      title: armies.length === 0 ? "Armies" : `Armies · ${count(men)} men`,
      marked: armies.some((force) => !force.changeExplanation.startsWith("Nothing has changed")),
      content: <Roll key="armies" forces={armies} empty={ours ? "No army is under your hand." : "You command no men."} />,
    },
    {
      id: "ships",
      title: fleets.length === 0 ? "Ships" : `Ships · ${count(ships)}`,
      marked: fleets.some((force) => !force.changeExplanation.startsWith("Nothing has changed")),
      content: <Roll key="ships" forces={fleets} empty={ours ? "No ships sail under your hand." : "You have no ships."} />,
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
      {muster !== null && muster.forces.length === 0 && <p className="quiet">You command no one.</p>}
      {muster !== null && muster.forces.length > 0 && <Tabs label="Your forces" sections={sections} />}
    </Sheet>
  );
}
