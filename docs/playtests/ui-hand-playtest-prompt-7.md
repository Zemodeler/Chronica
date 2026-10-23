# UI playtest prompt, round 7: a real player in the browser, model answered by hand

Paste everything below the line into a Claude Code session (or any agent with a shell **and** a browser tool), started in `C:\Users\andrei\Documents\Chronica`. Do not edit code while the run is going; fix afterwards (stop your server first: the dev server reloads code under a running game).

This is round 7. **Read first**: `docs/playtests/ui-hand-playtest-prompt-3.md` (sections 0, 1, 4, 5, 6), `ui-hand-playtest-prompt-6.md` (sections 0 and 1), and the round-6 report `docs/reports/2026-10-23-clepsina-20m-ui-hand-run-6.md` (sections 3, 5, 10).
Tools in `docs/playtests/ui-run-tools/` (watcher, `wp.sh`, `empties.sh`, `show.sh`, `schema.mjs`, `fund.mts`, `answer-lib.mjs`); `RUN=ui-run7`, `CHRONICA_HAND_DIR=eval-out/ui-run7/hand`. Report: `docs/reports/<date>-<character>-<n>y-ui-hand-run-7.md`.

## 0. What round 6 taught (cheap mistakes to skip)

- **Start-up on a new port**: set `BETTER_AUTH_URL=http://127.0.0.1:<port>` on the `dev-env.mjs` line, or sign-up says "temporarily unavailable" (and may have created the account anyway: log in). Fund 5 coins with `fund.mts`; on `/games/new` submit the form with a click on the button (it is slow: wait).
- **Declaring a character**: the answer needs at least four `relations`, one with `category: "family"` and a `familyRole`; an answer that fails validation is cached by prompt hash, so reword the request in the box to ask again. A historical figure already in the world: `becomesCharacterId` is their id (`gaius-genucius`, `manius-curius`, `hieron-ii`).
- **Typing an order**: focus `#sim-order` (JS `.focus()`), then the `type` action; set the span by the select's native setter and a `change` event (`#sim-order-span`, 90 = a season); click Send with JS. The page header date does not refresh until the pane is shown: take a screenshot to force it.
- **Delta shapes** that are read: `force_raid` with `toAccountRef`; `money_transfer` with `fromAccountRef`/`toAccountRef`; `political_procedure_open` needs `reason`, `institutionRef` (`roman-senate`, `carthaginian-council`), `type` from a closed list (`vote`, `petition`, `denunciation`...), `enacts.budget` with `accountRef`, `amount`, `purpose`, `holderRef`; `force_engage.posture` is `offer_battle|avoid_battle|defend|hold`; `character_pressure_set.kind` is a closed list. Two parts of one order must not share an act (the second reads "Nothing came of it").
- **Cognition prompts held for a letter**: the watcher leaves them for you. Answer a letter to a king with `diplomatic_message_answer` (`messageRef` is the id printed in the prompt after the actor's name, not the burst's); a king may also send `ultimatum` or `protest` to the player with `toCharacterRef` the player.
- A background loop that answers leftover cognition with `{"actors":[]}` and compose with `{"entries":[]}` (`eval-out/ui-run6/auto.sh`) is fine for the tail of a round, never the middle.

## 1. Seat and run

A seat of a **different power** from rounds 5 and 6, that commands in fact and may make war: **Gaius Genucius Clepsina again is not allowed**; take **Manius Curius Dentatus** (Rome) only if you want the censor's side, or better **Hieron II** only for a short second look (round 4 played him), or **Hannibal Gisco** (Carthage's fleet: a fleet, siege by sea), **Statius Mettius** or **Decius Vibellius** (the small powers; Decius was killed in round 6's run after the siege). A power that is *attacked* and must answer demands is what this round needs: play the seat of a power that **receives** an ultimatum from a player-side king.
Play at least **540 days and 10 orders**; the round-6 pace (10 orders, 614 days) took about three hours.

## 2. Things to exercise (round 6 could not)

1. **An alarm, after the fix**: a demand sent to the player's power (ultimatum, protest, tribute demand) must **stop the burst on the day it arrives** and appear in Matters in hand and the tray *then*, with its day. Make one happen (a hand-written `diplomatic_message_send` from a neighbour in your orchestrate or cognition answer) and say: the day it was sent, the day it arrived, the day the burst stopped, what Matters in hand listed.
2. **A truce within 30 days of ending**: where it shows.
3. **A secret plot told to you**: the thread in Matters in hand only after it is told.
4. **Two saves** on one account: the home page's "newest created" against "last played" (play the older one last).
5. **An election in another power**: after a leader of a small power dies, the new one must be of that power (round 6 fix: empty seat requirements now ask the office).
6. **A decision card, answered**: the order list, the Chronicle and Matters in hand must not say "Nothing came of it" or "The ruler has answered…" (round 6 fix).
7. **A siege seen from the army sheet** (still open: "Holding position").
8. **The pay line** if you play a seat with hired men (Carthage): strongbox, order sheet, ledger, as in round 5.

## 3. Regression checklist (round 6's fixes, look as a player)

- A demand reaches the desk on its day (item 1).
- A leader elected for a small power belongs to it (item 5).
- A card's answer leaves no failed order (item 6).
- A wait says "waiting for X to reach Y", never "never reached" (read `Still waiting for…` in the Chronicle's order lines).
- Round 5's: a part held for a refused part fails the same day; a fact written only for a refused act is not told; a dropped act takes its facts with it (`salvage`); standing orders listed once; "Did not go ahead" for a refused or failed order in Orders under way; the pass button says "without sending" when a draft is typed.

## 4. Still open (record every instance with both quotes; do not expect a fix)

1. Order outcome lines against the books ("Under way", "Waiting on a vote", "Stalled" after the thing is done, or lost).
2. Three odds for one fight (card, battle line, figures); the army sheet "Holding position" in a siege; a standing order "Waiting" after what it waited on happened.
3. The commander's own army told as hearsay ("It was said that …", "news reaching the court").
4. One vote told three ways (could not decide, rejected, carried).
5. "Decided by now: …" / "Wants your word" for a vote that is the chamber's; "Known issue" rows.
6. Far-off news crowding the Chronicle; "Ugly stories" every month.

## 5. The report

As prompt 3's section 6, plus: each of section 2's eight items "done / not done" with a quote, section 3's as fixed / not fixed with the day, section 4's as instances.

Finish by saying where the report is, the verdict, and the three things most worth fixing first. Then (the loop): fix what the run found that traces to a cause in `packages/` or `apps/`, with a failing test first, and write `docs/playtests/ui-hand-playtest-prompt-8.md`.
