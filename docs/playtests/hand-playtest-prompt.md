# Playtest prompt (for the ChatGPT / Codex CLI or a Claude Code session)

Paste everything below the line into the CLI, started in `C:\Users\andrei\Documents\Chronica` with full file access and a
shell (Git Bash available). Run it only on a clean working tree: do not run it while someone is editing `packages/`.
Round 9. Rounds so far played the Roman consul Gaius Genucius, Hieron II, Hannibal Gisco, Statius Mettius (the Mamertine
leader), Decius Vibellius (Rhegium), Manius Curius Dentatus (a Roman censor with no army) and Hanno of Carthage (strategos with an army and a fleet) and Alexander II of Epirus (a young king of a small confederation). All eight are in `docs/reports/hand-run-reports.md` or `docs/reports/*-hand-run.md`.

---

You are playtesting Chronica (this repository) as if you were a real player, then reporting honestly on what you saw, and
above all **whether the game is playable**. You are a tester, not a fixer: do not edit anything under `packages/`,
`apps/` or `scripts/`. Write only inside `eval-out/<your-run-name>/` and the one report `docs/reports/<date>-<character>-<n>y-hand-run.md`
(that name pattern is git-ignored; the maintainers fold the keepers into `docs/reports/hand-run-reports.md`).

The point of the exercise is a player's-eye verdict, not a bug hunt. A bug counts when a player would be misled, blocked
or lied to by it. Report the bugs you find; do not stop playing to chase one. Prefer a few well-evidenced bugs with the
burst and a quoted line to a long list of guesses.

## 0. Rules that earlier rounds broke (read twice)

1. **Shell state does not persist between tool calls.** Put your `COGWATCH` default and `PLAYERNAME` default inside `go.sh`
   and run one burst per tool call (two bursts in one call lost a compose in round 5). After every letter you send, check
   that the recipient's cognition prompt reached **you** (a `NEEDS ANSWER ... simulate_cognition-...` stop) before you
   decide the game ignored it. If no prompt came, say so as a finding, but first check your own `COGWATCH` and `PLAYERNAME`, and `grep -l "message-<id>" simulate_cognition-*.prompt.txt` in your run folder: a prompt that holds your letter but has a `{"actors":[]}` answer on disk means the harness stubbed it (rounds 5 and 6 both lost replies that way once; round 6's cause was a mangled regex in `drive.mjs`). Test this with your first letter, before you play on. `COGWATCH`: it must name
   every power that can hold your letter (all Roman consuls and senators you write to, the new ruler after an election).
2. **Read every thread of a Chronicle prompt to its last line.** (Round 5 cut each thread to 14 lines, wrote passages from that, and blamed the composer for facts it had in fact offered; `cw.sh` now prints whole threads; do not pipe it through `head`.) Before you call a Chronicle passage wrong or a fact missing, `grep` the thread prompt files in `eval-out/<run>/chronicle/` for it.
2b. **Compose the Chronicle straight after the burst, before the next one** (prompts are hashed with the world's date).
   Compose every burst with a battle, a siege, a treaty, a decision, a death or a letter of yours in it, and every burst of
   25 or more facts; answer **every** `WAITING` prompt and run `cw.sh` again until it prints the passages. A thread whose
   facts only repeat what the last report said may be answered `{"entries":[]}`; count those. List the bursts you skipped and why.
3. **Do not read `state.json`, `st.mjs` or the prompt files to decide moves.** The burst output and the Chronicle are what a
   player has. Exceptions: the order prompt you must answer (it is the only place that gives ids, the chest and the enemy
   forces; **each time you need a fact from it that the burst output lacked, write down what it was**: that list is a finding),
   and a letter's text if the output does not give it. Count every other peek and list it.
4. **Hand answers: no facts that the engine has not made true.** Put in `facts` only what the deltas you wrote would make
   true, or none. If an order cannot be done (no such town, already done, a power you may not command), answer it with a
   friction and no deltas, as a good clerk would, not with a different act. One fact per part of the order, so a refused
   part cannot leave a false fact for the part that was done.
5. **Match the order, and nothing more.**
6. **Never run more than 2 plain (order-less) bursts in a row.** If a burst stops early (`salient_event`, `player_decision`),
   say why and react. 30-day bursts when something is happening, 60 to 90 when quiet, 1 to 10 days when you are waiting on a letter or a march.
7. **Answer every `DEADLINE` line, every "letter to answer" and every player decision.** A decision answer needs
   `stance: "declare"` on its intent part. Always repeat `--order` when you re-run a burst after answering its prompt.
8. **Hand-answer pitfalls that cost round 5 an hour:** `localId` is lowercase letters, digits, `_` and `-`; a letter's `kind`
   is one of `letter alliance_offer peace_offer trade_offer marriage_offer military_aid_request tribute_demand ultimatum
   warning protest congratulation embargo ...` (see `schema.mjs diplomatic_message_send`); a tax change has `scope`, `polityId`,
   `regime` and `rateBps`; a force you command is addressed by its id as the order prompt prints it.

## 1. Setup

1. Read `eval-out/player-run/README.md` (it lists the helpers), then `docs/reports/hand-run-reports.md` and the newest
   `docs/reports/*-hand-run.md` (the first section, the bug lists and the "what was fixed" notes). Do not trust them over what you see.
2. Copy `eval-out/player-run/` to `eval-out/<your-run-name>/`. In `go.sh`, `loop.sh`, `drive.mjs`, `cw.sh` and `compose-player.mts` replace `player-run` with your run name; set `PLAYER`, `COGWATCH` and `PLAYERNAME` defaults in `go.sh`; write `me.json`; set the character and polity in `cw.sh` and `compose-player.mts`. If `diff eval-out/<run>/consul-run2.mts scripts/consul-run.mts` shows more than the one `facts.jsonl` append line, re-copy the script and re-add that line.
3. List the characters with a short `tsx` script over `punicWarsScenario.initialWorld.characters` and **pick a seat nobody has played**: not Genucius, Hieron II, Hannibal Gisco, Statius Mettius, Decius Vibellius, Manius Curius, Hanno of Carthage or Alexander II of Epirus. Good candidates: Quintus Ogulnius, Gnaeus Cornelius Blasio, Leptines of Syracuse (Hieron's admiral), Himilco son of Gisgo (a Carthaginian suffete), Antigonus Gonatas of Macedon (the king Epirus faces), Chremonides of Athens, a Carthaginian suffete, a ruler outside Italy and Sicily (Epirus, Macedon, a Gaulish or Iberian people, Egypt, Seleucia) if you want to test a seat with little to do. Prefer a seat with an army, a city or a letter to answer. Say in the report why you chose it and what it commands.
4. Before the first burst write `goals.md` with three goals: one military, one economic or fleet, one diplomatic or political. Set numeric bars **after** you have read the first order prompt. Make the bars measurable from what the output shows.
5. Play **at least one game year (about 365 days) with real orders in every burst, and up to three years if the seat has things to do**. The goal of this round is breadth: war, a siege or a battle, a letter answered, a player decision, a vote or a law, a fleet, and the checklist below, each seen once. Time each burst roughly and record slow ones. If the game cannot be played that far, say where, why and what you tried.

## 2. What the harness already does: let it

`drive.mjs` answers the model calls that have real code behind them in hand mode:

- `write_mechanic` `{"mechanic":null}`, `reconcile_facts` `{"withdraw":[],"rewrite":[]}`, `repair_deltas` `{"deltas":[]}` are stubbed. (So the game's step that takes back facts about a refused act does **not** run here. A false fact left by a refused order may be the stub's: say so.)
- `voice_letters` is filled by `autoletters.mjs`. `simulate_cognition` for every power not holding a letter from you is stubbed `{"actors":[]}`: nobody else acts by choice. Rome, Carthage and Syracuse still act by the engine's rules. State this limit in the report.
- Chronicle prompts are built by `compose-player.mts`. `--decide <option id>` answers a player decision; `--order "text"` gives an order.

You write by hand only: (a) the `simulate_orchestrate` answer for each order you give and for each "world stirs" seed that comes with a burst of 7 days or more (the prompt names the seed; answer it briefly and say so in the report: it is a lever on the world); use `lib.mjs`, `build.mjs`, `auto.mjs` + `specs.json` for letters, `schema.mjs`; (b) the `simulate_cognition` answer for a power that holds a letter from you (`cog.mjs`; follow the printed counsel unless you write a reason against it; where no counsel is printed decide from the prompt's facts, say why, and tally it); (c) the Chronicle historian answers (section 4, `cw.sh`).

## 3. Play like a player

- Know only what the game shows a player: the burst output (order outcomes, `under way` lines, `letter to answer` and `letter awaiting reply` lines, `DEADLINE` lines, the `army:` lines, the top facts, any `player decision`) and the Chronicle.
- Every burst: read the whole output. If you cut it, say which lines you did not read and why. Check the facts below the top 25 only where the output says there are more and something happened to you.
- Give real orders in every burst where you can: move, siege, fight, build, hire, write, ask, answer, vote.
- **Get into a war, a siege or a battle, and a player decision** at least once each, and see an alarm (`DEADLINE`, `letter to answer`, `salient_event`) fire and answer it. If your seat is peaceful, change the goals, not the rules: break a truce, make a demand, back a rising, march on a neighbour. You may take a war the game would not give you; say it was your choice.
- Try the fixes of the last round, and re-check the open items. Each is to be seen working or failing, with the burst where you saw it:
  1. **A garrison ordered to hold stands** (round 5 fix): order a force to hold the walls of a city, then let a much larger army come. It must not fall back by itself; if it is attacked it fights. Report what the order line and the facts said.
  2. A letter to another power is sent as a letter; the output says `letter awaiting reply`; the recipient's cognition prompt reaches you. A letter to a person who has left office, or to "the Senate", says who it was given to (round 5: it was silent).
  3. A truce or peace you ask to extend is extended: the standing agreement runs to the later date, there is a `treaty_amended` fact, and no `agreement_lapsed` on the old date. A peace "for a year" ends or is renewed on its date, with a line (round 5: nothing happened).
  4. A siege you lay and then lose says, on the order line, why it failed.
  5. A player decision is asked once a day; its answer carries out the option; the burst output lists the whole menu without cutting it.
  6. After you act without your chamber (declare a war on your own word, break a treaty), spending from the public chest is refused for you; the refusal says how to be forgiven or how long it lasts, or you report that it does not.
  7. A letter to answer shows its terms; the `army:` line shows men fit and morale; **the burst output says who is in the province with your army, how much bread you have and what is in your chest** (round 5: it did not; if it still does not, that is the first finding).
  8. An alliance made by letter is told as an alliance in the burst output and the Chronicle (round 5: only a `letter_answered` said so).
  9. An order refused or failed leaves no fact claiming it was done (check the Chronicle too).
  9b. A letter written again in the same words is told as not sent (`letter_not_resent`, "had already written ... not sent again"), not as "nothing came of it" (round 7 fix); an alliance, protectorate or other pact made by letter is told as a fact in the burst output (`alliance_made` / `treaty_made`, round 7 fix).
  10. A "world stirs" seed (a burst of 7 days or more brings one to the model) does not put a war, a motion or any act in the player's name, and never sets a power against its own foedus league (round 6: a seed opened Rome's war on the Apulian cities, a foedus follower, as "Motion of Manius Curius Dentatus: war on Apulian cities"; fixed in `narrator.ts`). Answer each seed in the way it asks and read how the burst output tells it.
  11. A letter you write to a man of your own power is listed as awaiting his reply, not as a letter for you to answer; a reply you write for someone is told in your words, not in the words of the man it was addressed to; the burst output prints no refusal of another power's order (round 6 fixes in `scripts/consul-run.mts` and `apply-deltas.ts`).
  12. An order to raise men, to audit a named body or to "propose in the Senate" either goes to a vote or says why it cannot, in words that are true (round 6: a censor's levy was refused as "nobody was paying" although the order named the treasury; an audit could not name a department because no id is printed).
- **Known open, do not re-report unless you can add new evidence** (they are the next fixes): (a) the burst output gives no line for the enemy in your province, your chest or your bread (the order prompt does; the UI does); (b) men raised by a levy or hired are paid by nobody (`payObligationRef: null` in every levy path: the treasury does not change); (c) a force keeps in its name the place it was raised at; (d) a conquest can take a whole small league in a day.
  13. A truce offered to a power you are not fighting is counselled as a quiet border, not as "not beaten"; a truce, alliance or protectorate made by letter is told as a fact (`treaty_made` / `alliance_made`); a truce you extend says `treaty_amended` with its new end day (rounds 7 and 8 fixes).
- Things not yet exercised in six rounds, to try if your seat allows: a rising in your own provinces and how you learn of it; a marriage or a succession; a loan, a debased coin; a magistrate's year ending; the death of your character; being a subject or ally under a foedus; a siege you lay and lose; an alliance requested against a shared enemy. Pick two or three that fit your seat.

## 4. Chronicle

After each burst that meets rule 0.2 run `bash eval-out/<run>/cw.sh <burst>`. It prints each thread; write the historian's answer as
`{"entries":[{"thread":N,"title":"...","body":"..."}]}` into the matching `.json` and run it again, until it prints `# Chronicle, burst N (... passages ...)`.
Write each passage **only** from the "Known to have happened" (and "Reported", "word only") lines of its thread, in the register the prompt asks for, adding no clause the thread does not state.

For each composed burst record, in a table, passages told, facts, facts carried. Judge: (1) does it say what mattered to this player in this burst (your orders' results, your letters, your wars, your decision)? (2) does it repeat headlines or old facts? (3) raw ids or fact strings as headlines? (4) does it tell anything the player could not know? (5) carried facts that should have been told (a letter awaiting your answer, a deadline, a lapsing treaty, a decision pending)?

## 5. Report: `docs/reports/<date>-<character>-<n>y-hand-run.md`

Sections, in this order: **1 Is the game playable?** (verdict first, three reasons, what a new player could not do); **2 What was played** (seat, what it commands, goals with bars and results, orders table, dated timeline); **3 Bugs by severity** (High corrupts state, hides what the player needs, or makes a goal unwinnable; Medium a rule that misbehaves; Low noise; each with burst, date, quoted evidence and file and line if traced; separate the failures that are yours); **4 The Chronicle outputs** (table, 2 to 3 passages verbatim, the five questions); **5 As a player** (what you could not tell); **6 What worked**; **7 How far to trust this run** (every stub, auto-fill and hand answer counted; every peek; what you did not read or compose; what the run did not exercise; the checklist result item by item); **8 Verdict in three lines**.

Finish by telling the user where the report is, the verdict, and the three things most worth fixing first.
