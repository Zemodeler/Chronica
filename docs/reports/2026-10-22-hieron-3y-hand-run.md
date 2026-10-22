# Three-year hand run as Hieron II of Syracuse: three goals, the bugs, the Chronicle

Date: 2026-10-22. Branch `chronicle-order-truth` (HEAD `7648f97`, working tree as found). Nothing under `packages/` or `apps/` was edited. All run files are in `eval-out/hieron-run/`; this report is the only file added to `docs/`.

## What was played

A different seat from the 16 Oct run (which was a Roman consul): **Hieron II, king of Syracuse**, from **1 March 270 BC to 17 March 267 BC** (1,112 game days), through the hand adapter (`scripts/consul-run.mts`, one burst per call; a copy, `consul-run2.mts`, also appends every new fact to `facts.jsonl`). 23 bursts. I wrote 12 order answers myself and answered, as the model, the replies of the Roman consul, the Mamertine spokesman and the Carthaginian suffete where my own letters were involved. Other cognition and the world-event seeds were stubbed or left alone (see "How far to trust this run").

Goals, decided before the first burst (`eval-out/hieron-run/goals.md`):

| # | Goal | Result |
|---|------|--------|
| G1 War | Take Messana and end the Mamertine war by treaty or submission | **Reached on 1 Jul 270 (day 122, siege of 74 days), the Mamertines gave themselves up on 28 Aug 270 (day 151). Lost again in Mar 268 (day ~380) by bug H1 below, and never recovered.** |
| G2 Fleet | 60+ warships, treasury never in arrears, coin not debased | **Reached on count**: 17 + 25 + 40 = 82 warships in April 268, treasury 5.6-6.4M, no arrears seen. But the Carthaginian fleet beat the squadrons repeatedly (at least five battles from Feb 269 to Mar 267; 69 ships remain at the end) and shut them in harbour. |
| G3 Diplomacy | Alliance with Rome, Carthage kept at peace | **Half.** Rome accepted the alliance on day 151 (my answer, as consul). Carthage made war on Syracuse about Feb 269, took 16 of 26 provinces, accepted peace for 800,000 in June 268, and was at war again four months later. Rome refused military aid and never fought Carthage. |

**End state (day 1112):** Syracuse holds 3 provinces (26 at the start of the war with Carthage). The capital's province has risen as "The Free People of Eastern Syracusia". The Mamertines (extinct since Aug 270) are back as a polity and at war with Syracuse. Messana and its province are held by Rome. Carthage holds 280 provinces. The king commands the royal army (2,436 men) and 69 ships in port, with 5.6M in the treasury.

Severity as in the earlier report: **High** corrupts state, hides what the player needs, or makes a goal unwinnable. **Medium** is a rule that misbehaves or contradicts itself. **Low** is noise, wording or tooling. Where I traced a bug into code the file is named.

## How far to trust this run

- **Cognition was stubbed** (`{"actors":[]}`) except where a letter from Hieron sat in front of another power; there I wrote the reply myself. So "Rome refused by silence" in burst 4 (Rome's reply to my first alliance letter) is **my stub**, not a bug. The Roman and Carthaginian refusals in burst 12 were my choices, following the engine's own printed counsel ("no, no men to spare"; "no, not beaten").
- **The long gap is mine.** I issued no order for 270 days (bursts 8-11, 28 Aug 270 to 22 Aug 269) while running longer bursts to see how the world moved. The collapse in G3 is partly that choice; what is a bug is that nothing told the player (B2 below).
- **Chronicle composer test uses only part of the input.** `compose-h.mts` passes facts, their significance, the world and the observer, but not `nameOf`, `describePerson`, storylines, campaign ids, `ownSide` or the order outcome. The raw ids shown as tags ("character-consul-21-1157", "sic-ecyan") are therefore **a harness limit**, not a game bug. The web path may select and tag differently.
- **Doubled "X writes: X writes:"** in dispatches may be partly my `AUTOLETTERS` harness (it fills letter bodies); I did not isolate it. The "Rome's government" greeting is hard-coded and is a game bug (H3).

## Timeline

| Date | What happened |
|------|---------------|
| Mar-Apr 270 | Declared war on Messana, army and squadron march; siege laid (the siege order is filed as a friction first, "march there first", then works). Embassy to Rome. |
| 29 Jun 270 | Breach in Messana. I stormed. Two contradictory same-day facts (B5). |
| 1 Jul 270 | Messana opens its gates (74 days). Mamertines ask a truce; I refuse and demand submission. |
| 28 Aug 270 | Mamertines give themselves up: "polity_ended", their army takes service under Syracuse. Rome accepts my alliance (I answered as the consul). |
| Aug 270 - Aug 269 | No orders from me. Nov 270: the 30-ship squadron is built. A 1,000-man Carthaginian garrison walks into Syracuse's home province in Aug 270 with nothing agreed. |
| ~Feb 269 | Carthage declares war ("Agrigentum garrison's attack at Eastern Syracusia"), raids 540,000, occupies 15 districts. Naval defeats Feb 269 (13 ships) and Aug 269 (10). |
| 22 Aug - 21 Oct 269 | My orders: peace offer to Carthage (refused), aid request to Rome (refused), 3,000 mercenaries (free, B6), 40 more ships, army relief of Syracuse (siege lifted after 30 days). |
| Nov 269 - Mar 268 | Siege of Agrigentum; Carthage's three armies and its fleet beat my army in a field battle (5,761 to 4,161). |
| ~20 Mar 268 | **Two risings "under Hieron II" against his own kingdom; his character's polity becomes `mamertines`** (H1). Messana lost. Rome declares war on the Mamertines "as its alliance bound it to". |
| 22 Mar - 21 Apr 268 | I choose "keep the lines" at the Agrigentum breach; the Punic army and the Panormus garrison beat my army and the siege is raised. |
| 20 Jun 268 | I offer 800,000 peace; Carthage accepts. A Roman ally sacks Messana (28,781 dead, 13.7M plunder). Rome makes peace with the Mamertines. |
| Jun 268 - Mar 267 | Carthage re-declares war (about day 995). Eleven provinces rise in one burst (nine for Carthage under Carthaginian-named leaders), the capital province rises. Syracuse 13 provinces to 3. |

## High

**H1. The player's own character is picked to lead a rising against his own kingdom, and his polity is overwritten.** (Same defect as the 16 Oct report's H1, still present.) `rise()` in `packages/sim/src/polity-end.ts` takes as leader "the first alive character with an active ambition whose `targetId` equals the power it rises for" (line 327) and then sets that character's `polityId` to the wanted polity (line 344). Hieron's ambition "Secure Syracuse against the Mamertines" has `kind: "peace"`, `targetId: "mamertines"`.
- Evidence: burst 16 (20 Mar 268): "North-eastern coast of the Sikeloi rose against Kingdom of Syracuse under Hieron II, and Mamertines of Messana stood again" and "North-eastern Peloris rose ... under Hieron II and went over to Mamertines". After it, `hieron-ii.polityId == "mamertines"`, `offices` is null, and two forces named "The rising of ..." under polity `mamertines` are commanded by him. Burst 19's prompt reads: `ACTING FOR: Hieron II, King of Syracuse, of Mamertines of Messana [mamertines]`, `Office: syracusan-king. Polity: mamertines`, with authority over the risings listed beside Syracuse's. Burst 22 repeats it: "Uplands of the Siculi rose against Kingdom of Syracuse under Hieron II and went over to Mamertines" and, in the same burst, "Coast of the Siculi rose against Carthage under Hieron II and went over to Kingdom of Syracuse" (the king leads risings for both sides).
- Effect: G1 (Messana and the Mamertine surrender) is undone by the game, 150 days after it was won, with nothing said to the player. Every later burst treats the player's polity as `mamertines` (`consul-run.mts` reads it from the character). A 16 Oct sighting had the Roman player as leader; this shows it hits any player whose ambition is aimed at the enemy.
- Fix: choose a leader whose ambition is a restoration of `wanted` or whose own polity is `wanted` or ended; never reassign `polityId` of a living officer of another power.

**H2. The risings epidemic (the 16 Oct H4) is now general, and unwinnable for a defender.** Burst 22 (Sep-Dec 268): eleven Syracusan provinces rose in one burst, nine "under" Carthaginian-named leaders (Hiempsal, Baalyaton, Bodashtart, Safot, Mago, Hamilcar, Arish, Abdeshmun, Milkpilles) and went over to Carthage; the capital province rose as "The Free People of Eastern Syracusia" with 3,000 men. The same shape appears in Macedon (Maedi "stood again", five provinces under Cotys, burst 23) and Media Atropatene (nine provinces to the Cadusii, burst 23), and in Italy (Bruttium, Campanians). Syracuse went from 26 provinces to 3. Facts per burst: 94, 260, 354, 98, 107, 401, 181, 219, 530. `province_unrest` ("Order is breaking down in ... and 5 more provinces", burst 20) is a fact only; the king is never offered a decision (grant, garrison, tax) before the rising.

**H3. Nothing tells the player that war has begun or that they are losing.** Carthage declared war in Feb 269 (burst 9, in a 260-fact burst), raided 540,000 and occupied 15 districts, beat my squadron twice and took the Aeolian Isles, all while the burst printed 25 facts led by a Campanian polity ending and Spartan wars. There is no decision, letter or warning for the king. A Carthaginian garrison entering the home province in Aug 270 raised nothing. The war reopened in burst 21 (about day 995, four months after peace) likewise. A turn of play that did not issue an order lost 16 provinces. (The 16 Oct report found the same shape for Messana's loss.)

**H4. Performance still degrades with the world's age.** 90-day bursts took 71 s, 98 s, 169 s, 222 s (bursts 8-11), 274 s, 223 s, 280 s (bursts 21-23), with 7-12 model calls each. The run was only 1,112 days; the earlier 1,826-day run reached 10-22 minutes. A "let the quarter pass" would be five minutes by year three and fact counts of 530 by burst 23.

## Medium

**M1. "Hire 3,000 mercenaries from the treasury" is free and adds no pay.** Burst 12: `force_reinforce` men 3,000: "done: Syracusan army at 5761 fit" at once. The treasury did not fall (5,438,943 to 5,549,814 over the month); the obligation `syracuse-army-pay` stays at its scenario value of 26,000 per 30 days (the scenario starts with 3,000 men; the army had 5,761). Free men is a hole in the economy and in the order verifier ("spend from the treasury" is not charged).

**M2. A pending siege decision silently freezes the game.** After bursts that stop on "Storm it, or keep the lines and wait?", a plain burst advances 2 days (burst 17, 20-22 Mar 268), then 0 days with 0 facts (burst 18). Only the last line of the output mentions the decision; the burst log says `stopped on player_decision`. In burst 6 the stale Messana decision did not block, so the rule is inconsistent.

**M3. Same-day contradictory siege facts, and the stale decision after a storm.** Burst 5 (29 Jun 270): "carried the breach, and the city lay open" and "went in at the breach and found nobody to hold it" on the same day, although a battle with the garrison (368 dead) was fought that day; the burst ends on the same "A breach has opened ... 72 days ... 1,118 men hold the city. Storm it?" decision, then "began raising rams and sheds before Messana". (Known M4 of the 16 Oct report.) Messana's siege is also held twice, once by the army and once by the squadron, with different week counts ("fourth week" and "sixth week" on one day).

**M4. A decision answer is audited as an order part.** Burst 19: "Refiled part 'Keep the lines and wait': it wrote no act of the order's, and its words are not the order's." The decision's order record then reads "Lay siege to Agrigentum -- under way (stalled): Failed" for the rest of the run. After "keep the lines" my army, not a besieger, was beaten and the siege "lifted" by the engine; the player never ordered a withdrawal.

**M5. "March and attack" in one answer fails again.** Burst 13: "armies cannot meet in battle until one of them has marched to the other", though the march worked and the siege was lifted. The same appears for Messana (burst 2, a siege laid in the answer is rejected with "march there first" and then laid anyway). (16 Oct M9.)

**M6. A part that moves one force and stands down others can fail while half works.** Burst 20: "Draw the army back on Syracuse and stand the two risings down" -- failed, yet the army did move; the stalled line stays in "under way" in every later burst (to burst 23). (16 Oct M15.)

**M7. Carthage entered Syracusan ground with no pact and no reaction.** A 1,000-man garrison from Agrigentum marched into Eastern Syracusia in Aug 270 and sat there; six months later it was the attack that opened the war. With the alliance in place Rome still did not enter that war, while it did enter the Mamertine one at once ("as its alliance with Kingdom of Syracuse bound it to") and later refused "to go to war for Rome against the Campanians" in return.

**M8. A fleet attacks in a land battle.** Burst 15: "Carthaginian field force and Carthaginian garrison of Agrigentum and Carthaginian fleet attacks Syracusan army at Southern coast of the Sicani" (my army lost 1,600 of 5,761). Ships held in harbour (`hold: true`) were attacked and "beaten" in Syracuse's harbour (burst 14), and afterwards sat at `sic-1j0kt`, a different province.

**M9. Plunder larger than the world's treasuries.** Burst 20: an Etruscan contingent of Rome took Messana: "28,781 of its people were put to the sword or sold, and 13,720,444 in plunder went to Etruscan cities". Rome's treasury is 6.1M; the Etruscan treasury is far smaller.

**M10. Leptines holds three jobs and steals in the first month.** The one man commands the squadron, besieges Messana and holds the shipbuilding project; `peculation` of 12,513 from the project fell in the first 30 days, before any milestone was due. A seeded "debt has come due" for him sits beside the prompt's own line "Life has been going well for Hieron II ... nobody wishes him harm" (see L1).

**M11. A peace can be broken within months with no new casus and no notice.** The peace of June 268 (Carthage 800,000 in eight payments, obligation `obligation-consul-19-304`) was gone by day 995; the fact list says "Carthage broke its peace with Kingdom of Syracuse" three times in one chronicle thread, and the player is not told in a letter.

**M12. Extinct powers come back as ordinary actors.** The Mamertines (polity ended 28 Aug 270) hold an Assembly, vote tribute ("22 to 21, 25 abstaining, Statius Mettius's motion") and are at war with Syracuse again (the war record is a second `war` agreement, `agreement-consul-15-1110`, while the first is `ended`). The Campanians likewise.

## Low

- **L1.** The seed preamble "Life has been going well ... nobody wishes him harm" / "The world has been quiet at home ... there is a war on" is printed above events that contradict it.
- **L2.** Refusals read "done: an answer came" (burst 12, both letters were refused). (16 Oct L2.)
- **L3.** `dispatches.ts:115`: the "cold" register is hard-coded "To the commander of Rome's government." and reaches a Syracusan king from his own strategos (bursts 8, 11, 14, 22, 23).
- **L4.** The squadron commander reports "perhaps 1,400 of theirs to our 40" (men against ships), repeatedly.
- **L5.** Dispatch doubled prefix "X writes: X writes:" (see trust notes).
- **L6.** The leftover "Mamertine garrison" stays a separate force under Syracuse after the Mamertines "took service", and was beaten by Carthage in Messana's province in burst 14 with no order; the pay line "The soldiery that holds Messana" (14,000 a month) continues from the treasury after Messana is lost.
- **L7.** Threads shown to the king include secret Roman and foreign matters: "Something laid against Gaius Genucius Clepsina" (brewing, with Postumius), "The health of Menecrates / Trebius Ninnius", Rhegium (burst 1 prompt).
- **L8.** Countries "with nobody in them" are asked every burst and hold 70-110 provinces each (Dacian highland communities 102, Turdetani 92, Boii 110, Cappadocia 82): Cappadocia, a kingdom, starts with no ruler.
- **L9.** The same war paragraph prints twice in Himilco's cognition prompt (burst 20).
- **L10.** `armies_facing` "Neither has been ordered to attack" is told for a besieger and its garrison, and for a standing blockade.
- **L11.** A truce letter "Kingdom of Syracuse asks for a truce" appears under "letter to answer" and "letter awaiting reply" for the player's own power (bursts 15, 22), written by no order of mine.
- **L12.** One order of several sentences is split into one orchestrate call per sentence (burst 12: three calls for four clauses); world seeds travel only with the first, and the answers are filed by newest mtime, so a harness answering by hand can file one under the wrong prompt.

## The Chronicle outputs

What comes out, and how it looks, from a hand-composed window of bursts 21-23 (20 Jun 268 to 17 Mar 267, one window of 930 facts; saved in `eval-out/hieron-run/chronicle-late.md` and `chronicle-result-late.json`):

- **Shape.** 10 calls, 10 passages, 0 overstated, **835 of 930 facts carried (not told)**. Each passage is a title, a body of one to five sentences, tags and a fact count (1-3 facts for most passages; one thread of about 70 facts).
- **Selection, by weight.** The thread with most facts mixed three years of war into one: a Roman grain-keeper's dole at Messana (three times), Etruscan, Bruttian and Apulian contingents crossing, Rome's peace with the Mamertines, the ten risings of Syracuse (nine to Carthage), "Carthage broke its peace" (three times) and Carthage refusing Syracuse's truce by silence. One passage was written from it ("The south falls away to Carthage, and Rome comes over the strait").
- **What the king reads is Carthaginian bookkeeping.** Four of the ten passages are about Carthage's council and its rising of south-eastern Sicania (a vote to let its feeding to a firm of Carthage; a refusal of bread; a rising's victory over a Mamertine garrison; the garrison of Panormus taking a camp). The capital rising ("Syracuse itself rises against the king") got its own passage; the loss of 23 provinces, repeated fleet defeats, the broken peace and the Carthaginian declaration got **no** passage of their own.
- **Noise passages.** "Parties in Syracuse fade" (three parties "no longer to be reckoned with"), "Aristomachus writes from the north-east" (three dispatches whose addressee is "Rome's government" and doubled sender prefix in the source facts), "Two Italian districts go over to the Bruttians" (a rising of the Campanian legion, which has no bearing on Syracuse).
- **Tags** show raw ids (a harness limit, see above); the entries carry `factIds`, `subjects`, `changes`, `quote` (null in all) and `storylineIds` (none here).
- **Window.** I composed three bursts at once (9 months), so the Chronicle there is one long window and the "recent titles" guard (no repeat headlines) had nothing earlier to read. In the game each burst is its own window.
- **Burst log output (what the player reads after each burst).** Order outcome lines, "under way" items, letters to answer, army lines (one per force the player commands, including risings after H1), then the top 25 facts. Observed problems: top facts are 40-60% other powers' elections, harvests and peculation audits; order lines never retire (M6, M4); the same war is told by army lines, `armies_facing` and `blockade` facts each month.

## What worked

- **A declared siege conquers.** War on Messana, siege by land and sea, breach at day 72, city yielded at 74; submission accepted by the Mamertine spokesman on the engine's counsel, with an army taking service. Peace by submission works for a beaten power (the 16 Oct H4 stays fixed).
- **Honest explained refusals.** Rome: "no men to spare", "no quarrel of ours" printed as counsel; Carthage: "not beaten" while it holds 17 provinces; the engine's counsel lines were consistent with the state.
- **Alliances bind in both directions.** Rome declared war on the Mamertines "as its alliance with Kingdom of Syracuse bound it to", and Syracuse is recorded as refusing a Roman war in return.
- **Relief and field outcomes read plausibly** (garrison "outnumbered three to one" withdraws; siege lifted "before the relief comes up"; storm and fleet storms: "13 of its ships were lost").
- **Treaty mechanics.** Indemnity clauses became an obligation (`Indemnity owed by Kingdom of Syracuse to Carthage`, 100,000 per 90 days).

## Files

- Goals: `eval-out/hieron-run/goals.md`. Raw notes in order: `notes.md`. Full burst log: `log.md`. Final save: `state.json` (day 1112); `facts.jsonl` holds every new fact from burst 20 on.
- Harness: `drive.mjs` (stubs, `COGWATCH`, `AUTOLETTERS`), `go.sh`, `loop.sh`, `build.mjs`/`lib.mjs`, `consul-run2.mts` (writes `facts.jsonl`), `compose-h.mts` (Chronicle test), answer files `a2.mjs` ... `a11.mjs` and `a6a-c.mjs`.
- To replay: delete `state.json`, `facts.jsonl` and `log.md`, run `bash eval-out/hieron-run/go.sh --span 30 --order "<order text>"` for the orders in `log.md`; hand answers on disk replay by prompt hash.

## Addendum: fixes made on 2026-10-22 and the second run

### Corrections to the report above (found while fixing)
- **H4 (performance) is mostly harness.** A CPU profile of one 90-day burst (burst 23 replayed with the fixed engine) shows 35 s of CPU in a run that took 4 minutes wall-clock: `drive.mjs` re-runs the whole burst from the start after each model call it has to answer, so a burst with 12 calls is run 12 times. The engine's own hot spots are small (elections 2.5 s, zod parsing 5 s, `isEligibleFor` 1.4 s, `stepsFromCapital` 1.4 s). No engine change was made for it.
- **M1 is half right.** A hired host does pay a bounty out of the treasury (51,750 for 3,000 men in a test). What was wrong is that the army's monthly pay did not grow with its men (26,000 before and after). Fixed as below.
- **L5 (doubled "X writes:") is a game bug**, not the harness: `withoutWrites` in `letter-voice.ts` only stripped names made of capitalised words, so "Leptines of Syracuse writes:" was never stripped.
- **L1 is by design**: "Life has been going well ... nobody wishes him harm" is `readPersonalTension`, the person's own comfort ("the country's comfort is not his"), not a statement about the country.
- **M3's double storm needs two storm acts the same day** (the player's answer at the breach and a `siege_lay` with `assault`); I gave both, as in the 16 Oct run. The guard below makes it harmless anyway.

### What was changed (all in `packages/sim/src`)
| Bug | Change |
|---|---|
| H1 player made a rising leader, polity overwritten | `polity-end.ts` `rise()`: a leader must stand for the wanted power (his own polity is it, or his polity has ended), and an aim of kind `peace` or `revenge` against it does not count. Test `a-rising-is-not-led-by-its-enemy.test.ts` (fails without the change). |
| H3 nothing tells the player war has begun or provinces are lost | `burst.ts`: a burst now stops (`salient_event`) once a day has passed when a fact of kind `war_declared`, `rising`, `city_taken`, `province_control_change`, `treaty_breached` or `civil_war` names the player's polity and was done to it (the acting power is named first), or when `province_unrest` names it. |
| M1 hired men draw no wages | `apply/apply-deltas.ts` `force_reinforce`: men levied to an army raise its pay obligation at the scenario rate (warships at the hull rate). Test `hired-men-draw-pay.test.ts`. |
| M3 contradictory same-day siege facts | `siege-decisions.ts` `assaultSiege`: one assault per siege per day (`storm@<day>` in `told`). |
| M3 stale "Storm it?" after the storm | `burst.ts`: a siege question the burst itself answered is dropped before the report ends; `quietTheOthers` clears the same city's other siege (army and squadron). |
| L3 "To the commander of Rome's government" | `dispatches.ts`: "To the head of the government." |
| L4 ships against men | `dispatches.ts`: an enemy is only counted against a force of its own kind (fleet to fleet, men to men). |
| L5 doubled "X writes:" | `letter-voice.ts` `withoutWrites` accepts "of/the/son/de/ben/bar" in names. Test `a-name-with-of-is-stripped-once.test.ts`. |

Not changed, and why: H2 (risings in just-absorbed ground) is game balance and needs a design choice, not a patch (see run 2); M2 (a pending siege decision stops plain bursts) is how decisions work, and with the stale one fixed it no longer loops; M4/M5/M6, M7-M12 and the remaining Lows are untouched.

Verification: the full `packages/sim` suite had 14 failures in two runs. Twelve were timeouts under load and pass alone (`a-general-marches-when-told`, `the-siege-of-messana`, `senate`, ...). The one real assertion, `a-turn-spends-few-calls` (`write_mechanic` called twice, limit one), **fails the same on the unchanged code**. The typecheck passes. ESLint reports the same 12 errors with and without my changes, none in lines I touched.

### Second run (`eval-out/hieron-run2/`), same character and goals, played to 28 Feb 267 BC (day 1095, 18 bursts)
Answers from run 1 replayed by prompt hash up to the Mamertine surrender, which came again on 28 Aug 270. Then I played differently: a pact of non-aggression and trade offered to Carthage (accepted by my answer as the suffete, against his printed counsel "no, does not trust him") and two thousand more mercenaries, instead of silence.

| | Run 1 | Run 2 |
|---|---|---|
| Carthage at war with Syracuse | declared ~Feb 269 | never; pact held to the end |
| Hieron's polity | `mamertines` from Mar 268 | `syracuse` throughout |
| Syracuse provinces at the end | 3 (of 26) | 20 |
| Treasury | 5.6M | 7.7M, no arrears |
| Warships | 69 | 47 (17 + 30; no second squadron ordered) |
| Rome alliance | yes | yes |
| Messana | lost Mar 268 (H1), then sacked | lost about day 1050 to a Mamertine rising (still the Peloris ground yearning for the extinct Mamertines) |
| Army pay obligation after hiring | 26,000 (unchanged) | 46,000 (grows with 2,000 hired men) |
| Siege report on the storm day | two contradictory facts, stale decision | one fact, no decision |
| Alarms | none (burst ran 90 days) | one: burst 14 stopped on `salient_event` at 5 Mar 268 on six simultaneous risings; but only after they had happened |
| Burst time (90 days, wall clock) | 71-280 s | 63-303 s (same harness re-run cost) |

What run 2 shows:
- **Fixed and visible:** the player is no longer turned into a rebel leader, the storm report is clean, hired men cost wages, the early-stop alarm fires on the first risings.
- **Not fixed (H2):** six provinces of the old Mamertine ground rose in one burst 14 months after the surrender and Messana went with them; the extinct Mamertines stood again. The alarm only reports it. Whether surrendered ground should yearn and rise that fast, and whether the player should get a warning (garrison or tax choices) in the months before, is a design decision for you.
- **Chronicle:** I did not compose a Chronicle for run 2; none of the fixes touch the composer, so the findings under "The Chronicle outputs" stand.

### H2 fix and third run
Root cause found: nothing in the engine ever raised `controlFirmnessBps` of ground taken (at most 3,000) or surrendered. `reviewPowers` grows a province's yearning for its old master by 400 a month while firmness is under 5,000 (plus 300 under low stability), and shrinks it only at 7,000 and over, which was unreachable, so every absorbed province rose about fourteen months after its surrender whatever its holder did.

Change (`polity-end.ts`): ground that still wants its old master now settles, +250 firmness a month while its stability is at least 4,000, +250 more with a force of the holder's own in the province (and stability at least 2,500), up to 7,500. Misery and unrest do not settle it, so a starved, disordered province still rises. Test `absorbed-ground-settles.test.ts` (the quiet-hold case fails without the change).

Third run (`eval-out/hieron-run3/`, same orders as run 2 through Oct 269, then plain bursts unattended): Messana is still Syracuse's at 28 Jul 268 with firmness 7,500 and no Mamertine rising, where runs 1 and 2 lost it. The world then diverged: Carthage declared war in Jan 268 "as 'Carthage to Kingdom of Syracuse: an ultimatum' had said it would if no answer came". The new alarm stopped burst 12 on it, but my loop did not answer the ultimatum, so Syracuse ended with 6 provinces; that is my inattention in an unattended loop, and the ultimatum sat in "letter to answer" for the burst before. Full-suite check: 8 failures, 7 timeouts that pass alone and the unchanged `a-turn-spends-few-calls` assertion.
