# UI playtest prompt, round 4: a real player in the browser, model answered by hand

Paste everything below the line into a Claude Code session (or any agent with a shell **and** a browser tool), started in `C:\Users\andrei\Documents\Chronica`. Do not edit code while the run is going; fix afterwards.

This is round 4. **Read first**: `docs/playtests/ui-hand-playtest-prompt-3.md` (its sections 0, 1, 4, 5 and 6 stand unchanged: rules, start-up, being the model, reading the Chronicle, the report) and the round-3 report
`docs/reports/2026-10-23-aristomachus-1y-ui-hand-run-3.md` (sections 4, 5 and 10). Tools in `docs/playtests/ui-run-tools/` (watcher, `wp.sh`, `empties.sh`, `show.sh`, `schema.mjs`, `fund.mts`, `answer-lib.mjs`);
use `RUN=ui-run4` and `CHRONICA_HAND_DIR=eval-out/ui-run4/hand`. Report: `docs/reports/<date>-<character>-<n>y-ui-hand-run-4.md`.

What rounds 2 and 3 taught (so you do not rediscover it):
- A seat that holds offices (an accountant) meets no war; a seat that is "Under" a king (a strategos) petitions him. **This round, the seat must be the head of its power's army or fleet in fact: the army sheet must read "Under <you>"** (check the sheet before you commit; if it says another name, change seat before the first order).
  Candidates to try: **Hanno of Carthage** (check his sheet), **Hannibal Gisco** (the Carthaginian fleet), **Gaius Genucius Clepsina** or **Manius Curius Dentatus** (Roman armies), **Hieron II** (the king himself), **Statius Mettius** or **Decius Vibellius** (small powers with real armies). Not the seats of rounds 2 and 3 (Abdmelqart, Aristomachus).
- Answers to the model's operations must be valid JSON (a `dialogue_ordinary` reply is a JSON *string*). A tray letter brings `dialogue_ordinary`, `propose_social_events`, `extract_knowledge`. A `delegation.ask.ref` must be the id of the army, question or post it names (a province id yields "there is no such army"; `speak_for` needs a question).
- Pay for hired men and a voted sum go through the Council for an office holder; for a ruler or a commander they are his own; say in the report which applied.
- Use port 3300 only if nothing holds it (`Get-NetTCPConnection -LocalPort 3300`); round 2 and 3 used 3301.

## 1. Goals of the run

Play at least **540 days and 10 orders** as that seat (more if you can; the original bar is 1,100 days), and exercise, once each, **every one of these** (round 3 only reached some):

1. a **war you make and fight by order** (an army you command, moved by your order: an attack, a march, a siege laid by order and *seen laid on the army sheet*);
2. a **battle you order** (`force_engage`) and its result on the army sheet and in the Chronicle;
3. a **decision card whose odds the engine wrote** (not you): compare its words to the army sheet and to a Map tooltip (open the tooltips);
4. an **alarm for each of**: a truce within 30 days of ending, an ultimatum to your power, a tribute demand, a protest that wants an answer by a day, a letter that asks you for a truce. Say which stopped a burst and which appeared in Matters in hand with its day;
5. **a lapsed order** and the reason the page gives;
6. **pay owed to an army** and the pay line against the ledger (open the ledger and the strongbox);
7. **a raid on ground your army took**;
8. **spending a sum a chamber voted** (or, for a ruler, spending from the chest);
9. **an answer to a letter the model's character wrote first**, in the tray;
10. the **home page** after a second save exists ("Your games": newest created vs last played).

## 2. Regression checklist: look at each fix as a player

Fixed in round 3's loop, to check: **(a)** a secret plot against you is not named in Matters in hand "threads of history" before anything of it is told to you (round 3: "Mettius's silver | brewing");
**(b)** after a reload the Council and the Chronicle say "Reading the record..." while loading, never "Nothing has been recorded yet" for the first seconds.
Fixed in round 2's loop, still to check where round 3 could not: **(c)** a voted sum can be spent by the man it names, once, with no second motion, and a spent-down vote says so; **(d)** the mover of a motion is among the named "for"; **(e)** a convoy with no source names the problem in words;
**(f)** "What changed" money lines read "18,600,000 to 19,524,407 ... (+924,407)".
Confirmed fixed (look once more, do not spend time): a decision card vanishes once answered and is not asked again; a town left bare says "Syracuse has no garrison of ours ... the walls are bare"; a Carthage-Syracuse war does not break the overlay (200); a letter sent through an order appears in the tray thread.

Still open (record every instance with both quotes, do not expect a fix):
1. **The page says the seat commands what it only petitions for** (arms rack "3,000 men ... in 2 forces", seal case "command in military matters" vs the army sheet "Under Hieron II" and "rode out to take charge of Syracusan army"): with a seat that does command, check that the page says so and that the order works.
2. **Order outcome lines against the books**: "refused" / "Stalled" / "nothing came of it" beside the Chronicle's "done" (round 3: five instances); "waiting on a vote" beside "a convoy sailed"; spend figures that change for one order.
3. **A truce request to the player's power** never reached the tray or Matters in hand and "lapsed by silence".
4. **Repeated headlines** (the same fact four times across windows) and stale "face each other" lines.
5. Engine words on the page ("there is no such army", "there is no question of ... before any house").
6. The army sheet says "Holding position" for an army that besieges.
7. A trade reported "16% over cost" that lost money after customs.
8. The monthly "Ugly stories" rumour in every window; private matters in a foreign king's section of the model prompt.

## 3. The report

As prompt 3's section 6, plus: for each of the ten items in section 1 say *done / not done* with a quote; list every item of section 2 as fixed / not fixed / not exercised.

Finish by saying where the report is, the verdict, and the three things most worth fixing first. Then (the loop): fix what the run found that traces to a cause in `packages/` or `apps/`, with a failing test first, and write `docs/playtests/ui-hand-playtest-prompt-5.md` with what to check next.
