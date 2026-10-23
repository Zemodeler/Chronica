# UI playtest prompt, round 6: a real player in the browser, model answered by hand

Paste everything below the line into a Claude Code session (or any agent with a shell **and** a browser tool), started in `C:\Users\andrei\Documents\Chronica`. Do not edit code while the run is going; fix afterwards.

This is round 6. **Read first**: `docs/playtests/ui-hand-playtest-prompt-3.md` (sections 0, 1, 4, 5, 6 stand), `ui-hand-playtest-prompt-4.md` (seat rule: the seat commands its army or fleet in fact), `ui-hand-playtest-prompt-5.md` (sections 0 and 2) and the round-5 report `docs/reports/2026-10-23-hanno-19m-ui-hand-run-5.md` (sections 4, 5, 10).
Tools in `docs/playtests/ui-run-tools/` (watcher, `wp.sh`, `empties.sh`, `show.sh`, `schema.mjs`, `fund.mts`, `answer-lib.mjs`); `RUN=ui-run6`, `CHRONICA_HAND_DIR=eval-out/ui-run6/hand`. Report: `docs/reports/<date>-<character>-<n>y-ui-hand-run-6.md`.

## 0. What round 5 taught (cheap mistakes to skip)

- **"Send" sends the order; "Let a season pass" only passes the time and keeps the draft.** Click Send (find it with `find`, then click by ref), wait for "Your order reaches the palace", and only then expect an orchestrate prompt. Two seasons were idled in round 5 by clicking the wrong button. A click on the typed box by `ref` works; a click by coordinate may miss it when the sheet has grown.
- Delta shapes that the server drops (read `server.err` for "dropped N thing(s)" after each orchestrate answer): `political_procedure_open` needs `reason`; `enacts.budget` takes `accountRef`, `amount`, `purpose` only. A dropped act keeps the model's facts, so the Chronicle will say it happened: write the facts only after you are sure of the act.
- A **commander may not make war** (the Council of Elders must) and a consul may. For a war you fight by order, pick a seat that can: a consul (Clepsina, Dentatus), a king (Hieron II was round 4), or open the Council motion first (Hanno: put the motion, vote it with `political_support_set` for the three groups, then order the siege).
- Compose retellings are checked against the books: a passage that says more than was done is refused and asked again. Say plainly what the part's line says.
- The tools: `wp.sh` lists unanswered prompts, `show.sh` prints the facts of the compose ones (orchestrate prompts: read the file, search `PLAYER ORDER`, `STANDING ORDERS`, `THE WORLD STIRS`). Use a Monitor `until` loop on unanswered prompts rather than sleeping.

## 1. Seat and run

A seat that **may make war and command in fact**: **Gaius Genucius Clepsina** or **Manius Curius Dentatus** (Rome), or **Hannibal Gisco** (fleet), or **Hanno of Carthage** again if you take the Council route first. Not Abdmelqart, Aristomachus, Hieron II. Play at least **540 days and 10 orders** (round 5 reached 569 days and 5 orders: the order count is the bar to keep). Plan the time: a season costs 20 to 40 prompts, mostly far-off compose news to answer with `empties.sh`.

## 2. Things to exercise (round 5 could not)

1. **A war made by order and a siege laid by order**, the army sheet read *during* the siege, and a Map tooltip against a decision card's odds ("about even", "nearly twice").
2. **An alarm**: an ultimatum, a tribute demand, or a protest that wants an answer by a day, addressed to you, stopping a burst and listed in Matters in hand with its day at that moment. Make one happen: a seat whose enemy has a king who writes first (a hand-written `diplomatic_message_send` from the king to you in your orchestrate answer for the world's stirring).
3. **A truce within 30 days of ending**: where it is shown, and whether it stops a burst.
4. **A chamber vote of money to spend** (a seat in a council): vote, spend the sum once, the mover among those "for".
5. **A decision card answered, then a reload**: the card must not return.
6. **Pay**: after hiring and paying, open the strongbox ("Going out"), the order sheet ("N paid down; M a month"), the ledger and the arms-rack tooltip; compare, and say which one is right.
7. **A secret plot against you, told to you**: its thread in Matters in hand after, not before.
8. **Two saves on one account** (newest created vs last played), reload from `/` and read "Reading the record…".

## 3. Regression checklist (round 5's fixes, look as a player)

- An order whose later part waits for something an earlier part does is never "Waiting" for its own arrival (round 5 fix 1: "Cross, hire, then march" must march).
- A refused act leaves **no fact** in the Chronicle or in the cognition prompts' "what they know" ("Hanno declared war" beside "may not make war" was the bug).
- A **part that follows a refused or failed part is told the same day** (still open: the siege waited ninety days after the war was refused). Record the day it is told.
- Standing orders listed **once** (still open: each listed twice in round 5).

## 4. Still open (record every instance with both quotes; do not expect a fix)

1. Order outcome lines against the books ("nothing came of it", "Stalled", "Under way, 0 paid down" beside the Chronicle's "done").
2. The strongbox "Going out" omits mercenary pay and "N a month to spare" does not move when men are hired.
3. A dropped invalid act keeps its facts ("Hanno put to the Council a motion" with the motion dropped).
4. The Active tab holds a refused part as "Needs your word" with no word the player can give and no name to ask.
5. Repeated failure headlines across windows; far-off news (Roman senators "worse", elections) crowding every season's compose.
6. A truce request lapsing unseen; the monthly "Ugly stories" rumour.

## 5. The report

As prompt 3's section 6, plus: each of section 2's eight items "done / not done" with a quote, section 3's four as fixed / not fixed with the day, section 4's as instances.

Finish by saying where the report is, the verdict, and the three things most worth fixing first. Then (the loop): fix what the run found that traces to a cause in `packages/` or `apps/`, with a failing test first, and write `docs/playtests/ui-hand-playtest-prompt-7.md`.
