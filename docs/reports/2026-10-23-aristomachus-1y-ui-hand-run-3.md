# Aristomachus of Syracuse, strategos: a year of a war at the website, model answered by hand (UI round 3)

Played 1 March 270 BC to 16 February 269 BC (351 days, six orders and one decision card) through the website, with the model's side answered from files by hand.
Prompt: `docs/playtests/ui-hand-playtest-prompt-3.md`. Run directory: `eval-out/ui-run3/` (goals, notes, answer scripts under `ans/`) and `apps/web/eval-out/ui-run3/hand/` (every prompt and answer).
**This run stopped at day 351, not the 540 days and 10 orders the prompt asks for** (section 10).

## 1. Verdict

**Playable with caveats.** Last day reached: 16 February 269 BC (day 351).

1. A war happened on the page this time and the page held: a Syracusan march, an ultimatum, a battle, a siege of 23 days, a surrender, a Carthaginian invasion of Syracuse's own country, a siege of Syracuse, a truce, a refused peace, and a decision card that vanished once answered. `/api/games/<id>/overlay` answered 200 throughout; reloads came back to the same date.
2. But the seat's powers are a mirage: the page shows an "arms rack: 3,000 men and 35 ships in 2 forces" and the seal case says "command in military matters", yet every military order was refused ("rode out to take charge of Syracusan army ... they take their orders from Hieron II"), while the same seat's *letter* (an ultimatum) made war for the whole kingdom. The player ends up petitioning the king in the order box and the page never says so.
3. Several fixes from round 2 were confirmed as a player (a bare town says so; a decision is asked once; a Council reload recovers), and one real leak was found and fixed (a rival's secret plot was named in "Matters in hand").

## 2. What was played

Seat: **Aristomachus of Syracuse, Syracusan strategos** (an existing person, `syracuse-strategos-11v4tw`; first declaration accepted at once). As the page shows it: purse 9,000 drachmae; a
charge of "raising and holding the levy" and "feeding and moving the armies" (honorary, no pay), one of three strategoi; standing 6,000 of 10,000; the arms rack "3,000 men and 35 ships in 2 forces"; the army sheet: Syracusan army 3,000 men
at Eastern Syracusia **"Under Hieron II"** (2,000 hoplites, 700 mercenary foot, 300 horse; "Men in good heart, fed and paid"; "Holding position"); squadron 35 ships "Under Leptines of Syracuse".

Goals (`eval-out/ui-run3/goals.md`, set after the room) and results at day 351:

| Goal | Bar | Result |
|---|---|---|
| Military: Messana in Syracusan hands by day 540 | Messana taken | **Met, by the king's army, not my order**: the Mamertine garrison lost the field (555 against 377 casualties) and Messana opened its gates after 23 days. Messana was then besieged by the Mamertines in August; a truce ended it on 17 Nov. |
| Economic: army fed and paid, purse >= 15,000 | no shortage line | Purse 29,000 (the king granted 20,000 when asked); the army sheet said "fed and paid" throughout; a famine hit Messana and a grain price rose at Syracuse. Met. |
| Diplomatic: no Carthaginian or Roman army in Sicily by day 540 | none landed | **Failed**: Carthage declared war on 15 Aug 270 and took 15 Syracusan districts, then besieged Syracuse; Rome's allied contingents camped in the Sikeloi uplands (and starved). Truce with the Mamertines won (hostages); my winter peace offer to Carthage was refused. |

Orders as typed and what the page said (Council):

| # | Span | As typed | What the page said |
|---|---|---|---|
| 1 | month | "Raise the levy and march the Syracusan army to Messana. Besiege the Mamertines in the city and keep the army fed on the way. Tell the king what we mean to do." | March "done: Syracusan army at North-eastern coast of the Sikeloi" (day ~21); levy "nothing came of it" beside "twelve hundred more citizens joined the army"; siege "failed: Nobody in Syracusan army could remember appointing Aristomachus of Syracuse to anything"; tell the king "nothing came of it". Matters in hand: "2 orders have stalled". |
| 2 | season | "Lay siege to Messana now with the whole army, close the roads and the strait shore, and send word to the Mamertine leader Statius Mettius that he may march out and leave Sicily with his life." | Siege "refused: Aristomachus of Syracuse rode out to take charge of Syracusan army. The men were polite about it, but they take their orders from Hieron II." The ultimatum was sent, refused, and "Kingdom of Syracuse made war on Mamertines of Messana". Messana's walls were later breached by the king's army. |
| 3 | season | "Press the siege of Messana and storm the walls as soon as a breach is made. Keep the army fed from Syracuse, pay the mercenary band out of the king's chest if I can't, and watch the strait in case Carthage sends ships." | Handed on to the king ("handed on, not yet taken up"); "Hieron II gave Aristomachus of Syracuse 20000"; "Hieron II found no bread for Syracusan army"; Matters in hand: "Press the siege ... Stalled" while Messana had fallen. Burst stopped at 15 Aug. |
| 4 | season | "Carthage has made war on us and is burning the farms of Eastern Syracusia. Take the army back to Syracuse and meet the Carthaginian garrison of Agrigentum in the field, and take the Mamertines' truce on five hostages so we have one enemy and not two. Ask the king to write to Rome for friendship." | Split into two prompts; "Hieron II did not march the army: there is no such army" (my ask named a province); "Hieron II would not speak for Aristomachus ... there is no question of Aristomachus of Syracuse's before any house". |
| 5 | season | "Write to Himilco son of Gisgo of Carthage and ask for a truce for the winter, and offer terms of peace: Syracuse keeps its own land and Carthage keeps Agrigentum and the west. Give Statius Mettius his truce on five hostages and sit the army down at Syracuse for the winter." | Himilco refused ("treat only on what her armies held"); the Mamertines accepted the truce ("Mamertines of Messana and Kingdom of Syracuse have made a truce"). |
| 6 | season | "The spring is coming. Offer battle to the Carthaginian garrison of Agrigentum on the plain outside Syracuse before the main Punic army joins it, and tell the king I mean to fight. If Carthage will talk, hear them." | A decision card ("King Hieron's council asks the strategos what he will do ... nearly twice the strength of the Syracusan army"), "Offer battle now" / "Hold the walls". I chose **Hold the walls**; the card vanished at once. |

Tray letters: Statius Mettius (15 Aug, "Mettius, you are beaten and Messana is ours. I will carry your wish for a truce to the king if you give up Coastal Sicelia and send me ten hostages of your chief men") answered after 8 days: "will have the truce he asked for and offers five hostages, but will not give up Coastal Sicelia".

Dated timeline: 1 Mar first order; ~21 Mar army reaches Messana; 31 Mar ultimatum; 4 Apr refused, war; 1 to 29 Jun siege of 21 days and 50%; July Messana opens its gates after 23 days; 15 Aug Carthage declares war and raids Eastern Syracusia (540,000 taken); Sep to Nov Carthaginian garrison occupies 12 then 3 more districts, besieges Syracuse, field force and Punic army cross to Sicily; 13-17 Nov truce with Mettius, Himilco's refusal; Feb 269 decision card; 16 Feb stop.

## 3. First-time experience (empty-wallet stranger)

Unchanged from round 2 and fixed there: "Your wallet is empty", the research button greyed, "Research is paid from your wallet, and it is empty. Add coins first." A new local test account (`stranger_r3`), funded with 5 coins through `fund.mts` (04:05).
This time the declaration of a person already in the world (Aristomachus) was accepted on the first try; the stranger is not told what research costs.

## 4. Regression checklist (section 3 of the prompt)

1. **Far-off and near battles do not break the page: fixed.** After a Syracusan-Mamertine battle, a 23-day siege, a Carthaginian invasion and a siege of Syracuse itself, `GET /api/games/<id>/overlay` answered `200` (`{"stamp":"10","mapVersion":"0203-1ccfwzt","mapOverlay":{"revision":352,...`) and a reload at day 346 came back.
2. **A decision is asked once: fixed.** After "Hold the walls" the card vanished at once ("The world is moving ... The season closes on 11 February 269 BC."), a short burst ran, and no card returned by 16 Feb.
3. **The odds in a decision card are true: not exercised** (the card was my hand-written text; the engine wrote none).
4. **A town left bare says so: fixed.** Chronicle, Sep 270: "Syracuse has no garrison of ours: Carthaginian garrison of Agrigentum stands in Eastern Syracusia, and the walls are bare." (it says it, as news, about the town the player's own power holds).
5. **Your own power writes no letters in your name: not exercised for letters in the tray; one observation:** "Kingdom of Syracuse refused Mamertines of Messana by silence on 'Mamertines of Messana asks for a truce'" (July): the king's power let a truce lapse that the player was never shown.
6. **Alarms: not fixed / partly.** The Mamertine truce request (to the player's power) did not stop a burst, did not appear in the tray ("They wrote, 4 April") nor in Matters in hand; Carthage's declaration of war is not in Matters in hand (the burst did stop on 15 Aug, 45 days into a 90-day span). An ultimatum I sent and a truce I answered behaved. Not exercised: tribute demand, protest with a day, truce lapsing.
7. **A raid on ground your army took: not exercised.**
8. **A lapsed order says why: partly fixed.** Every stall carried a reason ("The army answers to King Hieron; the strategos asks him to bring it back and fight").
9. **The pay line is true: not exercised** (the ledger stand was not opened; the army sheet said "fed and paid").
10. **The character screen: not exercised** (accepted at once).
11. **Order outcome lines against the books: not fixed, five instances.** (a) "Lay siege to Messana now ..." "refused: ... rode out to take charge of Syracusan army" beside the Chronicle's "The Syracusan army laid siege to Messana, drawing its lines before the walls" (31 Mar); (b) "Raise the levy" "nothing came of it" beside "twelve hundred more citizens joined the army" (1 Mar); (c) Matters in hand "Press the siege of Messana ... Stalled" after Messana opened its gates and Hieron "agreed" (15 Aug); (d) "Hold the walls ... Stalled" for a decision the player answered (Feb); (e) "Tell the king what we mean to do" "nothing came of it" beside "Aristomachus reported to King Hieron ...".
12. **Still open from round 1:** home page's featured save: not exercised. **Letters sent through an order appear in the tray thread: fixed** (the ultimatum shows as "You | An ultimatum, 31 March 270 bc ... Statius Mettius | Refused, 4 April 270 bc"). **Order box hidden by a decision card: by design, but unexplained:** while a card is open the order form is not drawn at all (`council-panel.tsx` `view.decision === null`); the page says "This needs your word" and nothing else. **Council "Since your last order" after a reload: recovered after about 15 s**; for those seconds the Council said "Nothing has been recorded yet. Give an order and the world will answer." (the round-2 report called this history lost: it was this loading state). **Fixed in loop 1** (shows "Reading the record..." until the record is read).
13 to 16 (round 2's fixes): not exercised (no money voted in a chamber, no chamber of mine, no convoy, no treasury lines for this seat).

## 5. New bugs

**High**

1. **The seat commands nothing, and the page says it does.** Arms rack "3,000 men and 35 ships in 2 forces"; seal case "command in military matters"; the model's own sheet "WHAT THIS PERSON MAY DO: ... command in military matters, over Kingdom of Syracuse". Yet "Lay siege to Messana now with the whole army" was "refused: Aristomachus of Syracuse rode out to take charge of Syracusan army ... they take their orders from Hieron II" (31 Mar), while the same seat's letter (an ultimatum with `onRefusal: war`) began a war for the kingdom ("Kingdom of Syracuse made war on Mamertines of Messana, as the letter had said it would if refused", 4 Apr). Goal 1 became "ask the king" and goal 3 unreachable by orders. The army sheet reads "Under Hieron II" but the arms rack and the order box do not say the army is not yours. Not fixed (needs a design call: either the strategos is given the king's army by an order, or the arms rack lists only what he commands).
2. **A secret thread's title was shown to its target** (Matters in hand "threads of history", 16 Feb): "Mettius's silver | brewing" and "Mettius's convoy | brewing", threads the model had opened `private` against the player. `threadsYouSee` treated being a participant as knowing the thread (`packages/shared/src/knowledge/threads.ts`). **Fixed in loop 1** (a private thread is shown only once an entry of it has been told or the player follows it).

**Medium**

3. **Matters in hand lists achieved or answered orders as "Stalled"** (instances in item 11 c, d). Not fixed.
4. **A truce request to the player's power vanished** (item 6): the king's power "refused ... by silence" and the player was never shown it. Not fixed.
5. **Repeated headlines.** "Ships of Kingdom of Syracuse slipped into [Messana/Eastern Syracusia] past the besiegers' lines" four times across windows (13 Nov to 11 Feb); "Contingent of Bruttians/Lucanians/Apulians ... has arrived in Rhegium coast" (two bursts in June-July); "Ugly stories about Aristomachus" once more in a gathered passage. Not fixed.
6. **Stale engagement lines.** The model's prompt kept "Carthaginian field force and Syracusan army face each other at Eastern Syracusia, 102 days, and nobody has ordered an attack" after the Carthaginians had gone to winter quarters at the south coast of the Sicani (`packages/sim/src/slice.ts:741`). Not traced; model-side but it shapes what the world writes.
7. **An ask the engine cannot place comes back in the engine's words.** "Hieron II did not march the army: there is no such army" and "Hieron II would not speak for Aristomachus of Syracuse: there is no question of Aristomachus of Syracuse's before any house" appeared as Chronicle passages. Both followed asks I mis-specified (`ask.ref` a province; `speak_for` with no question), but the page told them as the king's refusals.

**Low**

8. The army sheet says "Holding position" for an army that is besieging a city (31 Mar to July).
9. The player's own illness ("Aristomachus of Syracuse has been taken ill and keeps to his house") is reported as ordinary news in the Chronicle with no effect on the orders or the sheets.
10. A decision answered becomes an "order" ("The ruler has answered: Hold the walls.") in the model's prompt and in Matters in hand.
11. The Council's empty state read "Nothing has been recorded yet" while the record loaded (reload). **Fixed.**
12. The `find` tool of the browser does not find buttons by their text; screenshots lag one action. Not the game's.

## 6. Waiting

Send to result: turn 1 about 4 min, turn 2 about 6 min, turn 3 about 5 min (burst stopped at day 168 of 90), turn 4 about 4 min, turn 5 about 6 min, turn 6 and the card about 5 min. All of it was my answering time (the server only waits on the files). The page's live log was good ("Your order reaches the palace.", "The world turns to 3 March 270 BC.", "The record is entered...."). Hung bursts: none; one held prompt (a cognition for an actor the watcher flagged) answered empty after reading it. A season cost 13 to 34 compose prompts, 1 to 2 orchestrate prompts and 1 to 3 held cognition prompts; 110 compose prompts in 351 days, 33 of them answered empty.

## 7. The Chronicle on the page

| Turn | Said what mattered? | Repeated old facts? | Raw ids / engine words? | Told what the player could not know? | Missed? |
|---|---|---|---|---|---|
| 1 (to 31 Mar) | Yes: the march, the levy, the king told. | No. | "Nobody in Syracusan army could remember appointing Aristomachus to anything". | No. | The siege laid (Chronicle) vs refused (outcome). |
| 3 (to 15 Aug) | Yes: Messana's fall, the king's twenty thousand, Carthage's war. | No. | "found no bread ... may not draw upon the treasury". | No. | Mettius's truce letter to Syracuse. |
| 4-5 (to 13 Nov, 11 Feb) | Yes: the invasion, the bare walls, the refusal of peace. | Yes: the ships-slipping line four times. | No. | A Roman consul's assassination attempt (far news, told as news). | The page's Map overlay for the invasion not read. |

Two passages verbatim: "Hieron II sent the Syracusan army against the Mamertine garrison, and the Syracusan squadron sailed up to Messana and shut the Mamertines' shipping into the harbour. Statius Mettius appealed to Carthage and to Rome for protection. Carthage answered ... that it had no men to spare; Rome answered ... that the Mamertines' war was their own and the gods should keep both from folly." (Apr 270) and "Syracuse has no garrison of ours: Carthaginian garrison of Agrigentum stands in Eastern Syracusia, and the walls are bare." (Sep 270, the engine's own line).
Reading experience: a war season is 15 to 30 small cards; the outcome box sits above the passages; "earlier events" marks news; the answer to the player's own letter arrives with an honest "Statius Mettius's answer will come in 8 days."

## 8. As a player: what I could not tell

- That the army was the king's and my order could only ask him; the arms rack and the seal case said otherwise.
- Whether the siege was laid (Chronicle) or not (outcome "refused").
- That the Mamertines had begged Syracuse for a truce, and that the king let it lapse.
- What Carthage's declaration of war was or when it reached me; the burst simply ended.
- How strong the Carthaginians were (no Map tooltip was opened: not done).

## 9. What worked

The first-order feedback loop (a march that really took three weeks and "done" when it arrived); the army sheet (phalanxes, lochoses, "242 unfit for duty; 129 killed in action; 58 dead of their wounds or sent home maimed; 6 deserted"); the tray (ultimatum thread, eight-day answer); the truce and peace letters; the king's gift of 20,000 and the honest "Hieron II found no bread"; the decision card; the bare-walls line; reload recovery.

## 10. How far to trust this run

- **Length**: 351 of the 540 days and 6 of the 10 orders asked; the run stopped at the end of a season to start the fix pass (the user asked for three run-fix-prompt loops).
- Server: **port 3301** (an earlier round's server held 3300), hand directory `eval-out/ui-run3/hand` (resolved to `apps/web/eval-out/ui-run3/hand`), `CHRONICA_AI_MODE=hand`, `CHRONICA_HAND_RESPONDER=manual`. First page 04:05 (BST clock of the notes).
- Stubs: the watcher answered 1 `reconcile_facts` and about 30 `simulate_cognition` prompts with `{"actors":[]}` (log: `{"stub":31,"auto":0}`); no `voice_letters` prompt arose.
- Hand-written: 8 orchestrate answers (`ans/t1..t7.mjs`), 110 compose answers (33 empty, 77 with text; none by a rule), 5 cognition answers (Mettius three times: counsel "yes (gave way)" **went against** (once), no counsel printed (twice); Himilco once **followed** counsel "no (not beaten)"; one held prompt (Hieron, Himilco, Nicostratus) answered empty), 1 declaration.
- **Leaks from model to player**: none into a decision, except that I knew (from the first prompt) that the army is under Hieron and the strategos "may command", and used "ask the king" from turn 3 on after the page had told me nothing of it.
- Model-side shortcuts that changed the world: the siege order was converted to a request to the king by my answer (an answer the engine would not have refused if I had written `force_modify`, which it read in round 2 as "rode out to take charge"); the cousin and accuser I created (Philistion, Dionysodoros) and the first-order delegation refs (`ask.ref` a province; `speak_for` with no question) are mine; the Barmelqart-style inheritance seed was again answered without a `money_transfer`.
- Sheets opened: Council, army and fleet (both tabs, one army sheet), seal case (You, Your charge), letters (list, one thread with Mettius), Matters in hand, Chronicle (via DOM). **Not opened**: The state, Treaties, ledger stand, strongbox, mirror, books, window, Map tooltips, Peace table.
- Turns whose Chronicle was not read in full on the page: all but the last two were read from the prompts' facts and a DOM dump of the annals.

## 11. Fixes made after this run (loop 1, "Fix")

Tests: a case added to `packages/shared/src/knowledge/threads.test.ts` (secret thread, passes with the fix; I did not run it red first because the fix and test were written together).

- `packages/shared/src/knowledge/threads.ts`: a private thread is told by its entries, not by the player being its target.
- `council-panel.tsx` and `chronicle-panel.tsx`: "Reading the record..." until the record has been read, instead of the empty-state words.

Also verified: `apps/web` typechecks. Not fixed (next prompt): bugs 1, 3 to 10 above.

## 12. Verdict in three lines

Goals: Messana was taken (by the king), the army was fed and the purse grew; Carthage was not kept out of Sicily.
Worst bug: the seat appears to command an army it may only petition for, and a letter from it can start a war its orders cannot fight.
The page read as the story of a strategos at a king's side: a good war, honestly told when it was told.

Three things most worth fixing first: (1) say what the seat commands (or let it command), (2) the "Stalled" and "nothing came of it" lines beside the Chronicle's "done", (3) letters addressed to the player's power (a truce request) reaching the tray.
