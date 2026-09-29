"use client";

import { useRef, useState, useEffect, useCallback, useMemo, type FormEvent } from "react";
import type { AwaitingLetter, Correspondence, DirectoryEntry, DirectoryGroup } from "@chronica/shared";
import { Sheet, type SheetSide } from "../../../components/ui/sheet";
import { Era } from "../../../components/ui/era";
import { Explains, Name, useGlossary } from "./notes";
import type { EntityKey, EntityNote } from "@chronica/shared";

interface ContactView {
  readonly sessionId: string;
  readonly npcCharacterId: string;
  readonly knownName: string;
  readonly roleLabel: string;
  readonly isGroup: boolean;
  readonly unread: number;
}

interface MessageView {
  readonly id: string;
  readonly sessionId: string;
  readonly sequence: number;
  readonly speakerCharacterId: string;
  readonly isPlayerMessage: boolean;
  readonly body: string;
}

interface ChatPanelProps {
  readonly gameId: string;
  readonly playerCharacterId: string;
  /** Opened from the Office, so the panel no longer owns the answer to whether it is. */
  readonly open: boolean;
  readonly onClose: () => void;
  readonly side: SheetSide;
  /** Set to open this panel directly on a specific session -- e.g. a conversation a character initiated. */
  readonly openSessionId?: string | null;
  readonly onOpenSessionConsumed?: () => void;
}

type Focus =
  | { readonly kind: "none" }
  | { readonly kind: "letter"; readonly id: string }
  /** The name travels with the id: somebody found a moment ago, or who wrote first, may not be listed yet. */
  | { readonly kind: "person"; readonly id: string; readonly name: string };

type Reply = "accepted" | "refused" | "countered";

/**
 * The letter tray: everyone the player knows of, what they have said, and
 * the letters from other powers waiting on an answer.
 *
 * The column used to hold only people already spoken to, so a new player met
 * an empty list and a free-text box. It now lists everyone the player knows
 * of and every sitting officeholder (`lettersDirectory`), grouped -- those
 * spoken with, family, those who answer to you, then each power -- with a
 * search, and each marked with whether they can be reached. Choosing someone
 * shows what is known of them, and a way to speak or write, or what it would
 * take when that cannot be done yet.
 *
 * Somebody in the player's region is spoken with. Anybody further off is
 * written to: the letter goes out now, and they answer it when the world next
 * moves. A letter waiting on the player's answer is answered here too --
 * accepted, refused, or written back to -- not at the desk as an order.
 *
 * A conversation reads as a transcript -- who spoke, and what they said --
 * the way a history records an exchange, not as chat bubbles. A
 * correspondence reads as the letters themselves, dated.
 */
export function ChatPanel({ gameId, open, onClose, side, openSessionId, onOpenSessionConsumed }: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [contacts, setContacts] = useState<readonly ContactView[]>([]);
  const [groups, setGroups] = useState<readonly DirectoryGroup[]>([]);
  const [letters, setLetters] = useState<readonly AwaitingLetter[]>([]);
  const [correspondence, setCorrespondence] = useState<readonly Correspondence[]>([]);
  const [letterBody, setLetterBody] = useState("");
  const [reply, setReply] = useState<Reply>("countered");
  const [agreementKind, setAgreementKind] = useState("");
  const [posting, setPosting] = useState(false);
  /** Why the last letter did not go. The words stay on the page. */
  const [letterError, setLetterError] = useState<string | null>(null);
  const [letterSent, setLetterSent] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [focus, setFocus] = useState<Focus>({ kind: "none" });
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<readonly MessageView[]>([]);
  const [messageBody, setMessageBody] = useState("");
  const [sending, setSending] = useState(false);
  /** Why the last thing said did not reach them. The words stay in the box. */
  const [sayError, setSayError] = useState<string | null>(null);
  const [approaching, setApproaching] = useState(false);
  const [refusal, setRefusal] = useState<{ explanation: string; ladder: string[] } | null>(null);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [discoverQuery, setDiscoverQuery] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  /** What it would take, when station is what stands in the way (slice 10). */
  const [discoverLadder, setDiscoverLadder] = useState<{ rung: string; label: string }[]>([]);
  const [groupParticipantIds, setGroupParticipantIds] = useState<string[]>([]);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const activeContact = contacts.find((c) => c.sessionId === activeSessionId) ?? null;
  const everyone = useMemo(() => groups.flatMap((group) => group.people), [groups]);
  const personById = useMemo(() => new Map(everyone.map((person) => [person.id, person])), [everyone]);
  const sessionFor = (personId: string): ContactView | undefined => contacts.find((contact) => !contact.isGroup && contact.npcCharacterId === personId);
  const gatherings = contacts.filter((contact) => contact.isGroup);
  const focused = focus.kind === "person" ? personById.get(focus.id) ?? null : null;
  const letter = focus.kind === "letter" ? letters.find((candidate) => candidate.id === focus.id) ?? null : null;
  // Whom the letters on the right are with: the person chosen, or the one a
  // conversation is open with. A conversation begun here goes on by letter
  // once they have left the region.
  const correspondentId = focus.kind === "person" ? focus.id : activeContact !== null && !activeContact.isGroup ? activeContact.npcCharacterId : null;
  const correspondent = correspondentId === null ? null : personById.get(correspondentId) ?? null;
  const correspondentName = correspondent?.name ?? (focus.kind === "person" ? focus.name : activeContact?.knownName ?? "");
  const thread = correspondentId === null ? null : correspondence.find((entry) => entry.withCharacterId === correspondentId) ?? null;
  // Unlisted -- found a moment ago, or known only by the letter they sent --
  // is somebody elsewhere; the server says so if they are in fact here.
  const byLetter = correspondentId !== null && (correspondent === null ? true : correspondent.reach === "letter");
  // In a group, each line is spoken by one of its members.
  const namesById = useMemo(() => new Map([
    ...everyone.map((person) => [person.id, person.name] as const),
    ...contacts.filter((c) => !c.isGroup).map((c) => [c.npcCharacterId, c.knownName] as const),
  ]), [everyone, contacts]);
  const speakerOf = (message: MessageView): string =>
    message.isPlayerMessage ? "You" : namesById.get(message.speakerCharacterId) ?? activeContact?.knownName ?? "They";

  const wanted = search.trim().toLowerCase();
  const shownGroups = wanted.length === 0 ? groups : groups
    .map((group) => ({ ...group, people: group.people.filter((person) => [person.name, person.officeLabel, person.polityLabel, person.whereLabel].some((field) => field?.toLowerCase().includes(wanted))) }))
    .filter((group) => group.people.length > 0);

  const fetchContacts = useCallback(async () => {
    try {
      const res = await fetch(`/api/games/${encodeURIComponent(gameId)}/conversations`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json() as { contacts: ContactView[] };
      setContacts(data.contacts ?? []);
    } catch {
      // Silently ignore — contacts load on next open
    }
  }, [gameId]);

  const fetchDirectory = useCallback(async () => {
    try {
      const res = await fetch(`/api/games/${encodeURIComponent(gameId)}/directory`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json() as { groups: DirectoryGroup[]; letters: AwaitingLetter[]; correspondence: Correspondence[] };
      setGroups(data.groups ?? []);
      setLetters(data.letters ?? []);
      setCorrespondence(data.correspondence ?? []);
    } catch {
      // The tray still shows the conversations already open.
    }
  }, [gameId]);

  const fetchMessages = useCallback(async (sessionId: string) => {
    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/games/${encodeURIComponent(gameId)}/conversations/${encodeURIComponent(sessionId)}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json() as { messages: MessageView[] };
      setMessages(data.messages ?? []);
    } catch {
      // Silently ignore
    } finally {
      setLoadingMessages(false);
    }
  }, [gameId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  useEffect(() => {
    if (!openSessionId) return;
    void fetchContacts();
    void openSession(openSessionId);
    onOpenSessionConsumed?.();
    // openSessionId is a one-shot signal from the parent; deliberately not
    // re-running when fetchContacts/openSession identity changes.
  }, [openSessionId]);

  useEffect(() => {
    if (open) { void fetchContacts(); void fetchDirectory(); }
    // Deliberately keyed on `open` alone: the fetchers are re-created every
    // render and re-running them while the panel is already open would be a
    // second identical request.
  }, [open]);

  function closePanel() {
    setActiveSessionId(null);
    setMessages([]);
    setFocus({ kind: "none" });
    onClose();
  }

  async function openSession(sessionId: string) {
    setActiveSessionId(sessionId);
    setMessages([]);
    setRefusal(null);
    await fetchMessages(sessionId);
  }

  function freshPage() {
    setLetterBody("");
    setLetterError(null);
    setLetterSent(null);
    setReply("countered");
    setAgreementKind("");
  }

  function choosePerson(person: { readonly id: string; readonly name: string }) {
    setFocus({ kind: "person", id: person.id, name: person.name });
    setRefusal(null);
    freshPage();
    const session = sessionFor(person.id);
    if (session !== undefined) void openSession(session.sessionId);
    else { setActiveSessionId(null); setMessages([]); }
  }

  function chooseLetter(id: string) {
    setFocus({ kind: "letter", id });
    setActiveSessionId(null);
    freshPage();
    const waiting = letters.find((entry) => entry.id === id);
    if (waiting !== undefined) setReply(waiting.asksYesOrNo ? "accepted" : "countered");
  }

  /** A letter to somebody out of the region: it goes now, and is answered when the world next moves. */
  async function sendLetter(event: FormEvent) {
    event.preventDefault();
    const body = letterBody.trim();
    if (!body || correspondentId === null || posting) return;
    setPosting(true);
    setLetterError(null);
    setLetterSent(null);
    try {
      const res = await fetch(`/api/games/${encodeURIComponent(gameId)}/letters`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ toCharacterId: correspondentId, body }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) { setLetterError(data.error ?? "The letter did not go. Your words are still here; try again."); return; }
      setLetterBody("");
      setLetterSent(`Your letter is on its way to ${correspondentName}. They will answer when the world next moves.`);
      await fetchDirectory();
    } catch {
      setLetterError("The letter did not go. Your words are still here; try again.");
    } finally {
      setPosting(false);
    }
  }

  /** Accepting, refusing, or writing back to a letter waiting on the player. */
  async function sendAnswer(event: FormEvent) {
    event.preventDefault();
    const words = letterBody.trim();
    if (!words || letter === null || posting) return;
    setPosting(true);
    setLetterError(null);
    try {
      const res = await fetch(`/api/games/${encodeURIComponent(gameId)}/letters/${encodeURIComponent(letter.id)}/answer`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply, words, ...(reply === "accepted" && letter.offers.length > 1 ? { agreementKind } : {}) }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) { setLetterError(data.error ?? "The answer did not go. Your words are still here; try again."); return; }
      const sender = { id: letter.fromCharacterId, name: personById.get(letter.fromCharacterId)?.name ?? letter.fromLabel.split(",")[0]! };
      await fetchDirectory();
      choosePerson(sender);
      setLetterSent(reply === "countered"
        ? `Your answer is on its way. ${sender.name} will write back when the world next moves.`
        : `Your answer is sent: you have ${reply === "accepted" ? "accepted" : "refused"} it.`);
    } catch {
      setLetterError("The answer did not go. Your words are still here; try again.");
    } finally {
      setPosting(false);
    }
  }

  /** Open a conversation with someone chosen from the list. */
  async function approach(person: DirectoryEntry) {
    if (approaching) return;
    setApproaching(true);
    setRefusal(null);
    try {
      const res = await fetch(`/api/games/${encodeURIComponent(gameId)}/conversations/discover`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: person.name, characterId: person.id }),
      });
      if (!res.ok) { setRefusal({ explanation: "The message could not be sent. Try again.", ladder: [] }); return; }
      const data = await res.json() as { status: string; sessionId?: string; characterId?: string; knownName?: string; explanation?: string; ladder?: { label: string }[] };
      if (data.status === "letter" && data.characterId) {
        choosePerson({ id: data.characterId, name: data.knownName ?? person.name });
        void fetchDirectory();
        return;
      }
      if (data.status === "found" && data.sessionId) {
        await fetchContacts();
        await openSession(data.sessionId);
        void fetchDirectory();
        return;
      }
      setRefusal({ explanation: data.explanation ?? "They cannot be reached yet.", ladder: (data.ladder ?? []).map((step) => step.label) });
    } finally {
      setApproaching(false);
    }
  }

  async function handleSend(event: FormEvent) {
    event.preventDefault();
    const body = messageBody.trim();
    if (!body || !activeSessionId || sending) return;
    setSending(true);
    setSayError(null);
    setMessageBody("");
    try {
      const res = await fetch(
        `/api/games/${encodeURIComponent(gameId)}/conversations/${encodeURIComponent(activeSessionId)}/message`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) },
      );
      if (!res.ok) {
        const refused = await res.json().catch(() => ({})) as { error?: string; byLetter?: boolean };
        if (refused.byLetter === true) {
          // They have left the region since: what was to be said goes in a letter.
          setMessageBody("");
          setLetterBody(body);
          setSayError(null);
          void fetchDirectory();
          return;
        }
        setMessageBody(body);
        setSayError(res.status === 402
          ? "Your purse is spent, so they did not hear you. Add coins on your account page, then say it again."
          : "That did not reach them. Your words are still here; try again.");
        return;
      }
      const data = await res.json() as { playerMessage: MessageView | null; npcReply: MessageView | null; npcReplies?: MessageView[] };
      setMessages((prev) => {
        const next = [...prev];
        if (data.playerMessage) next.push(data.playerMessage);
        if (data.npcReply) next.push(data.npcReply);
        if (data.npcReplies) next.push(...data.npcReplies);
        return next;
      });
    } catch {
      setMessageBody(body);
      setSayError("That did not reach them. Your words are still here; try again.");
    } finally {
      setSending(false);
    }
  }

  function openDiscover() {
    setDiscoverQuery(search);
    setDiscoverError(null);
    setDiscoverLadder([]);
    setDiscoverOpen(true);
  }

  function openGroup() { setGroupParticipantIds([]); setGroupOpen(true); }
  async function createGroup() {
    if (groupParticipantIds.length < 2 || creatingGroup) return;
    setCreatingGroup(true);
    try {
      const res = await fetch(`/api/games/${encodeURIComponent(gameId)}/conversations/group`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ participantIds: groupParticipantIds }) });
      const data = await res.json() as { sessionId?: string };
      if (res.ok && data.sessionId) { setGroupOpen(false); await fetchContacts(); setFocus({ kind: "none" }); await openSession(data.sessionId); }
    } finally { setCreatingGroup(false); }
  }

  async function handleDiscover(event: FormEvent) {
    event.preventDefault();
    const query = discoverQuery.trim();
    if (!query || discovering) return;
    setDiscovering(true);
    setDiscoverError(null);
    setDiscoverLadder([]);
    try {
      const res = await fetch(
        `/api/games/${encodeURIComponent(gameId)}/conversations/discover`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) },
      );
      if (!res.ok) {
        setDiscoverError("The server could not be reached. Try again.");
        return;
      }
      const data = await res.json() as {
        status: "found" | "unavailable" | "letter"; sessionId?: string; characterId?: string; knownName?: string; explanation?: string;
        ladder?: { rung: string; label: string }[];
      };
      if (data.status === "letter" && data.characterId) {
        setDiscoverOpen(false);
        choosePerson({ id: data.characterId, name: data.knownName ?? query });
        void fetchDirectory();
        return;
      }
      if (data.status === "unavailable") {
        setDiscoverError(data.explanation ?? "No one matching that description could be found nearby.");
        // Never a dead end: the last rung is always "write to him and see".
        setDiscoverLadder(data.ladder ?? []);
        return;
      }
      if (data.sessionId) {
        setDiscoverOpen(false);
        await fetchContacts();
        void fetchDirectory();
        setFocus({ kind: "none" });
        await openSession(data.sessionId);
      }
    } catch {
      setDiscoverError("Something went wrong finding them. Try again.");
    } finally {
      setDiscovering(false);
    }
  }

  const unreadFor = (personId: string): number => sessionFor(personId)?.unread ?? 0;

  return (
    <>
      <Sheet label="your letters" title="Letters" width="reading" side={side} open={open} onClose={closePanel} className="sheet--wide sheet--letters">
        <div className="letters">
          <nav className="letters__people" aria-label="People you can reach">
            <div className="letters__search">
              <label className="visually-hidden" htmlFor="letters-search">Find someone in your letters</label>
              <input id="letters-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, office or power" autoComplete="off" />
            </div>
            <div className="letters__people-actions">
              <button type="button" className="word-button" onClick={openDiscover}>Find someone else</button>
              {contacts.filter((contact) => !contact.isGroup).length >= 2 && <button type="button" className="word-button" onClick={openGroup}>Gather several</button>}
            </div>

            <div className="letters__scroll">
              {wanted.length > 0 && <AskAfter wanted={wanted} />}
              {letters.length > 0 && wanted.length === 0 && (
                <section className="letters__group">
                  <h3><Explains k="rule:letter">Waiting on your answer</Explains></h3>
                  <ul className="letters__list">
                    {letters.map((entry) => (
                      <li key={entry.id}>
                        <button type="button" className="letters__person letters__person--letter" aria-current={focus.kind === "letter" && focus.id === entry.id ? "true" : undefined} onClick={() => chooseLetter(entry.id)}>
                          <strong><span className="seal-dot" aria-hidden="true" /> {entry.kindLabel}</strong>
                          <span>From {entry.fromLabel}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {correspondence.length > 0 && wanted.length === 0 && (
                <section className="letters__group">
                  <h3>Letters</h3>
                  <ul className="letters__list">
                    {correspondence.map((entry) => {
                      const last = entry.pages.at(-1);
                      const state = entry.waitingOn === "you" ? "Waiting on your answer"
                        : entry.waitingOn === "them" ? "Awaiting their answer"
                        : last !== undefined && !last.fromYou ? `They wrote, ${last.dateLabel}` : `You wrote, ${last?.dateLabel ?? ""}`;
                      return (
                        <li key={entry.withCharacterId}>
                          <button type="button" className="letters__person" aria-current={focus.kind === "person" && focus.id === entry.withCharacterId ? "true" : undefined} onClick={() => choosePerson({ id: entry.withCharacterId, name: entry.withName })}>
                            <strong>{entry.waitingOn === "you" && <span className="seal-dot" aria-hidden="true" />} {entry.withName}</strong>
                            <span><Era text={state} /></span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {gatherings.length > 0 && wanted.length === 0 && (
                <section className="letters__group">
                  <h3>Gatherings</h3>
                  <ul className="letters__list">
                    {gatherings.map((contact) => (
                      <li key={contact.sessionId}>
                        <button type="button" className="letters__person" aria-current={activeSessionId === contact.sessionId ? "true" : undefined} onClick={() => { setFocus({ kind: "none" }); void openSession(contact.sessionId); }}>
                          <strong>{contact.knownName}</strong>
                          <span>{contact.roleLabel}</span>
                          {contact.unread > 0 && <span className="badge">{contact.unread}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {shownGroups.map((group) => (
                <section key={group.key} className="letters__group">
                  <h3>{group.label}</h3>
                  <ul className="letters__list">
                    {group.people.map((person) => (
                      <li key={person.id}>
                        <button type="button" className="letters__person" aria-current={focus.kind === "person" && focus.id === person.id ? "true" : undefined} onClick={() => choosePerson(person)}>
                          <strong>{person.name}</strong>
                          <span>{[person.officeLabel, group.key.startsWith("polity:") ? null : person.polityLabel].filter(Boolean).join(", ") || (person.how === "heard_of" ? "Heard of" : "")}</span>
                          <span className={`letters__reach letters__reach--${person.reach}`}>{person.reach === "here" ? "Here" : person.reach === "letter" ? "By letter" : "Out of reach"}</span>
                          {unreadFor(person.id) > 0 && <span className="badge">{unreadFor(person.id)}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}

              {groups.length === 0 && contacts.length === 0 && <p className="letters__none">Nobody yet. Find someone nearby to speak with.</p>}
              {wanted.length > 0 && shownGroups.length === 0 && <p className="letters__none">Nobody you know of by that name. Find someone else to ask around.</p>}
            </div>
          </nav>

          <div className="letters__thread">
            {letter !== null && (
              <article className="letters__dossier" aria-label={`${letter.kindLabel} from ${letter.fromLabel}`}>
                <h3>{letter.kindLabel}</h3>
                <p className="letters__from">From {letter.fromLabel}{letter.replyByLabel !== null && <>, wanting an answer by <Era text={letter.replyByLabel} /></>}.</p>
                <p className="letters__subject">{letter.subject}</p>
                <blockquote className="letters__terms">{letter.terms}</blockquote>
                <p className="mirror__note">{letter.toYou ? "It is addressed to you." : "It is addressed to your government."}</p>
                <form className="letters-form" onSubmit={(event) => { void sendAnswer(event); }}>
                  {letter.asksYesOrNo && (
                    <fieldset className="letters-form__choices">
                      <legend className="visually-hidden">Your answer</legend>
                      <label><input type="radio" name="letter-reply" checked={reply === "accepted"} onChange={() => setReply("accepted")} disabled={posting} /> Accept{letter.offers.length === 1 ? ` the ${letter.offers[0]!.label}` : ""}</label>
                      <label><input type="radio" name="letter-reply" checked={reply === "refused"} onChange={() => setReply("refused")} disabled={posting} /> Refuse</label>
                      <label><input type="radio" name="letter-reply" checked={reply === "countered"} onChange={() => setReply("countered")} disabled={posting} /> Write back with terms of your own</label>
                    </fieldset>
                  )}
                  {reply === "accepted" && letter.offers.length > 1 && (
                    <label>
                      Which of what it offers you take up
                      <select value={agreementKind} onChange={(event) => setAgreementKind(event.target.value)} disabled={posting}>
                        <option value="" disabled>Choose one</option>
                        {letter.offers.map((offer) => <option key={offer.kind} value={offer.kind}>The {offer.label}</option>)}
                      </select>
                    </label>
                  )}
                  <label htmlFor="letters-answer">{reply === "countered" ? "Your letter back" : "Your answer, in your own words"}</label>
                  <textarea id="letters-answer" rows={6} value={letterBody} onChange={(event) => setLetterBody(event.target.value)} maxLength={1200} disabled={posting}
                    placeholder={reply === "countered" ? `What you write back to ${letter.fromLabel}…` : reply === "accepted" ? "On what understanding you accept…" : "Why you will not…"} />
                  {letterError !== null && <p className="letters-form__error" role="alert">{letterError}</p>}
                  <p className="mirror__note">
                    {reply === "countered" ? "It goes out now, and they will answer it when the world next moves." : "Your answer goes out now, and holds from the day it is sent."}
                  </p>
                  <div className="letters-form__actions letters-form__actions--start">
                    <button type="submit" className="btn btn--primary" disabled={posting || !letterBody.trim() || (reply === "accepted" && letter.offers.length > 1 && agreementKind === "")}>
                      {posting ? "Sealing it…" : reply === "accepted" ? "Send your acceptance" : reply === "refused" ? "Send your refusal" : "Send your letter"}
                    </button>
                  </div>
                </form>
              </article>
            )}

            {focused !== null && (
              <div className={activeContact !== null || thread !== null ? "letters__with letters__with--dossier" : "letters__dossier"}>
                <div className="letters__who">
                  <strong>{focused.name}</strong>
                  <span>{[focused.officeLabel, focused.polityLabel].filter(Boolean).join(", ")}</span>
                </div>
                {activeContact === null && thread === null && (
                  <>
                    <dl className="mirror__facts">
                      {focused.whereLabel !== null && <><dt>Where</dt><dd>{focused.whereLabel}</dd></>}
                      {focused.standingLabel !== null && <><dt>Standing</dt><dd>{focused.standingLabel}</dd></>}
                      {focused.knownFor.length > 0 && <><dt>Known for</dt><dd>{focused.knownFor.join(", ")}</dd></>}
                      {focused.ties.length > 0 && <><dt>Between you</dt><dd>{focused.ties.join("; ")}</dd></>}
                      {focused.opinionLabel !== null && <><dt>What you think of them</dt><dd>{focused.opinionLabel}</dd></>}
                      {focused.how === "public" && <><dt>Known</dt><dd>By repute; you have never dealt with them.</dd></>}
                    </dl>
                    <p className="letters__reach-line">{focused.reach === "letter" ? "Not here: written to, and answering when the world next moves" : focused.reachLabel}.</p>
                    {focused.ladder.length > 0 && (
                      <div className="letters-form">
                        <p className="mirror__note">They owe you no answer. To be heard in person:</p>
                        <ol className="letters-form__ladder">{focused.ladder.map((step) => <li key={step}>{step}</li>)}</ol>
                      </div>
                    )}
                  </>
                )}
                {activeContact === null && focused.reach !== "letter" && (
                  <>
                    {refusal !== null && (
                      <div className="letters-form">
                        <p className="letters-form__error" role="alert">{refusal.explanation}</p>
                        {refusal.ladder.length > 0 && <ol className="letters-form__ladder">{refusal.ladder.map((step) => <li key={step}>{step}</li>)}</ol>}
                      </div>
                    )}
                    <div className="letters-form__actions letters-form__actions--start">
                      <button type="button" className="btn btn--primary" disabled={approaching} onClick={() => void approach(focused)}>
                        {approaching ? "Sending for them…" : `Speak with ${focused.name}`}
                      </button>
                    </div>
                  </>
                )}
                {(activeContact !== null || thread !== null) && focused.knownFor.length > 0 && <span className="letters__known">Known for {focused.knownFor.join(", ")}</span>}
              </div>
            )}

            {focused === null && letter === null && (focus.kind === "person" || activeContact !== null) && (
              <div className="letters__with">
                <strong>{focus.kind === "person" ? focus.name : activeContact!.knownName}</strong>
                {activeContact !== null && <span>{activeContact.roleLabel}</span>}
              </div>
            )}

            {letter === null && (activeContact !== null || thread !== null || focus.kind === "none") && (
              <div className="letters__transcript" aria-live="polite">
                {loadingMessages && <p className="letters__hint">Finding what was said…</p>}
                {!loadingMessages && activeContact === null && focus.kind === "none" && (
                  <p className="letters__hint">Choose someone to speak with or write to, or a letter to answer.</p>
                )}
                {messages.map((message) => (
                  <div key={message.id} className={message.isPlayerMessage ? "letters__line is-yours" : "letters__line"}>
                    <span className="letters__speaker">{speakerOf(message)}</span>
                    <p>{message.body}</p>
                  </div>
                ))}
                {sending && (
                  <div className="letters__line is-waiting">
                    <span className="letters__speaker">{activeContact?.knownName ?? "They"}</span>
                    <p>considers what to say…</p>
                  </div>
                )}
                {thread !== null && thread.pages.map((page) => {
                  const answerable = page.awaiting && !page.fromYou ? letters.find((entry) => entry.id === page.messageId) : undefined;
                  return (
                    <article key={page.id} className={page.fromYou ? "letters__page is-yours" : "letters__page"}>
                      <header className="letters__page-head">
                        <span className="letters__speaker">{page.fromYou ? "You" : thread.withName}</span>
                        <span><Era text={`${page.label}, ${page.dateLabel}`} /></span>
                      </header>
                      {/* A subject the tray took from the letter's first words would only say them twice. */}
                      {page.subject !== null && !page.body.startsWith(page.subject.replace(/…$/, "")) && <p className="letters__page-subject">{page.subject}</p>}
                      <p>{page.body}</p>
                      {page.awaiting && page.fromYou && <p className="letters__page-note">Not yet answered. The answer comes when the world next moves.</p>}
                      {answerable !== undefined && (
                        <button type="button" className="word-button" onClick={() => chooseLetter(answerable.id)}>Answer this letter</button>
                      )}
                    </article>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            )}

            {activeContact && letter === null && (activeContact.isGroup || !byLetter) && (
              <form className="letters__compose" onSubmit={(e) => { void handleSend(e); }}>
                <label className="visually-hidden" htmlFor="letters-say">What you say to {activeContact.knownName}</label>
                <input
                  id="letters-say"
                  type="text"
                  value={messageBody}
                  onChange={(e) => setMessageBody(e.target.value)}
                  placeholder={`Say something to ${activeContact.knownName}…`}
                  disabled={sending}
                  autoComplete="off"
                />
                <button type="submit" className="btn btn--primary" disabled={sending || !messageBody.trim()}>Say it</button>
                {sayError !== null && (
                  <p className="letters-form__error letters__compose-error" role="alert">
                    {sayError}{sayError.startsWith("Your purse") && <> <a href="/account">Open your account</a>.</>}
                  </p>
                )}
              </form>
            )}

            {letter === null && byLetter && (
              <form className="letters__compose letters__compose--letter" onSubmit={(event) => { void sendLetter(event); }}>
                <label htmlFor="letters-write">
                  {activeContact !== null && !activeContact.isGroup ? `${correspondentName} is not here. Write to them` : `A letter to ${correspondentName}`}
                </label>
                <textarea
                  id="letters-write"
                  rows={4}
                  value={letterBody}
                  onChange={(event) => setLetterBody(event.target.value)}
                  maxLength={1200}
                  placeholder={`What you write to ${correspondentName}…`}
                  disabled={posting}
                />
                <button type="submit" className="btn btn--primary" disabled={posting || !letterBody.trim()}>{posting ? "Sealing it…" : "Send the letter"}</button>
                {letterError !== null && <p className="letters-form__error letters__compose-error" role="alert">{letterError}</p>}
                {letterSent !== null && letterError === null && <p className="mirror__note letters__compose-error" role="status">{letterSent}</p>}
              </form>
            )}
          </div>
        </div>
      </Sheet>

      {groupOpen && (
        <Sheet label="gathering several people" title="Gather several" width="narrow" side="center" onClose={() => setGroupOpen(false)}>
          <div className="letters-form">
            <p className="mirror__note">Choose at least two of the people you already speak with.</p>
            <div className="letters-form__choices">
              {contacts.filter((contact) => !contact.isGroup).map((contact) => (
                <label key={contact.sessionId}>
                  <input type="checkbox" checked={groupParticipantIds.includes(contact.npcCharacterId)} onChange={(event) => setGroupParticipantIds((ids) => event.target.checked ? [...ids, contact.npcCharacterId] : ids.filter((id) => id !== contact.npcCharacterId))} />
                  {contact.knownName}
                </label>
              ))}
            </div>
            <div className="letters-form__actions">
              <button type="button" className="btn btn--quiet" onClick={() => setGroupOpen(false)}>Cancel</button>
              <button type="button" className="btn btn--primary" onClick={() => { void createGroup(); }} disabled={creatingGroup || groupParticipantIds.length < 2}>{creatingGroup ? "Gathering…" : "Gather them"}</button>
            </div>
          </div>
        </Sheet>
      )}

      {discoverOpen && (
        <Sheet label="finding someone" title="Find someone else" width="narrow" side="center" onClose={() => setDiscoverOpen(false)}>
          <form className="letters-form" onSubmit={(e) => { void handleDiscover(e); }}>
            <label htmlFor="letters-find">Who do you want to speak with? Give a name, a role, or how they stand to you.</label>
            <input
              id="letters-find"
              type="text"
              value={discoverQuery}
              onChange={(e) => setDiscoverQuery(e.target.value)}
              placeholder="The garrison commander, Marcus Fabius…"
              disabled={discovering}
              autoFocus
            />
            {discoverError && <p className="letters-form__error" role="alert">{discoverError}</p>}
            {discoverLadder.length > 0 && <ol className="letters-form__ladder">
              {discoverLadder.map((step) => <li key={step.rung + step.label}>{step.label}</li>)}
            </ol>}
            <div className="letters-form__actions">
              <button type="button" className="btn btn--quiet" onClick={() => setDiscoverOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn--primary" disabled={discovering || !discoverQuery.trim()}>
                {discovering ? "Asking around…" : "Find them"}
              </button>
            </div>
          </form>
        </Sheet>
      )}
    </>
  );
}

const ASK_KIND_WORDS: Readonly<Record<EntityNote["kind"], string>> = { person: "a person", place: "a place", force: "a force", power: "a power", office: "an office" };

/**
 * Ask after anyone: every name the glossary holds that matches the search,
 * each opening its note. The glossary is station-filtered, so this finds only
 * what the player could know of; asking after a name nobody told him of
 * finds nothing.
 */
function AskAfter({ wanted }: { readonly wanted: string }) {
  const glossary = useGlossary();
  const found = (Object.entries(glossary) as [EntityKey, EntityNote | undefined][])
    .filter((entry): entry is [EntityKey, EntityNote] => entry[1] !== undefined && entry[1].name.toLowerCase().includes(wanted))
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .slice(0, 12);
  if (found.length === 0) return null;
  return (
    <section className="letters__group letters__ask">
      <h3>Ask after</h3>
      <ul className="letters__list">
        {found.map(([key, note]) => (
          <li key={key} className="letters__asked">
            <Name k={key}>{note.name}</Name>
            <span>{ASK_KIND_WORDS[note.kind]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
