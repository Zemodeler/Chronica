# UI playtest prompt, round 8: a real player in the browser, model answered by hand

Paste everything below the line into a Claude Code session (or any agent with a shell **and** a browser tool), started in `C:\Users\andrei\Documents\Chronica`. Do not edit code while the run is going; stop your server before you fix.

This is round 8. **Read first**: `ui-hand-playtest-prompt-3.md` (sections 0, 1, 4, 5, 6), `ui-hand-playtest-prompt-7.md` (section 0 stands: start-up on a new port, declaring, typing an order, delta shapes), and the round-7 report `docs/reports/2026-10-23-mettius-20m-ui-hand-run-7.md` (sections 3, 5, 10). Tools in `docs/playtests/ui-run-tools/`; `RUN=ui-run8`, `CHRONICA_HAND_DIR=eval-out/ui-run8/hand`. Report: `docs/reports/<date>-<character>-<n>y-ui-hand-run-8.md`.

## 0. What round 7 taught

- **The tail of a run goes four times faster with a responder** that answers leftover `simulate_cognition` with `{"actors":[]}` and `compose_chronicle` with `{"entries":[]}` (copy `eval-out/ui-run7/auto.sh`); but then **the Chronicle is not read**. Choose which: round 8 should answer compose by hand for the first four orders (the order lines are where the contradictions are), then switch to the responder.
- A reusable orchestrate answer from a spec: `eval-out/ui-run7/ans/gen.mjs <hash> <spec.json>` (parts, deltas, facts as plain JSON).
- `date -u` against `queue.log`: the burst is working while the page header is still the old date; take a screenshot to wake a hidden pane, and read `grep -c "stopped on" server.log` to know a burst ended. A just-ended burst's Matters sheet can be stale: reload before reading it, and say so in the report.
- To make a demand reach the player: answer the cognition prompt of a king whose letter the player wrote with `diplomatic_message_answer` and a `diplomatic_message_send` of kind `ultimatum`/`protest`/`tribute_demand`, `toCharacterRef` the player, `replyWithinDays` a number, `onRefusal: "war"`. It arrives after the road (4 days Messana to Syracuse); the burst should stop that day.
- The tray's answer needs a typed reason before "Send your refusal" is enabled.

## 1. Seat and run

A power that **is attacked and fights back**: **Hannibal Gisco** (a fleet and Carthage), **Statius Mettius** again only with a war made (make it: refuse the ultimatum, then raid), or **Decius Vibellius** (the Campanians, besieged in Rhegium; round 6 killed him after the siege, so the seat lets you play the siege from inside). Play at least **540 days and 10 orders**.

## 2. Things to exercise (rounds 6 and 7 could not)

1. **A siege suffered or laid, and the army sheet** (still open: "Holding position"). Say what the sheet says on the day a siege is laid.
2. **A truce within 30 days of ending**: where it shows, and whether it stops a burst on its day.
3. **A revealed secret plot**: after it is told to you (through the model: a `storyline_advance` with a fact the player may know), its thread must appear in Matters in hand. Say if it did.
4. **An election in another power after a leader dies**: the new leader must be of that power (round 6 fix). Make a small leader die (`character_state_set` with health) and let the election run.
5. **A decision card answered**: read the order list, the Chronicle and Matters in hand for "Nothing came of it" or "The ruler has answered" (round 6 fix).
6. **The agenda after a burst**: open Matters in hand at once, then after a reload; say whether they agree.
7. **A tribute demand and a protest** reaching you (not only an ultimatum), each with its day.
8. **Hired men's pay** (Carthage): strongbox, order sheet, ledger (round 5 open item).

## 3. Regression checklist (round 7's fixes, look as a player)

- The home page features the save last played (play the older one last, then read `/`).
- The character card's draft and its "Starting money" agree.
- The alarm: sent day, delivered day, stopped day, listed day.
- Round 6's: an election asks the office; a card's answer is not a failed order; a wait says "to reach", not "never reached".

## 4. Still open (record every instance with both quotes; do not expect a fix)

1. Order lines against the books ("Under way", "Waiting on a vote", "Stalled", "Needs your word — Nothing came of it. … it needs no act").
2. The commander's own army told as hearsay ("It was said that …").
3. The agenda stale right after a burst; a tray answer's greyed button with no word why.
4. One vote told three ways; three odds for one fight; a standing order "Waiting" after what it waited on happened.
5. "Still open" as the Chronicle's last line on the home page.

## 5. The report

As prompt 3's section 6, plus: section 2's eight items done / not done with a quote, section 3's as fixed / not fixed, section 4's as instances.

Finish by saying where the report is, the verdict, and the three things most worth fixing first. Then (if you are looping): fix what traces to a cause in `packages/` or `apps/`, with a failing test first, and write `docs/playtests/ui-hand-playtest-prompt-9.md`.
