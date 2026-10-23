# UI playtest prompt: a real player in the browser, with the model answered by hand

Paste everything below the line into a Claude Code session (or any agent that has a shell **and** a browser tool: the Claude
desktop app's built-in browser, Claude in Chrome, or Playwright), started in `C:\Users\andrei\Documents\Chronica`. Run it on a
clean working tree and do not edit code while it runs.

This is the sibling of `hand-playtest-prompt.md`. That one drives the engine from a script and reads a text report. This one
plays the **website**: a real server, a real account, a real save, a real browser, and you play with your eyes on what a
person would see. Only the model behind the game is you. Use it to judge whether the game is playable *as a product*: what the
page shows, what it hides, how long it makes the player wait, whether the Chronicle on the page reads as a record of your reign.

---

You are two people at once, and must keep them apart.

- **The player.** You sit at the website. You know only what the page shows: the Office, the Map, the people you can write to, the
  letters tray, the Chronicle, the order box. You decide from that and nothing else. You never read the database, `state.json`,
  a prompt file, or the server log to decide what to do in the game.
- **The model.** The game asks a model to interpret your orders, play other characters, voice letters and write the Chronicle. In
  hand mode those requests wait as files. As the model you read each prompt file and write the answer. You may read the files
  because the model must; but what you learn there stays on the model's side of the wall, and you say in the report each time it
  leaked into a player decision (it will, at least once: say so honestly).

Do not edit anything under `packages/`, `apps/` or `scripts/`. Write only inside `eval-out/<run>/` and the one report
`docs/reports/<date>-<character>-<n>y-ui-hand-run.md`.

## 0. Rules earlier rounds broke (read twice)

1. **Shell state does not persist between tool calls.** Set environment variables on the same command line that uses them, or in
   a file the process reads. Do not `export` once and assume.
2. **Start the server once and keep it running** in a background shell. Check it with a fetch of `/api/health` before you
   blame the game. Note every restart and why.
3. **Answer every prompt the server writes**, in the order of `queue.log`; a request left unanswered holds the page's burst for
   ever, and a request answered after the world moved on is cached under a hash that never recurs. Do not leave a watcher running
   that answers things you are meant to answer by hand (section 3).
4. **The page is the evidence.** For every claim about what a player saw, name the page and quote or screenshot it. A screenshot
   per burst result and per Chronicle is the minimum.
5. **Hand answers write no facts the deltas do not make true**; match the order and nothing more. If an order cannot be done,
   answer with a friction and no deltas (a good clerk's "it cannot be done, because ...").
6. **Compose real Chronicle passages from the thread's own facts only**, in the register the prompt asks for.
7. Never run more than two plain (order-less) turns in a row, and answer every letter, deadline and decision the page raises.

## 1. Start the server in hand mode

1. Read `README.md` ("Run locally", "Develop using your Codex allowance") and `.env.example` (the `CHRONICA_AI_MODE=hand`
   block). The hand mode you want is the **manual** one: the server writes prompts to a directory and waits for you.
2. The database is Postgres. On this machine it lives under `.cache/postgres-runtime` and `scripts/start-local-database.ps1`
   starts it. Run that script (PowerShell) and confirm the port opens (`DATABASE_URL` defaults to
   `postgres://chronica:chronica@localhost:5432/chronica`). If the runtime is not there, say so and stop: do not invent a database.
3. Start the web server **not** through `hosted.bat` (it kills ports 3000-3010 and starts a real-AI server). Use the launch
   configuration `Chronica Web (hand, manual)` in `.claude/launch.json`, which is

       node scripts/dev-env.mjs CHRONICA_AI_MODE=hand CHRONICA_HAND_RESPONDER=manual CHRONICA_HAND_DIR=eval-out/<run>/hand npm run dev --workspace @chronica/web -- -p 3300

   with your own directory in place of `eval-out/hand-armies-web`. Use `preview_start` with that name if you have it (edit the
   directory to `eval-out/<run>/hand` first by copying the entry under a new name in a scratch copy of the launch file; do not
   change the committed one), or run the command in a background shell. The server is at http://localhost:3300.
4. Wait for the first compile (the first hit of each route can take a minute in `next dev`). `GET /api/health` should answer.
5. Record in the report: the exact command, the port, the hand directory, how long the first page took.

## 2. Be a real player

1. Open http://localhost:3300 in the browser. Read the landing page as a stranger would. Note anything confusing before you sign up.
2. **Sign up** (`/sign-up`: username, password, confirmation, "Create account"). Use a throwaway username and password;
   they are for a local database. If the form fails, report what the page said.
3. **Choose a world** (`/worlds`): the Punic Wars card, "Begin this world", then "Choose who you will be". This is the character
   step. Find out from the page how a player chooses a person: a list of notable people, a free-text declaration, or both.
   If the page asks the model (a `declare` prompt appears in the hand directory), answer it as the model would, from the
   scenario, honestly and briefly. Say in the report how a first-time player would have understood this screen.
4. **Pick a seat nobody has played**: not Gaius Genucius, Hieron II, Hannibal Gisco or Statius Mettius. Candidates: Hanno of
   Carthage, Manius Curius, Quintus Ogulnius, Gnaeus Cornelius Blasio, Decius Vibellius (Rhegium), Leptines of Syracuse, a
   Carthaginian suffete, or a ruler outside Italy and Sicily. Prefer a seat with an army, a city or a letter to answer. If the
   page only lets you declare a free-text character, declare one and say what you got.
5. Look at the room before you act. Open every place and sheet a player has: the Office (and each object in it), the Map (click
   provinces, armies, cities; read the tooltips), the people you can write to, the letters tray, the Chronicle, the calendar line,
   the notes, the laws, the administration and economy sheets, the character panel. Take a screenshot of each. For each ask: could
   a player tell what they command, what they own, who is near, what is due? Write down what you wished it said.
6. Write `goals.md` in `eval-out/<run>/` with three goals (one military, one economic or fleet, one diplomatic or political),
   numeric bars set **after** you have looked at the room, each readable from the page.
7. **Play at least 3 years of game time (about 1,100 days)** through the page: type orders into the order box (or use the map's
   order bar if there is one), choose the span the page offers, read the result, write the next order. If the page cannot get that
   far (a stuck burst, a crash, a wall of waiting), say where and why. Time each turn from "send" to "result on the page" and
   record it; the model's time is yours, so also record how long each prompt waited for you, and report the two separately.
8. Play as a person plays, not as a script: write orders in ordinary language, with the vagueness and the mistakes a person
   makes (a misspelt name, an order with two requests, an order the seat cannot give, a letter, a question). Also try the
   everyday things: write to someone through the letters tray, answer a letter, answer a deadline, take a decision when the page
   puts one. Use the page's own buttons and words for each. If you cannot find how to do something a player should be able to
   do, that is a finding: say where you looked.
9. Get into a war, a siege and a decision at least once each (if your seat is peaceful, change the goals, not the rules, and say
   it was your choice), see an alarm (a deadline, a letter to answer, an early stop) and answer it.
10. Try the fixes of the last round and the things never exercised (the checklist in the sibling prompt, section 3, applies; check
    each as a player would see it: a letter shows its terms on the page; an extended truce stays extended; a failed siege says
    why; the same decision is not asked twice; the chamber refuses the chest after you defy it, and says how long). Pick two or
    three of the never-exercised ones that fit your seat.
11. Close the loop the way a player would after a long session: reload the page, leave and come back to the game from `/`, and check that
    the Chronicle, the letters and your orders are all still there.

## 3. Be the model

The server writes, for every model call, `<hand dir>/<operation>-<hash>.prompt.txt`, and waits for `<operation>-<hash>.json`.
`queue.log` lists them in the order asked; `system-<operation>.txt` is each operation's instructions and schema.

Answer them as this table says. The stubbed ones are the same stubs the scripted harness uses, so the results compare.

| Operation | You |
|---|---|
| `write_mechanic` | stub `{"mechanic":null}` |
| `reconcile_facts` | stub `{"withdraw":[],"rewrite":[]}` |
| `repair_deltas` | stub `{"deltas":[]}` |
| `voice_letters` | fill with `eval-out/player-run/autoletters.mjs` (read its function; it writes a letter body from each prompt) |
| `simulate_cognition` | `{"actors":[]}` for every power **except** one that holds a letter from you or a decision you forced: for those, answer by hand, follow the printed counsel unless you give a reason against it, and write the reason |
| `simulate_orchestrate` | by hand, for each order you give: match the order and nothing more (see `eval-out/player-run/lib.mjs`, `schema.mjs --list` and `schema.mjs <op>` for the delta shapes; stance `propose` or `declare`; letter answers `accepted|refused|countered|ignored`) |
| the declaration of a character, if the page asks for one | by hand, from the scenario |
| `compose_chronicle` | by hand, passage by passage, from each thread's own facts |
| anything else that appears | by hand, and list it in the report |

To spare yourself the stubs, write a small watcher in `eval-out/<run>/` that polls the hand directory and writes **only** the
stub answers above (and the autoletters). It must never write an answer you meant to give by hand. Show the watcher's code in
the report. Keep a count of every answer you wrote, split into stubs, auto-filled, and hand-written; and for cognition answers,
how many followed printed counsel, how many went against it, and how many had no counsel at all.

Remember the page is waiting for you while you answer. A real player would not wait twenty minutes on a spinner. Record how long
the page looked like it was doing nothing, and what it said while it waited.

## 4. The Chronicle, as the page shows it

After every turn read the Chronicle on the page. Screenshot it. For each judge, and record in a table:

1. Does it say what mattered to this player this turn (compare to your own notes of what happened to you)?
2. Does it repeat headlines or retell old facts?
3. Raw ids, internal words or template text on the page?
4. Does it tell anything the player could not know?
5. Are there things the page showed elsewhere (letters tray, deadline, army sheet) that the Chronicle should have told, and did not?

Also judge the **page** as a reading experience: is the newest news at the top, is a long turn readable, can a person find an old
turn, does the order outcome sit under its passage ("What came of the order"), are the dates right.

## 5. Report: `docs/reports/<date>-<character>-<n>y-ui-hand-run.md`

1. **Is the game playable through the page?** A plain verdict first (*playable / playable with caveats / not playable*) with the
   three reasons that decide it. Playable means a person with only the page could have made sensible choices for three years
   and understood what happened to them. State what a new player could not do, and what would have made them quit.
2. **What was played.** Seat, what it commands as the page shows it, goals and bars with results, the orders as typed and what the
   page answered (a table), and a dated timeline with game days.
3. **First-time experience.** Landing, sign-up, world, character, first room, first order: what a stranger would not have understood.
4. **Bugs by severity** (High corrupts state, hides what the player needs or makes a goal unwinnable; Medium a rule or a page that
   misbehaves; Low noise and wording), each with the turn, the date, the page and a quote or screenshot, and the file and line
   if you traced it. Say plainly when a failure is yours (your answer, your watcher, a stub) and not the game's. Before calling
   something a game bug, ask whether a stub or your own hand answer could cause it.
5. **Waiting.** Time per turn (page time and your answering time, separately), what the page said while waiting, any burst that
   hung, any prompt you answered that the page never used.
6. **The Chronicle on the page.** The table from section 4 for each turn, two or three passages verbatim, and the reading-experience judgement.
7. **As a player.** What you could not tell from the page: your own strength, a letter's content, who is marching on you, why an
   order failed, what a decision costs, where to look.
8. **What worked.**
9. **How far to trust this run.** Every stubbed, auto-filled and hand-written answer (counted); every time what you learned as the
   model leaked into the player's choices; every page or sheet you did not open; every turn whose Chronicle you did not read in
   full; what the run did not exercise.
10. **Verdict in three lines:** goals met, worst bug, and whether the page as a whole read as the story of this player's reign.

Finish by saying where the report is, the verdict, and the three things most worth fixing first.
