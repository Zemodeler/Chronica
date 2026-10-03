"use client";

import { createContext, useContext, type ReactNode } from "react";
import { EMPTY_OFFICE_INSIGHTS, type InsightLine, type OfficeInsights } from "@chronica/shared";
import { Era } from "../../../components/ui/era";
import { Tip, TipCard } from "../../../components/ui/tip";

const InsightsContext = createContext<OfficeInsights>(EMPTY_OFFICE_INSIGHTS);
export const useOfficeInsights = (): OfficeInsights => useContext(InsightsContext);
export function OfficeInsightsProvider({ insights, children }: { readonly insights: OfficeInsights | undefined; readonly children: ReactNode }) {
  return <InsightsContext.Provider value={insights ?? EMPTY_OFFICE_INSIGHTS}>{children}</InsightsContext.Provider>;
}

export function InsightLines({ lines }: { readonly lines: readonly InsightLine[] }) {
  return <ul className="office-insights__lines">{lines.map((line) => (
    <li key={line.key}><span>{line.text}</span>{line.detail !== null && <p className="office-insights__detail"><Era text={line.detail} /></p>}</li>
  ))}</ul>;
}

/** The body of a note: what the held offices say needs permission. */
export function PermissionRequirements() {
  const { permissions } = useOfficeInsights();
  if (permissions.length === 0) return null;
  return <div className="office-insights">
    <h4>What requires permission</h4>
    <ul className="office-insights__lines">{permissions.map((permission) => (
      <li key={permission.key}><strong>{permission.text}</strong><p>{permission.detail}</p></li>
    ))}</ul>
    <p className="tip__rule">The recorded rules for your held offices. Permission for a particular act still depends on its scope.</p>
  </div>;
}

/** The body of a note: what leaving the office would cost. Of one office when `office` is given. */
export function LeavingOffice({ office }: { readonly office?: string | undefined }) {
  const { departures } = useOfficeInsights();
  const shown = office === undefined ? departures : departures.filter((departure) => departure.office === office);
  if (shown.length === 0) return null;
  return <div className="office-insights">
    <h4>When the term ends</h4>
    {shown.map((departure) => <section key={departure.key} className="office-insights__departure">
      <p><strong>{departure.office}</strong>, until <Era text={departure.when} /></p>
      {departure.lost.length > 0 ? <><p>Authority this appointment alone provides:</p><ul>{departure.lost.map((line) => <li key={line}>{line}.</li>)}</ul></> : <p>Your other current grants cover the same powers.</p>}
      {departure.retained.length > 0 && <p>Other appointments you currently hold: {departure.retained.join(", ")}.</p>}
      {departure.affairs.length > 0 && <><p>Affairs to settle:</p><ul>{departure.affairs.map((line) => <li key={line}>{line}</li>)}</ul></>}
    </section>)}
    <p className="tip__rule">If this appointment ends and your other appointments and grants stay as they are. Your own money and land remain yours.</p>
  </div>;
}

export function FinancialExposure({ which }: { readonly which: "own" | "kept" }) {
  const lines = useOfficeInsights().exposure[which];
  if (lines.length === 0) return null;
  return <section className="sheet-section office-insights"><h3>What your income depends on</h3><InsightLines lines={lines} /></section>;
}

export function MilitaryReadiness({ forceId }: { readonly forceId: string }) {
  const lines = useOfficeInsights().readiness[forceId] ?? [];
  if (lines.length === 0) return null;
  return <p className="office-insights__detail"><Tip className="office-insights__trigger" label="Readiness for a campaign" note={() => (
    <TipCard kicker="Readiness" title="Readiness for a campaign"><div className="office-insights"><InsightLines lines={lines} /></div></TipCard>
  )}>Readiness for a campaign</Tip></p>;
}

export function ConflictingReports() {
  const { disagreements } = useOfficeInsights();
  if (disagreements.length === 0) return null;
  const label = `Reports that differ (${disagreements.length})`;
  return <p className="office-insights__detail"><Tip className="office-insights__trigger" label={label} note={() => (
    <TipCard kicker="Accounts" title={label}>
      <div className="office-insights office-insights__reports">
        {disagreements.map((report) => <section key={report.key}><h3>{report.subject}</h3><InsightLines lines={report.accounts} /></section>)}
        <p className="tip__rule">These accounts describe the same moment differently. Neither is treated here as established truth.</p>
      </div>
    </TipCard>
  )}>{label}</Tip></p>;
}

export function ServiceEvidence({ entityKey }: { readonly entityKey: string | undefined }) {
  const insights = useOfficeInsights();
  if (entityKey === undefined) return null;
  const lines = insights.service[entityKey] ?? [];
  if (lines.length === 0) return <p className="tip__rule office-insights__detail">You have no recorded work or outcomes here from which to judge their competence.</p>;
  const label = `Evidence from their record (${lines.length})`;
  return <p className="office-insights__detail"><Tip className="office-insights__trigger" label={label} note={() => (
    <TipCard kicker="Their record" title={label}>
      <div className="office-insights"><InsightLines lines={lines} /></div>
      <p className="tip__rule">Known work and dealings, rather than an assessment of hidden abilities.</p>
    </TipCard>
  )}>{label}</Tip></p>;
}
