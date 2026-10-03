"use client";

import { useWindowState } from "../../../components/ui/window-workspace";
import { Sheet } from "../../../components/ui/sheet";
import { Tabs } from "../../../components/ui/tabs";
import type { Agenda, AgendaDestination, AgendaItem, CalendarItem, EntityNote, Matters } from "@chronica/shared";
import { Era } from "../../../components/ui/era";
import { Tip, TipCard } from "../../../components/ui/tip";
import { LinkedName, Linkify, ThreadName, useGlossary, useThreads, Why } from "./notes";

/**
 * The next thing on the calendar, beside the date, and behind it the agenda.
 *
 * The world leaps to the next moment that matters whenever an order is given,
 * and a player who could not see that moment coming lost a month without
 * knowing why. One quiet line says what is next -- that stays as it was.
 * Pointing at it opens the agenda (`buildAgenda`): three short groups, what
 * needs the player's attention, what is coming soon, and what is going on,
 * each thing once however many sheets it also lives on. An item shows what it
 * is, when it matters and where it stands; selecting it shows the context and
 * a way to the sheet it belongs to. Each group shows its first few and keeps
 * the rest a click away, so the first view stays short.
 */
export function CalendarLine({ items, matters, agenda, onGo, onOpen }: {
  readonly items: readonly CalendarItem[];
  readonly matters: Matters | null;
  readonly agenda: Agenda | null;
  /** Take the player to the sheet an item belongs to. */
  readonly onGo: (to: AgendaDestination) => void;
  readonly onOpen?: (() => void) | undefined;
}) {
  const first = items[0];
  // Counted across the whole government: the room marks only the ones kept in it, so the two numbers differ (R59).
  const wanting = agenda?.wanting ?? matters?.wanting ?? 0;
  const nothing = agenda === null || agenda.groups.length === 0;
  if (onOpen !== undefined) return <div className="calendar-line"><button type="button" className="calendar-line__next" onClick={onOpen}>{wanting > 0 && <span className="seal-dot" />}<span>Matters in hand{wanting > 0 ? ` (${wanting})` : ""}</span></button></div>;
  if (first === undefined && nothing && (matters === null || matters.sections.length === 0)) return null;

  return (
    <div className="calendar-line">
      <Tip
        label="The agenda"
        className="calendar-line__next"
        note={() => <AgendaNote agenda={agenda} wanting={wanting} onGo={onGo} />}
      >
        {(wanting > 0 || first?.needsYou === true) && <span className="seal-dot"><span className="visually-hidden">Wants your word: </span></span>}
        {first === undefined
          ? <span className="calendar-line__label">The agenda</span>
          : (
            <>
              <span className="visually-hidden">Coming: </span>
              <span className="calendar-line__label">{first.label}</span>{" "}
              <span className="calendar-line__when"><Era text={first.whenLabel} /></span>
            </>
          )}
      </Tip>
    </div>
  );
}

/** How many of a group show before the rest are asked for. */
const SHOWN_FIRST = 3;

type WarNote = Extract<EntityNote, { kind: "power" }>["war"];

export function AgendaNote({ agenda, wanting, onGo }: {
  readonly agenda: Agenda | null;
  readonly wanting: number;
  readonly onGo: (to: AgendaDestination) => void;
}) {
  const { threads } = useThreads();
  const glossary = useGlossary();
  /** A war row says how the war goes, from the enemy's note. */
  const warOf = (key: string) => {
    const note = key.startsWith("war:") ? glossary[`power:${key.slice(4)}`] : undefined;
    return note?.kind === "power" ? note.war : null;
  };
  // Threads followed first, then those with news, then the rest.
  const known = Object.values(threads)
    .filter((thread) => thread.phase !== "closed" || thread.followed)
    .sort((a, b) => Number(b.followed) - Number(a.followed) || b.unread - a.unread || a.title.localeCompare(b.title))
    .slice(0, 3);
  const [openKey, setOpenKey] = useWindowState<string | null>("agenda:open", null);
  const [expanded, setExpanded] = useWindowState<readonly string[]>("agenda:expanded", []);
  const groups = agenda?.groups ?? [];

  return (
    <TipCard kicker="The calendar" title="The agenda">
      <div className="matters agenda">
        {wanting > 0 && <p className="agenda__wanting">{wanting === 1 ? "One matter wants your word." : `${wanting} matters want your word.`}</p>}
        {groups.length === 0 && <p className="quiet">Nothing is open to you.</p>}
        {groups.map((group) => {
          const all = expanded.includes(group.group);
          const shown = all ? group.items : group.items.slice(0, SHOWN_FIRST);
          const hidden = group.items.length - shown.length;
          return (
            <section key={group.group} className={`agenda__group agenda__group--${group.group}`} aria-label={group.label}>
              <h3>{group.label}<small>{group.items.length}</small></h3>
              <ol>
                {shown.map((item) => (
                  <AgendaRow
                    key={item.key}
                    item={item}
                    open={openKey === item.key}
                    war={warOf(item.key)}
                    onToggle={() => setOpenKey((was) => (was === item.key ? null : item.key))}
                    onGo={onGo}
                  />
                ))}
              </ol>
              {(hidden > 0 || (all && group.items.length > SHOWN_FIRST)) && (
                <button
                  type="button"
                  className="agenda__more"
                  onClick={() => setExpanded((was) => all ? was.filter((key) => key !== group.group) : [...was, group.group])}
                >
                  {all ? "Show fewer" : `Show ${hidden} more`}
                </button>
              )}
            </section>
          );
        })}
        {known.length > 0 && (
          <section className="agenda__threads" aria-label="Threads of history">
            <h3>Threads of history</h3>
            <ol>
              {known.map((thread) => (
                <li key={thread.id} className={thread.unread > 0 ? "is-marked" : undefined}>
                  <span><ThreadName id={thread.id} /></span>
                  <time>{thread.followed ? `${thread.phaseLabel} · followed` : thread.phaseLabel}</time>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </TipCard>
  );
}

export function AgendaPanel({ agenda, onGo, onClose }: { readonly agenda: Agenda | null; readonly onGo: (to: AgendaDestination) => void; readonly onClose: () => void }) {
  const groups = ["attention", "soon", "ongoing"] as const;
  const labels = { attention: "Needs your answer", soon: "Coming soon", ongoing: "Ongoing" };
  return <Sheet label="matters in hand" title="Matters in hand" width="desk" side="center" onClose={onClose} className="agenda-panel">
    {agenda === null ? <p className="quiet" role="status">Sending for the agenda…</p> : <Tabs label="Matters in hand" sections={groups.map((group) => ({
      id: group, title: labels[group], marked: group === "attention" && agenda.wanting > 0,
      content: <AgendaNote agenda={{ groups: agenda.groups.filter((entry) => entry.group === group), wanting: group === "attention" ? agenda.wanting : 0 }} wanting={group === "attention" ? agenda.wanting : 0} onGo={onGo} />,
    }))} />}
  </Sheet>;
}

function AgendaRow({ item, open, war, onToggle, onGo }: {
  readonly item: AgendaItem;
  readonly open: boolean;
  readonly war: WarNote | null;
  readonly onToggle: () => void;
  readonly onGo: (to: AgendaDestination) => void;
}) {
  return (
    <li className={item.marked ? "agenda__item is-marked" : "agenda__item"}>
      <button type="button" className="agenda__head" aria-expanded={open} onClick={onToggle}>
        <span className="agenda__title">
          {item.title.map((part, index) => <span key={index}>{typeof part === "string" ? part : part.label}</span>)}
        </span>
        <span className="agenda__when">{item.when === null ? "" : <Era text={item.when} />}</span>
        <span className="agenda__status">{item.status}</span>
      </button>
      {open && (
        <div className="agenda__context">
          {war !== null && <p>The war is <Why word={war.headline} why={war.why} kicker="How the war goes" />.</p>}
          {item.title.some((part) => typeof part !== "string") && <p>{item.title.filter((part) => typeof part !== "string").map((part, index) => typeof part === "string" ? null : <span key={index}>{index > 0 && ", "}<LinkedName linked={part} /></span>)}</p>}
          {item.context.map((line) => <p key={line}><Linkify text={line} /></p>)}
          {item.context.length === 0 && war === null && <p className="quiet">Nothing more is recorded about it.</p>}
          {item.go !== null && (
            <button type="button" className="agenda__go" onClick={() => onGo(item.go!.to)}>
              {item.go.label}
            </button>
          )}
        </div>
      )}
    </li>
  );
}
