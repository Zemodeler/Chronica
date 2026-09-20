"use client";

import { useEffect, useRef, useState } from "react";

type RelationCategory = "family" | "other";
type FamilyRole = "parent" | "partner" | "sibling" | "child" | "other_relative";
type FamilyView = "tree" | "list";
type DetailKey = "location" | "culture" | "money" | "authority" | "reputation" | "origin" | "relations";

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
  /** Legacy free-text authority claims, shown only as background -- never a source of mechanical power. */
  readonly authorityBackgroundNote?: readonly string[];
  /**
   * Who the world thinks this person is (slice 11): the traits others have
   * settled on, how they are held, and what they are good at -- in words.
   * Never scores: a number invites optimisation and a person does not have one.
   */
  readonly traits?: readonly string[];
  readonly standing?: string | null;
  readonly skills?: readonly string[];
}

const DETAIL_TITLES: Record<DetailKey, string> = { location: "Location", culture: "Culture", money: "Money", authority: "Authority", reputation: "Reputation", origin: "Origin", relations: "Key Relations" };
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
  const traits = props.traits ?? [];
  const skills = props.skills ?? [];
  const reputationValue = traits[0] ?? props.standing ?? "Not yet established";
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
          <FieldButton label="Reputation" value={reputationValue} onClick={() => openDetail("reputation")} />
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
          {detail === "authority" && <AuthorityDetail role={role} authority={authorityHoldings} backgroundNote={props.authorityBackgroundNote ?? []} />}
          {detail === "reputation" && <ReputationDetail traits={traits} standing={props.standing ?? null} skills={skills} />}
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
  return <><p className="character-detail-value">{moneyLabel}</p><BalanceGraph balances={balances} hasChanges={changes.length > 0} />{changes.length > 0 && <ul className="character-detail-list">{recent.map((change) => <li key={change.id}><strong>{change.amount >= 0 ? "+" : ""}{change.amount.toLocaleString()}</strong><span>{change.label} · {change.whenLabel}</span></li>)}</ul>}<p className="character-detail-note">{changes.length === 0 ? "The graph will gain history as transactions occur." : "Balance history is shown from your personal-account transactions."}</p></>;
}

function BalanceGraph({ balances, hasChanges }: { balances: readonly number[]; hasChanges: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width === 0 || height === 0) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const low = Math.min(...balances); const high = Math.max(...balances); const range = high - low || 1;
      const pointAt = (value: number, index: number) => ({ x: 12 + index * ((width - 24) / Math.max(1, balances.length - 1)), y: hasChanges ? height - 14 - ((value - low) / range) * (height - 28) : height / 2 });
      ctx.strokeStyle = getComputedStyle(canvas).color;
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      for (const [index, value] of balances.entries()) {
        const point = pointAt(value, index);
        if (index === 0) ctx.moveTo(point.x, point.y); else ctx.lineTo(point.x, point.y);
      }
      ctx.stroke();
      const end = pointAt(balances.at(-1) ?? 0, balances.length - 1);
      ctx.beginPath(); ctx.arc(end.x, end.y, 5, 0, Math.PI * 2); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
    };
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    draw();
    return () => observer.disconnect();
  }, [balances, hasChanges]);
  return <div className="money-graph"><canvas ref={canvasRef} role="img" aria-label={hasChanges ? "Recent balance changes" : "Current balance only"} /><span>{hasChanges ? "Recent account movement" : "No balance history yet"}</span></div>;
}

function AuthorityDetail({ role, authority, backgroundNote }: { role: string; authority: readonly string[]; backgroundNote: readonly string[] }) {
  const entries = authority.length > 0 ? authority : [role];
  return <>
    <p className="character-detail-value">{role}</p>
    <ul className="character-detail-list">{entries.map((entry) => <li key={entry}><strong>{entry}</strong></li>)}</ul>
    {backgroundNote.length > 0 && <p className="character-detail-note">Reputed background (unverified): {backgroundNote.join("; ")}</p>}
  </>;
}
/**
 * What the world would say of this person, rather than what a sheet would.
 *
 * Every line here is words. The route's own comment used to say raw skill
 * data may never cross the boundary, and the effect was that the panel could
 * tell a player nothing about their own abilities; the numbers still do not
 * cross, and the judgment now does.
 */
function ReputationDetail({ traits, standing, skills }: { traits: readonly string[]; standing: string | null; skills: readonly string[] }) {
  return <>
    <p className="character-detail-value">{standing ?? "Of no particular standing yet"}</p>
    <section className="origin-backstory">
      <h4>Known for</h4>
      {traits.length === 0
        ? <p className="character-detail-note">Nobody has settled on what you are like yet. Two people have to say the same thing before it sticks.</p>
        : <ul className="character-detail-list">{traits.map((trait) => <li key={trait}><strong>{trait}</strong></li>)}</ul>}
    </section>
    <section className="origin-backstory">
      <h4>What they say you are good at</h4>
      {skills.length === 0
        ? <p className="character-detail-note">Not yet established.</p>
        : <ul className="character-detail-list">{skills.map((skill) => <li key={skill}><strong>{skill.charAt(0).toUpperCase()}{skill.slice(1)}</strong></li>)}</ul>}
    </section>
  </>;
}

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
