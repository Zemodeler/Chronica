"use client";

import { useRef, useState } from "react";

type RelationCategory = "family" | "other";
type FamilyRole = "parent" | "partner" | "sibling" | "child" | "other_relative";
type FamilyView = "tree" | "list";
type DetailKey = "location" | "culture" | "money" | "authority" | "origin" | "relations";

interface CharacterRelation {
  readonly name: string;
  readonly relationship: string;
  readonly historical: boolean;
  readonly notes: string;
  readonly category?: RelationCategory;
  readonly familyRole?: FamilyRole | null;
}

interface MoneyChange { readonly id: string; readonly label: string; readonly amount: number; readonly whenLabel: string; }

export interface CharacterPanelProps {
  readonly characterName: string;
  readonly role: string;
  readonly locationLabel: string;
  readonly culture: string;
  readonly relations: readonly CharacterRelation[];
  readonly origin: "historical" | "invented" | "hybrid";
  readonly moneyLabel: string;
  readonly moneyBalance: number;
  readonly moneyChanges: readonly MoneyChange[];
  readonly birthYearApprox: number | null;
  readonly ageAtStart: number | null;
  readonly biography: string;
  readonly notableEvents: readonly string[];
  readonly authority?: readonly string[];
}

const DETAIL_TITLES: Record<DetailKey, string> = { location: "Location", culture: "Culture", money: "Money", authority: "Authority", origin: "Origin", relations: "Key Relations" };
const FAMILY_ROLES: readonly FamilyRole[] = ["parent", "partner", "sibling", "child", "other_relative"];

function inferredCategory(relation: CharacterRelation): RelationCategory {
  if (relation.category) return relation.category;
  return /\b(mother|father|parent|wife|husband|spouse|sister|brother|sibling|daughter|son|child|cousin|aunt|uncle|niece|nephew)\b/i.test(relation.relationship) ? "family" : "other";
}

function inferredFamilyRole(relation: CharacterRelation): FamilyRole {
  if (relation.familyRole) return relation.familyRole;
  const label = relation.relationship.toLowerCase();
  if (/mother|father|parent/.test(label)) return "parent";
  if (/wife|husband|spouse|partner/.test(label)) return "partner";
  if (/sister|brother|sibling/.test(label)) return "sibling";
  if (/daughter|son|child/.test(label)) return "child";
  return "other_relative";
}

function originLabel(origin: CharacterPanelProps["origin"]): string {
  return origin === "historical" ? "Historical figure" : origin === "hybrid" ? "Historical figure (extended)" : "Invented character";
}

function formatYear(year: number | null): string { return year === null ? "Unknown" : year < 0 ? `${Math.abs(year)} BCE` : `${year} CE`; }

export function CharacterPanel(props: CharacterPanelProps) {
  const { characterName, role, locationLabel, culture, relations, origin, moneyLabel, moneyBalance, moneyChanges, birthYearApprox, ageAtStart, authority } = props;
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<DetailKey | null>(null);
  const [relationsTab, setRelationsTab] = useState<RelationCategory>("family");
  const [familyView, setFamilyView] = useState<FamilyView>("tree");
  const [birthYearOpen, setBirthYearOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const authorityHoldings = authority ?? [];
  const family = relations.filter((relation) => inferredCategory(relation) === "family");
  const others = relations.filter((relation) => inferredCategory(relation) === "other");

  function openPanel() { setOpen(true); setDetail(null); dialogRef.current?.showModal(); }
  function closePanel() { setOpen(false); setDetail(null); dialogRef.current?.close(); }
  function openDetail(next: DetailKey) { if (next === "relations") setRelationsTab(family.length > 0 ? "family" : "other"); setDetail(next); }

  return <>
    <button className="character-avatar-button" onClick={openPanel} aria-label={`Open character panel for ${characterName}`}>⚔</button>
    <dialog ref={dialogRef} onClose={closePanel} className="character-sheet-dialog" aria-label={`${characterName} character sheet`}>
      <div className="character-sheet-scroll">
        <header className="character-sheet-header"><div><h2>{characterName}</h2><p>{role}</p></div><button onClick={closePanel} aria-label="Close character panel" className="character-sheet-close">✕</button></header>
        <div className="character-sheet-sections">
          <FieldButton label="Location" value={locationLabel} onClick={() => openDetail("location")} />
          <FieldButton label="Culture" value={culture} onClick={() => openDetail("culture")} />
          <FieldButton label="Money" value={moneyLabel} onClick={() => openDetail("money")} />
          <FieldButton label="Authority" value={authorityHoldings[0] ?? role} suffix={authorityHoldings.length > 1 ? `+${authorityHoldings.length - 1}` : undefined} onClick={() => openDetail("authority")} />
          <FieldButton label="Origin" value={originLabel(origin)} onClick={() => openDetail("origin")} />
          <FieldButton label="Key Relations" value={relations.length === 0 ? "None recorded" : `${relations.length} named people`} onClick={() => openDetail("relations")} />
        </div>
      </div>
      {detail && <aside className="character-detail-panel" aria-label={`${DETAIL_TITLES[detail]} details`}>
        <header className="character-detail-header"><div><p>Character details</p><h3>{DETAIL_TITLES[detail]}</h3></div><button className="character-sheet-close" onClick={() => setDetail(null)} aria-label={`Close ${DETAIL_TITLES[detail]} details`}>✕</button></header>
        <div className="character-detail-body">
          {detail === "location" && <><p className="character-detail-value">{locationLabel}</p><p>Your position at the scenario opening.</p></>}
          {detail === "culture" && <><p className="character-detail-value">{culture}</p><p>The cultural context used to ground this character’s identity and history.</p></>}
          {detail === "money" && <MoneyDetail moneyLabel={moneyLabel} balance={moneyBalance} changes={moneyChanges} />}
          {detail === "authority" && <AuthorityDetail role={role} authority={authorityHoldings} />}
          {detail === "origin" && <OriginDetail origin={origin} ageAtStart={ageAtStart} birthYearApprox={birthYearApprox} biography={props.biography} notableEvents={props.notableEvents} birthYearOpen={birthYearOpen} onToggleBirthYear={() => setBirthYearOpen((current) => !current)} />}
          {detail === "relations" && <RelationsDetail family={family} others={others} tab={relationsTab} onTabChange={setRelationsTab} familyView={familyView} onFamilyViewChange={setFamilyView} />}
        </div>
      </aside>}
    </dialog>
    {open && <div onClick={closePanel} className="character-sheet-backdrop" aria-hidden />}
  </>;
}

function FieldButton({ label, value, suffix, onClick }: { label: string; value: string; suffix?: string | undefined; onClick: () => void }) {
  return <button type="button" className="character-sheet-field" onClick={onClick}><span>{label}</span><strong>{value}</strong>{suffix && <em>{suffix}</em>}<b aria-hidden>›</b></button>;
}

function MoneyDetail({ moneyLabel, balance, changes }: { moneyLabel: string; balance: number; changes: readonly MoneyChange[] }) {
  const recent = changes.slice(-5);
  const start = balance - recent.reduce((total, change) => total + change.amount, 0);
  const balances = recent.reduce<number[]>((series, change) => [...series, (series.at(-1) ?? start) + change.amount], [start]);
  const low = Math.min(...balances); const high = Math.max(...balances); const range = high - low || 1;
  const points = balances.map((value, index) => `${12 + index * (216 / Math.max(1, balances.length - 1))},${66 - ((value - low) / range) * 48}`).join(" L");
  return <><p className="character-detail-value">{moneyLabel}</p><div className="money-graph" aria-label="Personal balance graph"><svg viewBox="0 0 240 80" role="img" aria-label={changes.length === 0 ? "Current balance only" : "Recent balance changes"}><path d={changes.length === 0 ? "M12 50 L228 50" : `M${points}`} fill="none" stroke="currentColor" strokeWidth="3" /><circle cx="228" cy={changes.length === 0 ? "50" : points.split(" L").at(-1)?.split(",")[1] ?? "50"} r="5" fill="currentColor" /></svg><span>{changes.length === 0 ? "No balance history yet" : "Recent account movement"}</span></div>{changes.length > 0 && <ul className="character-detail-list">{recent.map((change) => <li key={change.id}><strong>{change.amount >= 0 ? "+" : ""}{change.amount.toLocaleString()}</strong><span>{change.label} · {change.whenLabel}</span></li>)}</ul>}<p className="character-detail-note">{changes.length === 0 ? "The graph will gain history as transactions occur." : "Balance history is shown from your personal-account transactions."}</p></>;
}

function AuthorityDetail({ role, authority }: { role: string; authority: readonly string[] }) { const entries = authority.length > 0 ? authority : [role]; return <><p className="character-detail-value">{role}</p><ul className="character-detail-list">{entries.map((entry) => <li key={entry}><strong>{entry}</strong></li>)}</ul></>; }
function OriginDetail({ origin, ageAtStart, birthYearApprox, biography, notableEvents, birthYearOpen, onToggleBirthYear }: { origin: CharacterPanelProps["origin"]; ageAtStart: number | null; birthYearApprox: number | null; biography: string; notableEvents: readonly string[]; birthYearOpen: boolean; onToggleBirthYear: () => void }) { return <><p className="character-detail-value">{originLabel(origin)}</p><div className="origin-age"><span>Age at scenario opening</span><strong>{ageAtStart === null ? "Unknown" : `c. ${ageAtStart}`}</strong></div><button type="button" className="origin-birth-year" onClick={onToggleBirthYear} aria-expanded={birthYearOpen}>Birth year <b>{birthYearOpen ? "−" : "+"}</b></button>{birthYearOpen && <p className="origin-birth-year-value">{formatYear(birthYearApprox)}</p>}<section className="origin-backstory"><h4>Backstory</h4><p>{biography}</p></section>{notableEvents.length > 0 && <section className="origin-backstory"><h4>Notable events</h4><ul className="character-detail-list">{notableEvents.map((event) => <li key={event}><strong>{event}</strong></li>)}</ul></section>}</>; }

function RelationsDetail({ family, others, tab, onTabChange, familyView, onFamilyViewChange }: { family: readonly CharacterRelation[]; others: readonly CharacterRelation[]; tab: RelationCategory; onTabChange: (tab: RelationCategory) => void; familyView: FamilyView; onFamilyViewChange: (view: FamilyView) => void }) { return <><div className="relation-tabs" role="tablist" aria-label="Key relation categories"><button type="button" role="tab" aria-selected={tab === "family"} onClick={() => onTabChange("family")}>Family ({family.length})</button><button type="button" role="tab" aria-selected={tab === "other"} onClick={() => onTabChange("other")}>Other NPCs ({others.length})</button></div>{tab === "family" && <div className="family-view-toggle" role="group" aria-label="Family view"><button type="button" aria-pressed={familyView === "tree"} onClick={() => onFamilyViewChange("tree")}>Family tree</button><button type="button" aria-pressed={familyView === "list"} onClick={() => onFamilyViewChange("list")}>List</button></div>}{tab === "family" ? familyView === "tree" ? <FamilyTree relations={family} /> : <RelationCards relations={family} emptyLabel="No family members are recorded." /> : <RelationCards relations={others} emptyLabel="No other significant NPCs are recorded." />}</>; }
function FamilyTree({ relations }: { relations: readonly CharacterRelation[] }) {
  if (relations.length === 0) return <p className="character-detail-note">No family members are recorded.</p>;
  const byRole = (role: FamilyRole) => relations.filter((relation) => inferredFamilyRole(relation) === role);
  const parents = byRole("parent"); const partners = byRole("partner"); const siblings = byRole("sibling"); const children = byRole("child"); const relatives = byRole("other_relative");
  return <div className="family-tree-diagram" aria-label="Family tree">
    {parents.length > 0 && <TreeGeneration className="family-tree-generation--parents" relations={parents} />}
    <div className="family-tree-generation family-tree-generation--focus"><TreeNode name="You" relationship="Your character" self />{siblings.map((relation) => <TreeNode key={`${relation.name}-${relation.relationship}`} name={relation.name} relationship={relation.relationship} />)}{partners.map((relation) => <TreeNode key={`${relation.name}-${relation.relationship}`} name={relation.name} relationship={relation.relationship} />)}</div>
    {children.length > 0 && <TreeGeneration className="family-tree-generation--children" relations={children} />}
    {relatives.length > 0 && <div className="family-tree-relatives"><p>Extended family</p><div>{relatives.map((relation) => <TreeNode key={`${relation.name}-${relation.relationship}`} name={relation.name} relationship={relation.relationship} />)}</div></div>}
  </div>;
}

function TreeGeneration({ className, relations }: { className: string; relations: readonly CharacterRelation[] }) { return <div className={`family-tree-generation ${className}`}>{relations.map((relation) => <TreeNode key={`${relation.name}-${relation.relationship}`} name={relation.name} relationship={relation.relationship} />)}</div>; }
function TreeNode({ name, relationship, self = false }: { name: string; relationship: string; self?: boolean }) { return <div className={`family-tree-node${self ? " family-tree-node--self" : ""}`}><strong>{name}</strong><span>{relationship}</span></div>; }
function RelationCards({ relations, emptyLabel }: { relations: readonly CharacterRelation[]; emptyLabel: string }) { if (relations.length === 0) return <p className="character-detail-note">{emptyLabel}</p>; return <ul className="relation-cards">{relations.map((relation) => <li key={`${relation.name}-${relation.relationship}`}><strong>{relation.name}</strong><span>{relation.relationship}</span><p>{relation.notes}</p></li>)}</ul>; }
