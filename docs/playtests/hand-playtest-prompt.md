# Playtest prompt (for the ChatGPT / Codex CLI)

Paste everything below the line into the CLI, started in `C:\Users\andrei\Documents\Chronica`
with full file access and a shell (Git Bash available). Run it only on a clean working tree: do not run it while
someone is editing `packages/`.

---

You are playtesting Chronica (this repository) as if you were a real player, then reporting honestly on what you saw,
and above all **whether the game is playable**. Do not edit anything under `packages/` or `apps/`. Write only inside
`eval-out/<your-run-name>/` and the one report in `docs/reports/`.

## Setup
1. Read `eval-out/player-run/README.md`, then the newest two files in `docs/reports/` (harness notes, known bugs, what was fixed). Do not trust them over what you see.
2. Copy `eval-out/player-run/` to `eval-out/<your-run-name>/` and replace `player-run` with your run name in `go.sh`, `loop.sh`, `drive.mjs` and `compose-player.mts`. Set the default seat in `go.sh`, and the name in the `COGWATCH` regex of `drive.mjs` (`by <your character's name>`).
3. List the characters with a short `tsx` script over `punicWarsScenario.initialWorld.characters` (`import { punicWarsScenario } from "@chronica/db"`). Pick one that earlier reports did not play (played so far: Roman consul Gaius Genucius, Hieron II, Hannibal Gisco). Prefer a seat with an army, a city or a letter to answer. Your `PLAYER` env var is the character id.
4. Before the first burst write `goals.md` with 3 goals: one military, one economic or fleet, one diplomatic or political. Set numeric bars **after** you have seen what your character commands (read the first order prompt), not before.
5. Play at least 3 years of game time (about 1,100 days). If the game cannot be played that far, say where and why it stopped.

## What the harness already does: let it
`drive.mjs` answers the model calls that have real code behind them in hand mode. Do not hand-write these, and do not
read `state.json` to decide moves:
- `write_mechanic`, `reconcile_facts`, `repair_deltas`: stubbed by `drive.mjs`.
- `voice_letters`: filled by `autoletters.mjs` (`AUTOLETTERS=1` in `go.sh`).
- `simulate_cognition` for every other power: stubbed `{"actors":[]}`.
- Chronicle composition: `compose-player.mts` builds the prompts exactly as the web path does.
- `--decide <option id>` answers a player decision; `--order "text"` gives an order.
You write by hand only: (a) the `simulate_orchestrate` answer for each order **you** give (match what the order said and nothing more; use `lib.mjs` and `schema.mjs --list` / `schema.mjs <op>`; stance is `propose|declare`; answers are `accepted|refused|countered|ignored`), (b) the `simulate_cognition` answer for a power that holds a letter from you (set `COGWATCH="Name,Name"`; follow its printed counsel unless you give a reason against it, and write the reason), (c) the Chronicle historian answers (see below).
Always repeat `--order` when you re-run a burst after answering its prompt. Compose the Chronicle straight after the burst, before running the next one (prompts are hashed with the world's date).

## Play like a player
- Know only what the game shows a player: the burst output (order outcomes, "under way" lines, letters to answer, `DEADLINE` lines, the army lines, the top facts, any player decision) and the Chronicle.
- Every burst: read the whole output (do not filter facts away; if you must, list what you filtered in the report), answer every `DEADLINE`, every "letter to answer", every player decision. Never run more than 2 plain bursts in a row. If a burst stops early (`salient_event`), say why and react.
- Mix 30-day bursts when something is happening and 60-90 when it is quiet. Give real orders: move, siege, fight, build, hire, write, ask. Try to get into a war and a decision at least once; a run with no war proves little. If your character's seat is peaceful, change the goals, not the rules.

## Chronicle
After every burst with more than a handful of facts run
`node --import tsx eval-out/<run>/compose-player.mts <burst> <character-id> <polity-id>`. It stops with `WAITING <prompt file>`: read the prompt, write the historian's answer as `{"entries":[{"thread":N,"title":"...","body":"..."}]}` into the matching `.json`, run it again. Write each passage only from the "Known to have happened" lines of its thread. For each Chronicle judge: does it say what mattered to this player in this burst; does it repeat headlines; raw ids; anything the player could not know; facts carried that should have been told.

## Report: `docs/reports/<date>-<character>-<n>y-hand-run.md`
1. **Is the game playable?** First section, a plain verdict: *playable / playable with caveats / not playable*, with the three reasons that decide it. Playable means a person with only the burst output and the Chronicle could have made sensible choices for three years and understood what happened to them. State what a new player could not do.
2. What was played; the three goals and results; a dated timeline.
3. Bugs by severity (High corrupts state, hides what the player needs or makes a goal unwinnable; Medium a rule that misbehaves; Low noise and wording), each with burst, date, evidence quoted from the output, and file/line if you traced it. Say plainly when a failure is yours (harness, stub, inattention) and not the game's.
4. "The Chronicle outputs": what came out, 2-3 passages verbatim, facts told/carried per burst, what was missing.
5. "As a player": what you could not tell from the output (hidden losses, unclear letters, missing warnings, confusing decisions).
6. "What worked".
7. "How far to trust this run": every stubbed, auto-filled or hand-written answer, every fact kind you did not read, and what the run did not exercise (war, sieges, decisions, alarms).
8. Three-line verdict: goals met, worst bug, whether the Chronicle was readable as a record of this player's reign.
