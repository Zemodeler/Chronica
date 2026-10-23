# Abdmelqart, Officer of the Accounts of Carthage: a year at the website, model answered by hand (UI round 2)

Played 1 March 270 BC to 24 February 269 BC (360 days, six orders) through the website, with the model's side answered from files by hand.
Prompt: `docs/playtests/ui-hand-playtest-prompt-2.md`. Run directory: `eval-out/ui-run2/` (notes, goals, answer scripts under `ans/`) and
`apps/web/eval-out/ui-run2/hand/` (every prompt and answer). **This run stopped at day 360, not the 1,100 the prompt asks for** (section 10).

## 1. Verdict

**Playable with caveats.** Last day reached: 24 February 269 BC (day 360).

1. The page held up: no crash, reload at day 54 of the Chronicle's "New" count and at the end both came back to the same date with the
   Chronicle intact, `/api/games/<id>/overlay` answered 200 throughout a Roman siege of Rhegium, a Roman battle, an allied army landing in Sicily and
   two far wars (Sparta/Arcadia, Macedon). The round-1 High bug (page dead on reload) did not appear.
2. A seat that holds *offices, not armies* is hard to play through the order box: money voted by the Council could not be spent without a second vote,
   the same motion was moved twice, a mover voted against his own motion twice, and the order outcome lines carried engine vocabulary and spend figures that contradict each other.
3. The world itself read well when it was allowed to speak: a charge, a poisoning plot, a legacy, an inheritance, a treaty with Syracuse ratified 84 to 2.
   But a season costs 20 to 30 prompts of mostly "nothing to say" news (33 of 79 compose prompts were answered empty).

## 2. What was played

Seat: **Abdmelqart, Officer of the Accounts, Carthage** (an existing person of the scenario, `carthage-accountant-b1605j`). As the page shows it:
Carthage's treasury 20,666,667 (18.6M silver), surplus +1,312,000 a month, harbour dues 64% of income; own purse 44,444 (40,000 in silver);
no land; standing 5,600 of 10,000 ("Carthaginian suffete at 6,000"); one Roman trade pact (customs capped at 5 in a hundred). The seat commands no army or fleet.
The model prompt listed ~100 ships under Hannibal Gisco and five armies/garrisons under others; the page's seal case "Your charge" says only what the office keeps.

Goals (set after looking at the room, `eval-out/ui-run2/goals.md`) and results at day 360:

| Goal | Bar | Result |
|---|---|---|
| Military: no Carthaginian town in Sicily lost; armies paid at every muster | none lost | **Held, but not by me**: no battle touched Carthage. Army pay was put on a monthly list (20,000) on turn 1; the hiring of 4,000 mercenaries was voted (34 to 31) and then refused when spent. |
| Economic: treasury >= 30,000,000 and own purse >= 100,000 | by day 1,100 | At day 360: treasury ~24.3M (+3.6M in the season to 29 July), purse 64,086 (57,677 in silver) with 52,112 owed to foreign lenders and a monthly shortfall of 4,414. Not met, on track for the treasury only. |
| Diplomatic: keep the Roman pact, win a Syracuse treaty, reach 6,000 standing | any | **Syracuse treaty won**: offered 26 Nov, Hieron accepted (hand), ratified by the Council 84 to 2 in December. Roman pact unbroken. Standing not checked. |

Orders as typed and what the page said (Council, desk):

| # | Span | As typed (verbatim, misspelling kept) | What the page said |
|---|---|---|---|
| 1 | month | "Pay Hanno's army in Sicily what it is owed, and keep the grain flowing to Agrigentum. Also write to Himilco son of Gisgo and ask what the suffetes meen to do about Messana." | Split into 2 model prompts. Pay: "refused: Abdmelqart promised that pay ... would be paid from money that was never Abdmelqart's to promise"; grain: "partly done ... A convoy is sent from somewhere: name the province ("fromProvinceId")"; Himilco: "refused: he did not care to". Matters in hand: "Voted, not done", "Stalled". |
| 2 | month | "The Council has voted the money. Send the grain convoy from Carthage by sea to Agrigentum now, 15000 for the garrison's bread." | First "waiting on a vote" (the vote had passed 20 days before), then "done: the vote passed ... (21,725 Drachmae of 15,000 Drachmae spent)". |
| 3 | season | "Move in the Council that Carthage take the Mamertines of Messana under her protection against Syracuse, and send the Punic army in Sicily and the fleet to Messana. Hire four thousand mercenaries with the treasury's silver to make up the numbers." | Split into **3** prompts (the Messana clause twice). Mercenaries motion carried 34 to 31; the Messana motion never reported a result; two orders left "Stalled". |
| 4 | month | "The Council has voted 120000 for the mercenaries. Hire the four thousand now, Gauls and Campanian horse, and put them under Hasdrubal son of Hanno in Sicily on a monthly pay from the treasury." | "refused: Hiring was not completed: Officer of the Accounts may not draw upon the treasury himself ... He moved it in the chamber instead, and it waits on the vote (budget up to 120,000 Drachmae, none spent yet)". |
| 5 | season | "From my own purse, hire three hundred Gauls to guard the granaries of Carthage, and put 20000 of my own silver into a trade voyage carrying African grain to Alexandria. Also pay Azrubaal a visit and find out why he is spreading stories about me." | Gauls "done: the hire stands (3,000 Drachmae of 8,000 spent)"; voyage "needs credit: 39% down (33300), 52100 owed ... Say "on credit" in your order"; Azrubaal "refused: he has no love for Abdmelqart"; the same turn Azrubaal accused me before the Hundred and Four. |
| 6 | season | "Answer Azrubaal's charge before the Hundred and Four: lay the grain and mercenary accounts open to the judges. Take the Alexandria grain voyage on credit. And write to Hieron of Syracuse offering a treaty of friendship between Carthage and Syracuse." | Charge "nothing came of it: ... had already let the charge drop" (the Tribunal had advised against it 6 to 45); voyage sailed (cargo 86,100); letter "waiting on an answer", then accepted, then ratified. |

Dated timeline: 1 Mar 270 first order; 31 Mar Council votes bread (41-27); 11 Mar-10 Apr second vote 47-20 and grain sails; 20 May mercenaries carried 34-31;
10 May Roman army beats the Campanians before Rhegium; 10 Jul Decius Vibellius asks Carthage for protection (Himilco refuses, in the hand answer; the page says "by silence");
July Roman siege of Rhegium, 60 days, gates opened (Aug); 28 Aug accusation by Azrubaal, dropped; Sept-Nov allied Italian contingents land in the Sikeloi uplands and starve in winter;
26 Nov Hieron letter; Dec treaty ratified; Jan 269 grain sold at Alexandria; Jan 269 Hanno of Carthage's poison attempt on Himilco traced; 24 Feb 269 stop.

## 3. First-time experience (empty-wallet stranger)

`/sign-up` (local test account `stranger_r2`), `/worlds`, Punic Wars card, "Begin this world" form (name, a 5-coin spend cap, "how hard the world pushes back"), then the character page.
The stranger sees **"Your wallet is empty"** at the top right, the button "Research this character" greyed, and under it "Research is paid from your wallet, and it is empty. **Add coins first.**";
picking a name now says "Choosing a name only fills the box above. Press 'Research this character' to take them, which needs coins in your wallet" (fixed from round 1).
An empty-wallet stranger is told what is wrong and where to go ("Add coins" links to the wallet). What was not said: how many coins research costs or what coins buy. I then funded 5 coins through the real gift-code functions (`fund.mts`, 02:54).
Also: the page said "5 coins left in your wallet" at the confirmation, and "Your last order cost 0 coins" in hand mode (no spend is counted).

## 4. Regression checklist (section 3 of the prompt)

1. **Far-off battles do not break the page: fixed for what was exercised.** After the Roman battle and siege at Rhegium (the Campanians were beaten 10 May 270), two allied
   Italian armies in Sicily, Sparta/Arcadia and Macedon, `GET /api/games/<id>/overlay` answered `200` (`{"keys":["stamp","mapVersion","mapOverlay"]}`) and `/games/<id>` reloaded at day 360. The exact case (Carthage against Syracuse) was not exercised.
2. **A decision is asked once: not exercised** (no decision card appeared).
3. **The odds in a decision card: not exercised.**
4. **A town left bare says so: not exercised.**
5. **Your own power writes no letters in your name: not exercised** (I was at peace). No letter appeared in the tray that I had not written. One counter-note: the page reports "Abdmelqart wrote for Carthage to Hieron II" for a letter *I ordered*, which is right.
6. **Alarms: not exercised** (no truce, ultimatum, tribute demand or protest to answer). A letter to Himilco from Decius Vibellius ("Campanian Legion asks Carthage for help") did not stop the burst and lapsed "by silence" in the Chronicle.
7. **Raid on conquered ground: not exercised.**
8. **A lapsed order says why: partly.** Nothing "lapsed", but every refusal and stall carried a reason ("he did not care to", "The Tribunal ... had already let the charge drop, so there was nothing left to answer").
9. **The pay line is true: not exercised** (no army sheet reachable from this seat).
10. **Character screen: fixed.** A failed declaration said "The historians' answer could not be used (it was incomplete or gave dates that do not fit the world). Nothing was charged for it; try again, perhaps with a few more words about who you are." The real cause was mine (a 90-character `socioEconomicClass`, limit 80, `eval-out/ui-run2/declare-attempt1-too-long.json`); the page's words do not name it. A retry with identical words returned the cached failure without a new prompt (resubmitted with different words). Death-year-equals-year not exercised.
11. **Order outcome lines against the books: not fixed, four instances.** (a) "Send the grain convoy ... waiting on a vote" while the fact beside it says "A convoy sailed from Carthage with grain" (31 Mar); (b) "done: the vote passed ... (21,725 Drachmae of 15,000 Drachmae spent)" (10 Apr); (c) the Alexandria order "done (29,250 Drachmae of 33,300 Drachmae spent)" and later "(2,914 Drachmae of 33,300 Drachmae spent)" for the same order; (d) the Messana motion listed "Stalled" in Matters in hand though a motion was laid before the Council in the same order (my third answer was a no-op, see section 10).
12. **Still open from round 1:** home page featured save: not exercised (one save only). Letters sent through an order not in the tray thread: not verified. Order box hidden by a decision card: not exercised. **Council "Since your last order" after reload: looked not fixed, but see round 3 (it was the loading state)**: after the reload at 30 April 270 the desk showed "Nothing has been recorded yet. Give an order and the world will answer." (it did show the line "Since your last order" and the standing orders before the reload).

## 5. New bugs

**High**

1. **A carried vote of money could not be spent by the man it names** (turn 4, 29 Jul 270, Council/Matters in hand). The order to spend the 120,000 the Council had voted ("...is authorised from carthage-treasury ... Abdmelqart is to spend it") was refused with "Officer of the Accounts may not draw upon the treasury himself ... He moved it in the chamber instead, and it waits on the vote", and the same motion was re-moved (4 identical lines in one passage). Cause: `competenceGate` returned `refer` for the `by_the_body` grade even when `withinVotedBudget` had authorised the act, so a vote was never the authority (`packages/sim/src/apply/competence-gate.ts`, `by_the_body` case). Part of this was my answer (a 12-month term of two contracts, 248,000 over the 120,000 voted), but the page then told the wrong reason. **Fixed in loop 1** (section 11).

**Medium**

2. **Engine words on the page.** `A convoy is sent from somewhere: name the province ("fromProvinceId").` appeared in the Chronicle's "What this changed" and Matters in hand (31 Mar) (`packages/sim/src/apply/apply-deltas.ts:6310`). **Fixed.**
3. **A mover voted against his own motion**, twice: "Hanno of Carthage, ... Abdmelqart ... against" on the 15,025 bread vote (10 Apr) and the mercenaries (20 May) (`packages/sim/src/ballots.ts`). **Fixed.**
4. **"What changed" printed raw numbers**: "Treasury: 18600000 to 19524407 Drachmae (+924407)" (`packages/sim/src/what-changed.ts`). **Fixed** (thousands separators and a true minus).
5. **Order outcome and spend figures contradict** (section 4 item 11). Not fixed.
6. **An order is split into duplicate parts.** Order 3 became three prompts; the Messana clause was a part of two (the third got a no-op), leaving a "Stalled" order in Matters in hand. Not fixed (orchestration split, not traced).
7. **The same re-ordered spend re-moves a passed motion** ("waiting on a vote", turn 2): the standing order "Once Motion ... is carried" completes, but the new order is laid again as a fresh motion (15,025). Probably the same cause as 1; not retested.
8. **A trade is reported as a gain when it was a loss.** "sold for 98,140, against the 86,100 it cost (16% over); 5,888 to the crew and the docks, 24,535 in customs, 1,495 to the money-changers" (Jan 269): net 66,222, a loss of ~19,900 on the cost, yet the headline figure is "16% over". Page wording not fixed.
9. **Council history "lost" on reload** (still open from round 1): round 3 found this was the loading state: for about 15 s after a reload the Council shows the empty-state words "Nothing has been recorded yet" before the record arrives (see `2026-10-23-aristomachus-1y-ui-hand-run-3.md`); fixed in loop 1.
10. **Private matters known abroad.** Hieron's cognition section listed "Abdmelqart took a grain voyage to Alexandria on credit, putting down part of the price from his own purse" and "The Tribunal ... had already advised against the charge laid against Abdmelqart" as what he knew in Syracuse (6 Dec): my facts were marked public (mine to set carefully), but a private purse affair reaching a foreign king in the same week is what a player would call a leak.

**Low**

11. "Ugly stories about Abdmelqart are going round" came back in nearly every 10-day window from 31 March (a monthly vendetta whispering campaign, `packages/sim/src/villainy.ts:250`), with no cost or author named on the page.
12. The Letters sheet stays open behind the Council ("closing" the sheet did not remove it from the screen, 28 Nov), and screenshots lag one action behind a click. The page is slow after a reload (~15 s before sheets respond: "Finding who you know…", "Sending for your records…").
13. `dialogue_ordinary`, `propose_social_events` and `extract_knowledge` each need a hand answer after a tray letter; the dialogue answer must be a **JSON string** (a bare text answer waits for ever); not documented in the prompt.
14. A story thread seed demanded "crisis" for a charge the Tribunal had already dropped ("quiet 90 days ... it is now crisis"); I closed it.
15. Passages that "said more than the world shows" are replaced by the engine's line (server log: `1 of 3 passage(s) said more ... replaced by the engine's line`), so my corrected re-answers were not shown on the page for the pay passage (it kept the first draft).

## 6. Waiting

Page time and my answering time were not separable: every burst waits on a model answer, so time is mine. Per order, send to result: turn 1 4 m 48 s; turn 2 3 m 06 s; turn 3 (season) 5 m 42 s; turn 4 (month) 2 m 35 s; turn 5 (season) 5 m 03 s; turn 6 (season) 7 m. What the page said while waiting: a live log ("Your order reaches the palace.", "The world turns to 3 March 270 BC.", "3 March 270 BC: Himilco son of Gisgo, Bostar son of Hanno, Barmelqart decide what to do.", an elapsed timer "2:27 so far"). Hung bursts: none. A season costs about 13 to 30 compose prompts (10-day windows) plus 1 to 3 orchestrate prompts; 79 compose prompts over 360 days, 33 of them answered empty.

## 7. The Chronicle on the page

| Turn | Said what mattered? | Repeated old facts? | Raw ids / template text? | Told what the player could not know? | Missed? |
|---|---|---|---|---|---|
| 1 (to 31 Mar) | Yes: refused pay, the council vote, Himilco's silence, Rhegium blockade. | "Stories in the Market" first of many. | Yes: the `fromProvinceId` line. | Rhegium news reaches Carthage as "word reached" correctly. | Treasury +924,407 shown raw. |
| 3 (to 29 Jul) | Mostly: the vote on mercenaries, Rhegium falling. | No. | No. | No. | The Messana motion's fate was never told. |
| 6 (to 24 Feb) | Yes: the Alexandria sale and its costs, the poisoning, the treaty. | "Ugly stories" again. | No. | Hieron "knew" my voyage in his section (model side). | The ratified treaty did not appear in the seal case Treaties tab (not re-checked). |

Passages verbatim (my hand-writing from the facts, which the engine gave as the thread): "Word reached Carthage that the Greek ships serving Rome had closed in on the harbour of Rhegium, and that the Campanians who hold the town could no longer get their own shipping out to sea." (11 Mar) and "The Council of Elders carried Abdmelqart's motion to hire four thousand mercenaries, thirty-four votes to thirty-one with thirty-four abstaining ... and by the record Abdmelqart himself, who had moved it, voted against" (20 May).
Reading experience: newest first, "New" badges and "Only what is unread", dates right, "earlier events" labelled for news. Long turns are walls of 8 to 15 small cards; the outcome sits in "What this changed" under the first passage; dates within a card group are not sorted (10 May entries after 20 May). The Chronicle says why on a refusal (it says "he did not care to"; it says what the voted money was, not why a spend was blocked).

## 8. As a player: what I could not tell

- What the office commands: the seal case ("Your charge") lists what the office *keeps* but not that it commands no army; I found out by trying.
- Why "Pay Hanno's army" is refused when I may "propose in fiscal matters over the Carthage treasury".
- Whether the Messana motion was voted, how it ended, and what the army and fleet did.
- Whether my own purse was drawn for the grain credit (the "Short 4,414 a month" shows on the strongbox only after the fact).
- Who won the Council vote with my name on both sides.

## 9. What worked

Empty-wallet page and wallet link; the live "world is moving" log; Matters in hand ("Needs your answer" with plain stalled reasons); refusals that name a cause ("he has no love for Abdmelqart"); the treasury sheet with "What your income depends on"; the Council's vote breakdown by house; the trade engine telling the player to say "on credit"; credit, debt service and shortfall on the strongbox's Debts tab; the treaty path (letter, acceptance, "the Council must ratify it first", ratification); reload at any point.

## 10. How far to trust this run

- **Length**: 360 of the 1,100 days asked, 6 orders. The user redirected mid-run to a three-loop cycle (run, fix, make a prompt), so the run stopped at the end of a season to start the fix pass.
- Not exercised: a war, a siege, a decision card, an alarm (truce, ultimatum, tribute, protest), an army sheet, the Map's tooltips, a raid, the home page's featured save, a lapsed order, the pay line. These checklist items are "not exercised" above.
- Sheets opened and screenshotted (text read): Council, Treasury (Accounts, Administration), Strongbox (Accounts, Debts), Mirror, Seal case (You, Your charge, The state, Treaties), Letters (list, one thread with Hanno), Chronicle, Matters in hand, Map (loaded; not clicked). Not opened: the Peace table, Notes, Laws, the arms rack, the books, Lands tab, the "Gather several" letters flow, the window as its own sheet (it opens the Map).
- Server: **port 3301**, not 3300 (an earlier round's server was still holding 3300 with its own hand directory, which I did not stop); `CHRONICA_AI_MODE=hand`, `CHRONICA_HAND_RESPONDER=manual`, `CHRONICA_HAND_DIR=eval-out/ui-run2/hand` (resolved to `apps/web/eval-out/ui-run2/hand`). First page 02:55 (local 03:55 BST clock in the notes). The 127.0.0.1 origin was used so the older signed-in session on `localhost` was left alone.
- Stubs: the watcher (`docs/playtests/ui-run-tools/watcher.mjs`) answered `write_mechanic` (3) and `reconcile_facts` (4) with empty stubs, auto-filled `voice_letters` (1), and answered **26 `simulate_cognition` prompts with `{"actors":[]}`**; its code is unchanged. Count: 33 stubs, 1 auto-fill (per its log; the last log line at 02:29Z).
- Hand-written: 9 orchestrate answers (`ans/t1..t6.mjs`; the third prompt of order 3 was answered with a no-op because the Messana motion was already in the second prompt, my choice and a possible cause of bug 6); 79 compose answers (33 empty: far-off news and repeated headlines, 46 with text; none generated by a rule; several were re-asked once and answered again); 2 cognition answers (Himilco on Decius's letter, **followed** the printed counsel "no (no men to spare)"; Hieron on mine, **no counsel printed**); `dialogue_ordinary` 1, `propose_social_events` 1 (empty), `extract_knowledge` 1, `declare_character` 2 (the first my error, section 4 item 10).
- Not done by hand: nothing on the model's side was answered by an automatic rule except the watcher's items above.
- **Leaks from model to player**: none into a decision. I knew from prompts that Hanno's army and Hasdrubal's command exist, and used "Hasdrubal son of Hanno" in order 4 (named in the model prompt, not visible on the page until the Chronicle said it in turn 1, 1 Mar). I also knew from the prompt that the grain convoy needs a province and gave "from Carthage" in order 2 after reading the page's own error line.
- Modelling shortcuts of mine, which affected the world: the Barmelqart inheritance seed was answered without a `money_transfer` (no source account existed); the two voted-money hires had a 12-month term over the cap (bug 1's trigger); `force_modify payObligationRef` on an army the player does not command was read by the engine as "rode out to take charge of the army" (turn 1), which is a reading the page showed as a joke register ("somebody gave orders to people who did not have to take them").
- Turns whose Chronicle was not read in full on the page: turn 2, 4 and 5 were read through the prompt facts rather than in the annals; turn 1, 3 and 6 were read via a DOM dump of the articles.

## 11. Fixes made after this run (loop 1, "Fix")

Tests added: `packages/sim/src/a-voted-budget-is-spent-by-who-it-names.test.ts` (2 tests, both failed before the change) and one test in `every-seat-votes.test.ts`.

- `competence-gate.ts`: a voted budget naming the man is his authority to spend it (no second motion), and a spent-down vote says so.
- `ballots.ts`: the mover of a question votes for it unless he has said otherwise.
- `apply-deltas.ts`: the convoy rejection no longer shows `fromProvinceId`.
- `what-changed.ts`: money lines use separators and a true minus.

Not fixed (next prompt): bugs 5-10 and 12-15 above.

## 12. Verdict in three lines

Goals: the Syracuse treaty was won, the treasury grew, the purse and the mercenaries were not (and the army was never mine).
Worst bug: a vote of money could not be spent without being voted again.
The page read as the story of a clerk's reign: a refused pay order, a charge, a grain voyage and a treaty, told in a Chronicle that mostly said what mattered but still used engine words and misleading spend figures.

---

Three things most worth fixing first: (1) outcome lines and spend figures that contradict the books, (2) orders split into duplicate parts (and a Messana motion that was never reported), (3) the Council's "Since your last order" after a reload.
