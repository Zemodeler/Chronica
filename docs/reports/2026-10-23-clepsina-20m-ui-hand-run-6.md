# Gaius Genucius Clepsina, consul of Rome: twenty months, a siege laid, stormed and won, model answered by hand (UI round 6)

Run: `eval-out/ui-run6` (goals, notes, answer scripts `ans/r1..r12.mjs`, `c1..c5.mjs`), hand directory `apps/web/eval-out/ui-run6/hand`, port 3301 (started with `BETTER_AUTH_URL=http://127.0.0.1:3301`), game `224160e8-bbfe-48d6-a3e0-d630285db0ba`, account `uirun6clepsina`.
Prompt: `docs/playtests/ui-hand-playtest-prompt-6.md`. Rules kept: nothing in `packages/`, `apps/`, `scripts/` edited while play went on (the fixes of section 11 were made after the server was stopped; one failing test file was written during play, nothing that runs).

## 1. Verdict

This round reached the bar: **614 days (1 March 270 to 5 November 269 BC) and 10 orders, 2 decision cards, a siege laid by order, a breach stormed, a town taken, a Senate vote of money carried and spent**. It exercised most of prompt 6's list, and it found things the earlier rounds could not reach:

1. **An ultimatum put to Rome was never shown to the player** and lapsed by silence ("You sent no answer, 26 April 270 BC"), although the burst stopped on the day it was sent. The engine stopped for a letter that was still on the road, and the Council lists letters only once delivered.
2. **A Roman senator was elected leader of the Campanians** after Decius Vibellius died, and then commanded the enemy legion, wrote for it to Rome, and quartered it for the winter. Root cause: an empty list of requirements on a seat was read as "no requirements".
3. **A card answered ("Storm the breach", "Offer battle") was told as an order that came to nothing**, in the engine's own words ("The ruler has answered: ..."), beside the battle it began.
4. Stale lines: a standing order "Waiting" for two months after the siege it waited on was laid; "Still waiting for the army never reached Rhegium coast"; a "face each other" line after the legion had broken.
5. The three ratios for one fight.

## 2. What was played

Clepsina, consul (declared as "Gaius Genucius Clepsina, the Roman consul…", id `gaius-genucius`; the declaration needed four relations with one of the family, my first answers were rejected, nothing charged). Army sheet at the start: "Roman field army, 17,720 men, at Latium on the Almo. Under Gaius Genucius Clepsina. Holding position."

| # | Order | What followed |
|---|---|---|
| 1 | March the army to Rhegium and lay siege; write to Hieron to keep the peace | march under way; the siege held "waiting until the army reaches Rhegium"; Hieron accepted and sent an ultimatum (strait, 20 days) |
| 2 | Put to the Senate 40,000 for pay and ships, and a prorogation | both opened ("waiting on a vote"); the money carried 42 to 13; the prorogation "could not make up its mind 15 to 23", later "rejected 15 to 23" |
| – | decision card, breach in the walls (24 May 270) | Storm the breach: carried, 1,229 Roman and 1,485 Campanian dead; Rhegium opened its gates after 46 days |
| 3 | Take Rhegium; pay the army from the 40,000 | "sent forty thousand of the Senate's vote to the army's chest" |
| 4 | Garrison Rhegium with 4,000; friendship to Mettius | accepted |
| 5 | Raise two legions in Campania | Legio III and IV |
| 6 | Treaty of friendship to Hieron | accepted (five years) |
| 7 | Letter to Dentatus (the charge of keeping the plunder is false) | he refused in the model's hand; the Senate then carried the prorogation 47 to 16 |
| 8 | March on the Campanian legion in the Sikel uplands, destroy it, raid | arrived; card ("eaten the bread it carried") |
| – | decision card (Offer battle / Hold out / Fall back) | the legion "outnumbered three to one" gave way and left its camp |
| 9 | Truce of three months to the legion; hear terms | told "It could not be done as written" beside "offered … a truce" |
| 10 | Report the victory to the Senate; ask a triumph | put to the Senate by the consul |

Hand-written: 12 orchestrate answers (r1 to r12), 5 cognition answers, about 150 compose answers (60 written, the rest empty: far-off news, ailments, repeats), 1 declaration. A background responder answered the last 12 cognition and compose prompts with empties after order 10.

## 3. Checklist of prompt 6, section 2

1. **A war by order, a siege by order, the army sheet during the siege, a Map tooltip against the card's odds** — *done, still wrong.* The sheet at 44 days of siege read "Holding position." The Map tooltip gave only a place name ("Peloris on the Asinius"). The card's odds: see bug 5.
2. **An alarm** — *not working.* Ultimatum of 19 March 270 (to Rome, 20 days): not in the tray thread and not in Matters in hand at any time before it lapsed; the tray shows it afterwards: "An ultimatum, 19 March 270 bc … You sent no answer, 26 April 270 BC." Hieron's protest of 22 February 269 (30 days, to the consul) reached the Chronicle only afterwards. The Campanian peace plea reached the consul "ignored".
3. **A truce within 30 days of ending** — *not done* (the truce I offered was never carried).
4. **A chamber vote of money, spent once, the mover among those "for"** — *done.* "Forty thousand drachmae for the army's pay and the hire of the Greek ships — passed 40 days ago; it began nothing, so doing what it allowed is an order of its own" (model prompt) and after order 3: "sent forty thousand drachmae of the Senate's vote to the army's chest". No second motion.
5. **A card answered, then a reload** — *done.* After the reload the Council said "Reading the record…" and no card returned.
6. **Pay across strongbox, order sheet and ledger** — *consistent this time.* Strongbox is the purse ("Going out −0, +300 a month, 84,260 (61,510 in silver)"), ledger "Army pay −136,131". The purse rose from 60,000 to 84,260 in 174 days with an income of 300 a month; the difference is not explained on any sheet.
7. **A secret plot told to me** — *not done.* The plots I seeded (Dentatus's charge was public; Genucia's was private) never reached Matters in hand; nothing private leaked.
8. **Two saves** — *not done.*

Prompt 6, section 3 (round 5's fixes): the self-waiting march: *not seen* ("March … and lay siege" held correctly on the army's arrival, which was not self-waiting); no fact for a refused act: *not exercised*; a part after a refused part: *not exercised*; standing orders listed once: *seen once twice over:* "Once Roman field army is at Uplands of the Sikeloi, raid …" and "…take the army … and destroy it" are two different orders, not duplicates.

Section 4 (still open), instances:

1. Order lines against the books: "Storm the breach — Needs your word — Nothing came of it." (battle won); "and lay siege to the town — Under way" (Rhegium open); "that my consulship be prorogued — Under way — Waiting on a vote." (the Senate had rejected 15 to 23); Matters in hand "Take the town of Rhegium — Stalled" (town taken); "and pay them from the treasury of Rome — Stalled" (told "pay is carried in the treasury's army pay once mustered"); "Take the army … and destroy it -- done: Roman field army at Uplands of the Sikeloi" (done for a part that asked the legion destroyed).
2. Strongbox omission: not seen in this seat.
3. A dropped act keeping its facts: fixed after round 5; not exercised.
4. "Needs your word" for a refused part: the card-answer orders showed "Needs your word — Nothing came of it".
5. Repeated headlines, stale lines: the "face each other" line twice after the legion fled; "Ugly stories about Gaius Genucius Clepsina" four times.
6. A truce request lapsing unseen: the Campanian plea "answered (ignored)" and Hieron's ultimatum.

## 4. First-time experience

- Sign-up on port 3301 showed "Account creation is temporarily unavailable" although the account had been created (the sign-up call refused the origin once `BETTER_AUTH_URL` named another port; the second attempt found the username taken). The cause is dev setup, the message is misleading: a taken username says "username taken" on the same form.
- Declaring a character: the validator wants at least four relations including one of the family; the page said "incomplete or gave dates that do not fit the world" for it.

## 5. New bugs

1. **A demand is counted the day it is sent, listed the day it arrives.** `deadlinesFor` had no delivery test; the Council's calendar lists a letter once `isDelivered`. The burst stopped on 19 March with nothing on the desk to answer; when the letter arrived the burst did not stop again. *Fixed after the run.*
2. **An election ignored the office's own requirements.** The campanian-leader seat carried `eligibilityRequirementIds: []`; `seats()[0]?.eligibilityRequirementIds ?? office.eligibilityRequirementIds` kept the empty list. Rome's seats carry explicit lists; every other power's seats were unrestricted. The Campanian assembly elected Manius Curius Dentatus ("Leader of the Campanians at Rhegium, of Roman Republic"); he then "quartered Campanian legion … for the winter", wrote "Campanian Legion asks to talk of peace" to Rome, and the engine answered him "(ignored)". *Fixed after the run (also in `officeRequirements` in `shared`).*
3. **A decision card's answer was told as a failed order.** "Gaius Genucius Clepsina ordered: 'The ruler has answered: Offer battle.' Nothing came of it that anyone could see." and the same for "Storm the breach", plus an entry in "Orders under way". *Fixed after the run.*
4. **A wait was worded as a failure.** "Still waiting for Roman field army never reached Rhegium coast (14 days) before 'and lay siege to the town' can go ahead." The same words as the failure of the order after ninety days. *Fixed after the run.*
5. **Three ratios for one fight.** The card: "You have nearly twice their strength"; the battle line: "outnumbered three to one"; the books: 17,094 against "between 2,200 and 2,800" (about seven to one). *Open.* Lead: `engagement-decisions.ts` and `field-perils.ts` word the odds from different counts.
6. **The army sheet says "Holding position" during a siege.** *Open (round 3, 4 and 6).*
7. **A standing order stays "Waiting" after what it waited on happened.** "Once Roman field army is at Rhegium coast, and lay siege to the town. Waiting" for forty-four days of the siege. *Open.* Lead: the stage is resumed on a later tick than the arrival.
8. **The commander hears of his own army as hearsay.** "It was said that Gaius Genucius Clepsina marched the army out of Rhegium…"; "news reaching the court; nobody here witnessed it" for the army's passage of the Pomptine marshes. *Open.*
9. **One prorogation, three outcomes.** First motion: "could not make up its mind 15 to 23, 61 abstaining", later "rejected 15 to 23"; second motion carried 47 to 16. The order line kept saying "Waiting on a vote". *Open.*
10. **A truce offer is told as "could not be done as written" beside "offered … a truce".** *Open (partly my answer: two parts sharing one act).*
11. **"Decided by now: …" and "Wants your word" for Senate votes** in Matters in hand: the vote is the Senate's; the word is nobody's. "Known issue" for "The Censorship: every post in it is vacant". *Open.*

## 6. Waiting

A season is 20 to 45 prompts, 90 percent far-off compose (Roman magistrates' elections, Etruscan, Samnite and Lucanian contingents marching every season, Macedonian and Bithynian armies). The same "contingent arrived" line is asked for four contingents in four prompts.

## 7. The Chronicle on the page

Read through the compose side. The engine's own line for Rhegium's fall and the storm was good ("The Roman field army carried the breach… and the city lay open"); the order lines beside it were the worst of it (bug 3).

## 8. As a player: what I could not tell

- Whether the ultimatum had been sent: I learned of it from "You sent no answer" a season later.
- Whether the siege was laid: the army sheet said "Holding position", the standing order "Waiting", the Matters "Under way".
- Whether the Campanians had a leader of their own: the Chronicle named a Roman senator.

## 9. What worked

- The Senate's money: carried, authorised, spent once, with the sum named.
- The breach card, its three options, and its consequence (1,229 men) were clear, and it did not return after a reload.
- "Reading the record…" on a reload.
- The private plots never leaked into Matters in hand.

## 10. How far to trust this run

Single seat, single seed. Several order answers sharing one act were my doing (bug 10); two cognition answers were mine, one with a wrong message id (answered again). The Campanian bug was found because the engine said it in the model prompt too ("Manius Curius Dentatus … campanian-leader, aged 61"), which I read as the model; the page itself showed it in the Chronicle.

## 11. Fixes made after this run (loop 4, "Fix")

All with a failing test first, and all in `packages/`:

1. `elections.ts`, `shared/characters/candidates.ts`: an empty requirement list on a seat asks the office (bug 2). Test `an-office-asks-its-own-eligibility.test.ts` (it failed with "expected 'rome' to be 'rhegium-campanians'").
2. `burst.ts`: a card's answer is not told as a failed order and not recorded as one when nothing was made of it (bug 3). Test `a-card-answered-is-not-nothing.test.ts`.
3. `deadlines.ts`: a demand is a deadline when it is delivered (bug 1). Test added to `deadlines.test.ts` ("is told the day it reaches the player's power").
4. `burst.ts`: the review of a wait says "to reach" (bug 4). Test added to `an-order-is-remembered.test.ts`.

Not fixed: 5 to 11.

## 12. Verdict in three lines

A won siege and a spent Senate vote worked; the page lied about the orders around them and hid a demand until it had lapsed, and a Roman was made the Campanian leader by an empty list.
Most worth fixing next: (1) one honest status per order, from the books, not the model's attempt; (2) one count for every odds line, and an army sheet that says "Besieging Rhegium"; (3) the commander's own news told as his own.
