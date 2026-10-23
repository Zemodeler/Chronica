# UI playtest prompt, round 5: a real player in the browser, model answered by hand

Paste everything below the line into a Claude Code session (or any agent with a shell **and** a browser tool), started in `C:\Users\andrei\Documents\Chronica`. Do not edit code while the run is going; fix afterwards.

This is round 5. **Read first**: `docs/playtests/ui-hand-playtest-prompt-3.md` (its sections 0, 1, 4, 5 and 6 stand: rules, start-up, being the model, reading the Chronicle, the report), `ui-hand-playtest-prompt-4.md` (seat rule: the seat must command its army or fleet in fact; section 1's ten things),
and the round-4 report `docs/reports/2026-10-23-hieron-ii-7m-ui-hand-run-4.md` (sections 4, 5, 10). Tools in `docs/playtests/ui-run-tools/` (watcher, `wp.sh`, `empties.sh`, `show.sh`, `schema.mjs`, `fund.mts`, `answer-lib.mjs`); `RUN=ui-run5`, `CHRONICA_HAND_DIR=eval-out/ui-run5/hand`.
Report: `docs/reports/<date>-<character>-<n>y-ui-hand-run-5.md`.

## 0. What rounds 2 to 4 taught (cheap mistakes to skip)

- The browser: a click on a sheet's "Close" is at about (665,85) for the Council and Matters in hand, (710,83) for Letters, (758,85) for the treasury, (415,86) for the army sheet; sheets that look closed stay in the page's text, so read `document.body.innerText` for the *latest* sheet (search for its heading), and after a reload wait ~15 s before clicking.
- A tray letter with a pending answer shows radio choices ("Accept / Refuse / Write back with terms of your own"), a box, and a button ("Send your acceptance / refusal"); the button sits below the fold, scroll the sheet (`scroll` at (480,450)) before clicking it.
- Answer files: valid JSON always. A cognition prompt the watcher holds for a letter of yours must be answered (`{"actors":[...]}`) even if only `{"actors":[]}`. `delegation.ask.ref` must be a real id of what it names.
- The hold you give a force with `force_modify hold: true` stays: a later card answer "fight" is then refused by your own model answer. If you give a hold, lift it before a fight you want (`hold: false`).
- Each order of more than ~160 characters is split into 1 to 4 model calls (one per command sentence); a sentence of fact stays with its command since round 4's fix. Count the prompts an order costs.

## 1. Seat and run

Seat: choose one that **commands in fact** and that has not been played: **Hanno of Carthage** (check his army sheet first), **Hannibal Gisco** (the fleet), **Gaius Genucius Clepsina** or **Manius Curius Dentatus** (Rome), **Statius Mettius** or **Decius Vibellius** (small powers with real armies), or **Himilco son of Gisgo** if his sheet shows men. Not Abdmelqart, Aristomachus, Hieron II.
Play at least **540 days and 10 orders** (hold to this: rounds 3 and 4 stopped at 351 and 217). A season costs 15 to 35 prompts; plan the time, answer `compose_chronicle` with `empties.sh` where the news is far-off or a repeat.

## 2. Things to exercise (round 4 did not)

1. **A tribute demand and a protest that wants an answer by a day, addressed to you**, each stopping a burst and appearing in the tray and in Matters in hand *with its day at the moment the burst stops* (round 4: the ultimatum was listed in Matters in hand only on the next burst; a truce request lapsed unseen once).
2. **A truce within 30 days of ending**: say whether it stops a burst and where it is shown.
3. **The pay line against the ledger and the strongbox**: after paying an army from a chest, open the ledger, the strongbox and the arms-rack tooltip and compare ("nobody has undertaken to pay them" beside a paid chest in round 4).
4. **Open the Map and its tooltips** and compare a decision card's odds ("about even", "nearly twice") with the figures a tooltip or the army sheet gives; open the army sheet *during* a siege and say what it says ("Holding position" in round 3).
5. **A reload mid-season, and from `/`**: the Council and Chronicle say "Reading the record..." while loading (round 3's fix), never the empty-state words.
6. **A secret plot against you** (the model's seeds make some): after it has been told to you, its thread may appear in Matters in hand; before, it must not (round 3's fix). Say what you saw.
7. **A chamber vote of money for you to spend** (needs a seat in a council: Roman consul, a Carthaginian suffete): vote, then spend the sum once, with no second motion; the mover's name among those "for" (round 2's fixes, never exercised since).
8. **A decision card answered, then a reload**: the card must not return (round 3 and 4: fixed; confirm once from a reload).
9. Two saves on one account: **newest created vs last played** on the home page (round 4 could not tell: play the *older* save last, after creating a second).

## 3. Still open (record every instance with both quotes; do not expect a fix)

1. **Order outcome lines against the books** (round 4: six instances): "nothing came of it" / "ordered; no sign of it yet" / "Stalled" / "failed" beside the Chronicle's "done" (levy, convoy, pay, raid, "hear terms"). Fixing it needs `orderPartStatus` (`packages/shared/src/authority/under-way.ts`).
2. **The page says "refused" for a decision the engine took** (the answer to a card is applied by `answerEngagement`; the order line then reports the model's attempt).
3. An order the player never typed reported as failed ("March Syracusan army to Coastal Sicelia.").
4. Repeated headlines in a season; stale "face each other" lines; "ships slipped into" four times.
5. A truce request lapsing in silence against a standing instruction to hear it.
6. A monthly "Ugly stories" rumour; private matters in a foreign king's section of the model prompt.

## 4. The report

As prompt 3's section 6, plus: each of section 2's nine items "done / not done" with a quote, and section 3's items as instances.

Finish by saying where the report is, the verdict, and the three things most worth fixing first. Then (the loop): fix what the run found that traces to a cause in `packages/` or `apps/`, with a failing test first, and write `docs/playtests/ui-hand-playtest-prompt-6.md`.
