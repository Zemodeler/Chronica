# Three-year hand run as Hannibal Gisco of Carthage: three goals, the bugs, the Chronicle

Date: 2026-10-22. Branch `chronicle-order-truth` (HEAD `446885b`, working tree as found). Nothing under `packages/` or `apps/` was edited. Run files are in `eval-out/carthage-run/` (a copy of `eval-out/player-run/`; `player-run` replaced in `go.sh`, `loop.sh`, `drive.mjs`, `compose-player.mts`; the default seat set to `hannibal-gisco`; the `COGWATCH` letter test in `drive.mjs` changed from "by Hieron II" to "by Hannibal Gisco"). This report is the only file added to `docs/`.

## What was played

A seat that is neither Hieron II nor the Roman consul: **Hannibal Gisco** (`hannibal-gisco`, polity `carthage`), 39, "a man of consequence" (standing 6,000), of the Gisgonids, with no office. He commands one thing, the **Carthaginian fleet** (110 ships of 120 on the books), holds a purse of 28,810 and the fleet's war chest of 35,000. He may command the fleet, propose in civil and social matters and spend his purse; nothing else is his ("Nothing beyond this is theirs to command").

Played **1 March 270 BC to 30 March 267 BC (1,125 game days), 26 bursts** through the hand adapter (`consul-run2.mts` via `go.sh`). Spans: 30 days when something was happening, 60 or 90 when it was quiet, 5 and 20 when I wanted an order to land. No unattended loop longer than one burst; I ran each burst by hand. **No burst stopped on `salient_event`, and no `DEADLINE` line was ever printed**: all 26 stopped on `max_span`. So the new alarms were never exercised by this run (nothing happened to Carthage that they cover).

Orders given (bursts in brackets; "mine" marks my failures):

| Burst | Order | Outcome |
|---|---|---|
| 2 | Sail the fleet to the strait of Messana and hold it | Done (fleet there 30 Apr 270). No `order:` line was printed (see M2). |
| 3 | Answer the Campanian Legion: no men, we keep the peace with Rome | **Mine**: two enum errors in my answer (`"refuse"`, stance `"refuse"`); the engine told me ("dropped to keep the answer") and filed "nothing came of it". Redone in 4: "done, beyond his authority: an answer came". |
| 7 | Write to Statius Mettius offering Carthage's friendship and the fleet's shelter | Accepted by the Mamertines (my answer as Mettius, against printed counsel), ratified by the Council of Elders 78 to 1 (burst 8). |
| 9 | Ask Hasdrubal (Punic army in Sicily) to march to Messana and garrison it | "nothing came of it" for the rest of the run (M4). |
| 14 | Write to Hieron offering non-aggression and trade | **Mine**: the burst was run without `--order`, so the letter never existed (my cognition answer for Hieron was thrown away). Re-sent in 15: accepted, ratified 78 to 4 (day ~565). |
| 17 | Bring the fleet into the harbour of Messana and keep it there | "already so when ordered" |
| 19 | Have five new warships built, paid from the fleet's chest and my purse | Project (70,000 in three milestones); a separate raw force of five ships appears in burst 21. |
| 24 | Land 800 of the fleet's marines at Messana | **The fleet is turned into a "garrison" of 110 warships and ceases to exist** (H1). Mine in part. |
| 25 | Call the warships at Messana the Carthaginian fleet again | Repaired by rename; cohesion shows "raw" instead of "steady". |

## Goals

Written to `eval-out/carthage-run/goals.md` before the first burst. **Goal 2 was set before I had seen the fleet's size**, so its numeric bar is trivial (110 ships on day 0, my fault; I did not move it afterwards).

| # | Goal | Result |
|---|------|--------|
| G1 Military | Keep every Carthaginian province in Sicily, no lost field battle or city, and stand at Messana before Rome does | **Met on holdings, partly on Messana.** Carthage held 261 provinces at day 535 and at day 1,125 (32 of them Sicilian); no battle, no siege, no war involving Carthage at all. The fleet lay in Messana's province from 30 Apr 270 and Rome never took the city. But the garrison I wanted there never came: Hasdrubal did not march, and my marines order destroyed the fleet's organisation (H1). Rome keeps a consul's army in the "Uplands of the Sikeloi", Sicilian ground, the whole run. |
| G2 Economic / fleet | 60+ warships, treasury never in arrears, no debasement | **Met on the numbers**: 110 + 5 = 115 warships at the end; no arrears or debasement fact for Carthage in `facts.jsonl`; `carthage-treasury` 53.6M at day 1,000 and 56.8M at day 1,125. The fleet's own war chest vanished with the force in burst 24 (not found among accounts afterwards). |
| G3 Diplomacy | No Roman war on Carthage by day 1,100; bind Syracuse by a pact | **Met.** No war with Rome (the Rome-Carthage trade pact of 279 stands). The Syracuse pact (non-aggression and trade) was accepted and ratified in Sept 269. I also made an alliance with the Mamertines that I did not plan as a goal (the fleet was the thing I could offer). The engine nevertheless records all three treaty undertakings as **broken** (H2). |

**End state (day 1,125):** Carthage at peace with everybody, 261 provinces, treasury 56.8M; Syracuse 17 provinces and an alliance with Massalia "against Carthage" (burst 13), a 3,000-man army and 35 ships; the Mamertines (9 provinces, 1,400 men, allied to Carthage); Rome 73 provinces, 11.2M, its army still on Sicilian ground. My purse 4,970.

## Timeline

| Date | What the player saw |
|------|---------------------|
| 1-31 Mar 270 | 82 facts (illnesses, a Roman birth, Himilco names Hannibal the Barcid admiral), army line "Carthaginian fleet at sic-4z01i". |
| 30 Apr 270 | Fleet arrives at Messana "without leave from Mamertines, whose land it is". A letter to answer: the Campanian Legion asks Carthage for help, due 10 July. |
| 4 Jun 270 | My refusal goes out "over the government's name" ("authority_breach"); letter answered in the words of Himilco. |
| Aug-Oct 270 | Rhegium falls to Rome after 40 days; the Campanian Legion gives itself up (2 Oct). Nothing of this concerns the fleet. |
| 2 Oct-1 Nov 270 | My letter to Mettius; he accepts (3 Nov). The Council of Elders ratifies 78 to 1 (1 Dec). |
| 1 Dec 270-20 Jan 269 | I ask Hasdrubal to garrison Messana; nothing comes of it. |
| 20 Mar 269 | 296 facts: an attempt to poison Himilco traced to Hanno of Carthage (the commander in Sicily); "Ugly stories about Hannibal Gisco are going round"; Rome's consuls chosen, Valerius Messalla to "the army in Uplands of the Sikeloi". |
| 18 Jul 269 | "Kingdom of Syracuse and Massalia made an alliance against Carthage". No letter, no deadline. |
| 16 Sep 269 | Syracuse's pact with Carthage accepted and ratified. |
| 15 Nov 269 | `promise_overdue`: Himilco has not yet kept his promise to Mettius (the fleet will shelter Messana); 15 Dec: `promise_broken`, with the fleet in the harbour. |
| 13 Feb-14 May 268 | Five-warship project ordered, set going "without leave to spend" the chest; the ships arrive as a separate "raw" force by 13 Jul. |
| 11 Oct 268 | `promise_broken` twice: Himilco to Hieron, Hieron to Himilco, "Carthage will not make war on Syracuse"; no war exists. |
| 10 Dec 268 | Marines order: "110 men of Carthaginian fleet became Carthaginian marines of Messana, and Carthaginian fleet is no more." |
| 9 Jan 267 | Fleet renamed back; "raw". |
| 30 Mar 267 | End: 283 facts in the last burst, the top 25 are elections and a death. |

## High

**H1. A "garrison" order can turn the whole fleet into the garrison and remove it from the record.** My answer for burst 24 was a `force_create` from the fleet with `authorizedStrength` 800 and `categoryId` "infantry". The fleet had 110 ships and no marines. Instead of refusing, the engine moved all 110 warships into the new force and dissolved the fleet.
- Evidence (burst 24): `[45] force_reformed: 110 men of Carthaginian fleet became Carthaginian marines of Messana, and Carthaginian fleet is no more.` and `[40] garrison_set: Carthaginian marines of Messana stands as the garrison of North-eastern coast of the Sikeloi, 110 men under orders to hold it.` The state afterwards: force `force-consul-23-2` "Carthaginian marines of Messana", `personnel: [["warship",110]]`, authorized 110. No marine was created. No `order:` line was printed for the order at all.
- Effects, all visible to the player only by reading the army line: the original force id `carthaginian-fleet` is gone, so the first order's record turns to **"failed"** afterwards (the Chronicle prompts of bursts 25 and 26 say: "'Sail the fleet to the strait of Messana and hold it' -- failed"); the fleet's morale state falls from "steady" to "raw"; the fleet's war chest account no longer exists.
- Whose fault: the delta was mine and badly shaped (asking for 800 men from a 110-ship fleet, category mismatch). The engine's part is that it accepted a request it could not meet by silently taking everything there was, relabelled ships as "men", and said so only in a 45-significance fact. It should refuse, or take a bounded amount of the right category.
- File: not traced; the `force_create` with `fromForceRef` path in `packages/sim/src/apply/apply-deltas.ts` (the fact text is `force_reformed`).

**H2. Every treaty undertaking is hard-coded as a thing to "do", is owed by the head of government, and is marked broken at its review date.** Three treaty promises were recorded as broken in a run with no war and a fleet sitting in the allied city.
- Evidence: `[30] promise_overdue: Himilco son of Gisgo has not yet kept his promise to Statius Mettius: Under the treaty: The Carthaginian fleet will shelter Messana against any who would take it` (16 Nov 269); `[55] promise_broken: Himilco son of Gisgo broke his promise to Statius Mettius` (15 Dec 269, the fleet in the harbour, order "already so when ordered"); `promise_broken` twice on 11 Oct 268 (`Himilco ... Carthage will not make war on Syracuse` and `Hieron II ... Syracuse will not make war on Carthage`) with `WARS:` empty. State afterwards: the three commitments have status `broken`, and each broken promise gives the beneficiary a `betrayed` memory and trust -20, reputation -8 against the promisor (`promises.ts` lines 289-290).
- Cause, traced: `packages/sim/src/apply/apply-deltas.ts:7356` writes `form: "do" as const` for every treaty clause, so `promiseFormOf` (`packages/shared/src/characters/commitments.ts:401`), which would class "will not make war" as `refrain` and keep it by holding back (`promises.ts` lines 244-260), is never consulted. And the promisor is `rulerOf(world, by, government)` (line 7335), Himilco, while the thing promised is done by the player's fleet, whose commander is Hannibal Gisco; `keptOnTheRecord` (`promises.ts:106`) only looks at forces commanded by the promisor, so the sheltering fleet cannot keep it.
- No war followed within the run, but the grievance exists in the world and is the stuff a later war cause is built from.

**H3. The burst report tells the player nothing about their own reign when the world is busy.** Burst 19: 299 new facts; the printed top 25 were **24 elections, a death, an illness and a peculation audit of other powers**; the one own item (the order line) came from a different list. Burst 26: 283 facts, top 25 = death, an alliance of Sparta and the Achaeans, elections. Own-side news (a treaty ratified, a promise broken, ships launched) came out only when I read the 40-fact bursts. By significance weighting the player's treaty (65) sits below other powers' lustrum counts (45) only because the others fill 25 slots with the same number. I filtered 17 kinds of noise out of the printed list myself in `g.sh` (illness, magistrate, harvest_failed, office_filled, group_formed, force_short, force_resupplied, royal_audit, peculation, election_held, motion_*, birth, lustrum, project_completed, project_milestone); that hid my own ships' `project_completed` fact, which is my doing, but even unfiltered the top 25 is not about the player.

## Medium

**M1. A stale or flipped order record.** After H1 the first order reads "failed" in the Chronicle's order lines for two bursts, though the fleet had done it. In burst 2 and burst 25 an order produced facts but no `order:` / `under way:` line; in burst 24 none either. The player cannot tell whether such an order is done, failed or lost.

**M2. Orders sometimes print no outcome.** Bursts 2, 24 and 25 printed no `order:` line. In burst 2 the fleet-movement order printed only the fact "Hannibal Gisco took the Carthaginian fleet ..." and a project-complete fact two lines down.

**M3. The player is told a refusal was "done, beyond his authority" and nothing more.** Four `authority_breach` facts (days 90, 215, 535, 715) and four orders annotated "beyond his authority", with no cost visible: the refusal to the Campanians went out "in the words of Himilco" and the letters to Mettius and Hieron were ratified by the Council. A new player cannot tell whether going over the government's name has a price. The wording "Hannibal Gisco set 'Five new warships ...' going on the pay chest of the Carthaginian fleet without leave to spend it" (burst 19, repeated in every later "under way" line) reads as an audit finding but the ships were built anyway.

**M4. A request to a general leaves no trace of the answer, and the general cannot be named.** "Ask Hasdrubal ... to march it to Messana": "nothing came of it" in the burst (9) and the stalled lines persist to the end (`under way (stalled)` printed in bursts 9-14 twice, once as my order and once as an auto-made "pursuit": "Ask the Punic army in Sicily to march to Messana. -- An intention only: nothing is being done about it"). The player is not told whether Hasdrubal refused, never saw it, or took it as a favour not owed. His character id is not printed in the order prompt either; I had to address the force (`recipientRef: force`).

**M5. A counsel line contradicts the prompt it sits in.** Mettius' prompt (burst 7) prints "They want: Hold Messana", "worried about no ally of their own: high", "it means to seek a protector before Syracuse closes on the city" and, under the letter, "What your interests and nature say: **no (no quarrel of ours)**". I followed my own judgement against it, with a reason. Hieron's prompt for the pact (bursts 14-15) printed **no counsel line at all** under "Letters awaiting their answer", so I decided from his stated nature.

**M6. A fleet's arrival is trespass, with no consequence told.** Burst 2: "Carthaginian fleet, an army of Carthage, entered North-eastern coast of the Sikeloi without leave from Mamertines of Messana, whose land it is." That is the fact for a 110-ship fleet anchoring in an unallied harbour. Nothing followed and a month later Mettius asked it to stay.

**M7. Fact and order outcome disagree.** Burst 17: `order: ... already so when ordered` and, in the same burst, `[60] movement: Hannibal Gisco brought the Carthaginian fleet into the harbour of Messana`, and `[55] promise_broken ... will shelter Messana` (H2).

**M8. Rome's army stays on Sicilian ground and the player is never told why or what it does.** Every year the Senate "settled the provinces ... to the army in Uplands of the Sikeloi", with 800-1,000 men "laid up" by sickness each summer, and "Rome's Allied contingents ... short rations ... in the depth of winter", but the player sees no army line for anyone but themselves and no warning that the force sits within a march of the allied city. This is part of the world, not a defect, but it is the kind of thing a player needs to know.

## Low

- **L1.** "Ugly stories about Hannibal Gisco are going round, and people are repeating them" (20 Mar 269 and again 13 Feb-15 Mar 268, same words) and a poison plot "traced to Hanno of Carthage" (the commander in Sicily) concern the player or his state; the player gets no cause, no option, no one to answer.
- **L2.** Himilco names "Hannibal the Barcid Admiral of the fleet of Carthage" in March 270 while the player, Hannibal Gisco, commands the only fleet; the burst never explains the second admiral.
- **L3.** The same fact is printed twice in a burst (e.g. four contingents "on short rations" listed twice in a thread, four duplicate "government: The Marshals has been organised" lines in burst 11).
- **L4.** `compose-player.mts` period lines always start at 1 Mar 270 and end at today's date (the composer takes the earliest carried fact); every passage window is "1 March 270 BC - <today>".
- **L5.** A promise is told as "has not yet kept ... will not make war" (burst 22 passage) though no war is on the record.
- **L6.** Fleet cohesion drops to "raw" after a rename/reform (H1).

## The Chronicle outputs

Composed with `compose-player.mts` straight after bursts **1, 2, 5, 8, 11, 15, 19, 22, 25 (partly: one prompt unanswered when I moved on) and 26**; not composed for 3, 4, 6, 7, 9, 10, 12, 13, 14, 16, 17, 18, 20, 21, 23, 24 (the harness hashes the prompt by the date of the world's current state, so a Chronicle must be composed before the next burst; I lost bursts 16-17 and 25's last passage to that, which is my harness error, and `carry.mjs` copies answers across prompts that differ only in the "Period:" line). The answers were hand-written by me, one per thread, only from the "Known to have happened" lines.

| Burst | Facts printed (all new) | Passages | Facts in them (told) | Facts carried (reported by composer, cumulative) |
|---|---|---|---|---|
| 1 | 82 | 4 | 9 | 65 |
| 2 | 49 | 4 | 12 | 88 |
| 5 | 95 | 6 | 25 | 139 |
| 8 | 33 | 4 | 11 | 410 |
| 11 | 296 | 6 | 18 | 403 |
| 15 | 40 | 7 | 18 | 415 |
| 19 | 299 | 6 (one empty by guard, one "[]") | 10 | 702 |
| 22 | 54 | 6 | 16 | 710 |
| 26 | 283 | 6 | 21 | 961 |

So the Chronicle tells about **5-25 facts a burst, and the carried pile grows to 961** (the composer's own count, includes earlier windows' untold facts). Passages were short, one to five sentences, titles in the "who did what" form, no raw ids (names, offices and places are named: "Hannibal Gisco", "the north-eastern coast of the Sikeloi"), and a "Where this part of the order stands" line was present for own orders and was repeated faithfully.

Three passages as they came out (hand-written from the thread facts):

> **Hannibal Gisco Takes the Fleet to the Strait of Messana.** "Hannibal Gisco took the Carthaginian fleet from the coast of the Elymi to the strait of Messana, there to hold it, and by the end of the month it lay in the waters of the north-eastern coast of the Sikeloi. It had come without leave from the Mamertines, whose land that shore was. ... The order to sail and hold the strait stood done." (burst 2)

> **Mamertines Accept the Friendship of Carthage and the Shelter of Its Fleet.** "Statius Mettius, leader of the Mamertines, answered Hannibal Gisco's letter by accepting the friendship of Carthage and the shelter of her fleet, and asked that it stay in the strait while Syracuse stood at the border. He named no price yet, and called the gods to witness. Hannibal Gisco could not bind Carthage to it of himself: the Council of Elders had first to ratify it, and when it did the terms bound Carthage." (burst 8)

> **The Bruttian Contingent Changes Commander Twice in the Uplands of the Sikeloi.** "... Magius took the Bruttian contingent in the uplands of the Sikeloi from Ninnius, who went home. When the Senate of Rome settled the provinces of the year and gave Marius Ninnius the army in the uplands, the command passed back ..." (burst 26)

**Does it say what mattered to this player?** In part. The treaty with Mettius, the pact with Syracuse, the fleet's sailing and the five ships each got their own passage, and the order status was carried into the passage correctly. What was **missing**: the player's own reign has few events, so the passages around them are other powers' bookkeeping. In burst 5 six threads named: Syracusan appointments, the Campanian siege, a Roman plot, a Macedonian war, a daughter's birth (own). In burst 19 (299 facts) five of six threads were Etruscan, Samnite, Lucanian and Umbrian elections and Messana's harbour contract; in burst 26 the Roman consuls, a Bruttian command flip-flop, a Seleucid audit. The Syracuse-Massalia alliance "against Carthage" (burst 13, significance 60) and the promise breaches (H2) were carried but never told (the burst-13 window was not composed; the breaches were told twice, as "Held to Have Broken the Pact Not to Make War", but that is the bug's output, not news). **Repeats**: the "short rations" facts, "ugly stories", "Seleucid peace with Pergamon" and "promise broken" each came out in more than one window (L3, burst 22 vs 25 vs 26); the guard list printed at the head of each prompt did prevent most headline repeats, and I left three passages empty (`entries: []`) where the guard said nothing had changed. **Told that the player could not know**: no; the news from far off arrives as "Word came ..." in its own thread. **Raw language**: "set ... going on the pay chest ... without leave to spend it" was told verbatim from the order outcome line (M3). **Facts carried that should have been told**: the Syracuse alliance with Massalia against Carthage; the poison plot against Himilco by the Carthaginian commander in Sicily; the Mamertine treaty's "promise overdue" (told only partly).

## As a player

- **I could not see what I commanded or what stood near me.** The army line names my fleet and its quality ("steady", "raw") and nothing of numbers; I learned "110 ships of 120 on the books" only from the order prompt (the harness prompt, which a web player may not see), the strength of my allies and of Rome near Messana never. I saw Rome's consul assigned to "Uplands of the Sikeloi" every spring and had no way to ask where that is.
- **No letters or warnings for the things that mattered.** Syracuse's alliance with Massalia against Carthage (burst 13, 18 Jul 269) was a fact of 60 in a 35-fact burst. A treaty undertaking "overdue" (burst 16) was a fact of 30 and became "broken" a month later (burst 17), which I read only after the fact.
- **"Done, beyond his authority"** (M3) and **"nothing came of it"** (M4, burst 9) leave me guessing: was the letter sent? was the general asked? What did it cost me to speak for the government?
- **Hidden losses.** The loss of my fleet's identity (H1) shows as one fact and one changed army line, not as a failure of the order.
- **The five warships' completion** shows only as a second line in the army list ("Five new warships of the fleet ... raw"); the order stays "Partly done" to the end of the run.
- **Gaps I felt as a player**: no money line (treasury, chest, purse) in the burst output; no way to see which of my orders is still in force; no sense of what the Council of Elders or Himilco think of me beyond "ugly stories".

## What worked

- **Letters and treaties bind**: a letter from a man without authority over the state was accepted by the Mamertines, ratified by the Council of Elders with a printed vote (78 to 1; 78 to 4) and recorded as an active alliance / non-aggression, and both counterparts answered in character.
- **The harness stops on what needs an answer**: `NEEDS ANSWER` on a cognition prompt for a power holding my letter (COGWATCH) worked for Mettius and Hieron; letters to answer and deadlines were printed with their due dates (`letter to answer [message-consul-1-492] ... answer due 10 July 270 BC`).
- **My mistakes were reported, not swallowed**: "dropped to keep the answer: deltas.0 ... Invalid option" (burst 3), and the engine asked again with "An earlier answer did not carry this out" (burst 18, my first `force_reinforce` for ships).
- **The war/peace/election machinery stayed quiet and consistent for 1,125 days**: no world-load failure, no crash, 26 bursts of 5-8 model calls each, 135 files of answers/prompts for 114 cognition and 12 orchestrate prompts. The first burst took 21 s wall-clock; I did not time the others.
- **A shipbuilding project can be set up by hand and delivers a force** (5 ships by burst 21).

## How far to trust this run

Every stubbed or hand-written answer:

- **Orchestrate (my orders), nine hand answers**, `a1.mjs`-`a9.mjs`: written by me; two failed through my own enum mistakes (`a2` in burst 3), one order was never sent (the burst 14 omission of `--order`), one asked for the wrong kind of act (`force_reinforce` for ships, bounced by the engine), and one (`a8`, H1) was badly shaped.
- **Cognition**: only two hand answers: **Statius Mettius** (accepted, against his printed counsel "no (no quarrel of ours)", with a reason written in his answer) and **Hieron II** (accepted a pact, with no counsel printed; I chose from his stated caution). All other cognition calls were stubbed with `{"actors":[]}`, including Himilco, Hanno, Hasdrubal, Rome's consuls and every other power. So **nobody but Mettius and Hieron ever reasoned in this world**: Rome never answered anything, Hasdrubal never answered my request (M4 is partly this: his reply was not asked for), and the Carthaginian Council voted only because the engine's own procedure ran.
- **Letter wording**: `voice_letters` filled automatically by `autoletters.mjs` (each letter gets its stated substance as its body).
- **`write_mechanic` `{"mechanic":null}`, `reconcile_facts` `{"withdraw":[],"rewrite":[]}`, `repair_deltas` `{"deltas":[]}`** stubbed: every "generic_entity_create" the writer refused was refused by the stub.
- **Chronicle**: composed by hand, ten windows, from the thread facts only; where the guard said "nothing changed" I returned an empty entry list for the thread. Not composed: 16 bursts (see above). Windows are single-burst but carry every untold earlier fact of the composed bursts; those from uncomposed bursts never entered. The composer in `compose-player.mts` is the harness copy, not the web path.
- **Noise filtering**: `g.sh` removed 17 fact kinds from what I read (listed under H3). I read the full burst output only for bursts 1-4 and from `log.md` for 19; for the rest I read the filtered list. The `army:` lines, `order:` lines, `under way:`, `letter to answer`, `DEADLINE` and the player decision lines were never filtered.
- **I did read `state.json`** for verification after the fact: the bursts 14 (to find my missing letter), 24 (H1), 26 (end state) and `facts.jsonl` for arrears, debasement and authority-breach counts; I did not use it to choose a move.
- **Harness faults of mine**: the lost letter in burst 14; Chronicles composed one burst late (16-17, 25); the first Campanian answer.
- **Not covered**: war. Carthage was never at war, so sieges, battles, the new alarms (salient_event and DEADLINE) and any player decision were not exercised; this run says nothing about those.

## Files

`eval-out/carthage-run/`: `goals.md`, `log.md` (all 26 bursts), `facts.jsonl`, `state.json` (day 1,125), `a1.mjs`-`a9.mjs` (order answers), `chronicle/burst-{1,2,5,8,11,15,19,22,26}.md` and the prompts/answers beside them, `g.sh`, `carry.mjs`, `pend.mjs`.

## Verdict

- **Goals met:** 3 of 3 on the numbers (all Sicilian holdings kept and no war; 115 ships and no arrears; no Roman war and a ratified Syracuse pact), but G1's Messana garrison never came and G2's bar was set before I knew the fleet's size.
- **Worst bug:** H1, a "land marines" order dissolved the 110-ship fleet into a "garrison" force and flipped the earlier order to "failed" (partly my badly shaped answer); with H2 close behind (every treaty clause "to do", broken by the head of government at its review day).
- **Chronicle as a record of this reign:** readable and well-formed passage by passage, but only partly a record of *this* player: it told the treaties and the sailing and then filled its pages with other powers' elections and audits, and it carried 961 untold facts, among them the Syracuse-Massalia alliance and the plot against Himilco.

## Addendum: fixes made on 2026-10-22 after this run

| Item | Change |
|---|---|
| H1 fleet drawn into "marines" | `apply/apply-deltas.ts` `force_create` from a force: when the source holds only ships and the order asks for land troops (or the reverse) it now refuses ("... holds no infantry to give: it is made up of warships"); men are drawn only of the kind asked for. Test `a-fleet-is-not-drawn-into-marines.test.ts`. |
| H2 treaty promises | `apply/apply-deltas.ts`, treaty undertakings: `form` is read from the words (`promiseFormOf`, so "will not make war" is a refraining, kept by holding back) instead of a hard-coded `"do"`; a duty written "other" that is plainly a sheltering or aid becomes `protection`, which the record can show as kept; the promisor is the man who signed where he commands that power's men (the admiral whose fleet shelters the city), else the head of the government. Test `a-treaty-promise-is-kept-by-who-can.test.ts`. |
| H3 burst report led by other powers' news | New `report-facts.ts` `factsForPlayer` (what touches the player personally, then their side, then their campaign, then the rest, each by weight); used by `scripts/consul-run.mts` and the `player-run` template. Test `report-facts.test.ts`. The web path does not print a top-25; whatever it prints can use the same function. |
| M2 one-part orders printed no outcome | The consul-run scripts print the part's line when the engine's own list is empty (the game answers a done one-part order with its passage; a hand run has none). |
| M4 order and its "pursuit" listed twice | `shared/src/authority/under-way.ts`: a pursuit whose `order` text is an order already listed is not listed again. Test added to `under-way.test.ts`. |
| M5 counsel | `letter-verdict.ts`: a power whose government names "no ally" as a high worry is no longer counselled "no quarrel of ours" to a protector's offer; a pact not to make war (`non_aggression`) now has counsel. Test `a-lonely-power-takes-a-protector.test.ts`. |

Not changed: M1 (an order whose force no longer exists reads "failed": rare once H1 cannot dissolve a fleet), M3 (what "beyond his authority" costs: a design question), M6-M8, L1-L6 and the Chronicle's repeat of carried facts (L3, M-Chronicle): none fixed in this pass. A second playtest prompt is in `docs/playtests/hand-playtest-prompt.md`.
