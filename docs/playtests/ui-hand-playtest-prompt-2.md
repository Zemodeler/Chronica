# UI playtest prompt, round 2: a real player in the browser, model answered by hand

Paste everything below the line into a Claude Code session (or any agent with a shell **and** a browser tool: the Claude desktop
app's built-in browser, Claude in Chrome, or Playwright), started in `C:\Users\andrei\Documents\Chronica`. Do not edit code while it runs.

This is round 2 of `ui-hand-playtest-prompt.md`, written after the Decius Vibellius run (`docs/reports/2026-10-23-decius-vibellius-2y-ui-hand-run.md`)
and the fix pass that followed it. Read that report's section 4 (bugs) first: this round checks each fix from the page, then plays on.
The tools that run kept are now in `docs/playtests/ui-run-tools/` (watcher, wait/list scripts, coin-funding script, answer helpers).

---

You are two people at once, and must keep them apart.

- **The player.** You sit at the website and know only what the page shows. You never read the database, `state.json`, a prompt file, or the
  server log to decide what to do in the game.
- **The model.** The game asks a model to interpret orders, play other characters, voice letters and write the Chronicle. Those requests wait
  as files; as the model you read each prompt and write the answer. What you learn there stays on the model's side of the wall, and the report
  says each time it leaked into a player decision.

Write only inside `eval-out/<run>/` and the one report `docs/reports/<date>-<character>-<n>y-ui-hand-run-2.md`. Do not edit `packages/`,
`apps/` or `scripts/`.

## 0. Rules earlier rounds broke (read twice)

1. **Shell state does not persist between tool calls.** Put environment variables on the command line that uses them. Background processes started
   from a tool call may end with it; start the server and watcher with `Start-Process` (PowerShell) or `nohup` and check they are alive.
2. **The hand directory resolves under `apps/web/`.** `CHRONICA_HAND_DIR=eval-out/ui-run/hand` becomes `apps/web/eval-out/ui-run/hand` because
   `npm run dev --workspace @chronica/web` changes the working directory. Point every script at that path (the tools default to it).
3. **Answer every prompt, in the order of `queue.log`.** A request left unanswered holds the page's burst for ever.
4. **Write the model's reasons in the voice of the world.** The Chronicle prints a cognition answer's `reasoning` as "Accounts given at the time".
   Never write "the printed counsel says...", "no counsel was printed", or "I follow the counsel" in it (round 1 leaked this onto the page).
5. **Check enum values before writing a delta.** `node docs/playtests/ui-run-tools/schema.mjs <op>` and `--def <Name>`. Round 1 lost answers to
   `obligation_upsert` kind `wages` (use `army_pay`), `character_pressure_set` kind `kinship` (the list is closed), a class string over 80 characters,
   and a death year equal to the opening year. `character_intent_set` on the player is always refused.
6. **A passage must say no more than the world shows.** The engine re-asks a compose prompt that claims more than the order's status ("Your passage
   said more was done than the world shows"). Say plainly where the order stands, then tell the rest.
7. **Do not answer for what the page should have told you.** If a letter, a deadline or a decision appears on the page, deal with it as a player.
8. **Keep the player's wallet honest.** A new account has 0 coins; round 1 funded 5 coins through the real gift-code functions
   (`npx tsx --env-file=apps/web/.env.local docs/playtests/ui-run-tools/fund.mts <username>`). Do that only after you have looked at what the
   page tells an empty-wallet stranger, and say so in the report.
9. Never run more than two order-less turns in a row. Answer every letter, deadline and decision.

## 1. Start

1. `README.md` "Run locally" and the `CHRONICA_AI_MODE=hand` block of `.env.example`. Database: `scripts/start-local-database.ps1`; confirm port 5432.
2. Server (not `hosted.bat`):
   `node scripts/dev-env.mjs CHRONICA_AI_MODE=hand CHRONICA_HAND_RESPONDER=manual CHRONICA_HAND_DIR=eval-out/ui-run2/hand npm run dev --workspace @chronica/web -- -p 3300`
   Wait for `GET /api/health` (the first hit can take six seconds).
3. Watcher (stubs `write_mechanic`, `reconcile_facts`, `repair_deltas`, auto-fills `voice_letters`, and answers `simulate_cognition` with
   `{"actors":[]}` unless a letter from the player awaits that power):
   `node docs/playtests/ui-run-tools/watcher.mjs apps/web/eval-out/ui-run2/hand "<your character's name>"`.
   Start it after you know the character's name. It writes only what it is meant to; show its code in the report and count its answers.
4. Record the command, port, hand directory and the time of the first page.

## 2. Be a real player

1. Landing, `/sign-up`, `/worlds`, the Punic Wars card, "Choose who you will be". **Say how a stranger with an empty wallet fares on the character
   page** (the fix pass changed its wording; "Choosing a name only fills the box above" should now appear).
2. **Pick a seat nobody has played**: not Gaius Genucius, Hieron II, Hannibal Gisco, Statius Mettius or Decius Vibellius. Prefer one with money to run:
   Abdmelqart (Officer of the Accounts, Carthage), Himilco son of Gisgo, Aristomachus of Syracuse, Quintus Ogulnius, Manius Curius, Hanno of Carthage,
   Leptines of Syracuse, or a seat of your own. Choose one that has a **fleet or a treasury** so the economic goal can be met.
3. Open every place and sheet a player has (Office, each object, Map, tray, Chronicle, seal case every tab, books, arms rack, mirror, window) and
   screenshot each. For each ask: could a player tell what they command, own, who is near, what is due? In round 1 the window, laws, notes, the
   Peace table and Accounts tabs were never opened: open them.
4. Write `goals.md` with three goals (military, economic or fleet, diplomatic or political), numeric bars set after you have looked at the room.
5. **Play at least 1,100 days.** Prefer spans of a month or a season; a year-long span with many far-off powers costs dozens of compose prompts.
   Time each turn from "Send" to the result and record your own answering time separately.
6. Play as a person plays: ordinary language, misspellings, two requests in one order, an order the seat cannot give, a question, a letter written
   in the tray, an answer to a letter, a deadline, a decision card. If you cannot find how to do something a player should be able to do, that is a finding.
7. **Reload the page every season** (and once from `/`, "Continue"): the Chronicle, letters, orders and "Since your last order" must survive. In
   round 1 the page died on reload at day 988; a reload that fails is a High finding the moment it happens, and you then stop and say so.
8. Get into a war, a siege and a decision at least once each (change the goal, not the rules, if your seat is peaceful), and see an alarm.

## 3. Regression checklist: look at each fix as a player

For each, quote the page and say fixed / not fixed / not exercised.

1. **Far-off battles do not break the page.** After a war between powers you cannot see (Carthage and Syracuse, a Seleucid campaign) the Map still
   loads, `/games/<id>` reloads, and `GET /api/games/<id>/overlay` answers 200 (check from the browser's network tool).
2. **A decision is asked once.** Answer a decision card; it vanishes at once and does not return for the same question. Note any "Standing orders"
   it leaves behind and whether they make sense.
3. **The odds in a decision card are true.** The card names strength in words ("nearly twice", "about three to one", "many times over"). Compare
   with the army sheet and the Map tooltips.
4. **A town left bare says so.** Move the army out of a town of yours while an enemy stands in its province: within about a month the Chronicle
   should say that the town has no garrison of ours.
5. **Your own power writes no letters in your name.** Be tired of a war for some months. The Chronicle may say your officers urge a truce
   ("urged him to ask for ..."); no letter you did not write should appear in the tray.
6. **Alarms.** A truce within 30 days of ending, an ultimatum, a tribute demand and a protest that wants an answer by a day should each stop a burst
   and appear in Matters in hand with their day. Record which did.
7. **A raid on ground your army took from an enemy is allowed** ("raid the farms of the districts we conquered").
8. **A lapsed order says why and what to do** ("Lapsed: it was given and carried as an instruction ... give it again and say what you want to see").
9. **The pay line is true.** "Pay owed, though their chest still holds N that has not reached them" must match the ledger; "their chest is empty" only
   when it is.
10. **The character screen:** a failed declaration says what went wrong in words that fit ("incomplete or gave dates that do not fit"), and a
    real person alive in the opening year (death year equal to the year) is accepted.
11. Order outcome lines against the books: "ordered; no sign of it yet" while the ledger already shows the payment, "Stalled / Nothing came of it" in
    Matters in hand for an order the Chronicle called done. These were not fixed; record every instance with both quotes.
12. Still open from round 1, check and record: the home page's featured save (newest created, not last played), letters sent through an order not
    appearing in the tray thread, the order box hidden by a decision card, and the Council's "Since your last order" after a reload.

## 4. Be the model

The server writes `<hand dir>/<operation>-<hash>.prompt.txt` and waits for `<operation>-<hash>.json`; `queue.log` lists them in order;
`system-<operation>.txt` has each operation's instructions and schema.

| Operation | You |
|---|---|
| `write_mechanic`, `reconcile_facts`, `repair_deltas` | the watcher's stubs |
| `voice_letters` | the watcher's auto-fill (`autoletters.mjs`) |
| `simulate_cognition` | `{"actors":[]}` from the watcher unless a letter from the player awaits that power or a decision of the player is put to it; those you answer by hand. Follow the printed counsel unless you give a reason (in the world's voice, rule 4) against it. Count: followed / went against / no counsel |
| `simulate_orchestrate` | by hand, matching the order and nothing more. Helpers: `docs/playtests/ui-run-tools/answer-lib.mjs` (`base`, `fact`, `ch`, `po`, `fo`, `ruler`, `seedThread`). Answer every "WORLD STIRS" seed and every "COUNTRIES WITH NOBODY" entry (a leader or forces, by `force_create` with the existing ruler as commander where a ruler exists) |
| `compose_chronicle` | by hand, passage by passage, from each thread's own facts. `{"entries":[]}` is right for a matter that "has only gone on", for far-off news that is nobody's business, and when the prompt repeats a headline. Never use an automatic rule for these; if you must, disclose it and count |
| anything else | by hand, and list it |

Use `docs/playtests/ui-run-tools/waitp.sh 90` to wait for the next prompt and `show.sh` to see the facts of the pending ones. Write several answers in
one command. Keep counts: stubs, auto-filled, hand-written, hand-written empty.

## 5. The Chronicle, as the page shows it

After every turn read the Chronicle on the page and screenshot it. For each judge: did it say what mattered to this player (compare your notes), did it
repeat headlines, raw ids or template text, did it tell anything the player could not know, did it miss something the books or the tray showed.
Also judge the page as a reading experience: newest first, can a long turn be read, can an old turn be found, does the outcome sit with its passage,
are dates right, and does the Chronicle say *why* when something is lost.

## 6. Report: `docs/reports/<date>-<character>-<n>y-ui-hand-run-2.md`

1. Verdict first (*playable / playable with caveats / not playable*) with three reasons, and the last day reached.
2. What was played: seat, what it commands as the page shows it, goals and results, orders as typed and what the page said (a table), a dated timeline.
3. First-time experience, including the empty-wallet stranger.
4. The regression checklist of section 3, each item fixed / not fixed / not exercised with a quote.
5. New bugs by severity (High corrupts state, hides what the player needs or makes a goal unwinnable; Medium a rule or page that misbehaves; Low noise),
   each with turn, date, page, quote, and file and line if traced. Say when a failure is yours and not the game's.
6. Waiting: page time and your answering time separately, what the page said while waiting, any hung burst, how many compose prompts a season costs.
7. The Chronicle on the page: the table of section 5 for several turns, two or three passages verbatim, the reading judgement.
8. As a player: what you could not tell from the page.
9. What worked.
10. How far to trust this run: every stubbed, auto-filled and hand-written answer (counted, with cognition counsel counts), every leak from model to player,
    every sheet not opened, every turn whose Chronicle was not read in full, what was not exercised.
11. Verdict in three lines: goals met, worst bug, whether the page read as the story of this reign.

Finish by saying where the report is, the verdict, and the three things most worth fixing first.
