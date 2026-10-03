"use client";

import { useEffect, useState, type ReactNode } from "react";
import { explanationOf, type MirrorReading, type MirrorRelation, type NotableEvent, type PeersReading, type PromiseReading } from "@chronica/shared";
import { Sheet, type SheetSide } from "../../../components/ui/sheet";
import { Era } from "../../../components/ui/era";
import { Tip, TipCard } from "../../../components/ui/tip";
import { Explains, Name } from "./notes";

type DetailKey = "story" | "relations" | "promises" | "peers";

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
  /** Open the strongbox, where the money is itemised. */
  readonly onOpenBooks?: (() => void) | undefined;
}

const DETAIL_TITLES: Record<DetailKey, string> = { story: "Since the opening", relations: "Key relations", promises: "Promises", peers: "Among your peers" };

function originLabel(origin: CharacterPanelProps["origin"]): string {
  return origin === "historical" ? "Historical figure" : origin === "hybrid" ? "Historical figure (extended)" : "Invented character";
}

function formatYear(year: number | null): string { return year === null ? "Unknown" : year < 0 ? `${Math.abs(year)} BCE` : `${year} CE`; }

/** Shown in a row while the room has not answered yet. */
const PENDING = "…";

/**
 * The bronze mirror: who the player is, as the world has it written down.
 *
 * One sheet, one line per thing. What each line means is in its note; only
 * the real lists (story, relations, promises, peers) open a page of their own.
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
  const { characterName, role, culture, origin, birthYearApprox, ageAtStart, mirror, story, promises, peers, onOpenChronicle, onOpenBooks, open, onClose, side } = props;
  const [detail, setDetail] = useState<DetailKey | null>(null);
  const yourPromises = promises.filter((promise) => promise.yours);
  const pressing = yourPromises.filter((promise) => promise.pressing).length;
  const authorityHoldings = mirror?.authority ?? [];
  const holdsAuthority = authorityHoldings.length > 0 && authorityHoldings[0] !== "No current public office";
  const traits = mirror?.traits ?? [];
  const skills = mirror?.skills ?? [];
  const reputationValue = mirror === null ? PENDING : traits[0] ?? mirror.standing;
  // The number every office's gate is written in, shown whatever he is known
  // for: it used to sit behind the first trait, so a man with any trait never
  // saw how far he stood from the quaestorship.
  const gates = mirror?.gates ?? [];
  const nextGate = gates.find((gate) => !gate.met);
  const relations = mirror?.relations ?? [];
  const family = relations.filter((relation) => relation.category === "family");
  const others = relations.filter((relation) => relation.category === "other");
  const moneyLabel = mirror === null ? PENDING : `${mirror.moneyBalance.toLocaleString()} ${mirror.currencyName}`;
  const title = mirror?.officeTitle ?? role;
  const ageNow = mirror?.ageNow ?? null;
  const alive = mirror?.alive ?? true;

  // Every time the mirror is picked up, it shows the whole person first.
  useEffect(() => { if (open) setDetail(null); }, [open]);

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
          <li>
            <NoteRow label="Location" value={mirror?.locationLabel ?? PENDING} kicker="Where you are" body={mirror?.polityLabel == null ? null : <p>You belong to {mirror.polityLabel}.</p>} />
          </li>
          <li>
            <NoteRow label="Culture" value={culture} kicker="Culture" body={<p>The people whose ways ground who you are and what you were raised on.</p>} />
          </li>
          <li>
            <NoteRow
              label="Money"
              value={moneyLabel}
              kicker="Your own purse"
              body={<>
                <p>What is in your personal account. The strongbox itemises it.</p>
                {onOpenBooks !== undefined && <button type="button" className="word-button" onClick={onOpenBooks}>Open your means</button>}
              </>}
            />
          </li>
          <li>
            <NoteRow
              label="Authority"
              value={holdsAuthority ? authorityHoldings[0]! : title}
              suffix={holdsAuthority && authorityHoldings.length > 1 ? `and ${authorityHoldings.length - 1} more` : undefined}
              kicker="What you hold"
              body={<>
                {holdsAuthority
                  ? <ul className="mirror__list">{authorityHoldings.map((entry) => <li key={entry}><strong>{entry}</strong></li>)}</ul>
                  : <p>No public office. {title}.</p>}
                {!holdsAuthority && props.declaredAuthority.length > 0 && <p>Reputed background, unverified: {props.declaredAuthority.join("; ")}</p>}
              </>}
            />
          </li>
          <li>
            <NoteRow
              label="Standing"
              value={mirror === null ? PENDING : mirror.standingFigure}
              suffix={nextGate === undefined ? undefined : `${nextGate.office} at ${nextGate.needed}`}
              kicker={mirror === null ? "Your standing" : capitalise(mirror.standing)}
              body={<>
                <p>What every office&apos;s gate is written in. Deeds in the field, a city taken, a year in office, games and feasts given raise it; defeats, lost elections and convictions lower it.</p>
                {gates.length > 0 && (
                  <ul className="mirror__list">
                    {gates.map((gate) => <li key={gate.office}><strong>{gate.office}</strong> {gate.needed}{gate.short === null ? ", within reach" : `, ${gate.short}`}</li>)}
                  </ul>
                )}
              </>}
            />
          </li>
          <li>
            <NoteRow
              label="Reputation"
              value={reputationValue}
              kicker={mirror?.standing ?? "Of no particular standing yet"}
              body={<>
                <section className="mirror__section">
                  <h4>Known for</h4>
                  {traits.length === 0
                    ? <p>Nobody has settled on what you are like yet. Two people have to say the same thing before it sticks.</p>
                    : <ul className="mirror__list">{traits.map((trait) => <li key={trait}><strong>{trait}</strong></li>)}</ul>}
                </section>
                {skills.length > 0 && (
                  <section className="mirror__section">
                    <h4>Said to be good at</h4>
                    <ul className="mirror__list">{skills.map((skill) => <li key={skill}><strong>{capitalise(skill)}</strong></li>)}</ul>
                  </section>
                )}
              </>}
            />
          </li>
          <li>
            <NoteRow
              label="Origin"
              value={originLabel(origin)}
              kicker="Origin"
              body={<>
                <dl className="mirror__facts">
                  {ageNow !== null && <><dt>{alive ? "Age now" : "Age at death"}</dt><dd>About {ageNow}</dd></>}
                  <dt>Age at the opening</dt><dd>{ageAtStart === null ? "Unknown" : `About ${ageAtStart}`}</dd>
                  <dt>Born</dt><dd>{formatYear(birthYearApprox)}</dd>
                </dl>
                {props.biography.length > 0 && <p>{props.biography}</p>}
                {props.notableEvents.length > 0 && <ul className="mirror__list">{props.notableEvents.map((event) => <li key={event}><strong>{event}</strong></li>)}</ul>}
              </>}
            />
          </li>
          <li><Row label="Since the opening" value={story === null ? PENDING : story[0]?.line ?? "Nothing yet"} suffix={story !== null && story.length > 1 ? `and ${story.length - 1} more` : undefined} onClick={() => setDetail("story")} /></li>
          <li><Row label="Key relations" value={mirror === null ? PENDING : relations.length === 0 ? "None recorded" : `${relations.length} named people`} onClick={() => setDetail("relations")} /></li>
          {peers !== null && (
            <li><Row label="Among your peers" value={peers.lines[0]?.label ?? peers.among} onClick={() => setDetail("peers")} /></li>
          )}
          {promises.length > 0 && (
            <li>
              <Row
                label="Promises"
                value={yourPromises.length === 0 ? `${promises.length} made to you` : `${yourPromises.length} you have made`}
                suffix={pressing > 0 ? `${pressing} due soon` : undefined}
                marked={pressing > 0}
                onClick={() => setDetail("promises")}
              />
            </li>
          )}
        </ul>
      ) : (
        <section className="mirror__detail" aria-label={`${DETAIL_TITLES[detail]} details`}>
          <button type="button" className="word-button mirror__back" onClick={() => setDetail(null)}>Back to {characterName}</button>
          <h3>{detail === "promises" ? <Explains k="rule:promise">{DETAIL_TITLES[detail]}</Explains> : DETAIL_TITLES[detail]}</h3>
          {detail === "promises" && <PromisesDetail promises={promises} />}
          {detail === "peers" && peers !== null && (
            <dl className="mirror__peers">
              {peers.lines.map((line) => <div key={line.aspect}><dt>{line.aspect}</dt><dd>{capitalise(line.label)}</dd></div>)}
            </dl>
          )}
          {detail === "story" && <StoryDetail story={story ?? []} onOpenChronicle={onOpenChronicle} />}
          {detail === "relations" && <RelationsDetail family={family} others={others} />}
        </section>
      )}
    </Sheet>
  );
}

/** A line that opens a page of its own: only for a real list. */
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

/** A line that says what is so; what it means is in the note behind its value. */
function NoteRow({ label, value, suffix, kicker, body }: { label: string; value: string; suffix?: string | undefined; kicker: string; body: ReactNode }) {
  return (
    <div className="mirror__row">
      <span>{label}</span>
      <Tip label={label} note={() => <TipCard kicker={kicker} title={value}>{body}</TipCard>}><strong>{value}</strong></Tip>
      {suffix !== undefined ? <em>{suffix}</em> : <em aria-hidden="true" />}
    </div>
  );
}

/** What the player has promised and been promised. A promise of theirs falling due within a fortnight is marked. */
function PromisesDetail({ promises }: { promises: readonly PromiseReading[] }) {
  return (
    <ul className="mirror__list">
      {promises.map((promise) => (
        <li key={promise.id} className={promise.pressing ? "is-pressing" : undefined}>
          <span>{promise.between}{promise.dueLabel !== null && <>, to be kept by <Era text={promise.dueLabel} /></>}</span>
          <strong>{promise.description}</strong>
          {promise.conditions !== null && <span>{promise.conditions}</span>}
        </li>
      ))}
    </ul>
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
      ? <p className="mirror__note">Nothing yet.</p>
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

/** Family first, then the rest; each name opens its note where the glossary has one. */
function RelationsDetail({ family, others }: { family: readonly MirrorRelation[]; others: readonly MirrorRelation[] }) {
  const all = [...family, ...others];
  if (all.length === 0) return <p className="mirror__note">Nobody yet.</p>;
  return <ul className="mirror__list">{all.map((relation) => (
    <li key={relation.characterId} className={relation.alive ? undefined : "is-dead"}>
      <strong><Name k={`person:${relation.characterId}`}>{relation.name}</Name></strong>
      <span>{kinLine(relation)}{relation.alive && relation.regard !== null && REGARD_WORDS[relation.regard] !== undefined ? `. ${REGARD_WORDS[relation.regard]}` : ""}</span>
      {relation.notes.length > 0 && <span>{relation.notes}</span>}
    </li>
  ))}</ul>;
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

const capitalise = (text: string): string => (text.length === 0 ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`);
