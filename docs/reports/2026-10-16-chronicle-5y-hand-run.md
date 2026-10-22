# Five-year hand run: three goals, and the bugs it found

Date: 2026-10-16. Branch `chronicle-order-truth` (working tree with uncommitted changes). Nothing under `packages/` or `apps/` was edited; all run files are in `eval-out/chronicle-5y/` and this report is the only file added to `docs/`.

## What was played

I played Gaius Genucius Clepsina, consul of 270 BC, through the hand adapter (`scripts/consul-run.mts`, one burst per call), from **1 March 270 BC to 29 February 265 BC**: 1,826 game days, **49 bursts**, about 9,600 new facts and about 290 model calls. I answered every model call myself or with a stub (see "How far to trust this run").

The three goals were decided before the first burst (`eval-out/chronicle-5y/goals.md`):

| # | Goal | Result |
|---|------|--------|
| G1 War | Destroy the Campanian Legion, end that war by treaty, hold both shores of the strait (Rhegium and Messana) before Carthage can | **Reached, then lost, then regained.** Campanians gave themselves up on a signed offer (29 Jul 270). Rhegium fell 30 May 270, Messana in mid December 270. Messana was lost in Aug-Oct 268 when eight Sicilian provinces "rose against Rome under Hieron II" (bug H1). On the last day both settlements are Roman again. The Campanians were revived by a rising under Vibellius in Nov 269 and Rome was at war with them again at the end. |
| G2 Fleet | 100+ warships by early 265, no treasury strain | **Reached on ships, not on count.** The Senate refused the fleet 36-37 (Apr 270) and passed it 50-19 (Nov 270). 100 warships stood at Latium by about Aug 269. At the end Rome has 89 of them plus 17 captured Apulian hulls. Treasury 2.7M to 11.6M, no Roman arrears, the Roman coin never debased (`silverBps` 7300, `debasedSinceStep` null). |
| G3 Politics | A second consulship by the elections of 266; Syracuse allied | **Reached.** Alliance with Hieron signed 1 Mar 269 after one refusal by silence and one counter-offer. Senate waived the ten-year bar of the lex Genucia on 19 Feb 268 (43-11), a day after that year's election. Elected consul unopposed on 20 Feb 267, term 267-266. |

At the end of five years Rome holds 135 provinces, but it is at war with the Campanian Legion, the Mamertines, a revived Apulia and the Bruttians. The Lucanian ally owes 960,000 over 26 missed periods. The world ends in a state that no one would call settled (see H4).

Severity: **High** corrupts state, hides what the player needs, or makes a goal or a war unwinnable. **Medium** is a rule that misbehaves or contradicts itself. **Low** is noise, wording or tooling. Where I traced a bug into the code, the file is named.

## How far to trust this run

- **NPC cognition was stubbed.** About 95% of cognition calls were answered `{"actors":[]}` by a driver script, so other powers acted by engine rule only. I answered by hand only for letters addressed to Hieron, Hanno, Paquius Calavius and the Mamertine spokesman. "Refused by silence" in the first burst against Syracuse and the Mamertines was my stub, not a bug (I note where I had to correct myself).
- **Letters.** Subordinates' reports and some letters were answered by a script that copies the stated substance into the body (`autoletters.mjs`).
- **The world seeds and "countries with nobody in them" asks were answered for roughly the first 25 bursts, then mostly left alone.**
- **Two claims were retracted while writing.** The Senate waiver arriving a day after the election was my own 30-day deadline. The duplicate storm events need two storm commands in the same day, which my harness gave (both `--decide siege-storm` and a storm order). Both are marked below.
- The Chronicle composer test at the end uses only the last 300 facts, because `consul-run.mts` keeps `knownFacts.slice(-300)`. That is a harness limit, not a game rule.

## Timeline

| Date | What happened |
|------|---------------|
| Mar 270 | Field army to Rhegium. Seed war with the foedus ally Apulia opens on turn 1; other allies are levied for it. Senate refuses the fleet 36-37. |
| 30 Apr / 30 May 270 | Breach stormed; Rhegium opens its gates. |
| 29 Jul 270 | Campanian Legion accepts peace on submission and ends as a power. |
| 12 Oct 270 | Apulia accepts peace on the old foedus. Syracuse and the Mamertines leave alliance offers unanswered. |
| Oct-Nov 270 | Declared war on the Mamertines; the war is called an act "usurped". Fleet motion passes 50-19. |
| Dec 270 | Messana taken after a 32-day siege. |
| Jan-Mar 269 | Hieron counters my alliance offer with non-aggression, then declares war on the Mamertines himself and offers Rome an alliance (accepted 1 Mar 269). |
| Feb 269 | Himilco assassinated; Hanno makes himself master of Carthage. Senate refuses to prorogue; Fabius Pictor takes the army. |
| Apr 269 | Prosecuted for the war made without the Senate; fined nothing (vote 2-74). Triumph carried 70-3. |
| Aug-Oct 268 | Eight Sicilian provinces "rise against Rome under Hieron II" and go to the Mamertines, Messana included (H1). |
| Nov 269 - Jan 268 | Rhegium coast and Bruttium rise; Campanian Legion and Bruttians "stand again". |
| 20 Feb 267 | Elected consul a second time. |
| Mar-Dec 267 | Won a field battle at the Clanius against the Apulian levy; Apulia asks talks, then cannot sign (H5), then "gives itself up" on its own on 4 Dec 267. |
| Mar 266 - Feb 265 | Risings keep flipping provinces (H4); each 90-day burst takes 10-20 minutes (H6). |

## High

**H1. A rising is led by an enemy of the power it rises for, and the leader's polity is overwritten.** `rise()` in `packages/sim/src/polity-end.ts` (about line 321) takes as leader "the first alive character with an active ambition whose `targetId` equals the power it rises for". Hieron II had the ambition "Secure Syracuse against the Mamertines" (`targetId: mamertines`), so he led eight risings *for the Mamertines*. The same function then sets that character's `polityId` to the wanted polity: in the saved state `hieron-ii.polityId` is `"mamertines"` while he sits in Syracuse. An ambition against X is read as an ambition for X.
- Evidence: burst 30 (Aug-Oct 268): "Western Peloris ... North-eastern coast of the Sikeloi rose against Roman Republic under Hieron II and went over to Mamertines of Messana", eight lines. Messana changed hands. In bursts 46-49 "Hieron II lost The rising of Western Peloris" appears as a command.
- Effect: the player's ally is turned into a rebel leader, a G1 asset is lost, and nothing tells the player "Messana is gone" (it sat among 168 facts that month; I found it 14 bursts later).
- Fix: choose a leader whose ambition `kind` is "restore" and whose own `polityId` is the wanted polity or ended; never reassign `polityId` of a living officer of another power.

**H2. The player's own prosecution and triumph are hidden from the order prompt.** `slice.ts` builds BEFORE THE COUNCIL as the first `CAPS.procedures` (6) open procedures in array order (`council = ... .slice(0, CAPS.procedures)`), with no ranking. On 10 Apr 269 the six places were all routine elections (quaestor, tribune, aediles, praetor, military tribunes), so `prosecution:gaius-genucius:400` (vote in 30 days) and `triumph:gaius-genucius:400` were not shown. Only an id in RECENT HISTORY allowed me to answer. A player who does not know the id cannot defend himself.
- Fix: rank by "concerns the acting person" and by nearest deadline before capping.

**H3. Armies are never recalled when their war ends, and allies cannot be released.** All of these starve for months:
- Foedus contingents left in Apulia after the peace of 12 Oct 270: Etruscan levy 28-174 dead a month, Bruttians/Lucanians/Marsi 21-43 each. "Send the allied contingents home" is refused ("Nobody in Etruscan league levy could remember appointing Gaius Genucius Clepsina"). Their own assemblies vote down their bread (0-19, 1-12, 4-27). A Senate vote to feed them from the Roman chest fixed provisioning but "send them home" has no act.
- The Roman field army (about 16,000) sat in a Carthaginian province for five months after the Mamertine peace, starving (30 dead a month, camp sickness 163 dead).
- Hosts created for "countries with nobody in them" (Culchas, Ariarathes, Indortes, Rubobostes, Seuthes, Bolgios, Waldgar) march into neighbours' land and starve forever (up to 175 dead a month each; `force_starving` appears 226 times in the logged top lists).
- Fix: when a war ends, every force of its parties and their contingents should get a return march (project) as a rule; an ally released by its leader should obey.

**H4. Risings and absorptions loop, and risings flip provinces back and forth.**
- Within three months of a union or surrender the ground rises again: Rhegium coast under Vibellius (Campanian Legion "stood again", Nov 269), Bruttium (Bruttians "stood again" three times, deditio twice), Apulia (revived with "rising" legions).
- Inside one burst the same province rises in opposite directions: "Uplands of the Sontini rose against The Free People of Daunia ... went over to Lucanians" and "Uplands of the Sontini rose against Lucanians ... went over to The Free People of Daunia" (burst 47); Hills of the Oenotri twice.
- Result: Rome 113 provinces in Jan 268, 93 in Mar 268, 73 in Mar 267, 146 in Dec 267, 135 at the end; Apulia 21 to 47 to 89 to 0. Fact volume per burst grew from about 60 to 1,146.
- No unrest or grievance fact warns the player in advance. Related earlier report: consul-run M10.

**H5. A power with no head cannot sign anything, so its war cannot end by treaty.** My peace offer to Apulia (which had asked for talks six weeks before) was refused by rule: "An undertaking is somebody's word: Apulian cities has nobody at its head to give or take it". Its ruler Paquius Calavius shows "Office: none"; the Apulian elections stay open. A polity holding 69 provinces and about 18,000 men cannot make peace, only be beaten (it "gave itself up" three months later).
- Fix: when a polity's head office is vacant and no election can complete, the engine should seat a regent or allow the council to answer.

**H6. Performance falls off a cliff late in the run.** Bursts of 30 days took 15-25 s in the first two years. The 90-day bursts 46-49 (650-1,146 facts each) took 10-22 minutes each. State was 13.8 MB, 152 forces, 731 characters, 431 procedures, 164 letters. I did not isolate the cause; the likely ones are rising forces and their engagement pairs (each pair re-evaluated daily), the long list of foreign elections, and size of the world slice. A player's "let a quarter pass" would time out. `scripts/burst-timings.mts` should be run on `eval-out/chronicle-5y/state.json` (burst 45).

## Medium

**M1. A clause of an order that has no `intent.part` is dropped silently.** "The field army attacks ... Send an embassy to Hieron" produced one outcome line (burst 5). A part with no acts is re-asked as its own call (burst 2); a missing part is not noticed. The plan "every clause reported" (C02, R65) is not met.

**M2. The order verifier mistakes "Offer battle" for a letter.** Audit: "this asked for a letter or embassy, and what was written for it is force engage" (burst 16), shown to the player as "Check: ...". Keyword "offer".

**M3. "Hire a spy" and the system prompt disagree.** The prompt says a spy is `covert_plot_open` "espionage"; the verifier rejects that as "not the kind of act" and wants `service_contract_open` with a locally hired agent (burst 23). Even then a private man paying from his own purse is "done, beyond his authority ... without leave to".

**M4. Contradictory siege events and a stale decision after a storm.** Storming Rhegium and Messana gave both "carried the breach, and the city lay open" and "went in at the breach and found nobody to hold it" in one burst, and the burst ended on the same "Storm it or keep the lines and wait?" decision again. Cause: `stormSiege` (`siege-decisions.ts` 141-185) ran twice that day; the second pass finds an empty garrison. My harness gave both `--decide siege-storm` and a storm order. Needs an idempotence guard per siege and day. A stale decision also followed "Offer battle" (bread eaten) twice.

**M5. The triumph does not move the man.** "Gaius Genucius Clepsina entered the city in triumph, and laid down his command at the Capitol" (Apr 269), but `locationProvinceId` stayed `sic-q659z` (Messana) for 16 months and `house_found` refused ("lives too far from Latium"). `command-tenure.ts` 326-337 only adds prestige and ends the hold; `triumph_asked` (466-485) says he "waits outside the city" while he is in Sicily with the army.

**M6. Promises that the player cannot keep are recorded as broken.** My peace undertaking to Apulia, "Rome restores what her armies took", fell on ground taken by foedus allies' contingents. There is no act to hand it back, and Feb 269 shows "promise_broken: Gaius Genucius Clepsina broke his promise to Paquius Calavius". Related: consul-run M5.

**M7. Stale polity outlooks and pressures.** Thirteen months after Rhegium fell, Rome's aims still read "worried about Rhegium still held by the Campanian legion" and "means to recover Rhegium and make an example of its garrison". Decius Vibellius, after he joined Rome, still shows "Keep Rhegium and his men's necks", "Rome has not forgiven Rhegium" and the "old soldiers press him" pressure three times; the trading houses' pressure shows twice with different numbers.

**M8. Alliances between powers at war.** Carthage formed three leagues "against Mamertines ... a war on one is a war on all" with Rome, Syracuse and the Apulian cities, while Apulia was at war with Rome and Syracuse. Foedus allies send their own truce letters even though a foedus gives "no war or peace of their own".

**M9. Non-bordering march plus attack in one answer.** "armies cannot meet in battle until one of them has marched to the other" appears again (burst 41) when the march was in the same answer. A bordering march-and-fight (burst 40) worked. In burst 38 a deferred march and engage after "take command" never ran; the order waited 90 days for an arrival nothing caused (part of that was a wrong province id of mine).

**M10. "Countries with nobody in them" lists powers that have rulers, and the seed starts wars.** The same list (Apulian cities, Boii, Boeotian League, Mauretanian peoples, Lusitanian peoples) is asked every burst. Answered, it creates rulers and hosts: the Volcae host raided Massalia (700,000 taken, upkeep arrears 3.9M), the Carpetani, Semnones and Dacians fought wars no one asked for.

**M11. Allied states collapse unpaid while Rome stands by.** Lucanian upkeep arrears: 76,800 (7 periods) to 960,000 (26), loan defaulted, six "rose ... went over to Lucanians" and back. No decision reaches the leader.

**M12. The audit log is mostly NPC noise.** Every burst lists the same "already stand in alliance" (Seleucids with three Thracian powers, Rome with Messapians three times), "not at war ... no war to plan", and "armies cannot meet" rows, plus a raw id: "rome and polity-consul-32-353 already stand in alliance".

**M13. Peculation findings are uniform.** The Treasury of Saturn audits found the same sum against each quaestor (3,666 three times, 18,330 twice) and then put each on trial, the player's kinsman included.

**M14. Carthaginian ground is crossed and fought on with no reaction.** Pursuing the Mamertine garrison, the army fought a battle in the Carthaginian province of Panormus (Rome and Carthage had a trade pact) and nothing was said.

**M15. Orders that failed or were refused are listed "under way (stalled)" in every later burst** (adoption, land tax, trade venture: three bursts running; "The siege of Rhegium goes on" for the whole run). They are never retired.

## Low

- **L1.** An order the player did not give appears in the order list: `order: "March Roman field army to Coastal Sicelia." -- done` (engine-written approach march).
- **L2.** A "countered" answer is shown as "done: an answer came" (Hieron's non-aggression counter, burst 13).
- **L3.** Subordinates' reports are one template: "A great force is gathering ... perhaps 20 of theirs to our a handful"; "to my lord, on a small matter" for an enemy host.
- **L4.** Syracuse's rule-written warning to the Mamertines says "leave them be ... the appeal of the Roman Republic against the Mamertines has hurt us", the opposite of Hieron's aim.
- **L5.** Dead men stay in the office list (Himilco in Carthage's suffetes). Hanno, "master of Carthage", shows "Office: none".
- **L6.** `public_benefaction` shows "done (none spent yet)" in the burst the purse fell by 30,000.
- **L7.** Rome's legitimacy sits at 4,999 with the cause "did without leave what the Senate decides" from 225 BC; I did not check whether it decays.
- **L8.** The waiver motion cannot pass before the election it is meant for and the waiver ends one day after the next election; nothing warns the player.
- **L9.** Two forces share a name ("The rising of Rhegium coast" twice; "The rising of Syracusia on the Kakyparis attacks The rising of Syracusia on the Kakyparis").
- **L10.** The same `force_starving` fact twice in a burst, and six `armies_facing` facts a month for one standoff.

## What worked

- **Peace by submission now works.** The old report's H4 ("a beaten power never ends") is fixed for the cases I tried: Campanians (29 Jul 270), Apulia on its own (4 Dec 267), Bruttians twice.
- **Explained refusals.** Trade venture ("57% down, 8044 owed ... say 'on credit'"), adoption ("is of the gens already"), land tax ("a private citizen cannot set the land tax"), house founding ("lives too far from Latium").
- **Consequence chains.** An unauthorised declaration of war led to `act_usurped`, then a prosecution when office ended, then command handed to the successor with the player as legate. A hired spy was caught inside the same month and named his sender.
- **Politics.** Senate motions that the consuls take the army against Apulia passed 50-31 and the NPC consuls moved the army and the fleet. The waiver, the pontiff election and the consular election all ran through the real procedures, and the "election_open_to_you" notice fired.
- **Legate orders** are obeyed. "Return to Rome" carried the player in under 60 days.
- **Field battles** are plausible (1,911 v 2,755 near Naples, 575 v 630 at Messana).

## The Chronicle at the end

I composed the last three weeks through the hand adapter (`compose-last.mts`). Ten threads, every one a movement or a fight between two "rising" bands: "The rising of Uplands of the Siculi marches on ...", "stand facing each other. Neither has been ordered to attack", and the same battle once per round. Nothing about Messana, the treasury, Hieron, the Senate or the player. With 1,146 facts per quarter the Chronicle's significance filter does not suppress this noise. (The test used only the last 300 facts; the web path may rank differently.)

## Files

- Goals: `eval-out/chronicle-5y/goals.md`. Raw bug notes in the order found: `notes.md`.
- Run log of all 49 bursts: `log.md`. Final save: `state.json` (day 1826); previous burst: `state.prev.json`. Every prompt and answer: `simulate_*`, `voice_letters-*`, `chronicle/`.
- Harness: `drive.mjs` (one burst; stubs for cognition, mechanic, reconcile, repair; `COGWATCH`, `AUTOLETTERS`), `go.sh`, `view.mjs` and `cogview.mjs` (compact prompt viewers), `build.mjs`/`lib.mjs` (answer builders, `STEM=` to pick a prompt), `st.mjs` (state summary), `stats.mjs` (per-burst facts and calls), `compose-last.mts` (Chronicle test).
- To replay: delete `state.json`, run `node eval-out/chronicle-5y/drive.mjs -- --dir eval-out/chronicle-5y --reset --order "March the Roman field army to Rhegium and lay siege to it" --span 30`; the answers on disk replay by prompt hash.

## Addendum: continuation to 28 June 265 BC (bursts 50-52)

The five years ended with G1 not fully settled: the Campanian Legion had been revived by a rising and was at war with Rome again. I continued for three more bursts (4 months) to finish it.

- **Burst 50 (1 Mar - 14 Apr 265).** I moved the Senate that the consuls march on the revived Campanians and offer them peace on submission. Carried 39-26. The Campanians asked a truce in the same month.
- **Burst 51 (to 29 May).** Neither consul acted: Fulvius Flaccus stayed with the field army in Samnium, Appius Claudius Caudex at Messana, the truce letter lapsed, and the 1,400 Campanians were untouched. The same kind of motion in 268 (against Apulia) was obeyed at once. Logged as M16.
- **Burst 52 (to 28 Jun).** I asked the Senate for the field-army command as proconsul. My own support delta failed ("refers to `local:proconsul_motion`, which nothing in this batch created") and the repair was refused; the order reads "taken up, nothing done yet". The Campanians (about 1,300) moved to Rhegium coast beside Rhegium, which is still Roman along with Messana (control firmness 3,000, "held loosely").
- **Result.** Both shores are Roman at day 1946, the original Campanian war stays ended by treaty (29 Jul 270), and the revived war is unresolved. I stopped there: the player (a pontiff and senator) has no lever the NPC consuls obey, which is a finding in itself.

New findings:
- **M16 (Medium).** A carried Senate order to the consuls is executed in one case and ignored in the next, with no fact saying why.
- **H1 again, with the player.** "Uplands of the Sikeloi rose against Campanian Legion under Gaius Genucius Clepsina and went over to Roman Republic" (burst 50). `rise()` picked the player as a rising leader because his active ambition targets Rome; `rise()` also sets the leader's `locationProvinceId`, and the player's recorded location changed (from Samnium to the Eastern coast of the Iapyges) in that burst. I did not isolate whether the move is solely due to `rise()`.
- **Low.** A `command_assignment` motion opened with a same-batch `local:` reference is dropped by the repair step with no correction offered.
