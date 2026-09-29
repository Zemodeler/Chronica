"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { THREAD_PHASES, explanationOf, type EntityKey, type EntityNote, type Glossary, type Linked, type SourceReading, type ThreadNote, type WhyReading } from "@chronica/shared";
import { Tip, TipCard } from "../../../components/ui/tip";

/**
 * A note for every name, from the glossary the room brings (`readGlossary`).
 *
 * `<Name k="person:…">` looks its key up and opens the note for that kind.
 * A name the glossary has no note for is plain words. That is the rule that
 * keeps notes honest: the server sends a note only for what the viewer's
 * station reaches, and the client cannot make one up.
 */

const GlossaryContext = createContext<Glossary>({});

/** The threads of history the player may know of, and what can be done with one. */
export interface ThreadsView {
  readonly threads: Readonly<Record<string, ThreadNote>>;
  readonly onFollow: (storylineId: string, followed: boolean) => void;
  /** Open the Chronicle at one entry. */
  readonly onOpenEntry: (entryId: string) => void;
}

const NO_THREADS: ThreadsView = { threads: {}, onFollow: () => undefined, onOpenEntry: () => undefined };

/**
 * What a word means, in the note where it is met (`explanations.ts`). Fixed
 * text; nothing where there is none.
 */
export function Explained({ k }: { readonly k: string | null | undefined }) {
  const entry = explanationOf(k);
  if (entry === null) return null;
  return (
    <div className="tip__rule tip__explained">
      <p className="tip__kicker">{entry.title}</p>
      <p>{entry.text}</p>
    </div>
  );
}

/** A heading or a word with its rule behind it: "Before the councils", and what a vote carried does. */
export function Explains({ k, children }: { readonly k: string; readonly children: ReactNode }) {
  const entry = explanationOf(k);
  if (entry === null) return <>{children}</>;
  return (
    <Tip label={entry.title} note={() => <TipCard kicker="How it works" title={entry.title}><p>{entry.text}</p></TipCard>}>
      {children}
    </Tip>
  );
}

const ThreadsContext = createContext<ThreadsView>(NO_THREADS);

export function GlossaryProvider({ glossary, threads, children }: { readonly glossary: Glossary; readonly threads?: ThreadsView; readonly children: ReactNode }) {
  return (
    <GlossaryContext.Provider value={glossary}>
      <ThreadsContext.Provider value={threads ?? NO_THREADS}>{children}</ThreadsContext.Provider>
    </GlossaryContext.Provider>
  );
}

export const useThreads = (): ThreadsView => useContext(ThreadsContext);

/** A thread's name, with its note behind it. Plain words for a thread the player may not know of. */
export function ThreadName({ id, children }: { readonly id: string; readonly children?: ReactNode }) {
  const { threads } = useThreads();
  const thread = threads[id];
  if (thread === undefined) return <>{children ?? null}</>;
  return <Tip label={thread.title} note={() => <ThreadCard thread={thread} />}>{children ?? thread.title}</Tip>;
}

/**
 * A thread of history: how far it has gone, who is in it, and what the
 * Chronicle has said of it. Only the Chronicle (`threadsYouSee`).
 */
export function ThreadCard({ thread }: { readonly thread: ThreadNote }) {
  const { onFollow, onOpenEntry } = useThreads();
  return (
    <TipCard kicker={thread.followed ? "A thread · you follow it" : "A thread of history"} title={thread.title}>
      <ol className="thread__phases" aria-label={`It is ${thread.phaseLabel}`}>
        {THREAD_PHASES.map((phase) => (
          <li key={phase} data-on={phase === thread.phase ? "true" : undefined}>{phase === thread.phase ? thread.phaseLabel : ""}</li>
        ))}
      </ol>
      {thread.stakes !== null && <p>At stake: {thread.stakes}</p>}
      {thread.who.length > 0 && <p>In it: <LinkedNames items={thread.who} />.</p>}
      {thread.history.length > 0 && (
        <ul className="thread__history tip__rule">
          {thread.history.map((line) => (
            <li key={line.entryId}>
              <button type="button" className="thread__entry" onClick={() => onOpenEntry(line.entryId)}>
                {line.dateLabel !== null && <time>{line.dateLabel}</time>}
                <span>{line.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {thread.unread > 0 && <p className="tip__source">{thread.unread === 1 ? "One entry of it you have not read." : `${thread.unread} entries of it you have not read.`}</p>}
      <p className="tip__source">{thread.history.length === 0 ? "The Chronicle has told you nothing of it yet." : "From the Chronicle."}</p>
      <button type="button" className="thread__follow" onClick={() => onFollow(thread.id, !thread.followed)}>
        {thread.followed ? "Stop following" : "Follow this thread"}
      </button>
    </TipCard>
  );
}

/** Followed threads, as marks beside the date: a seal on one with news unread. */
export function ThreadMarks() {
  const { threads } = useThreads();
  const followed = Object.values(threads).filter((thread) => thread.followed);
  if (followed.length === 0) return null;
  return (
    <ul className="thread-marks" aria-label="Threads you follow">
      {followed.map((thread) => (
        <li key={thread.id}>
          <Tip label={thread.title} className="thread-mark" note={() => <ThreadCard thread={thread} />}>
            {thread.unread > 0 && <span className="seal-dot"><span className="visually-hidden">News unread: </span></span>}
            <span className="thread-mark__title">{thread.title}</span>
          </Tip>
        </li>
      ))}
    </ul>
  );
}

export const useGlossary = (): Glossary => useContext(GlossaryContext);

/**
 * Every name the glossary has a note for, as one pattern, longest first so
 * "Gaius Genucius Clepsina" wins over "Gaius". A label two notes share is
 * left out: a name that could mean either opens neither.
 */
function useNameIndex(): { readonly pattern: RegExp | null; readonly keyOf: ReadonlyMap<string, EntityKey> } {
  const glossary = useGlossary();
  return useMemo(() => {
    const counts = new Map<string, number>();
    const keyOf = new Map<string, EntityKey>();
    for (const [key, note] of Object.entries(glossary) as [EntityKey, EntityNote | undefined][]) {
      if (note === undefined || note.name.length < 3) continue;
      counts.set(note.name, (counts.get(note.name) ?? 0) + 1);
      keyOf.set(note.name, key);
    }
    for (const [name, count] of counts) if (count > 1) keyOf.delete(name);
    const names = [...keyOf.keys()].sort((a, b) => b.length - a.length);
    if (names.length === 0) return { pattern: null, keyOf };
    const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return { pattern: new RegExp(`(?<![\\p{L}])(${escaped.join("|")})(?![\\p{L}])`, "gu"), keyOf };
  }, [glossary]);
}

/**
 * Words with every name in them that has a note made askable: the
 * Chronicle's prose, a muster line, a list of holders. Only names the
 * glossary holds are matched, so this can link nothing the viewer's station
 * does not reach.
 */
export function Linkify({ text }: { readonly text: string }) {
  const { pattern, keyOf } = useNameIndex();
  if (pattern === null) return <>{text}</>;
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(<Name key={`${at}-${match[0]}`} k={keyOf.get(match[0])}>{match[0]}</Name>);
    last = at + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

export function Name({ k, children }: { readonly k: EntityKey | null | undefined; readonly children: ReactNode }) {
  const glossary = useGlossary();
  const note = k === null || k === undefined ? undefined : glossary[k];
  if (note === undefined) return <>{children}</>;
  return <Tip label={note.name} note={() => <NoteCard note={note} />}>{children}</Tip>;
}

/** A linked name: a note of its own when there is one, its words when not. */
export function LinkedName({ linked }: { readonly linked: Linked | null }) {
  if (linked === null) return null;
  return <Name k={linked.key}>{linked.label}</Name>;
}

/** Several names in a sentence: "A, B and C". */
export function LinkedNames({ items }: { readonly items: readonly Linked[] }) {
  return (
    <>
      {items.map((item, index) => (
        <span key={`${item.key ?? item.label}-${index}`}>
          {index > 0 && (index === items.length - 1 ? " and " : ", ")}
          <LinkedName linked={item} />
        </span>
      ))}
    </>
  );
}

/**
 * A judgement with its causes behind it: "sullen", and why. Plain words when
 * there are no causes to give.
 */
export function Why({ word, why, kicker, children }: { readonly word: string; readonly why: WhyReading | null; readonly kicker?: string; readonly children?: ReactNode }) {
  if (why === null || why.causes.length === 0) return <>{children ?? word}</>;
  return (
    <Tip label={`Why ${word}`} note={() => (
      <TipCard kicker={kicker ?? "Why it is"} title={capitalise(word)}>
        <ul className="why">
          {why.causes.map((cause, index) => <li key={index} data-tone={cause.tone}><Linkify text={cause.label} /></li>)}
        </ul>
        {why.remedy !== null && <p className="tip__rule">{why.remedy}</p>}
        <Explained k={why.explainedBy} />
      </TipCard>
    )}>{children ?? word}</Tip>
  );
}

export function SourceLine({ source }: { readonly source: SourceReading | null }) {
  if (source === null) return null;
  return <p className="tip__source" data-freshness={source.freshness}>{source.text}</p>;
}

export function NoteCard({ note }: { readonly note: EntityNote }) {
  switch (note.kind) {
    case "person": return (
      <TipCard kicker={note.kicker} title={note.alive ? note.name : `${note.name}, now dead`}>
        {(note.office !== null || note.polity !== null || note.where !== null) && (
          <p>
            {/* An office already says whose it is: "Roman senator", not "Roman senator of the Roman Republic". */}
            {note.office !== null ? <LinkedName linked={note.office} /> : note.polity !== null ? <>Of <LinkedName linked={note.polity} /></> : null}
            {note.where !== null && <>{note.office !== null || note.polity !== null ? ", in " : "In "}<LinkedName linked={note.where} /></>}
            .
          </p>
        )}
        <p>{capitalise(note.standingLabel)}.</p>
        {note.knownFor.length > 0 && <p>Known to be {listInWords(note.knownFor.map((word) => word.toLowerCase()))}.</p>}
        {note.skills.length > 0 && <p>Said to be {listInWords(note.skills)}.</p>}
        {note.opinionLabel !== null && <p className="tip__rule">You think {note.female ? "her" : "him"} <Why word={note.opinionLabel} why={note.opinionWhy} kicker="Why you think so" />.</p>}
        {note.ties.length > 0 && <p>{capitalise(listInWords(note.ties))}.</p>}
        {note.towardYou.length > 0 && <p>{note.female ? "She" : "He"} has {listInWords(note.towardYou)}.</p>}
        {note.leads.length > 0 && <p>Leads {listInWords(note.leads)}.</p>}
        {note.people.length > 0 && (
          <div className="tip__rule">
            <p className="tip__kicker">{note.female ? "Her" : "His"} people</p>
            <ul className="note__people">
              {note.people.map((tie) => <li key={`${tie.role}-${tie.who.label}`}><span>{capitalise(tie.role)}</span> <LinkedName linked={tie.who} /></li>)}
            </ul>
          </div>
        )}
        <Compared lines={note.compared} />
        {note.heard.length > 0 && (
          <ul className="tip__rule">
            {note.heard.slice(0, 3).map((line, index) => (
              <li key={index}>{line.preface}: {line.claim}{line.whenLabel === null ? "" : ` (${line.whenLabel})`}</li>
            ))}
          </ul>
        )}
        <SourceLine source={note.source} />
      </TipCard>
    );
    case "place": return (
      <TipCard kicker={note.kicker} title={note.name}>
        {note.holder !== null && <p>Held by <LinkedName linked={note.holder} />{note.holdLabel === null ? "" : `, ${note.holdLabel}`}.</p>}
        {note.forcesHere.length > 0 && <p>Here: <LinkedNames items={note.forcesHere} />.</p>}
        <SourceLine source={note.source} />
      </TipCard>
    );
    case "force": return (
      <TipCard kicker={note.kicker} title={note.name}>
        <p>{capitalise(note.strengthLabel)}{note.where !== null && <>, in <LinkedName linked={note.where} /></>}.</p>
        {note.commander !== null && <p>Under <LinkedName linked={note.commander} />.</p>}
        {note.conditionLabel !== null && <p>{note.conditionLabel}</p>}
        {note.projections.length > 0 && <div className="tip__rule">{note.projections.map((line) => <p key={line}><Linkify text={line} /></p>)}</div>}
        {note.explainedBy.map((key) => <Explained key={key} k={key} />)}
        <SourceLine source={note.source} />
      </TipCard>
    );
    case "power": return (
      <TipCard kicker={note.kicker} title={note.name}>
        {note.ruler !== null && <p>Led by <LinkedName linked={note.ruler} />.</p>}
        {note.regardLabel !== null && <p>Your government holds it {note.regardLabel}.</p>}
        {note.war !== null && <p className="tip__rule">The war is <Why word={note.war.headline} why={note.war.why} kicker="How the war goes" />.</p>}
        <Compared lines={note.compared} />
        <Explained k={note.explainedBy} />
        <SourceLine source={note.source} />
      </TipCard>
    );
    case "office": return (
      <TipCard kicker={note.kicker} title={note.name}>
        {note.holders.length > 0
          ? <p>Held now by <LinkedNames items={note.holders.slice(0, 6)} />{note.holders.length > 6 ? `, and ${note.holders.length - 6} more` : ""}.</p>
          : <p>Nobody holds it now.</p>}
        {(note.termLabel !== null || note.filledLabel !== null) && (
          <p>{[note.filledLabel, note.termLabel === null ? null : note.termLabel.toLowerCase()].filter((part) => part !== null).join("; ")}.</p>
        )}
        {note.next !== null && (note.next.standing.length > 0 || note.next.talkedOf.length > 0 || note.next.youLabel !== null) && (
          <div className="tip__rule">
            <p className="tip__kicker">Who could be next</p>
            {note.next.pollingLabel !== null && <p>{note.next.pollingLabel}.</p>}
            {note.next.standing.length > 0 && <p>Standing: <LinkedNames items={note.next.standing} />.</p>}
            {note.next.talkedOf.length > 0 && <p>{note.next.standing.length > 0 ? "Also talked of" : "Talked of"}: <LinkedNames items={note.next.talkedOf} />.</p>}
            {note.next.youLabel !== null && <p>{note.next.youLabel}</p>}
          </div>
        )}
        <Explained k={note.explainedBy} />
        <SourceLine source={note.source} />
      </TipCard>
    );
  }
}

/** Set against the viewer: "Land: more land than yours". */
function Compared({ lines }: { readonly lines: readonly { readonly aspect: string; readonly label: string }[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="tip__rule">
      <p className="tip__kicker">Compared with you</p>
      <dl className="note__compared">
        {lines.map((line) => <div key={line.aspect}><dt>{line.aspect}</dt><dd>{capitalise(line.label)}</dd></div>)}
      </dl>
    </div>
  );
}

const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

function listInWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
