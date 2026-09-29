"use client";

import type { CalendarItem, MatterFocus, MatterPart, Matters } from "@chronica/shared";
import { Era } from "../../../components/ui/era";
import { Tip, TipCard } from "../../../components/ui/tip";
import { LinkedName, ThreadName, useGlossary, useThreads, Why } from "./notes";

/**
 * The next thing on the calendar, beside the date, and behind it everything
 * in hand.
 *
 * The world leaps to the next moment that matters whenever an order is
 * given, and a player who could not see that moment coming lost a month
 * without knowing why. One quiet line says what is next. Pointing at it
 * opens Matters in hand (`mattersInHand`): what is coming, what wants the
 * player's word, votes carried and never carried out, promises either way,
 * orders under way, and wars. Hold still and it pins, and every name in it
 * opens a note of its own. Each row can open the Chronicle at its thread,
 * because everything that happens is told there.
 */
export function CalendarLine({ items, matters, onOpenChronicle }: {
  readonly items: readonly CalendarItem[];
  readonly matters: Matters | null;
  readonly onOpenChronicle: (focus: MatterFocus) => void;
}) {
  const first = items[0];
  const wanting = matters?.wanting ?? 0;
  if (first === undefined && (matters === null || matters.sections.length === 0)) return null;

  return (
    <div className="calendar-line">
      <Tip
        label="Matters in hand"
        className="calendar-line__next"
        note={() => <MattersNote items={items} matters={matters} onOpenChronicle={onOpenChronicle} />}
      >
        {(wanting > 0 || first?.needsYou === true) && <span className="seal-dot"><span className="visually-hidden">Wants your word: </span></span>}
        {first === undefined
          ? <span className="calendar-line__label">Matters in hand</span>
          : (
            <>
              <span className="visually-hidden">Coming: </span>
              <span className="calendar-line__label">{first.label}</span>{" "}
              <span className="calendar-line__when"><Era text={first.whenLabel} /></span>
            </>
          )}
        {wanting > 0 && <span className="calendar-line__wanting"> · {wanting === 1 ? "one wants your word" : `${wanting} want your word`}</span>}
      </Tip>
    </div>
  );
}

function MattersNote({ items, matters, onOpenChronicle }: {
  readonly items: readonly CalendarItem[];
  readonly matters: Matters | null;
  readonly onOpenChronicle: (focus: MatterFocus) => void;
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
    .slice(0, 6);
  return (
    <TipCard kicker="The calendar" title="Matters in hand">
      <div className="matters">
        {items.length > 0 && (
          <section>
            <h3>Coming</h3>
            <ol>
              {items.map((item) => (
                <li key={item.key} className={item.needsYou ? "is-marked" : undefined}>
                  <span>{item.label}</span>
                  <time><Era text={item.whenLabel} /></time>
                </li>
              ))}
            </ol>
          </section>
        )}
        {(matters?.sections ?? []).map((section) => (
          <section key={section.section}>
            <h3>{section.label}</h3>
            <ol>
              {section.rows.map((row) => (
                <li key={row.key} className={row.marked ? "is-marked" : undefined}>
                  <span><Parts parts={row.parts} /></span>
                  {(row.detail !== null || row.focus !== null) && (
                    <small>
                      {warOf(row.key) !== null && <span>The war is <Why word={warOf(row.key)!.headline} why={warOf(row.key)!.why} kicker="How the war goes" />.</span>}
                      {row.detail}
                      {row.focus !== null && (
                        <button type="button" className="matters__thread" onClick={() => onOpenChronicle(row.focus!)}>
                          In the Chronicle
                        </button>
                      )}
                    </small>
                  )}
                </li>
              ))}
            </ol>
          </section>
        ))}
        {known.length > 0 && (
          <section>
            <h3>Threads</h3>
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

function Parts({ parts }: { readonly parts: readonly MatterPart[] }) {
  return <>{parts.map((part, index) => (typeof part === "string" ? <span key={index}>{part}</span> : <LinkedName key={index} linked={part} />))}</>;
}
