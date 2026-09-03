# Interrupt and the Chronicles button (docs/14 Phase 5)

## What the architecture actually allows

The redesign brief asks for a control that "pauses Chronicle flow" and
"returns the player to the normal map/game screen" at "the next safe
committed-event boundary." Chronica's actual turn architecture is important
here: `resolveTurn` (`apps/web/lib/resolution/pipeline.ts`) resolves one
whole turn as a single, continuous, server-side async function -- there is
no player-facing "autoplay" that keeps advancing through multiple turns on
its own, and no mid-turn checkpoint a client can safely inject a pause into
without a much larger rewrite into a resumable step machine. What the client
already has, via `orders-panel.tsx`'s SSE stream
(`/api/games/[gameId]/resolution/stream`), is a live view of that one turn's
progress (`RESOLUTION_PROGRESS_STAGES`/`STEP_LABELS`).

Given that, "interrupt" is implemented as exactly what is safely possible
and still genuinely useful: **the player can stop watching the resolution
overlay and return to the map while resolution keeps running to completion
in the background.** This satisfies every real constraint in the brief:

- Committed history is never undone -- nothing was undone before either;
  `commitResolution` still runs exactly once, when the turn actually
  finishes, whether or not anyone was watching.
- The player is returned to the normal map/control interface immediately.
- Automatic flow resumes (i.e., the result becomes visible) only through
  explicit action -- opening the persistent Chronicles button below.

What it does *not* pretend to do: stop the simulation mid-flight, roll back
partial work, or let the player revise orders while a turn is still
resolving (the order batch for this turn is already locked in). Claiming
otherwise would be describing a feature that doesn't exist.

## The control

`orders-panel.tsx`'s full-screen resolution overlay gained a `dismissed`
state and a "Return to map" button, shown only while actively resolving
(there is nothing left to interrupt once it's done). Dismissing it hides the
overlay; the `EventSource` connection (`sseRef`) is untouched and keeps
receiving progress events and, eventually, the completion signal, which
still fires `onResolutionComplete` (offering the Chronicle) exactly as
before. Submitting a fresh order batch resets `dismissed` so the overlay
reappears for the new turn.

## The persistent Chronicles button

`chronicle-panel.tsx`'s toggle button was previously rendered only when
`phase === "news"`, positioned at an arbitrary offset from other buttons. It
is now **always rendered**, positioned directly beneath the Orders button
via a new `.chronicle-panel-toggle` CSS rule
(`top: calc(8rem + 44px + .75rem + 44px + .75rem); left: 1rem;` -- Orders'
own offset plus one button height and gap). Opening it always fetches and
displays the same `/api/games/[gameId]/chronicle` data Orders' own
completion handler already used -- the last completed turn's chronicle, read
in chronological order via the existing cursor/"Continue"/"Done reading"
flow. Reading it is, and was already, a pure read of already-persisted
entries: it does not call `resolveTurn`, so it never resumes simulation,
whether the player opens it between turns or while a resolution they
dismissed is still finishing in the background.

## What this phase deliberately does not do

It does not build a new autoplay/auto-advance system to interrupt (none
exists to interrupt), and it does not make an in-progress turn's order batch
editable. Both would be a materially larger change than "add an interrupt
control," and neither is implied by the actual current architecture.
