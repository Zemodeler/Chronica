# UI playtest prompt, round 3: a real player in the browser, model answered by hand

Paste everything below the line into a Claude Code session (or any agent with a shell **and** a browser tool: the Claude desktop app's built-in
browser, Claude in Chrome, or Playwright), started in `C:\Users\andrei\Documents\Chronica`. Do not edit code while the run is going; fix afterwards.

This is round 3 of `ui-hand-playtest-prompt.md` and `ui-hand-playtest-prompt-2.md`. Read the round-2 report first
(`docs/reports/2026-10-23-abdmelqart-1y-ui-hand-run-2.md`, sections 4, 5 and 10). Round 2 played a seat that holds offices and no army (an accountant) and so never
met a war, a siege, a decision card or an alarm: **this round must**. Tools are in `docs/playtests/ui-run-tools/` (watcher, `wp.sh`, `empties.sh`, `show.sh`, `schema.mjs`, `fund.mts`, `answer-lib.mjs`).

---

You are two people at once, and must keep them apart.

- **The player.** You sit at the website and know only what the page shows. You never read the database, `state.json`, a prompt file or the server log to decide what to do in the game.
- **The model.** The game asks a model to interpret orders, play other characters, voice letters and write the Chronicle. Those requests wait as files; as the model you read each prompt and write the answer.
  What you learn there stays on the model's side of the wall, and the report says each time it leaked into a player decision.

Write only inside `eval-out/<run>/` and the one report `docs/reports/<date>-<character>-<n>y-ui-hand-run-3.md`. Do not edit `packages/`, `apps/` or `scripts/`.
Use `RUN=ui-run3` in the environment of every script call (they default to it).

## 0. Rules earlier rounds broke (read twice)

1. **Shell state does not persist between tool calls.** Put environment variables on the command line that uses them. Start the server and watcher with `Start-Process` (PowerShell) and check they live.
2. **Check the port first.** `Get-NetTCPConnection -LocalPort 3300` before starting. Round 2 found an old dev server (a different hand directory) already on 3300; its health check answered mine. If 3300 is taken use 3301 and say so; do not stop a server you did not start.
3. **The hand directory resolves under `apps/web/`**: `CHRONICA_HAND_DIR=eval-out/ui-run3/hand` is `apps/web/eval-out/ui-run3/hand`. The notes, answers and logs you write go in `eval-out/ui-run3/`.
4. **Answer every prompt, in the order of `queue.log`.** A request left unanswered holds the burst. **An answer must be valid JSON**, including `dialogue_ordinary` (answer with a JSON *string*: `node -e 'fs.writeFileSync(f, JSON.stringify(text))'`).
   A bare-text answer is "caught half-written" and waits for ever.
5. **Operations a tray letter brings**: `dialogue_ordinary` (the reply, a JSON string), then `propose_social_events` (`{"events":[]}` unless the exchange changed something; see its system file) and `extract_knowledge` (`{"entries":[{"body":"...","contradicts":[]}]}` or `{"entries":[]}`).
6. **Write the model's reasons in the voice of the world** ("Accounts given at the time"). Never "the printed counsel says...".
7. **Check enum values before writing a delta**: `SYSTEM_FILE=apps/web/eval-out/ui-run3/hand/system-simulate_orchestrate.txt node docs/playtests/ui-run-tools/schema.mjs <op>`; `--def <Name>` does not exist for every name (`Summary` crashed); to read a type use a short `node -e` on the schema JSON.
   Known traps: `obligation_upsert` kind `army_pay`; `character_pressure_set` kinds are a closed list; `character_create` needs `kin`, `officeLabel` and `provinceId`; `service_contract_open` counts `advance + monthlyPay x ceil(termDays/30)` against a voted budget, so a 12-month contract can exceed the vote;
   `force_provision` with `how: "convoy"` needs `fromProvinceId`; `trade_venture_open` has no credit field (the engine reads "on credit" in the player's order); a carried budget (`enacts.budget`) names its spender in `holderRef` (set it to the player).
8. **A passage must say no more than the world shows.** The engine re-asks a compose prompt once ("Your passage said more was done than the world shows") and then prints its own line; say plainly where the order stands, in the order's own words ("waiting on a vote", "refused: ...", "done: ..."), then tell the rest.
9. **Do not answer for what the page should have told you.** If a letter, deadline or decision appears on the page, deal with it as a player.
10. **Keep the wallet honest.** A new account has 0 coins; look at what the page tells the empty-wallet stranger, then fund 5 coins with `npx tsx --env-file=apps/web/.env.local docs/playtests/ui-run-tools/fund.mts <username>` and say so.
11. Never more than two order-less turns in a row. Answer every letter, deadline and decision.
12. The tool `find` is unreliable for buttons (it finds only inputs by role); `read_page` with `filter: "interactive"` lists refs; screenshots lag a click by one action, so wait 2 s before a screenshot or read; after a reload wait ~15 s before clicking a sheet.
13. **Use `127.0.0.1` for the test account** if the browser already holds a session on `localhost` (cookies are per origin); do not sign the other account out.
14. Do not make the engine's confusions yours: an order to *an army you do not command* (even a pay obligation set with `force_modify`) is read as "rode out to take charge of the army". Keep model answers inside what the seat may do.

## 1. Start

1. `README.md` "Run locally" and the `CHRONICA_AI_MODE=hand` block of `.env.example`. Database: `scripts/start-local-database.ps1`; confirm port 5432.
2. Server (not `hosted.bat`), on the free port: `node scripts/dev-env.mjs CHRONICA_AI_MODE=hand CHRONICA_HAND_RESPONDER=manual CHRONICA_HAND_DIR=eval-out/ui-run3/hand npm run dev --workspace @chronica/web -- -p <port>`; wait for `GET /api/health`.
3. Watcher once you know the character's name: `node docs/playtests/ui-run-tools/watcher.mjs apps/web/eval-out/ui-run3/hand "<name>"` (stubs `write_mechanic`, `reconcile_facts`, `repair_deltas`; auto-fills `voice_letters`; answers `simulate_cognition` with `{"actors":[]}` unless a letter from the player awaits that power). It logs to `apps/web/eval-out/ui-run3/watcher.log`; count its answers.
4. Record the command, port, hand directory and the time of the first page.

## 2. Be a real player

1. Landing, `/sign-up`, `/worlds`, the Punic Wars card, "Choose who you will be". Say how an empty-wallet stranger fares (round 2: "Your wallet is empty", "Add coins first").
2. **Seat rule: the seat must command men.** Not the Officer of the Accounts (Abdmelqart, Azrubaal, Barmelqart), and not Gaius Genucius, Hieron II, Hannibal Gisco, Statius Mettius, Decius Vibellius. Choose among:
   **Hanno of Carthage** (commands the field force and sits in Sicily; round 2 saw him try to poison Himilco), **Aristomachus of Syracuse** or **Leptines of Syracuse** (Hieron's army against Messana), **Quintus Ogulnius Gallus** or **Manius Curius Dentatus** (Rome, the Rhegium war), **Bostar son of Hanno** (suffete), or a seat of your own that holds an army. The prompt of that seat's first order lists its forces under MILITARY; if you command none, change seat.
3. Open every place and sheet a player has (Office, each object, Map, tooltips, tray, Chronicle, seal case every tab including **Your charge** and **The state**, **Treaties**, ledger, strongbox with Debts/Lands, books, arms rack, mirror, window) and screenshot each. Open the **army sheet** and the **Map tooltips** (round 2 never reached them).
4. Write `goals.md` with three goals (military, economic or fleet, diplomatic or political), numeric bars set after looking at the room.
5. **Run length**: play at least **540 days and 10 orders**, more if the budget allows (the original bar is 1,100 days). Prefer spans of a month or a season; a season costs 13 to 30 compose prompts.
   Time each turn from "Send" to the result (record your own answering time separately in `notes.log` with `date -Is`).
6. Play as a person plays: ordinary language, misspellings, two requests in one order, an order the seat cannot give, a question, a letter written in the tray, an answer to a letter, a deadline, a decision card.
7. **Reload the page every season** (and once from `/`, "Continue"): the Chronicle, letters, orders, Council history and "Since your last order" must survive. Round 2: the Council forgot its history ("Nothing has been recorded yet") after a reload.
8. **Mandatory events, at least once each, by changing the goal not the rules**: a **war** (your power's, declared or suffered), a **siege** (laid or suffered), a **decision card**, an **alarm** (see 3.6), a **truce**, a **battle** you order, an order to **spend voted money**, a **letter answered by you** after the model's character wrote first, and a **raid**.
   If the seat's power is at peace, make the war (move a motion; order the march; write the ultimatum).

## 3. Regression checklist: look at each fix as a player

For each, quote the page and say fixed / not fixed / not exercised. Items 1 to 12 are round 2's checklist, **not exercised in round 2 unless marked**.

1. **Far-off battles do not break the page** (round 2: fixed for a Roman siege and far wars; exercise a Carthage-Syracuse battle).
2. **A decision is asked once.** Answer a decision card; it vanishes at once and does not return for the same question; note any "Standing orders" it leaves.
3. **The odds in a decision card are true** (compare words like "nearly twice" with the army sheet and Map tooltips).
4. **A town left bare says so** within about a month.
5. **Your own power writes no letters in your name** (an officers' "urged him to ask for ..." line is fine; a letter in the tray you did not write is not).
6. **Alarms**: a truce within 30 days of ending, an ultimatum, a tribute demand and a protest that wants an answer by a day each stop a burst and appear in Matters in hand with their day. Record which did.
7. **A raid on ground your army took from an enemy is allowed.**
8. **A lapsed order says why and what to do.**
9. **The pay line is true** ("Pay owed, though their chest still holds N that has not reached them" matches the ledger).
10. **The character screen** (round 2: fixed for the wording and the wallet; not fixed: the page does not name the real cause of a rejected declaration, e.g. "class over 80 characters").
11. **Order outcome lines against the books** (round 2: four contradictions: "waiting on a vote" beside "a convoy sailed", "21,725 of 15,000 spent", "29,250 of 33,300 spent" then "2,914 of 33,300", "Stalled" for a motion that was laid). Record every instance with both quotes.
12. Still open: the home page's featured save (newest created, not last played); letters sent through an order appearing in the tray thread; the order box hidden by a decision card; **the Council's "Since your last order" after a reload**.

Fixes made after round 2 (check them as a player):
13. **A voted sum can be spent by the man it names.** Get the Council to carry a budget (`holderRef` the player, or the sponsor), then order the spend. It must happen, once, with no second motion, and a spent-down vote must say "The vote (...) gave N and M of it is spent: P is more than the Q left".
14. **The mover of a motion votes for it** ("among the named ... for"): look at the named lists of two votes you move.
15. **A convoy with no source names the problem in words** ("The convoy had no place to sail from. Give the order again and say which town...") and never "fromProvinceId".
16. **"What changed" money lines read "18,600,000 to 19,524,407 ... (+924,407)"** and a loss reads "(−N)".

Open from round 2 to look at (record, do not expect a fix): order split into duplicate parts (an order's clause may reach the model twice); a trade "16% over cost" that lost money after customs; the monthly "Ugly stories" rumour in every window; private matters reaching a foreign king's section; the Letters sheet staying open behind the Council.

## 4. Be the model

The server writes `<hand dir>/<operation>-<hash>.prompt.txt` and waits for `<operation>-<hash>.json`; `queue.log` lists them in order; `system-<operation>.txt` has each operation's instructions and schema.

| Operation | You |
|---|---|
| `write_mechanic`, `reconcile_facts`, `repair_deltas` | the watcher's stubs |
| `voice_letters` | the watcher's auto-fill |
| `simulate_cognition` | `{"actors":[]}` from the watcher unless a letter from the player awaits that power or a decision of the player is put to it; those you answer by hand. Follow the printed counsel unless you give a reason (in the world's voice) against it. Count: followed / went against / no counsel |
| `simulate_orchestrate` | by hand, matching the order and nothing more. Helpers in `answer-lib.mjs` (`base`, `fact`, `ch`, `po`, `fo`, `ruler`, `seedThread`). Answer every "WORLD STIRS" seed (a seed that contradicts the world, like a charge already dropped, you close and say so) and every "COUNTRIES WITH NOBODY" entry (`ruler()` or `force_create` with the existing ruler as commander) |
| `compose_chronicle` | by hand, passage by passage, from each thread's own facts. `{"entries":[]}` (use `empties.sh <hash>...`) is right for a matter that "has only gone on", for far-off news that is nobody's business, and for a headline already told. Never use an automatic rule; if you must, disclose it and count |
| `dialogue_ordinary`, `dialogue_principal`, `propose_social_events`, `extract_knowledge`, anything else | by hand (see rule 5), and list it |

`bash docs/playtests/ui-run-tools/wp.sh 28` waits for a pending prompt (set `IGNORE` for a stale one); `show.sh` prints the facts of the pending composes (`HAND=... W=600`). Write several answers in one command. Keep counts: stubs, auto-filled, hand-written, hand-written empty.

## 5. The Chronicle, as the page shows it

After every turn read the Chronicle on the page (a DOM dump of `article` elements is the cheapest) and screenshot it. For each judge: did it say what mattered to this player, did it repeat headlines, raw ids, engine words or template text, did it tell anything the player could not know, did it miss something the books or the tray showed.
Also judge the page as a reading experience: newest first, can a long turn be read, can an old turn be found, does the outcome sit with its passage, are dates right and sorted, does the Chronicle say *why* when something is lost or refused.

## 6. Report: `docs/reports/<date>-<character>-<n>y-ui-hand-run-3.md`

1. Verdict first (*playable / playable with caveats / not playable*) with three reasons, and the last day reached.
2. What was played: seat, what it commands as the page shows it, goals and results (a table), orders as typed and what the page said (a table), a dated timeline.
3. First-time experience, including the empty-wallet stranger.
4. The regression checklist of section 3, each item fixed / not fixed / not exercised with a quote.
5. New bugs by severity (High corrupts state, hides what the player needs or makes a goal unwinnable; Medium a rule or page that misbehaves; Low noise), each with turn, date, page, quote, and file and line if traced. Say when a failure is yours and not the game's.
6. Waiting: send-to-result per turn, your answering time, what the page said while waiting, hung bursts, prompts per season.
7. The Chronicle on the page: the table of section 5 for several turns, two or three passages verbatim, the reading judgement.
8. As a player: what you could not tell from the page.
9. What worked.
10. How far to trust this run: every stubbed, auto-filled and hand-written answer (counted, with cognition counsel counts), every leak, every sheet not opened, every turn not read in full, what was not exercised, and **every modelling shortcut of yours that changed the world**.
11. Verdict in three lines: goals met, worst bug, whether the page read as the story of this reign.

Finish by saying where the report is, the verdict, and the three things most worth fixing first. Then (the loop): fix what the run found that traces to a cause in `packages/` or `apps/`, with a failing test first,
and write `docs/playtests/ui-hand-playtest-prompt-4.md` with the fixes to check and what stayed unexercised.
