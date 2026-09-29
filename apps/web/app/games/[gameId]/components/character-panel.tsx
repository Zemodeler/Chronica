"use client";

import { useEffect, useRef, useState } from "react";
import { explanationOf, type MirrorFamilyRole, type MirrorMoneyChange, type MirrorReading, type MirrorRelation, type NotableEvent, type PeersReading, type PromiseReading } from "@chronica/shared";
import { Sheet, type SheetSide } from "../../../components/ui/sheet";
import { Era } from "../../../components/ui/era";

type RelationCategory = "family" | "other";
type FamilyView = "tree" | "list";
type DetailKey = "location" | "culture" | "money" | "authority" | "reputation" | "origin" | "story" | "relations" | "promises" | "peers";

/**
 * What the declaration is the authority on: who the character was before the
 * game began. Everything that can change arrives as a `MirrorReading` with the
 * room (room-service.ts), so the mirror follows the world rather than the
 * moment the page was loaded.
 */
export interface CharacterPanelProps {
  readonly characterName: string;
  /** The declared role, shown until the world gives him an office. */
  readonly role: string;
  readonly culture: string;
  readonly origin: "historical" | "invented" | "hybrid";
  readonly birthYearApprox: number | null;
  readonly ageAtStart: number | null;
  readonly biography: string;
  readonly notableEvents: readonly string[];
  /** Free-text authority claims from the declaration: background only, never a source of power. */
  readonly declaredAuthority: readonly string[];
}

const DETAIL_TITLES: Record<DetailKey, string> = { location: "Location", culture: "Culture", money: "Money", authority: "Authority", reputation: "Reputation", origin: "Origin", story: "Since the opening", relations: "Key relations", promises: "Promises", peers: "Among your peers" };

function originLabel(origin: CharacterPanelProps["origin"]): string {
  return origin === "historical" ? "Historical figure" : origin === "hybrid" ? "Historical figure (extended)" : "Invented character";
}

function formatYear(year: number | null): string { return year === null ? "Unknown" : year < 0 ? `${Math.abs(year)} BCE` : `${year} CE`; }

/** Shown in a row while the room has not answered yet. */
const PENDING = "…";

/**
 * The bronze mirror: who the player is, as the world has it written down.
 *
 * One sheet. The rows are the summary; choosing one opens its detail in the
 * same sheet, with a way back, rather than a second panel pinned beside the
 * first.
 */
export function CharacterPanel(props: CharacterPanelProps & {
  readonly mirror: MirrorReading | null;
  /** What has happened to him since the opening (life-story.ts); null until the room answers. */
  readonly story: readonly NotableEvent[] | null;
  /** Open promises either way, from the room (`promisesOf`). */
  readonly promises: readonly PromiseReading[];
  /** Where he stands among those who hold or held what he holds (`peersOf`). */
  readonly peers: PeersReading | null;
  /** Open the Chronicle filtered to him, at one entry or at the top. */
  readonly onOpenChronicle: (entryId: string | null) => void;
  readonly gameId: string; readonly open: boolean; readonly onClose: () => void; readonly side: SheetSide }) {
  const { characterName, role, culture, origin, birthYearApprox, ageAtStart, mirror, story, promises, peers, onOpenChronicle, open, onClose, side } = props;
  const [detail, setDetail] = useState<DetailKey | null>(null);
  const yourPromises = promises.filter((promise) => promise.yours);
  const pressing = yourPromises.filter((promise) => promise.pressing).length;
  const [relationsTab, setRelationsTab] = useState<RelationCategory>("family");
  const [familyView, setFamilyView] = useState<FamilyView>("tree");
  const [birthYearOpen, setBirthYearOpen] = useState(false);
  const authorityHoldings = mirror?.authority ?? [];
  const holdsAuthority = authorityHoldings.length > 0 && authorityHoldings[0] !== "No current public office";
  const traits = mirror?.traits ?? [];
  const skills = mirror?.skills ?? [];
  const reputationValue = mirror === null ? PENDING : traits[0] ?? mirror.standing;
  const relations = mirror?.relations ?? [];
  const family = relations.filter((relation) => relation.category === "family");
  const others = relations.filter((relation) => relation.category === "other");
  const moneyLabel = mirror === null ? PENDING : `${mirror.moneyBalance.toLocaleString()} ${mirror.currencyName}`;
  const title = mirror?.officeTitle ?? role;

  // Every time the mirror is picked up, it shows the whole person first.
  useEffect(() => { if (open) setDetail(null); }, [open]);

  function openDetail(next: DetailKey) { if (next === "relations") setRelationsTab(family.length > 0 ? "family" : "other"); setDetail(next); }

  return (
    <Sheet
      label={`${characterName}'s character sheet`}
      title={characterName}
      subtitle={mirror !== null && !mirror.alive ? `${title}, now dead` : title}
      width="ledger"
      side={side}
      open={open}
      onClose={onClose}
      className="character-sheet"
    >
      {detail === null ? (
        <ul className="mirror__rows">
          <li><Row label="Location" value={mirror?.locationLabel ?? PENDING} onClick={() => openDetail("location")} /></li>
          <li><Row label="Culture" value={culture} onClick={() => openDetail("culture")} /></li>
          <li><Row label="Money" value={moneyLabel} onClick={() => openDetail("money")} /></li>
          <li><Row label="Authority" value={holdsAuthority ? authorityHoldings[0]! : title} suffix={holdsAuthority && authorityHoldings.length > 1 ? `and ${authorityHoldings.length - 1} more` : undefined} onClick={() => openDetail("authority")} /></li>
          <li><Row label="Reputation" value={reputationValue} onClick={() => openDetail("reputation")} /></li>
          <li><Row label="Origin" value={originLabel(origin)} onClick={() => openDetail("origin")} /></li>
          <li><Row label="Since the opening" value={story === null ? PENDING : story[0]?.line ?? "Nothing yet"} suffix={story !== null && story.length > 1 ? `and ${story.length - 1} more` : undefined} onClick={() => openDetail("story")} /></li>
          <li><Row label="Key relations" value={mirror === null ? PENDING : relations.length === 0 ? "None recorded" : `${relations.length} named people`} onClick={() => openDetail("relations")} /></li>
          {peers !== null && (
            <li><Row label="Among your peers" value={peers.lines[0]?.label ?? peers.among} onClick={() => openDetail("peers")} /></li>
          )}
          {promises.length > 0 && (
            <li>
              <Row
                label="Promises"
                value={yourPromises.length === 0 ? `${promises.length} made to you` : `${yourPromises.length} you have made`}
                suffix={pressing > 0 ? `${pressing} due soon` : undefined}
                marked={pressing > 0}
                onClick={() => openDetail("promises")}
              />
            </li>
          )}
        </ul>
      ) : (
        <section className="mirror__detail" aria-label={`${DETAIL_TITLES[detail]} details`}>
          <button type="button" className="word-button mirror__back" onClick={() => setDetail(null)}>Back to {characterName}</button>
          <h3>{DETAIL_TITLES[detail]}</h3>
          {detail === "location" && <><p className="mirror__value">{mirror?.locationLabel ?? PENDING}</p><p className="mirror__note">{mirror?.polityLabel == null ? "Where you are now." : `Where you are now. You belong to ${mirror.polityLabel}.`}</p></>}
          {detail === "culture" && <><p className="mirror__value">{culture}</p><p className="mirror__note">The cultural context used to ground this character’s identity and history.</p></>}
          {detail === "money" && <MoneyDetail moneyLabel={moneyLabel} balance={mirror?.moneyBalance ?? 0} changes={mirror?.moneyChanges ?? []} />}
          {detail === "authority" && <AuthorityDetail role={title} authority={holdsAuthority ? authorityHoldings : []} backgroundNote={holdsAuthority ? [] : props.declaredAuthority} />}
          {detail === "reputation" && <ReputationDetail traits={traits} standing={mirror?.standing ?? null} skills={skills} />}
          {detail === "origin" && <OriginDetail origin={origin} ageAtStart={ageAtStart} ageNow={mirror?.ageNow ?? null} alive={mirror?.alive ?? true} birthYearApprox={birthYearApprox} biography={props.biography} notableEvents={props.notableEvents} birthYearOpen={birthYearOpen} onToggleBirthYear={() => setBirthYearOpen((current) => !current)} />}
          {detail === "promises" && <PromisesDetail promises={promises} />}
          {detail === "peers" && peers !== null && (
            <>
              <p className="mirror__note">{peers.among}: {peers.count === 1 ? "one other" : `${peers.count} others`}.</p>
              <dl className="mirror__peers">
                {peers.lines.map((line) => <div key={line.aspect}><dt>{line.aspect}</dt><dd>{capitalise(line.label)}</dd></div>)}
              </dl>
            </>
          )}
          {detail === "story" && <StoryDetail story={story ?? []} onOpenChronicle={onOpenChronicle} />}
          {detail === "relations" && <RelationsDetail family={family} others={others} tab={relationsTab} onTabChange={setRelationsTab} familyView={familyView} onFamilyViewChange={setFamilyView} />}
        </section>
      )}
    </Sheet>
  );
}

function Row({ label, value, suffix, marked = false, onClick }: { label: string; value: string; suffix?: string | undefined; marked?: boolean; onClick: () => void }) {
  return (
    <button type="button" className="mirror__row" onClick={onClick}>
      <span>{label}</span>
      <strong>{value}</strong>
      {suffix !== undefined
        ? <em className={marked ? "is-pressing" : undefined}>{marked && <span className="seal-dot" aria-hidden="true" />} {suffix}</em>
        : <em aria-hidden="true" />}
    </button>
  );
}

/**
 * What the player has promised and been promised. A promise of theirs falling
 * due within a fortnight is marked: the world holds them to it.
 */
function PromisesDetail({ promises }: { promises: readonly PromiseReading[] }) {
  return (
    <>
      <p className="mirror__note">{explanationOf("rule:promise")?.text}</p>
      <ul className="mirror__list">
        {promises.map((promise) => (
          <li key={promise.id} className={promise.pressing ? "is-pressing" : undefined}>
            <span>{promise.between}{promise.dueLabel !== null && <>, to be kept by <Era text={promise.dueLabel} /></>}</span>
            <strong>{promise.description}</strong>
            {promise.conditions !== null && <span>{promise.conditions}</span>}
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * His life since the game began: Chronicle entries about him or his close
 * family, and the milestones the world keeps whether or not a historian wrote
 * them up. An entry opens where it stands in the record.
 */
function StoryDetail({ story, onOpenChronicle }: { story: readonly NotableEvent[]; onOpenChronicle: (entryId: string | null) => void }) {
  return <>
    {story.length === 0
      ? <p className="mirror__note">Nothing has happened to you yet that anyone has written down.</p>
      : <ul className="mirror__list mirror__story">{story.map((event) => (
        <li key={event.key} className={event.whose === "family" ? "is-family" : undefined}>
          <span><Era text={event.whenLabel} /></span>
          {event.chronicleEntryId === null
            ? <strong>{event.line}</strong>
            : <button type="button" className="word-button" onClick={() => onOpenChronicle(event.chronicleEntryId)}><strong>{event.line}</strong></button>}
        </li>
      ))}</ul>}
    <button type="button" className="word-button" onClick={() => onOpenChronicle(null)}>Everything the Chronicle says of you</button>
  </>;
}

function MoneyDetail({ moneyLabel, balance, changes }: { moneyLabel: string; balance: number; changes: readonly MirrorMoneyChange[] }) {
  const recent = changes.slice(-5);
  const start = balance - recent.reduce((total, change) => total + change.amount, 0);
  const balances = recent.reduce<number[]>((series, change) => [...series, (series.at(-1) ?? start) + change.amount], [start]);
  return <>
    <p className="mirror__value">{moneyLabel}</p>
    <BalanceGraph balances={balances} hasChanges={changes.length > 0} />
    {changes.length > 0 && <ul className="mirror__list">{recent.map((change) => <li key={change.id}><strong>{change.amount >= 0 ? "+" : "−"}{Math.abs(change.amount).toLocaleString()}</strong><span>{change.label}, {change.whenLabel}</span></li>)}</ul>}
    <p className="mirror__note">{changes.length === 0 ? "The graph will gain history as transactions occur." : "Balance history is shown from your personal-account transactions."}</p>
  </>;
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
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.beginPath();
      for (const [index, value] of balances.entries()) {
        const point = pointAt(value, index);
        if (index === 0) ctx.moveTo(point.x, point.y); else ctx.lineTo(point.x, point.y);
      }
      ctx.stroke();
      const end = pointAt(balances.at(-1) ?? 0, balances.length - 1);
      ctx.beginPath(); ctx.arc(end.x, end.y, 4, 0, Math.PI * 2); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
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
    <p className="mirror__value">{role}</p>
    <ul className="mirror__list">{entries.map((entry) => <li key={entry}><strong>{entry}</strong></li>)}</ul>
    {backgroundNote.length > 0 && <p className="mirror__note">Reputed background, unverified: {backgroundNote.join("; ")}</p>}
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
    <p className="mirror__value">{standing ?? "Of no particular standing yet"}</p>
    <section className="mirror__section">
      <h4>Known for</h4>
      {traits.length === 0
        ? <p className="mirror__note">Nobody has settled on what you are like yet. Two people have to say the same thing before it sticks.</p>
        : <ul className="mirror__list">{traits.map((trait) => <li key={trait}><strong>{trait}</strong></li>)}</ul>}
    </section>
    <section className="mirror__section">
      <h4>What they say you are good at</h4>
      {skills.length === 0
        ? <p className="mirror__note">Not yet established.</p>
        : <ul className="mirror__list">{skills.map((skill) => <li key={skill}><strong>{skill.charAt(0).toUpperCase()}{skill.slice(1)}</strong></li>)}</ul>}
    </section>
  </>;
}

function OriginDetail({ origin, ageAtStart, ageNow, alive, birthYearApprox, biography, notableEvents, birthYearOpen, onToggleBirthYear }: { origin: CharacterPanelProps["origin"]; ageAtStart: number | null; ageNow: number | null; alive: boolean; birthYearApprox: number | null; biography: string; notableEvents: readonly string[]; birthYearOpen: boolean; onToggleBirthYear: () => void }) {
  return <>
    <p className="mirror__value">{originLabel(origin)}</p>
    <dl className="mirror__facts">
      {ageNow !== null && <><dt>{alive ? "Age now" : "Age at death"}</dt><dd>About {ageNow}</dd></>}
      <dt>Age at the opening</dt><dd>{ageAtStart === null ? "Unknown" : `About ${ageAtStart}`}</dd>
      <dt>Born</dt>
      <dd>
        {birthYearOpen
          ? formatYear(birthYearApprox)
          : <button type="button" className="word-button" onClick={onToggleBirthYear} aria-expanded={birthYearOpen}>Show the year</button>}
      </dd>
    </dl>
    <section className="mirror__section"><h4>Backstory</h4><p>{biography}</p></section>
    {notableEvents.length > 0 && <section className="mirror__section"><h4>Before the opening</h4><ul className="mirror__list">{notableEvents.map((event) => <li key={event}><strong>{event}</strong></li>)}</ul></section>}
  </>;
}

function RelationsDetail({ family, others, tab, onTabChange, familyView, onFamilyViewChange }: { family: readonly MirrorRelation[]; others: readonly MirrorRelation[]; tab: RelationCategory; onTabChange: (tab: RelationCategory) => void; familyView: FamilyView; onFamilyViewChange: (view: FamilyView) => void }) {
  return <>
    <div className="mirror__tabs" role="tablist" aria-label="Key relation categories">
      <button type="button" role="tab" aria-selected={tab === "family"} onClick={() => onTabChange("family")}>Family ({family.length})</button>
      <button type="button" role="tab" aria-selected={tab === "other"} onClick={() => onTabChange("other")}>Others ({others.length})</button>
    </div>
    {tab === "family" && <div className="mirror__toggle" role="group" aria-label="Family view"><button type="button" aria-pressed={familyView === "tree"} onClick={() => onFamilyViewChange("tree")}>Family tree</button><button type="button" aria-pressed={familyView === "list"} onClick={() => onFamilyViewChange("list")}>List</button></div>}
    {tab === "family" ? familyView === "tree" ? <FamilyTree relations={family} /> : <RelationList relations={family} emptyLabel="No family members are recorded." /> : <RelationList relations={others} emptyLabel="Nobody outside your family has had dealings with you yet." />}
  </>;
}

/** Your own view of them (`opinionLabel`), as a sentence. Neutral says nothing. */
const REGARD_WORDS: Readonly<Record<string, string>> = {
  hostile: "You are hostile to them",
  distrustful: "You distrust them",
  friendly: "You are well disposed to them",
  devoted: "You are devoted to them",
};

/** "Your brother", and "died" beside him once he has. */
const kinLine = (relation: MirrorRelation): string => (relation.alive ? relation.relationship : `${relation.relationship}, died`);

function FamilyTree({ relations }: { relations: readonly MirrorRelation[] }) {
  if (relations.length === 0) return <p className="mirror__note">No family members are recorded.</p>;
  const byRole = (role: MirrorFamilyRole) => relations.filter((relation) => (relation.familyRole ?? "other_relative") === role);
  const parents = byRole("parent"); const partners = byRole("partner"); const siblings = byRole("sibling"); const children = byRole("child"); const relatives = byRole("other_relative");
  return <div className="family-tree-diagram" aria-label="Family tree">
    {parents.length > 0 && <TreeGeneration className="family-tree-generation--parents" relations={parents} />}
    <div className="family-tree-generation family-tree-generation--focus"><TreeNode name="You" relationship="Your character" self />{[...siblings, ...partners].map((relation) => <TreeNode key={relation.characterId} name={relation.name} relationship={kinLine(relation)} dead={!relation.alive} />)}</div>
    {children.length > 0 && <TreeGeneration className="family-tree-generation--children" relations={children} />}
    {relatives.length > 0 && <div className="family-tree-relatives"><p>Extended family</p><div>{relatives.map((relation) => <TreeNode key={relation.characterId} name={relation.name} relationship={kinLine(relation)} dead={!relation.alive} />)}</div></div>}
  </div>;
}

function TreeGeneration({ className, relations }: { className: string; relations: readonly MirrorRelation[] }) { return <div className={`family-tree-generation ${className}`}>{relations.map((relation) => <TreeNode key={relation.characterId} name={relation.name} relationship={kinLine(relation)} dead={!relation.alive} />)}</div>; }
function TreeNode({ name, relationship, self = false, dead = false }: { name: string; relationship: string; self?: boolean; dead?: boolean }) { return <div className={`family-tree-node${self ? " family-tree-node--self" : ""}${dead ? " is-dead" : ""}`}><strong>{name}</strong><span>{relationship}</span></div>; }
function RelationList({ relations, emptyLabel }: { relations: readonly MirrorRelation[]; emptyLabel: string }) {
  if (relations.length === 0) return <p className="mirror__note">{emptyLabel}</p>;
  return <ul className="mirror__list">{relations.map((relation) => (
    <li key={relation.characterId} className={relation.alive ? undefined : "is-dead"}>
      <strong>{relation.name}</strong>
      <span>{kinLine(relation)}{relation.alive && relation.regard !== null && REGARD_WORDS[relation.regard] !== undefined ? `. ${REGARD_WORDS[relation.regard]}` : ""}</span>
      {relation.notes.length > 0 && <span>{relation.notes}</span>}
    </li>
  ))}</ul>;
}

const capitalise = (text: string): string => (text.length === 0 ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`);
