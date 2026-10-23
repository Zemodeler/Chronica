# Hieron II, king of Syracuse: seven months of a war he commands, model answered by hand (UI round 4)

Played 1 March 270 BC to 4 October 270 BC (217 days, five orders, one decision card and four tray answers) through the website, with the model's side answered from files by hand.
Prompt: `docs/playtests/ui-hand-playtest-prompt-4.md`. Run directory: `eval-out/ui-run4/` (goals, notes, `ans/`), hand directory `apps/web/eval-out/ui-run4/hand/`.
**This run stopped at day 217, not the 540 days and 10 orders asked** (section 10).

## 1. Verdict

**Playable.** (Better than rounds 2 and 3: a seat that really commands its army.) Last day reached: 4 October 270 BC.

1. The orders worked as orders: a levy, a march, a battle offered "if the garrison comes out", a siege laid "if it keeps to the walls", a war declared, a garrison cut out of the army, a raid, convoys and pay paid from the royal chest, and every one reached the army sheet, the Chronicle and Matters in hand. Standing orders showed "Completed".
2. The alarms and the tray behaved: an ultimatum from Carthage stopped a burst, sat in the tray with "Accept / Refuse / Write back with terms of your own" and a deadline ("wanting an answer by 25 October 270 BC"), and was answered in the order box or the tray; an engine-written decision card ("Mamertine garrison is drawn up before your camp ... The two sides are about even") offered three options and vanished once answered.
3. But the page still contradicts itself about orders, and a decision card offered an option (the player's own hold order made it impossible) that the engine then refused.

## 2. What was played

Seat: **Hieron II, king of Syracuse** (declared at once; the army sheet reads "Under Hieron II", and the model's slice lists "command in military matters, over Syracusan army"). Page: royal treasury 1,696,842 (1,612,000 in silver), surplus +148,500 a month (tithe 192,000, army pay 43,500), pay chest of the army 21,053, own purse 120,000; Syracusan army 3,000 (2,000 hoplites, 700 mercenary foot, 300 horse; action "Set the men to drill in camp"); squadron 35 ships.

| Goal | Bar | Result at day 217 |
|---|---|---|
| Military: garrison beaten in the field and Messana taken by day 540 | both | **Met**: the Mamertines were beaten in the field (517 against 377 casualties) and Messana opened its gates after 30 days of siege. |
| Economic: treasury >= 2,500,000, pay chest never empty | both | Treasury 2,234,780 (from 1,696,842); the Garrison of Messana's chest was empty until I filled it; the army chest 89,000. Not yet. |
| Diplomatic: non-aggression with Carthage; no Carthaginian army landed | both | **Failed**: Himilco refused ("will make no treaty with the king while Syracuse holds Messana"), sent an ultimatum, and when I refused Carthage made war: its garrison of Agrigentum occupied 12 districts and laid siege to Syracuse (it fell back from the returning army, outnumbered three to one). A friendship with **Rome** was won ("Rome and Syracuse will make no war on each other"), and the Mamertines accepted a tribute (20,000 a year for five years) and a six-month truce. |

Orders as typed and what the page said:

| # | Span | As typed | What the page said |
|---|---|---|---|
| 1 | month | "Call the levy and march the Syracusan army on Messana. If the Mamertine garrison comes out, offer it battle in the field; if it keeps to the walls, lay siege to the town and build towers. Keep the army fed by convoys paid from the royal chest." | March done (army at Messana); battle offered and, 3 weeks on, the Mamertines attacked and lost; siege laid, towers raised; "Call the levy ... nothing came of it" beside "twelve hundred more citizens joined the army"; "Keep the army fed ... ordered; no sign of it yet" beside "A convoy of sixty days' bread ... was sent". Matters in hand: "3 orders under way"; standing orders "Completed". |
| 2 | season | "Press the siege of Messana and storm the walls the day a breach is made. If the Mamertines ask for terms, hear them. And write to Himilco ... offering a treaty of non-aggression." | War declared ("syracuse and mamertines already stand in war"); Messana opened its gates after 30 days; Himilco countered ("if Hieron lifts the siege"); the Mamertines' truce request **lapsed unseen** ("You sent no answer, 2 June 270 bc") although my order said "hear them"; the order shows "Stalled". |
| 3 | season | "Messana is mine and the Mamertine garrison is beaten. Put a Syracusan garrison of a thousand men into Messana, and demand a tribute of twenty thousand a year from the Mamertines who still hold Coastal Sicelia. Write to Himilco ... that Messana has fallen and I still want the treaty of non-aggression. Pay the army in full from the royal chest." | Split into **four** prompts (the first sentence, a statement, became its own order: "This is a statement of what has happened, not an order"); garrison "1000 men of Syracusan army became Garrison of Messana; 3007 remain in it"; tribute accepted; pay "done: 60000 paid" but Matters in hand "Pay the army in full ... Stalled"; the burst stopped on 31 Aug when Himilco's ultimatum reached me. |
| 4 | season | "Refuse Carthage's ultimatum: Messana stays Syracusan. Take the army and the fleet to the strait, and raid the farms of the Mamertine districts they still hold in Coastal Sicelia so they cannot pay Carthage. Write to the consul Gaius Genucius Clepsina asking Rome's friendship against Carthage." | Raid "Syracusan army raided Coastal Sicelia, and found nothing left worth carrying off" beside "ordered; no sign of it yet"; Rome accepted. Matters in hand then listed "An answer to Himilco son of Gisgo is due in 45 days" and "An answer to Statius Mettius is due in 20 days". |
| (tray) | | Refuse (Himilco's ultimatum): "Messana is Syracusan and will stay so. Carthage may make war if it will; Syracuse will meet it." / Accept (Mettius's six months' truce): "The truce is granted for six months, so long as the tribute is paid on its day." | Both went out at once ("Your answer goes out now, and holds from the day it is sent."). |
| 5 | season | "The Carthaginians will come now that I have refused them. Bring the army and the Garrison of Messana back toward Syracuse, pay the men in full from the royal chest, and meet the Carthaginian garrison of Agrigentum in the field wherever it stands. Hold Messana with what is left." | The army returned, Carthage's garrison fell back before it; an engine decision card arose on 4 Oct (below). |
| card | | "Come out and fight" | Refused: "Garrison of Messana is under orders to hold, and will not attack until the hold is lifted" (the hold was mine). |

Dated timeline: 1 Mar levy and march; ~21 Mar army at Messana; Apr battle offered, Mamertines beaten and 5 districts taken; 31 Mar to 29 Jun siege of Messana, gates open after 30 days; 2 Jun Mamertine truce request lapses; 29 Jun to 31 Aug garrison, tribute, letters; 31 Aug Carthage's ultimatum; 10 Sep refused; Sep Carthage declares war and occupies 12 districts, besieges Syracuse; 30 Sep Mettius accepts the truce; the army relieves Syracuse; 4 Oct decision card; stop.

## 3. First-time experience

Reused the account `stranger_r3` (funded in round 3), so the empty-wallet page was not re-seen. A second save was begun on the same account: the home page then listed the newest save as "Hieron II ... The Chronicle last recorded The King Answers, and the Hold Stands." (the round-3 copy "Still open" is better now) and the other as "Aristomachus of Syracuse ... 16 February 269 BC". Both are the newest and the last played, so the "newest created vs last played" question was **not discriminated**.

## 4. Checklist of prompt 4

Section 1 (ten things):
1. **War by order, siege laid by order, seen on the army sheet: done** (war: "King Hieron declared war on the Mamertines ... and pressed the siege"; siege laid by a deferred order and shown in the Chronicle; the army sheet itself was not re-opened mid-siege, so "seen on the sheet" is not checked).
2. **A battle by order: done**: the standing order "offer battle" ended "Completed" after "Mamertine garrison attacks Syracusan army ... beaten ... 517 casualties ... 377".
3. **A decision card whose odds the engine wrote: done, odds not checked**: "The two sides are about even; your men are in good heart and fed". The Map tooltips were not opened, so the claim was not compared with a figure.
4. **Alarms**: an ultimatum to my power **stopped a burst** and appears in the tray with a deadline and in Matters in hand "due in 45 days" (not at the moment of the stop: Matters did not list it on 31 Aug, it did on 10 Sep); a **truce request** lapsed unseen in June ("You sent no answer, 2 June 270 bc") and was seen only after I had stopped and reopened the tray in September; a **tribute demand** to my power, a **protest** and a **truce lapsing within 30 days** were not exercised (I made the tribute demand; the Mamertines accepted).
5. **A lapsed order**: the engine warned "Still waiting for Syracusan army never reached Eastern Syracusia (20 days) before 'meet the Carthaginian garrison of Agrigentum in the field wherever it stands' can go ahead. It lapses on day 283; your word?" (seen as a Chronicle prompt fact; I did not see where the page showed it).
6. **Pay owed against the ledger: partly**: the arms-rack tooltip said "The Garrison of Messana: nobody has undertaken to pay them | Waiting on your word" although 30,000 had been paid into its chest; the ledger and strongbox were not reopened after the war began.
7. **A raid: done** ("Syracusan army raided Coastal Sicelia, and found nothing left worth carrying off", the ground was then occupied).
8. **Spending from the chest: done as ruler** (60,000 to the army chest; 30,000 to the garrison's chest), the outcome lines later "Stalled" / "nothing came of it".
9. **An answer to a letter the model's character wrote first: done** (Mettius's truce request, tray: "Accept the truce / Refuse / Write back with terms of your own").
10. **Home page with two saves: not discriminated** (section 3).

Section 2 (round 3 fixes and round 2 fixes):
(a) **A secret plot against you is not named in Matters in hand: not exercised** (the model's threads against Hieron were of the public kind this time; no secret title appeared). (b) **"Reading the record..." while loading: not exercised** (no reload this run). (c) voted sum spent by its man: **not exercised** (a ruler spends his own chest). (d) the mover is among the named "for": **not exercised** (no chamber). (e) a convoy with no source: not exercised. (f) "What changed" money lines: the Chronicle did not carry a "What changed" box for this seat in this stretch. Confirmed again: a decision card vanished once answered (and the answer started a short burst); "Syracuse has no garrison of ours ... the walls are bare" appeared again (Sep); a Carthage-Syracuse war did not break the page; a letter sent through an order appears in the tray.
Still open items: 1 (**the page says the seat commands**): here it did and it worked. 2 (**outcome lines against the books**) **not fixed, six instances**: "Call the levy ... nothing came of it" beside "twelve hundred more citizens joined" (1 Mar); "Keep the army fed ... ordered; no sign of it yet" beside "A convoy ... was sent" (1 Mar); "raid ... ordered; no sign of it yet" beside "Syracusan army raided Coastal Sicelia" (Sep); "Pay the army in full from the royal chest" "Stalled" after "done: 60000 paid" (31 Aug); "If the Mamertines ask for terms, hear them" "Stalled" after they had asked (June); "March Syracusan army to Coastal Sicelia." "failed" (an order the player never typed; Oct). 3 (**a truce request to the player's power never reached the tray before it lapsed**): **not fixed** (June), but a later request (30 Sep) was shown with its deadline. 4 repeated headlines: the "Ships slipped into" line again in the model's news; 5 engine words: "It could not be done as given: Garrison of Messana is under orders to hold" (clear enough); 6 "Holding position" for an army besieging: not re-checked.

## 5. New bugs

**High**

1. **The page tells the player a decision was "refused" when the engine took it.** (Traced after the run: see section 11.) Card 4 Oct: "Come out and fight / Keep to the camp / Fall back by night" for the Garrison of Messana; after "Come out and fight" the order read "refused: Garrison of Messana is under orders to hold, and will not attack until the hold is lifted" (the hold was my own order in turn 5). The card should either not offer the option or lift the hold. Not traced.
2. **A truce request addressed to the player's power lapsed without the player seeing it, against a standing instruction to hear it** (June): "If the Mamertines ask for terms, hear them" ended "Stalled" while the Chronicle said "Kingdom of Syracuse refused Mamertines of Messana by silence on 'Mamertines of Messana asks for a truce'"; the tray showed it only as "You sent no answer, 2 June 270 bc". Later requests (30 Sep) were shown with a deadline, so the lapse is intermittent or burst-dependent. Not traced.

**Medium**

3. **Outcome lines contradict the books** (six instances, section 4). Not fixed.
4. **A statement became an order** ("Messana is mine and the Mamertine garrison is beaten." got its own model call and the outcome "under way: Mamertine garrison marches on North-eastern coast of the Sikeloi", news unrelated to anything the player said). The order splitter treats a sentence of fact as an order.
5. **The Carthaginian ultimatum is not listed among "Letters awaiting an answer" in the model's slice** while it was in the tray (a model-side gap: the model is shown an ultimatum as a fact, not as a letter awaiting).
6. **Arms-rack "nobody has undertaken to pay them" beside a paid chest**: true in the engine's terms (no pay obligation) but the page does not say that 30,000 stands in the chest.
7. The king's own army was reported as "Syracusan army marches on Coastal Sicelia: Arrives in Coastal Sicelia." "(news reaching the court; nobody here witnessed it)" with the order "March Syracusan army to Coastal Sicelia." "failed" (turn 5): a stale project reported as news about his own army.

**Low**

8. Matters in hand listed the ultimatum only on the next burst, not when the burst stopped for it.
9. Repeated "ships slipped into" and "Contingent ... has arrived in Rhegium coast" lines in the model's news.
10. The page's `find` and screenshot lag (not the game's).

## 6. Waiting

Send to result: turn 1 about 6 min, turn 2 about 5, turn 3 about 8, turn 4 about 8, turn 5 about 6 (all my answering time). The live log was good. Prompts: 91 compose (47 hand-written empties are in section 10), 9 orchestrate answers, 8 cognition answers by hand (and about 30 stubs), 0 `dialogue_*` (no tray conversation this round).

## 7. The Chronicle on the page

Read through the prompts' facts and the cards I wrote; the page's own text was read for Matters in hand, the tray, the card and the home page. Passages verbatim (my hand-writing from the thread facts): "The Carthaginian garrison of Agrigentum, outnumbered three to one, would not stand against the Syracusan army at Syracuse and fell back into south-western Syracusia, losing five in a hundred of its men to the pursuit; the Syracusans took its camp and fed on its stores." (Sep 270) and "Statius Mettius accepted the king's truce of six months on the terms he set, the tribute to be paid on its day."

## 8. As a player: what I could not tell

- Whether a truce request had reached me before it lapsed (June).
- That my own "hold" order would make a decision option impossible.
- What the Carthaginians numbered (no tooltip opened); whether "about even" was true.
- Why my pay orders showed "Stalled" after being done.

## 9. What worked

Orders with conditions ("if it comes out ... if it keeps to the walls") became standing orders with a status; the tray answer form with its three choices and deadline; the king's tribute demand and its acceptance; the arms-rack tooltip naming what waits on the player ("2 letters wait on your answer"); the home page text for the last Chronicle entry.

## 10. How far to trust this run

- Length: 217 of the 540 days and 5 of the 10 orders; stopped at the end of a burst to do the fix pass (the three-loop cycle).
- Server **port 3301**, hand directory `eval-out/ui-run4/hand`, `CHRONICA_AI_MODE=hand`, `CHRONICA_HAND_RESPONDER=manual`; first page 04:49.
- Stubs: the watcher answered `reconcile_facts`/`write_mechanic` and about 30 cognition prompts with `{"actors":[]}`; no `voice_letters`.
- Hand-written: 9 orchestrate (`ans/t1..t6.mjs`), 91 compose (about 25 empty), 8 cognition answers (Himilco x4: counsel never printed; Mettius x3; Genucius x1; counts: **no counsel printed 5, followed 1 ("yes (gave way)": Mettius on the tribute demand)**, 2 held prompts answered empty), 1 declaration.
- Leaks from model to player: none into a decision. I did act on the model prompt's "the army is under Hieron II" and used `force_modify hold: true` on the Garrison of Messana as a model-side choice that later refused a card option (bug 1 is therefore partly my modelling, but the card is the game's).
- Modelling shortcuts that changed the world: the garrison commander (Nicostratus) was named by me; the Carthaginian war and ultimatum were my cognition answers (no counsel was printed to follow); the cousin and the charge-bringer I created.
- Sheets opened: Council, army sheet (once), treasury (Accounts, once), tray and a letter thread (answered both), Matters in hand, the home page. **Not opened**: Map tooltips, strongbox, seal case, mirror, books.

## 11. Fixes made after this run (loop 2, "Fix")

Test first, then code: `packages/sim/src/orchestrate-split.test.ts` gained a case (it failed before the change): an order that opens with a sentence of fact ("Messana is mine and the Mamertine garrison is beaten.") no longer sends that sentence to the model as an order of its own; it stays with the command after it (`packages/sim/src/orchestrate.ts`, `splitOrder`).
Looked at and not changed: bug 1 (the decision card): the engine's own answer to a card is `answerEngagement` (`packages/sim/src/engagement-decisions.ts`), which applied "fight" itself; the refusal text came from the *model's* `force_engage` (mine), blocked by the hold I had set, so the card is not wrong, but the page then told the player "refused" for a decision the engine had taken: the same class as the other outcome lines. Bug 3's "Stalled" for done orders comes from `orderPartStatus` in `packages/shared/src/authority/under-way.ts` and needs its own pass.

## 12. Verdict in three lines

Goals: Messana taken and the Mamertines paying tribute; Carthage not appeased (it made war).
Worst bug: a decision option the engine refuses, and a truce request that lapsed unseen against a standing instruction.
The page read as the story of a king's war, with the engine's own outcome lines still arguing with the Chronicle.
