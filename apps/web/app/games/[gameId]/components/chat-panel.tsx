"use client";

import { useRef, useState, useEffect, useCallback, type FormEvent } from "react";

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
}

export function ChatPanel({ gameId, playerCharacterId }: ChatPanelProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const discoverDialogRef = useRef<HTMLDialogElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [contacts, setContacts] = useState<readonly ContactView[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<readonly MessageView[]>([]);
  const [messageBody, setMessageBody] = useState("");
  const [sending, setSending] = useState(false);
  const [discoverQuery, setDiscoverQuery] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const activeContact = contacts.find((c) => c.sessionId === activeSessionId) ?? null;

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
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function openPanel() {
    setOpen(true);
    dialogRef.current?.showModal();
    void fetchContacts();
  }

  function closePanel() {
    setOpen(false);
    setActiveSessionId(null);
    setMessages([]);
    dialogRef.current?.close();
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
    discoverDialogRef.current?.showModal();
  }

  function closeDiscover() {
    discoverDialogRef.current?.close();
  }

  async function handleDiscover(event: FormEvent) {
    event.preventDefault();
    const query = discoverQuery.trim();
    if (!query || discovering) return;
    setDiscovering(true);
    setDiscoverError(null);
    try {
      const res = await fetch(
        `/api/games/${encodeURIComponent(gameId)}/conversations/discover`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) },
      );
      if (!res.ok) {
        setDiscoverError("Could not reach the server. Please try again.");
        return;
      }
      const data = await res.json() as { status: "found" | "unavailable"; sessionId?: string; explanation?: string };
      if (data.status === "unavailable") {
        setDiscoverError(data.explanation ?? "No one matching that description could be found nearby.");
        return;
      }
      if (data.sessionId) {
        closeDiscover();
        await fetchContacts();
        await selectContact(data.sessionId);
      }
    } catch {
      setDiscoverError("An error occurred. Please try again.");
    } finally {
      setDiscovering(false);
    }
  }

  void open;

  return (
    <>
      <button className="chat-open-button" onClick={openPanel} aria-label="Open chat panel">💬</button>

      <dialog ref={dialogRef} className="chat-panel-dialog" onClose={closePanel}>
        <div className="chat-panel-layout">
          {/* Contact list */}
          <aside className="chat-contact-list">
            <div className="chat-contact-list-header">
              <span className="chat-contact-list-title">Contacts</span>
              <button type="button" className="chat-add-contact-button" onClick={openDiscover} aria-label="Add contact">+</button>
            </div>
            {contacts.length === 0 && (
              <p className="chat-no-contacts">No contacts yet. Use + to add someone nearby.</p>
            )}
            <ul className="chat-contact-items">
              {contacts.map((contact) => (
                <li key={contact.sessionId}>
                  <button
                    type="button"
                    className={`chat-contact-item${activeSessionId === contact.sessionId ? " chat-contact-item--active" : ""}`}
                    onClick={() => { void selectContact(contact.sessionId); }}
                  >
                    <span className="chat-contact-name">{contact.knownName}</span>
                    <span className="chat-contact-role">{contact.roleLabel}</span>
                    {contact.unread > 0 && <span className="chat-unread-badge">{contact.unread}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          {/* Message thread */}
          <div className="chat-thread-pane">
            <div className="chat-thread-header">
              {activeContact ? (
                <>
                  <strong className="chat-thread-npc-name">{activeContact.knownName}</strong>
                  <span className="chat-thread-role">{activeContact.roleLabel}</span>
                </>
              ) : (
                <span className="chat-thread-placeholder">Select a contact</span>
              )}
              <button type="button" className="chat-close-button" onClick={closePanel} aria-label="Close chat">×</button>
            </div>

            <div className="chat-messages">
              {loadingMessages && <p className="chat-loading">Loading…</p>}
              {!loadingMessages && activeContact === null && (
                <p className="chat-empty-hint">Choose a contact to start a conversation.</p>
              )}
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`chat-bubble${msg.isPlayerMessage ? " chat-bubble--player" : " chat-bubble--npc"}`}
                >
                  {msg.body}
                </div>
              ))}
              {sending && <div className="chat-bubble chat-bubble--npc chat-bubble--typing">…</div>}
              <div ref={messagesEndRef} />
            </div>

            {activeContact && (
              <form className="chat-composer" onSubmit={(e) => { void handleSend(e); }}>
                <input
                  className="chat-composer-input"
                  type="text"
                  value={messageBody}
                  onChange={(e) => setMessageBody(e.target.value)}
                  placeholder="Write a message…"
                  disabled={sending}
                  autoComplete="off"
                />
                <button type="submit" className="chat-composer-send" disabled={sending || !messageBody.trim()}>
                  Send
                </button>
              </form>
            )}
          </div>
        </div>
      </dialog>

      {/* Add contact dialog */}
      <dialog ref={discoverDialogRef} className="chat-discover-dialog">
        <form onSubmit={(e) => { void handleDiscover(e); }}>
          <div className="chat-discover-header">
            <h2 className="chat-discover-title">Add a Contact</h2>
            <button type="button" onClick={closeDiscover} aria-label="Close">×</button>
          </div>
          <p className="chat-discover-hint">
            Who do you want to contact? Describe a person nearby — their name, role, or relationship to you.
          </p>
          <input
            className="chat-discover-input"
            type="text"
            value={discoverQuery}
            onChange={(e) => setDiscoverQuery(e.target.value)}
            placeholder="e.g. the garrison commander, Marcus Fabius…"
            disabled={discovering}
            autoFocus
          />
          {discoverError && <p className="chat-discover-error">{discoverError}</p>}
          <div className="chat-discover-actions">
            <button type="button" className="btn-secondary" onClick={closeDiscover}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={discovering || !discoverQuery.trim()}>
              {discovering ? "Searching…" : "Find"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
