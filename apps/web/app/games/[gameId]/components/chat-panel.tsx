"use client";

import { useRef, useState, useEffect, useCallback, useMemo, type FormEvent } from "react";
import type { AwaitingLetter, DirectoryEntry, DirectoryGroup } from "@chronica/shared";
import { Sheet, type SheetSide } from "../../../components/ui/sheet";
import { Era } from "../../../components/ui/era";

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
  /** Letters from other powers are answered at the desk, as orders. */
  readonly onAnswerAtDesk: () => void;
  /** Set to open this panel directly on a specific session -- e.g. a conversation a character initiated. */
  readonly openSessionId?: string | null;
  readonly onOpenSessionConsumed?: () => void;
}

type Focus =
  | { readonly kind: "none" }
  | { readonly kind: "letter"; readonly id: string }
  | { readonly kind: "person"; readonly id: string };

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
 * A conversation reads as a transcript -- who spoke, and what they said --
 * the way a history records an exchange, not as chat bubbles.
 */
export function ChatPanel({ gameId, open, onClose, side, onAnswerAtDesk, openSessionId, onOpenSessionConsumed }: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [contacts, setContacts] = useState<readonly ContactView[]>([]);
  const [groups, setGroups] = useState<readonly DirectoryGroup[]>([]);
  const [letters, setLetters] = useState<readonly AwaitingLetter[]>([]);
  const [search, setSearch] = useState("");
  const [focus, setFocus] = useState<Focus>({ kind: "none" });
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<readonly MessageView[]>([]);
  const [messageBody, setMessageBody] = useState("");
  const [sending, setSending] = useState(false);
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
      const data = await res.json() as { groups: DirectoryGroup[]; letters: AwaitingLetter[] };
      setGroups(data.groups ?? []);
      setLetters(data.letters ?? []);
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

  function choosePerson(person: DirectoryEntry) {
    setFocus({ kind: "person", id: person.id });
    setRefusal(null);
    const session = sessionFor(person.id);
    if (session !== undefined) void openSession(session.sessionId);
    else { setActiveSessionId(null); setMessages([]); }
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
      const data = await res.json() as { status: string; sessionId?: string; explanation?: string; ladder?: { label: string }[] };
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
    setMessageBody("");
    try {
      const res = await fetch(
        `/api/games/${encodeURIComponent(gameId)}/conversations/${encodeURIComponent(activeSessionId)}/message`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) },
      );
      if (!res.ok) {
        setMessageBody(body);
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
        status: "found" | "unavailable"; sessionId?: string; explanation?: string;
        ladder?: { rung: string; label: string }[];
      };
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
              {letters.length > 0 && wanted.length === 0 && (
                <section className="letters__group">
                  <h3>Waiting on your answer</h3>
                  <ul className="letters__list">
                    {letters.map((entry) => (
                      <li key={entry.id}>
                        <button type="button" className="letters__person letters__person--letter" aria-current={focus.kind === "letter" && focus.id === entry.id ? "true" : undefined} onClick={() => { setFocus({ kind: "letter", id: entry.id }); setActiveSessionId(null); }}>
                          <strong><span className="seal-dot" aria-hidden="true" /> {entry.kindLabel}</strong>
                          <span>From {entry.fromLabel}</span>
                        </button>
                      </li>
                    ))}
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
                <p className="mirror__note">{letter.toYou ? "It is addressed to you." : "It is addressed to your government."} Answer it at the desk, as an order.</p>
                <div><button type="button" className="btn btn--primary" onClick={onAnswerAtDesk}>Answer at the desk</button></div>
              </article>
            )}

            {focused !== null && (
              <div className={activeContact !== null ? "letters__with letters__with--dossier" : "letters__dossier"}>
                <div className="letters__who">
                  <strong>{focused.name}</strong>
                  <span>{[focused.officeLabel, focused.polityLabel].filter(Boolean).join(", ")}</span>
                </div>
                {activeContact === null && (
                  <>
                    <dl className="mirror__facts">
                      {focused.whereLabel !== null && <><dt>Where</dt><dd>{focused.whereLabel}</dd></>}
                      {focused.standingLabel !== null && <><dt>Standing</dt><dd>{focused.standingLabel}</dd></>}
                      {focused.knownFor.length > 0 && <><dt>Known for</dt><dd>{focused.knownFor.join(", ")}</dd></>}
                      {focused.ties.length > 0 && <><dt>Between you</dt><dd>{focused.ties.join("; ")}</dd></>}
                      {focused.opinionLabel !== null && <><dt>What you think of them</dt><dd>{focused.opinionLabel}</dd></>}
                      {focused.how === "public" && <><dt>Known</dt><dd>By repute; you have never dealt with them.</dd></>}
                    </dl>
                    <p className="letters__reach-line">{focused.reachLabel}.</p>
                    {focused.reach === "out_of_reach" && focused.ladder.length > 0 && (
                      <div className="letters-form">
                        <p className="mirror__note">What it would take:</p>
                        <ol className="letters-form__ladder">{focused.ladder.map((step) => <li key={step}>{step}</li>)}</ol>
                      </div>
                    )}
                    {refusal !== null && (
                      <div className="letters-form">
                        <p className="letters-form__error" role="alert">{refusal.explanation}</p>
                        {refusal.ladder.length > 0 && <ol className="letters-form__ladder">{refusal.ladder.map((step) => <li key={step}>{step}</li>)}</ol>}
                      </div>
                    )}
                    <div className="letters-form__actions letters-form__actions--start">
                      <button type="button" className="btn btn--primary" disabled={approaching} onClick={() => void approach(focused)}>
                        {approaching ? "Sending for them…" : focused.reach === "here" ? `Speak with ${focused.name}` : focused.reach === "letter" ? `Write to ${focused.name}` : "Try anyway"}
                      </button>
                    </div>
                  </>
                )}
                {activeContact !== null && focused.knownFor.length > 0 && <span className="letters__known">Known for {focused.knownFor.join(", ")}</span>}
              </div>
            )}

            {focused === null && letter === null && activeContact !== null && (
              <div className="letters__with">
                <strong>{activeContact.knownName}</strong>
                <span>{activeContact.roleLabel}</span>
              </div>
            )}

            {letter === null && (activeContact !== null || focused === null) && (
              <div className="letters__transcript" aria-live="polite">
                {loadingMessages && <p className="letters__hint">Finding what was said…</p>}
                {!loadingMessages && activeContact === null && focused === null && (
                  <p className="letters__hint">Choose someone to speak with, or a letter to answer.</p>
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
                <div ref={messagesEndRef} />
              </div>
            )}

            {activeContact && letter === null && (
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
