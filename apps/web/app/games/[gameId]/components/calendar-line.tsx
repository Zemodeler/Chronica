"use client";

import { useEffect, useState } from "react";
import type { CalendarItem } from "@chronica/shared";
import { Era } from "../../../components/ui/era";

/**
 * The next thing on the calendar, beside the date.
 *
 * The world leaps to the next moment that matters whenever an order is given,
 * and a player who could not see that moment coming lost a month without
 * knowing why. One quiet line says what is next; choosing it shows the few
 * after that. Nothing coming, nothing shown.
 *
 * The list is the browser's own popover, so Escape and a click elsewhere
 * close it without any code here.
 */
export function CalendarLine({ gameId, revision }: { readonly gameId: string; readonly revision: number }) {
  const [next, setNext] = useState<readonly CalendarItem[]>([]);

  useEffect(() => {
    let live = true;
    void fetch(`/api/games/${encodeURIComponent(gameId)}/calendar`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { next: CalendarItem[] } | null) => { if (live && data !== null) setNext(data.next); })
      .catch(() => undefined);
    return () => { live = false; };
    // Re-read when simulated time has moved: that is the only thing that changes it.
  }, [gameId, revision]);

  const first = next[0];
  if (first === undefined) return null;

  return (
    <div className="calendar-line">
      <button type="button" className="calendar-line__next" popoverTarget="calendar-coming">
        {first.needsYou && <span className="seal-dot"><span className="visually-hidden">Wants your word: </span></span>}
        <span className="visually-hidden">Coming: </span>
        <span className="calendar-line__label">{first.label}</span>{" "}
        <span className="calendar-line__when"><Era text={first.whenLabel} /></span>
      </button>
      <div id="calendar-coming" popover="auto" className="calendar-line__list on-papyrus">
        <h2>Coming</h2>
        <ol>
          {next.map((item) => (
            <li key={item.key} className={item.needsYou ? "needs-you" : undefined}>
              <span>{item.label}</span>
              <time><Era text={item.whenLabel} /></time>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
