# Fixing what the consul run found

Source: `docs/reports/consul-run-issues.md` (H = high, M = medium, L = low, T = tooling). The aim is that a hand-played consul can finish a war, take Italy, and fight Carthage without the engine's own rules standing in the way.

## Phase 1: wrong places and invalid acts (small, done first)

| Issue | Fix | Where | State |
|---|---|---|---|
| H1 | Destinations read from an order match whole words; a misspelling is forgiven only in a word written as a name | `mission-intent.ts` `namedDestination` | done, test `a-name-inside-a-word-is-no-place.test.ts` |
| H2 | The march written before a fight carries only the march, no null fields | `burst.ts` `approachFirst` | done, test `a-march-written-for-a-fight-keeps-the-army-name.test.ts` |
| H5 | "Enemy forces near them" says which of the actor's forces the enemy is near ("here, with X" / "about N km from X"), and keeps the old words when it is the man himself | `cognition.ts` | done, test in `the-war-they-were-in.test.ts` |
| M7 | The tick wrote back the agreements it held from the start of the day, undoing what the union and peace settlement ended; it now keeps their endings and openings | `tick.ts` (~1609) | done, test `a-united-ally-keeps-no-foedus.test.ts` |
| M12 | A part with held acts and no earlier part to wait on waits on its own march; its held fight was dropped before | `burst.ts` (~3275) | done, test `a-fight-on-arrival-waits-for-the-march.test.ts` |

Known unrelated failure: `a-turn-spends-few-calls.test.ts` (2 `write_mechanic` calls, at most 1 allowed) fails with each of these changes switched off, so it comes from the existing uncommitted work. The full suite takes over 10 minutes and times out several heavy tests under parallel load; they pass when run alone.

## Phase 2: wars that can end (the run's real blockers)

**H3 Catching an army. Done** (`engagements.ts`, `packages/shared/src/warfare/retreat.ts`, test `an-army-outnumbered-is-caught.test.ts`): a storm or night attack ordered that day is fought before the outnumbered side may withdraw, and a stormed camp is not left by night; a withdrawal loses 2-12% of the men to the pursuit (`pursuitLosses`) and 600 morale; a retreat never steps onto a hostile army. Original spec: A retreat never steps into a province where a hostile army stands; a force with no such step left must stand and fight. A camp stormed or a night attack ordered that day is tried before the weaker side may withdraw. Withdrawing costs men (stragglers cut down by the pursuit) and morale, scaled by the odds. Files: `engagements.ts`, `packages/shared/src/warfare/retreat.ts`.

**H4 Peace by rule. Done for offers the player's power makes** (`peace-by-rule.ts`, wired into `tick.ts` beside `settleUnionOffers`, test `a-beaten-power-takes-its-terms.test.ts`): on its due day (or on arrival, with nobody to answer), a peace offer from the player's power is answered by `concludePeace`: taken where its clauses cost no more than the recipient will bear, and always where the player dictates (submission included); refused with the reason otherwise, never by silence. Still open: peace talks accepted by rule, and offers between the world's own powers. Original spec: A peace offer or peace talks put to a power nobody plays is answered by rule, as union offers already are (`submission.ts`): talks are accepted by a power weary of its war; terms are accepted when what they cost it (`termsPrice`) is within what it will bear (`willingToGive`), and a power totally defeated holding three provinces or fewer accepts submission. Never "refused by silence" for an offer the rule can decide. Files: `submission.ts` or a new `peace-by-rule.ts`, the tick's silence pass.

**M11/M12 Fighting on arrival.** An engage given with a march to a non-bordering province is held for the arrival (`approachFirst` / `holdForArrival` treat an answer's own march like theirs), and a held engage fires when the army arrives. File: `burst.ts` (has uncommitted edits: lead only).

## Phase 3: the prompt and its seeds

- **H6** Seeds (`THE WORLD STIRS`, `COUNTRIES WITH NOBODY IN THEM`, `DUE NOW`) go in the first chunk of a split order only.
- **M1** A thread that has moved on asks for `storyline_advance` only; `storyline_open` with the seedKey only for a seed with no thread.
- **M2** A seeded `storyline_open` is not refused by the thread cap: the stalest thread of the world's own is closed to make room.
- **M4** "Countries with nobody in them" asks for a ruler only where there is none, and for forces otherwise.
- **M3/L3** A dropped act is reported with its schema error, in the run log and in the next prompt; a handle whose act was dropped is not turned into a placeholder person.

Files: `orchestrate.ts`, `slice.ts`, `narrator.ts`, `apply/apply-deltas.ts`.

**Done:** H6 (seeds, empty countries and due events go with the first line of a split order only, and never with a retry of one part: `orchestrate.ts`), M1 (a thread's turn is told its thread is open and to open no other: `slice.ts`), M2 (a seed's own thread makes room by setting aside the stalest world thread: `storyline-cap.ts` `makeRoomForASeed`, `apply-deltas.ts`), M4 (an empty country is asked only for what it lacks, in the slice and principle 5). Tests: `a-split-order-stirs-the-world-once.test.ts`, `storyline-cap.test.ts`. M3/L3 done too: a dropped act is recorded with its op and the schema's complaint (`salvage.ts`; `deltas.1 (belief_set): kind: Invalid option...` in the run log), and a field written `null` where a value or nothing is wanted is left out as not said instead of costing the whole act (`salvage.ts`), so the commonest drop (`faith: null` on `character_create`) no longer costs a person (test `a-null-faith-keeps-the-person.test.ts`). The schema itself is unchanged: making `faith` nullable pushed the cognition prompt past its 74,900-character ceiling. Not done: telling the model in the next prompt what was dropped.

## Phase 4: allies, Rome's own business, rules that contradict themselves

- **M5 Done** (`takerFor` in shared `agreements.ts`, used by `occupation.ts` and `sieges.ts`; test `an-ally-takes-ground-for-its-leader.test.ts`) Ground taken in a leader's war by a foedus ally ("no war or peace of their own") goes to the leader.
- **M6 Done** A foedus's years count from its historical date: new optional `heldYearsAtStart` on agreements (shared), set from each foedus's year in the scenario (the Samnites from 272, their last defeat), read by `unionScore`. Test in `a-united-ally-keeps-no-foedus.test.ts`.
- **M8 Done** (`order-verifier.ts`: speaking for a question already before a chamber answers "ask the Senate"; test in `order-verifier.test.ts`) The order verifier accepts support for an existing question on the same matter.
- **M9 Done** (the man an army answers to holds a command grant over it, `deriveCommandGrants` in shared `authority-grant.ts`; test `a-proconsul-commands-his-detachments.test.ts`) A detachment split from an army the actor commands is neither "raising" nor "beyond his authority"; a prorogued command covers forces split from it.
- **M13 Done** (force names are taken out of an order's words before a destination is read, `mission-intent.ts`; `givenItsDestination` in `burst.ts` also reads whole words now) An order's outcome follows its battle; a force's name is not read as a destination.
- **M14 Done for the first half** (`takenBy` in shared `world/occupation.ts` gives an ally's or a confederate's lost ground back to it, but still takes what an ally holds and gives up; test in `an-ally-takes-ground-for-its-leader.test.ts`). The flip-back is the rule as designed: an enemy army's patrols (80 km, `occupation.ts`) retake ground nobody defends. Liberated allied ground goes back to the ally; ground does not flip back the day an army leaves without an enemy army there.
- **M15 Not a bug, as far as found**: the swings follow ground changing hands as armies step in and out and enemy patrols retake undefended ground (M14). Smoothing them is a design choice. War score factors read held ground over time, not who stepped in this week.
- **M16 Not a bug**: a burst is a month, and the two facts fell on different days (the Picene contingent starved in the Sallentine country, then finished its march to Rhegium). The detachment shown at its starting province was the H1 march, now fixed. A force on the march is shown where the road has brought it; no force is in two places in one burst.
- **M17 Explained, needs a decision**: a call to arms fires when a war opens (`callAllies`, `treaties.ts`), and both of Rome's wars began before Carthage's league was made, so nobody was called. Whether a league made during a war should bring its members in is yours to decide. A defensive league is honoured, or the prompt and facts say why not.
- **M18 Done** (a fleet's strength is printed in ships in the slice and the portrait, `countsShips` in `cognition.ts`; test in `the-war-they-were-in.test.ts`) Hull strength is shown in ships, or blockades weigh it.

## Phase 5: low and tooling

L1 **done** (`aNameFor` and `staffing.ts` fall back to patronymics and then a numeral, never an id; test `a-name-is-never-an-id.test.ts`), L2 **done** (the 45-54 stage reads "middle years"), L4 letters to the player's power reach him as decisions, L5 money label; T1 **done** (the hand adapter strips a BOM, test in `packages/ai/src/adapters/hand.test.ts`), T3 **half done**: `consul-run.mts` prints the letters the player's power must answer and those it waits on; putting terms at a peace table from the script is still open.

## Found while validating

- **A treaty's prose handed Rome's army to the enemy.** `servesInTerms` (`apply/apply-deltas.ts`) reads a force transfer out of a peace's words. Rome's terms "give yourselves up to the Roman people; your ground passes to Rome" matched one word of "Roman field army" a few words before "passes", and the Roman field army went into the service of the Campanian Legion. **Fixed:** the force's whole name must stand in the terms before the word of service, and nothing passes into the service of a power that is submitting. Test `a-word-of-an-army-name-hands-over-no-army.test.ts`.
- **The run script could not answer a decision.** `consul-run.mts` now keeps the decision a burst stopped on and answers it with `--decide <option id>`.
- **Invented capitals piled up.** A power holding only countryside is given a "Seat at …" town (`reconcileCapitals`, shared `world/capitals.ts`); each time it lost and regained ground it was given another, a numbered one in the same province. **Fixed:** a seat already invented in a province is used again once the power holds it, and a province whose seat the enemy holds is not chosen. Test in `capitals.test.ts`.

## Validation

**Done once, on a copy of the burst-23 save** (`eval-out/consul-fixcheck2`; the original run is untouched): the consul sends the Campanians terms of submission; on the letter's due day the Campanian Legion accepts (Rome dictates at 100 of 100), gives itself up, its army takes service under Rome, and the war ends. Before the fixes every such letter was refused by silence.

Full sim suite, second run after all but the capital-seat change: 389 of 390 files and 2,859 of 2,860 tests passed; the one failure is `a-turn-spends-few-calls`, as before. Shared package: 93 of 94 files, the one failure a test that passes alone (a 5-second timeout under load). First run, after most of these changes: 385 of 389 files passed. Of the 4 failures, 2 were tests the run reached while they were being edited (both pass since), 1 was the cognition prompt ceiling (fixed by moving the null handling into salvage), and 1 is `a-turn-spends-few-calls`, which fails with or without these changes.

Originally planned: 

Each fix lands with its own test. Once phases 1 and 2 are in, the consul run is replayed from its burst-23 save to check that the Campanian and Messapian wars can be ended.
