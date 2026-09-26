"use client";

import { useEffect, useState } from "react";
import { Sheet, type SheetSide } from "../../../components/ui/sheet";

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
 * number worth printing is how many men are actually there.
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
}

interface MusterView {
  readonly forces: readonly ForceReading[];
  readonly theirGovernments: boolean;
}

/** "Men in good heart, fed and paid." Three labels, read as a sentence. */
function condition(force: ForceReading): string {
  return `Men ${force.moraleLabel}, ${force.provisionLabel.toLowerCase()} and ${force.payStatus.toLowerCase()}.`;
}

export function ForcesPanel({ gameId, revision, onClose, side }: { readonly gameId: string; readonly revision: number; readonly onClose: () => void; readonly side: SheetSide }) {
  const [muster, setMuster] = useState<MusterView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void fetch(`/api/games/${encodeURIComponent(gameId)}/forces`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("no muster"))))
      .then((data: MusterView) => { if (live) setMuster(data); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [gameId, revision]);

  const men = (n: number): string => n.toLocaleString();

  return (
    <Sheet
      label="your forces"
      title={muster?.theirGovernments === true ? "The Army" : "Your Men"}
      width="ledger"
      side={side}
      onClose={onClose}
      className="forces-panel"
    >
      {failed && <p className="quiet">There are no forces you may count.</p>}
      {muster === null && !failed && <p className="quiet">Sending for the muster roll…</p>}

      {muster !== null && muster.forces.length === 0 && (
        <p className="quiet">You command no one.</p>
      )}

      {muster !== null && muster.forces.length > 0 && (
        <ul className="muster ruled">
          {muster.forces.map((force) => (
            <li key={force.id} className="muster__force">
              <h3>{force.name}</h3>
              <p className="muster__commander">Under {force.commanderLabel}</p>
              <p className="muster__strength">
                <strong>{men(force.fitStrength)} men</strong>
                {force.fitStrength < force.authorizedStrength && <span>, of {men(force.authorizedStrength)} on the books</span>}
                {force.unavailable > 0 && <span>, and {men(force.unavailable)} unfit</span>}
              </p>
              <p className="muster__condition">{condition(force)}</p>
              <p className="muster__where">
                At {force.locationLabel}. {force.destinationLabel}
                {force.arrivalLabel !== null && `, expected ${force.arrivalLabel}`}
              </p>
              <p className={force.changeExplanation.startsWith("Nothing has changed") ? "muster__change" : "muster__change is-new"}>
                {force.changeExplanation}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
