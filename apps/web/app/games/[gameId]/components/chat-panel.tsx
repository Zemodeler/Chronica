"use client";

import { useRef, useState, useEffect, useCallback, useMemo, type FormEvent } from "react";
import { Sheet, type SheetSide } from "../../../components/ui/sheet";

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

/**
 * The letter tray: the people the player can reach, and what has been said.
 *
 * A conversation reads as a transcript -- who spoke, and what they said --
 * the way a history records an exchange, not as chat bubbles.
 */
export function ChatPanel({ gameId, open, onClose, side, openSessionId, onOpenSessionConsumed }: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [contacts, setContacts] = useState<readonly ContactView[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<readonly MessageView[]>([]);
  const [messageBody, setMessageBody] = useState("");
  const [sending, setSending] = useState(false);
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
  // In a group, each line is spoken by one of its members; their names are
  // the player's contacts.
  const namesById = useMemo(() => new Map(contacts.filter((c) => !c.isGroup).map((c) => [c.npcCharacterId, c.knownName])), [contacts]);
  const speakerOf = (message: MessageView): string =>
    message.isPlayerMessage ? "You" : namesById.get(message.speakerCharacterId) ?? activeContact?.knownName ?? "They";

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
    void selectContact(openSessionId);
    onOpenSessionConsumed?.();
    // openSessionId is a one-shot signal from the parent; deliberately not
    // re-running when fetchContacts/selectContact identity changes.
  }, [openSessionId]);

  useEffect(() => {
    if (open) void fetchContacts();
    // Deliberately keyed on `open` alone: fetchContacts is re-created every
    // render and re-running it while the panel is already open would be a
    // second identical request.
  }, [open]);

  function closePanel() {
    setActiveSessionId(null);
    setMessages([]);
    onClose();
  }

  async function selectContact(sessionId: string) {
    setActiveSessionId(sessionId);
    setMessages([]);
    await fetchMessages(sessionId);
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
    setDiscoverQuery("");
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
      if (res.ok && data.sessionId) { setGroupOpen(false); await fetchContacts(); await selectContact(data.sessionId); }
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
        await selectContact(data.sessionId);
      }
    } catch {
      setDiscoverError("Something went wrong finding them. Try again.");
    } finally {
      setDiscovering(false);
    }
  }

  return (
    <>
      <Sheet label="your letters" title="Letters" width="reading" side={side} open={open} onClose={closePanel} className="sheet--wide sheet--letters">
        <div className="letters">
          <nav className="letters__people" aria-label="People you can reach">
            <div className="letters__people-head">
              <h3>People</h3>
              <div className="letters__people-actions">
                <button type="button" className="word-button" onClick={openDiscover}>Find someone</button>
                <button type="button" className="word-button" onClick={openGroup}>Gather several</button>
              </div>
            </div>
            {contacts.length === 0 && (
              <p className="letters__none">Nobody yet. Find someone nearby to speak with.</p>
            )}
            <ul className="letters__list">
              {contacts.map((contact) => (
                <li key={contact.sessionId}>
                  <button
                    type="button"
                    className="letters__person"
                    aria-current={activeSessionId === contact.sessionId ? "true" : undefined}
                    onClick={() => { void selectContact(contact.sessionId); }}
                  >
                    <strong>{contact.knownName}</strong>
                    <span>{contact.roleLabel}</span>
                    {contact.unread > 0 && <span className="badge">{contact.unread}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div className="letters__thread">
            {activeContact !== null && (
              <div className="letters__with">
                <strong>{activeContact.knownName}</strong>
                <span>{activeContact.roleLabel}</span>
              </div>
            )}
            <div className="letters__transcript" aria-live="polite">
              {loadingMessages && <p className="letters__hint">Finding what was said…</p>}
              {!loadingMessages && activeContact === null && (
                <p className="letters__hint">Choose someone to speak with.</p>
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

            {activeContact && (
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
        <Sheet label="finding someone" title="Find someone" width="narrow" side="center" onClose={() => setDiscoverOpen(false)}>
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
            {discoverLadder.length > 0 && <ul className="letters-form__ladder">
              {discoverLadder.map((step) => <li key={step.rung + step.label}>{step.label}</li>)}
            </ul>}
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
