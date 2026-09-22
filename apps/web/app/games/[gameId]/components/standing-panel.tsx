"use client";

import { useEffect, useState } from "react";

/**
 * What a person holds: the offices, the powers, and the land.
 *
 * `describeAuthority` has produced "propose, spend in fiscal matters, over the
 * Rome treasury" since the authority index was written, and only ever wrote it
 * into prompts. The character sheet showed the office's *name* and stopped, so
 * a player could not find out what holding it actually permitted.
 *
 * A seat the world has not written down says so. A declared player can name an
 * office the scenario has no free seat for, and being quietly shown a consul's
 * view is worse than being told Rome has not agreed.
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

interface Standing {
  readonly seats: readonly SeatReading[];
  readonly powers: readonly PowerReading[];
  readonly holdings: readonly HoldingReading[];
  readonly nothing: string | null;
}

/** "Propose and spend in fiscal matters, over the Rome treasury." */
function sentence(power: PowerReading): string {
  const list = power.powers.length <= 1
    ? power.powers.join("")
    : `${power.powers.slice(0, -1).join(", ")} and ${power.powers[power.powers.length - 1]}`;
  const said = `${list} in ${power.domain} matters, over ${power.overLabel}`;
  return `${said.charAt(0).toUpperCase()}${said.slice(1)}.`;
}

export function StandingPanel({ gameId, revision, onClose }: { readonly gameId: string; readonly revision: number; readonly onClose: () => void }) {
  const [standing, setStanding] = useState<Standing | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void fetch(`/api/games/${encodeURIComponent(gameId)}/standing`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("no standing"))))
      .then((data: Standing) => { if (live) setStanding(data); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [gameId, revision]);

  return (
    <aside className="sim-panel" aria-label="Your standing">
      <header className="sim-panel__header">
        <h2>Your Standing</h2>
        <div className="sim-panel__header-actions">
          <button type="button" onClick={onClose} aria-label="Close your standing">×</button>
        </div>
      </header>

      {failed && <p className="sim-panel__empty">There is no standing you may read.</p>}
      {standing === null && !failed && <p className="sim-panel__empty">Sending for the record…</p>}
      {standing?.nothing != null && <p className="sim-panel__empty">{standing.nothing}</p>}

      {standing !== null && standing.nothing === null && (
        <div className="standing">
          {standing.seats.length > 0 && (
            <section className="standing__section">
              <h3>What you hold</h3>
              <ul>
                {standing.seats.map((seat) => (
                  <li key={seat.seatId} className={seat.claimed ? "standing__seat standing__seat--claimed" : "standing__seat"}>
                    <strong>{seat.officeLabel}</strong>
                    <span>{seat.polityLabel}</span>
                    {seat.termLabel !== null && <em>{seat.termLabel}</em>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {standing.powers.length > 0 && (
            <section className="standing__section">
              <h3>What it lets you do</h3>
              <ul className="standing__powers">
                {standing.powers.map((power) => (
                  <li key={`${power.domain}-${power.overLabel}`}>{sentence(power)}</li>
                ))}
              </ul>
            </section>
          )}

          <section className="standing__section">
            <h3>Your land</h3>
            {standing.holdings.length === 0
              ? <p className="sim-panel__empty">No land that anyone has written down.</p>
              : <ul>
                {standing.holdings.map((holding) => (
                  <li key={holding.id} className="standing__holding">
                    <strong>{holding.title}</strong>
                    <span>{holding.territoryLabel} — {holding.controlLabel}</span>
                    <em>{holding.incomeLabel}</em>
                  </li>
                ))}
              </ul>}
          </section>
        </div>
      )}
    </aside>
  );
}
