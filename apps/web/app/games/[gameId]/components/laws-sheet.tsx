"use client";

import { useState } from "react";
import type { LawRow, LawsReading } from "@chronica/shared";
import { Era } from "../../../components/ui/era";
import { Explains, LinkedName } from "./notes";
import { Fact, Facts, Registry, RegistryRow, Unknown } from "./registry";

/**
 * The state's measures: those in force, and those before the councils.
 *
 * A row is a name and one plain sentence of what the measure does or would do;
 * opened, it gives the body that decided it, its dates, what it spends or
 * obliges, and whether it has been carried out. How a vote stands is shown
 * only where the player may know it -- the reader leaves it null otherwise,
 * and the page says that it is not theirs to see rather than leaving it out
 * without a word.
 */
export function LawsSheet({ laws, focusKey, startOn }: {
  readonly laws: LawsReading;
  /** The measure to open on arrival. */
  readonly focusKey?: string | undefined;
  readonly startOn?: "in_force" | "before" | undefined;
}) {
  const arrivedIn = focusKey === undefined ? undefined : laws.before.some((row) => row.key === focusKey) ? "before" : laws.inForce.some((row) => row.key === focusKey) ? "in_force" : undefined;
  const [view, setView] = useState<"in_force" | "before">(arrivedIn ?? startOn ?? (laws.inForce.length === 0 && laws.before.length > 0 ? "before" : "in_force"));
  const rows = view === "in_force" ? laws.inForce : laws.before;
  return (
    <div className="standing laws">
      <div className="registry__switch" role="group" aria-label="Which measures">
        <button type="button" aria-pressed={view === "in_force"} onClick={() => setView("in_force")}>
          In force{laws.inForce.length > 0 && <small>{laws.inForce.length}</small>}
        </button>
        <button type="button" aria-pressed={view === "before"} onClick={() => setView("before")}>
          <Explains k="rule:vote">Before the councils</Explains>{laws.before.length > 0 && <small>{laws.before.length}</small>}
        </button>
      </div>
      {rows.length === 0
        ? <p className="quiet">{view === "in_force" ? "No measure is recorded as carried." : "Nothing is before the councils that you may know of."}</p>
        : <Registry label={view === "in_force" ? "Measures in force" : "Measures before the councils"}>
          {rows.map((row) => <Row key={row.key} row={row} view={view} open={row.key === focusKey} />)}
        </Registry>}
    </div>
  );
}

function Row({ row, view, open }: { readonly row: LawRow; readonly view: "in_force" | "before"; readonly open: boolean }) {
  const detail = row.detail;
  return (
    <RegistryRow id={row.key} title={row.name} sentence={row.sentence} meta={detail.status} marked={row.marked} yours={row.yours} openOnArrival={open}>
      <Facts>
        <Fact term={view === "in_force" ? "Decided by" : "Before"}>{detail.body ?? "No body is recorded."}</Fact>
        {detail.sponsor !== null && <Fact term="Put forward by"><LinkedName linked={detail.sponsor} /></Fact>}
        <Fact term="Dates">{detail.dates.map((line) => <span key={line} className="registry__line"><Era text={line} /></span>)}</Fact>
        {detail.obligations.length > 0 && <Fact term="Spending and duties">{detail.obligations.map((line) => <span key={line} className="registry__line">{line}</span>)}</Fact>}
        <Fact term="Status">{detail.status}</Fact>
        {detail.vote !== null && <Fact term={view === "in_force" ? "The vote" : "How the votes stand"}>{detail.vote}</Fact>}
      </Facts>
      <Unknown lines={detail.unknown} />
    </RegistryRow>
  );
}
