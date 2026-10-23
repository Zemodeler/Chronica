# Hand-run reports

One document for the played-through playtests (a person with only the burst output and the Chronicle). Newest harness notes: `docs/playtests/hand-playtest-prompt.md`. Run files live under `eval-out/` (git-ignored). Each report below is kept whole, its headings moved down one level.

Earlier audits that are not hand runs stay as they were: `270-bc-clepsina-*`, `consul-run-issues.md`, `five-year-sanity-runs.md`.

New hand-run reports are written as `docs/reports/<date>-<character>-<n>y-hand-run.md`, which is git-ignored; fold the ones worth keeping into this file.

## Contents

- [Triage: Codex hand-mode play-test (2026-10-02)](#2026-10-03-codex-hand-playtest-triage) (2026-10-03-codex-hand-playtest-triage.md)
- [Five-year hand run: three goals, and the bugs it found](#2026-10-16-chronicle-5y-hand-run) (2026-10-16-chronicle-5y-hand-run.md)
- [Three-year hand run as Hieron II of Syracuse: three goals, the bugs, the Chronicle](#2026-10-22-hieron-3y-hand-run) (2026-10-22-hieron-3y-hand-run.md)
- [Three-year hand run as Hannibal Gisco of Carthage: three goals, the bugs, the Chronicle](#2026-10-22-hannibal-gisco-3y-hand-run) (2026-10-22-hannibal-gisco-3y-hand-run.md)
- [Three-year hand run as Statius Mettius, Leader of the Mamertines (Messana): playable, with caveats](#2026-10-22-statius-mettius-3y-hand-run) (2026-10-22-statius-mettius-3y-hand-run.md)

<a id="2026-10-03-codex-hand-playtest-triage"></a>

---

## Triage: Codex hand-mode play-test (2026-10-02)

Source: the six-run Codex hand-mode play-test of scenario v43 at 270 BC (legionary, military
tribune, consul, coup, tycoon, reformer). Each fault below was traced to code. Line numbers are
from `main` at `febddc8`.

There are three kinds of fault:

- **Engine bug (E).** Deterministic code does the wrong thing, whatever the model says.
- **Model guard (M).** The model wrote bad data and the engine accepted it. The fix is a guard in
  code, not in the prompt.
- **Logic gap (L).** The game has no rule for something a player should be able to do. Most of the
  "the player cannot get anywhere" findings are in this group.

The **Workstream** column says which change set fixes each fault (see the end of this document).

### Engine bugs

| # | Fault | Root cause | Workstream |
|---|---|---|---|
| E1 | A saved world fails its own schema (`slips` > 3) | The "owed" branch of `settleOverdueSteps` gave every late step another slip with no cap (`plans.ts:327`). `applyDeltas` validates the whole world, not just the batch (`apply-deltas.ts:1143`). Once something else had written bad data, every later batch was refused with "would have left the world invalid" and the bad world went through anyway. `runSimulationBurst` never validates its result. The scripts and `persistOpeningWorld` write without validating. | 1 |
| E2 | A "paid" goal with `amount: 0` corrupts `orders` | `goalsOfAct` copies `money_transfer.amount` (non-negative, so 0 is allowed) into a goal whose schema needs a positive amount (`order-goals.ts:83`). `recordOrder` writes `world.orders` without validating it (`burst.ts:2620`). | 1 |
| E3 | "0 spent" while the purse empties | `money_transfer` is tagged with the actor id, not the act (`apply-deltas.ts:1890`). Contract wages, mechanic firings and obligations carry no `sourceActionId`. Tick payments ignore reservations. | 1 |
| E4 | "refused" although the 8 letters went | A part takes its least-finished status, so one ignored letter counts as refused (`orders.ts:271`). `part.refusal` is set even when other acts were carried. Only 4 goals are kept per part. | 1 |
| E5 | "Leave the army, travel to Rome: done" with no effect | `force_membership_set discharge` never clears `character.service` (`apply-deltas.ts:3791`). A part with no goals and any fact reads "achieved" (`orders.ts:283`). There is no goal for a person's location or service. | 1 |
| E6 | Stale orders pile up; an old attempt is matched to new orders | Order parts never lapse. Accepted attempts with no work never close (`burst.ts:965`). Only one pursuit is retired per burst. The slice offers accepted attempts as decidable, so the refusal of a re-decision is attached to new parts by their words. | 1 |
| E7 | Order lines the player never wrote ("Give the Umbrians their own ruler") | `recordOrder` takes `intent.parts` verbatim. World business the orchestrator was asked to do lands among the player's parts. There is a guard for misfiled deltas but none for parts. *(Also M.)* | 1 |
| E8 | An outcome dated before the vote it reports | Outcome lines are read from the end-of-burst world but appended to an entry dated when the order was given (`order-outcomes.ts:84`). | 1 |
| E9 | The Senate fleet question "done" while its stage failed on `local:fleet-question` | Held stages and deferred acts store raw `local:` handles and are re-applied with a fresh handle map (`burst.ts:1090`). Met goals outrank a failed stage (`orders.ts:271`). | 1 |
| E10 | The consul's own crossing is "handed on, not yet taken up" | Every held stage displays as "pending" (`orders.ts:259`). A resumed instruction is delegated to *another* officeholder, never to the actor (`burst.ts:1073`). Delegations to oneself are accepted. A `transport_capacity` wait can never become impossible. | 1 |
| E11 | Engine refusals ("No force … exists") leak into the Chronicle and the Council | `engine_rejection` facts are copied into the order's answer (`burst.ts:2350`). Reference refusals become `part.refusal` (`burst.ts:1124`). | 1 |
| E12 | False breaches for drills, letters and one's own candidacy | Own-business rules miss the actor's own nomination and drilling in his own unit. `character_create` of an existing man still counts as changed. `province_material_shift` consequences are judged as the player's acts (`own-business.ts`, `apply-deltas.ts:987`, `:3070`). | 2 |
| E13 | Senate-floor refusal for requests to a person and for an aedile's games | The convener check applies to every procedure type except nomination (`whose-to-give.ts:93`). A null institution bypasses it completely. | 2 |
| E14 | Requests to officeholders wait for ever | When owed cognition turns are dropped, the order attempt is never touched (`burst.ts:3384`). Attempts have no due date. | 2 |
| E15 | A legionary can never be promoted | The optio has no grade, so it ranks above the centurio posterior. The vacancy rule promotes only into the unit officer's post (`ranks.ts:327`). | 2 |
| E16 | A lost election says nothing | Ineligible candidates are dropped without a fact (`elections.ts:309`). A college with no winners settles every candidacy as **passed**. "tribunate" and "aedileship" do not match their office. | 3 |
| E17 | Ex-consuls fill the college of 16 military tribunes | The office has no rank and no age or career rule, and electable men are sorted by raw prestige (`punic-wars-scenario.ts:121`, `elections.ts:230`). | 3 |
| E18 | A soldier's pay vanishes | `army_pay` has no recipient, so the money leaves the treasury and lands nowhere (`tick.ts:687`). | 3 |
| E19 | A merchant's first venture takes his whole purse; a cargo is charged twice | `payOrBorrow` puts down the entire balance when it is short (`apply-deltas.ts:6708`). A rejected `income_source_upsert` is repaired or kept as a second venture or arrangement in the same burst. | 3 |
| E20 | A letter set up a paid "respect" rule that took the last coins | Pursuits and letters are offered to the mechanic writer. The setup cost has a floor and no affordability check (`burst.ts:1815`, `attach-mechanic.ts:46`). | 3 |
| E21 | Carthage's admiral makes a private plebeian his nemesis | `chooseNemesis` scores capability alone, needs no grievance, and searches the whole world (`nemesis.ts:106`, `:186`). | 3 |
| E22 | A fleet of 18 allied hulls cannot ferry 8,772 men | `MAX_FERRY_TRIPS = 12` caps trips by count, not by days. The hulls are filed as warships at 30 men each (`passage.ts:43`). | 4 |
| E23 | A Syracuse letter cannot be addressed | Polities named under PLACES, DIPLOMACY, agreements and letters carry no id. OTHER POWERS is capped at 12 and ignores the order text (`slice.ts:650`). | 4 |
| E24 | "The world is already following 12 threads" refuses the player's own storyline | The cap is global and is checked only on `storyline_open`. Other paths add storylines without any check (`apply-deltas.ts:4192`). | 4 |
| E25 | A consul cannot detach a garrison from his own army | `force_create` with `fromForceRef` is judged as raising new men at the polity's cost (`apply-deltas.ts:260`, `nobody-listens.ts:169`). | 4 |
| E26 | A march is re-announced "from Latium", even after a battle | A re-order restarts the march from its origin. An army's own crossing leg is cancelled by its own re-order. March counts as winter (`apply-deltas.ts:1611`, `:1556`, `seasons.ts`). | 4 |
| E27 | A plebiscite with no enactment "passes" silently | The "begins nothing" warning fires only for questions about a polity (`senate.ts:442`). | 4 |
| E28 | Tax surpluses are reported as shortfalls | The shortfall test is `share < 1`, not `received < owed`. Occupied ground is blamed on over-taxing (`tick.ts:422`, `:1211`). | 5 |
| E29 | `fact_places` drops every turn | An army's ground does not include where it is marching to (`burst.ts:1542`). | 5 |
| E30 | Codex answers fail as invalid JSON | The game JSON is double-encoded inside `{answer: string}`. A parse error throws before the sim's lenient readers can run, and the raw text is lost (`hand-codex.ts:126`). | 5 |
| E31 | The answer cache ignores effort | The namespace is hard-coded `codex-v1:${model}:high` (`ai/src/index.ts:97`). | 5 |

### Model guards

| # | Fault | Guard | Workstream |
|---|---|---|---|
| M1 | A 0-amount payment | Reject `money_transfer` with an amount ≤ 0, and drop invalid goals. | 1 |
| M2 | World tasks written as player order parts | Drop parts that have no acts of the order's own and do not match the order text; audit them. | 1 |
| M3 | Delegation to oneself; deciding an already-decided attempt | Drop the delegation, or carry it out as one's own act. Treat a re-decision as an ignored no-op that is never attributed to a part. | 1, 2 |
| M4 | A drill by a man with no command sets the whole army drilling | Refuse it in `nobodyListens`, or apply it to his own unit only. | 2 |
| M5 | `character_create` with an office label seats someone, bypassing `whoseToGive` | Judge it as an `office_seat_set`. | 2 |

### Logic gaps

| # | What a player could not do | What is built | Workstream |
|---|---|---|---|
| L1 | See his standing and what each office needs | The sheet shows a number, the next office within reach and its gate. Failure text gives the numbers. Word bands follow the gates. | 3 |
| L2 | Earn standing by deeds | Deterministic standing for: a soldier in a won battle, a siege taken or held, being first over the wall, games, feasts and doles (scaled by money spent), speaking on the winning side, months in office, clients, a lost election, a lost trial. | 3 |
| L3 | Learn why he was not elected | A fact at declaration and on polling day ("not admitted: standing 2,190 of 3,000"). Each candidacy gets its own outcome reason. | 3 |
| L4 | Get an answer to a request | Each request gets a due date. When it falls due, the engine decides it by rule: whether he can grant it, his opinion of the asker, and his interests. The answer is yes, no or conditional, with a reason, and on yes the act is carried out. | 2 |
| L5 | Have a magistrate put his question | A convener is chosen by willingness, as war and peace already are. A named sponsor is asked, not assumed. | 2 |
| L6 | Rise from the ranks | `appointedBy` on ranks, a `force_post_set` act judged by it, a seasonal merit review, and a request for promotion decided by merit and opinion. | 2 |
| L7 | Hold the aedile's games | Games and benefactions as an act, with a cost, a standing gain, and the aediles' yearly allowance. | 3 |
| L8 | Find money as a private man | Soldiers' pay into named purses. Loans offered by rule when the purse is low. A patron's stipend to his clients. | 3 |
| L9 | Trade at sea | A venture by sea has a voyage and an arrival, and its cargo is sold at a margin, instead of a perpetual trickle. | 3 |
| L10 | Marry into the nobility | Seeded wives and daughters of the great houses. Guards on marriage ties. Accepting a marriage offer brings a dowry and standing. | 3 |
| L11 | Be resisted as a person on hard | Beaten candidates resent the winner. Private men can be prosecuted. A personal enemy may plot against him. The nemesis is sized to the player's station. | 3 |
| L12 | Cross to Sicily | Ferrying is capped by days, not trips. Allied hulls can be requisitioned. Transports are a real troop category. | 4 |
| L13 | Spend money the Senate voted | A carried budget becomes a spending grant for the named magistrate, capped at the voted amount. | 4 |
| L14 | Act as proconsul | Prorogation grants command, detachments, a war chest and truces, and the slice states them. | 4 |
| L15 | Absorb an ally | A deterministic "demand submission" decision, deditio after defeat, a franchise enactment, and an answerer for allies with no named leader. | 4 |
| L16 | Read a chronicle that is about him | Far news is weighted by distance and dealings, capped per burst, and the rest folded into a digest. | 5 |
| L17 | Have a month actually thought about | Repairs and reconciles are batched per round, engine-authored work no longer buys model calls, the player's requests come first, and the budget scales with the span. | 5 |
| L18 | Play hand mode at medium effort | `gpt-6-luna` at medium is the default. Effort is selectable and part of the cache key. The real schema is passed to Codex, with tolerant repair and one retry for invalid JSON. The timeout is configurable. | 5 |

### Workstreams

1. **Save integrity and the order ledger.** E1–E11, M1–M3. Covers burst.ts (order ledger), orders.ts, order-goals.ts, order-outcomes.ts, under-way.ts and plans.ts.
2. **Authority and requests.** E12–E15, M3–M5, L4–L6. Covers own-business.ts, whose-to-give.ts, nobody-listens.ts, misfiled.ts, a new requests.ts, and ranks.ts.
3. **The player as a person.** E16–E21, L1–L3, L7–L11. Covers elections.ts, standing, money, ventures, mechanics, family and nemesis.
4. **War and the state.** E22–E27, L12–L15. Covers passage.ts, enact.ts, command-tenure.ts, slice.ts, submission, storylines, marches and senate.ts.
5. **Chronicle, budget and hand mode.** E28–E31, L16–L18. Covers tick taxes, far-news.ts, the burst hop loop, cognition.ts and packages/ai.

The model-quality caveat in the report still stands: faults 13 and 16 should be re-run at medium
effort once workstream 5 lands. Several outcome-line faults were partly a weak model meeting a
strict schema; with the real schema passed to Codex, that class should mostly disappear.

<a id="2026-10-16-chronicle-5y-hand-run"></a>

---

## Five-year hand run: three goals, and the bugs it found

Date: 2026-10-16. Branch `chronicle-order-truth` (working tree with uncommitted changes). Nothing under `packages/` or `apps/` was edited; all run files are in `eval-out/chronicle-5y/` and this report is the only file added to `docs/`.

### What was played

I played Gaius Genucius Clepsina, consul of 270 BC, through the hand adapter (`scripts/consul-run.mts`, one burst per call), from **1 March 270 BC to 29 February 265 BC**: 1,826 game days, **49 bursts**, about 9,600 new facts and about 290 model calls. I answered every model call myself or with a stub (see "How far to trust this run").

The three goals were decided before the first burst (`eval-out/chronicle-5y/goals.md`):

| # | Goal | Result |
|---|------|--------|
| G1 War | Destroy the Campanian Legion, end that war by treaty, hold both shores of the strait (Rhegium and Messana) before Carthage can | **Reached, then lost, then regained.** Campanians gave themselves up on a signed offer (29 Jul 270). Rhegium fell 30 May 270, Messana in mid December 270. Messana was lost in Aug-Oct 268 when eight Sicilian provinces "rose against Rome under Hieron II" (bug H1). On the last day both settlements are Roman again. The Campanians were revived by a rising under Vibellius in Nov 269 and Rome was at war with them again at the end. |
| G2 Fleet | 100+ warships by early 265, no treasury strain | **Reached on ships, not on count.** The Senate refused the fleet 36-37 (Apr 270) and passed it 50-19 (Nov 270). 100 warships stood at Latium by about Aug 269. At the end Rome has 89 of them plus 17 captured Apulian hulls. Treasury 2.7M to 11.6M, no Roman arrears, the Roman coin never debased (`silverBps` 7300, `debasedSinceStep` null). |
| G3 Politics | A second consulship by the elections of 266; Syracuse allied | **Reached.** Alliance with Hieron signed 1 Mar 269 after one refusal by silence and one counter-offer. Senate waived the ten-year bar of the lex Genucia on 19 Feb 268 (43-11), a day after that year's election. Elected consul unopposed on 20 Feb 267, term 267-266. |

At the end of five years Rome holds 135 provinces, but it is at war with the Campanian Legion, the Mamertines, a revived Apulia and the Bruttians. The Lucanian ally owes 960,000 over 26 missed periods. The world ends in a state that no one would call settled (see H4).

Severity: **High** corrupts state, hides what the player needs, or makes a goal or a war unwinnable. **Medium** is a rule that misbehaves or contradicts itself. **Low** is noise, wording or tooling. Where I traced a bug into the code, the file is named.

### How far to trust this run

- **NPC cognition was stubbed.** About 95% of cognition calls were answered `{"actors":[]}` by a driver script, so other powers acted by engine rule only. I answered by hand only for letters addressed to Hieron, Hanno, Paquius Calavius and the Mamertine spokesman. "Refused by silence" in the first burst against Syracuse and the Mamertines was my stub, not a bug (I note where I had to correct myself).
- **Letters.** Subordinates' reports and some letters were answered by a script that copies the stated substance into the body (`autoletters.mjs`).
- **The world seeds and "countries with nobody in them" asks were answered for roughly the first 25 bursts, then mostly left alone.**
- **Two claims were retracted while writing.** The Senate waiver arriving a day after the election was my own 30-day deadline. The duplicate storm events need two storm commands in the same day, which my harness gave (both `--decide siege-storm` and a storm order). Both are marked below.
- The Chronicle composer test at the end uses only the last 300 facts, because `consul-run.mts` keeps `knownFacts.slice(-300)`. That is a harness limit, not a game rule.

### Timeline

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

### High

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

### Medium

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

### Low

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

### What worked

- **Peace by submission now works.** The old report's H4 ("a beaten power never ends") is fixed for the cases I tried: Campanians (29 Jul 270), Apulia on its own (4 Dec 267), Bruttians twice.
- **Explained refusals.** Trade venture ("57% down, 8044 owed ... say 'on credit'"), adoption ("is of the gens already"), land tax ("a private citizen cannot set the land tax"), house founding ("lives too far from Latium").
- **Consequence chains.** An unauthorised declaration of war led to `act_usurped`, then a prosecution when office ended, then command handed to the successor with the player as legate. A hired spy was caught inside the same month and named his sender.
- **Politics.** Senate motions that the consuls take the army against Apulia passed 50-31 and the NPC consuls moved the army and the fleet. The waiver, the pontiff election and the consular election all ran through the real procedures, and the "election_open_to_you" notice fired.
- **Legate orders** are obeyed. "Return to Rome" carried the player in under 60 days.
- **Field battles** are plausible (1,911 v 2,755 near Naples, 575 v 630 at Messana).

### The Chronicle at the end

I composed the last three weeks through the hand adapter (`compose-last.mts`). Ten threads, every one a movement or a fight between two "rising" bands: "The rising of Uplands of the Siculi marches on ...", "stand facing each other. Neither has been ordered to attack", and the same battle once per round. Nothing about Messana, the treasury, Hieron, the Senate or the player. With 1,146 facts per quarter the Chronicle's significance filter does not suppress this noise. (The test used only the last 300 facts; the web path may rank differently.)

### Files

- Goals: `eval-out/chronicle-5y/goals.md`. Raw bug notes in the order found: `notes.md`.
- Run log of all 49 bursts: `log.md`. Final save: `state.json` (day 1826); previous burst: `state.prev.json`. Every prompt and answer: `simulate_*`, `voice_letters-*`, `chronicle/`.
- Harness: `drive.mjs` (one burst; stubs for cognition, mechanic, reconcile, repair; `COGWATCH`, `AUTOLETTERS`), `go.sh`, `view.mjs` and `cogview.mjs` (compact prompt viewers), `build.mjs`/`lib.mjs` (answer builders, `STEM=` to pick a prompt), `st.mjs` (state summary), `stats.mjs` (per-burst facts and calls), `compose-last.mts` (Chronicle test).
- To replay: delete `state.json`, run `node eval-out/chronicle-5y/drive.mjs -- --dir eval-out/chronicle-5y --reset --order "March the Roman field army to Rhegium and lay siege to it" --span 30`; the answers on disk replay by prompt hash.

### Addendum: continuation to 28 June 265 BC (bursts 50-52)

The five years ended with G1 not fully settled: the Campanian Legion had been revived by a rising and was at war with Rome again. I continued for three more bursts (4 months) to finish it.

- **Burst 50 (1 Mar - 14 Apr 265).** I moved the Senate that the consuls march on the revived Campanians and offer them peace on submission. Carried 39-26. The Campanians asked a truce in the same month.
- **Burst 51 (to 29 May).** Neither consul acted: Fulvius Flaccus stayed with the field army in Samnium, Appius Claudius Caudex at Messana, the truce letter lapsed, and the 1,400 Campanians were untouched. The same kind of motion in 268 (against Apulia) was obeyed at once. Logged as M16.
- **Burst 52 (to 28 Jun).** I asked the Senate for the field-army command as proconsul. My own support delta failed ("refers to `local:proconsul_motion`, which nothing in this batch created") and the repair was refused; the order reads "taken up, nothing done yet". The Campanians (about 1,300) moved to Rhegium coast beside Rhegium, which is still Roman along with Messana (control firmness 3,000, "held loosely").
- **Result.** Both shores are Roman at day 1946, the original Campanian war stays ended by treaty (29 Jul 270), and the revived war is unresolved. I stopped there: the player (a pontiff and senator) has no lever the NPC consuls obey, which is a finding in itself.

New findings:
- **M16 (Medium).** A carried Senate order to the consuls is executed in one case and ignored in the next, with no fact saying why.
- **H1 again, with the player.** "Uplands of the Sikeloi rose against Campanian Legion under Gaius Genucius Clepsina and went over to Roman Republic" (burst 50). `rise()` picked the player as a rising leader because his active ambition targets Rome; `rise()` also sets the leader's `locationProvinceId`, and the player's recorded location changed (from Samnium to the Eastern coast of the Iapyges) in that burst. I did not isolate whether the move is solely due to `rise()`.
- **Low.** A `command_assignment` motion opened with a same-batch `local:` reference is dropped by the repair step with no correction offered.

<a id="2026-10-22-hieron-3y-hand-run"></a>

---

## Three-year hand run as Hieron II of Syracuse: three goals, the bugs, the Chronicle

Date: 2026-10-22. Branch `chronicle-order-truth` (HEAD `7648f97`, working tree as found). Nothing under `packages/` or `apps/` was edited. All run files are in `eval-out/hieron-run/`; this report is the only file added to `docs/`.

### What was played

A different seat from the 16 Oct run (which was a Roman consul): **Hieron II, king of Syracuse**, from **1 March 270 BC to 17 March 267 BC** (1,112 game days), through the hand adapter (`scripts/consul-run.mts`, one burst per call; a copy, `consul-run2.mts`, also appends every new fact to `facts.jsonl`). 23 bursts. I wrote 12 order answers myself and answered, as the model, the replies of the Roman consul, the Mamertine spokesman and the Carthaginian suffete where my own letters were involved. Other cognition and the world-event seeds were stubbed or left alone (see "How far to trust this run").

Goals, decided before the first burst (`eval-out/hieron-run/goals.md`):

| # | Goal | Result |
|---|------|--------|
| G1 War | Take Messana and end the Mamertine war by treaty or submission | **Reached on 1 Jul 270 (day 122, siege of 74 days), the Mamertines gave themselves up on 28 Aug 270 (day 151). Lost again in Mar 268 (day ~380) by bug H1 below, and never recovered.** |
| G2 Fleet | 60+ warships, treasury never in arrears, coin not debased | **Reached on count**: 17 + 25 + 40 = 82 warships in April 268, treasury 5.6-6.4M, no arrears seen. But the Carthaginian fleet beat the squadrons repeatedly (at least five battles from Feb 269 to Mar 267; 69 ships remain at the end) and shut them in harbour. |
| G3 Diplomacy | Alliance with Rome, Carthage kept at peace | **Half.** Rome accepted the alliance on day 151 (my answer, as consul). Carthage made war on Syracuse about Feb 269, took 16 of 26 provinces, accepted peace for 800,000 in June 268, and was at war again four months later. Rome refused military aid and never fought Carthage. |

**End state (day 1112):** Syracuse holds 3 provinces (26 at the start of the war with Carthage). The capital's province has risen as "The Free People of Eastern Syracusia". The Mamertines (extinct since Aug 270) are back as a polity and at war with Syracuse. Messana and its province are held by Rome. Carthage holds 280 provinces. The king commands the royal army (2,436 men) and 69 ships in port, with 5.6M in the treasury.

Severity as in the earlier report: **High** corrupts state, hides what the player needs, or makes a goal unwinnable. **Medium** is a rule that misbehaves or contradicts itself. **Low** is noise, wording or tooling. Where I traced a bug into code the file is named.

### How far to trust this run

- **Cognition was stubbed** (`{"actors":[]}`) except where a letter from Hieron sat in front of another power; there I wrote the reply myself. So "Rome refused by silence" in burst 4 (Rome's reply to my first alliance letter) is **my stub**, not a bug. The Roman and Carthaginian refusals in burst 12 were my choices, following the engine's own printed counsel ("no, no men to spare"; "no, not beaten").
- **The long gap is mine.** I issued no order for 270 days (bursts 8-11, 28 Aug 270 to 22 Aug 269) while running longer bursts to see how the world moved. The collapse in G3 is partly that choice; what is a bug is that nothing told the player (B2 below).
- **Chronicle composer test uses only part of the input.** `compose-h.mts` passes facts, their significance, the world and the observer, but not `nameOf`, `describePerson`, storylines, campaign ids, `ownSide` or the order outcome. The raw ids shown as tags ("character-consul-21-1157", "sic-ecyan") are therefore **a harness limit**, not a game bug. The web path may select and tag differently.
- **Doubled "X writes: X writes:"** in dispatches may be partly my `AUTOLETTERS` harness (it fills letter bodies); I did not isolate it. The "Rome's government" greeting is hard-coded and is a game bug (H3).

### Timeline

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

### High

**H1. The player's own character is picked to lead a rising against his own kingdom, and his polity is overwritten.** (Same defect as the 16 Oct report's H1, still present.) `rise()` in `packages/sim/src/polity-end.ts` takes as leader "the first alive character with an active ambition whose `targetId` equals the power it rises for" (line 327) and then sets that character's `polityId` to the wanted polity (line 344). Hieron's ambition "Secure Syracuse against the Mamertines" has `kind: "peace"`, `targetId: "mamertines"`.
- Evidence: burst 16 (20 Mar 268): "North-eastern coast of the Sikeloi rose against Kingdom of Syracuse under Hieron II, and Mamertines of Messana stood again" and "North-eastern Peloris rose ... under Hieron II and went over to Mamertines". After it, `hieron-ii.polityId == "mamertines"`, `offices` is null, and two forces named "The rising of ..." under polity `mamertines` are commanded by him. Burst 19's prompt reads: `ACTING FOR: Hieron II, King of Syracuse, of Mamertines of Messana [mamertines]`, `Office: syracusan-king. Polity: mamertines`, with authority over the risings listed beside Syracuse's. Burst 22 repeats it: "Uplands of the Siculi rose against Kingdom of Syracuse under Hieron II and went over to Mamertines" and, in the same burst, "Coast of the Siculi rose against Carthage under Hieron II and went over to Kingdom of Syracuse" (the king leads risings for both sides).
- Effect: G1 (Messana and the Mamertine surrender) is undone by the game, 150 days after it was won, with nothing said to the player. Every later burst treats the player's polity as `mamertines` (`consul-run.mts` reads it from the character). A 16 Oct sighting had the Roman player as leader; this shows it hits any player whose ambition is aimed at the enemy.
- Fix: choose a leader whose ambition is a restoration of `wanted` or whose own polity is `wanted` or ended; never reassign `polityId` of a living officer of another power.

**H2. The risings epidemic (the 16 Oct H4) is now general, and unwinnable for a defender.** Burst 22 (Sep-Dec 268): eleven Syracusan provinces rose in one burst, nine "under" Carthaginian-named leaders (Hiempsal, Baalyaton, Bodashtart, Safot, Mago, Hamilcar, Arish, Abdeshmun, Milkpilles) and went over to Carthage; the capital province rose as "The Free People of Eastern Syracusia" with 3,000 men. The same shape appears in Macedon (Maedi "stood again", five provinces under Cotys, burst 23) and Media Atropatene (nine provinces to the Cadusii, burst 23), and in Italy (Bruttium, Campanians). Syracuse went from 26 provinces to 3. Facts per burst: 94, 260, 354, 98, 107, 401, 181, 219, 530. `province_unrest` ("Order is breaking down in ... and 5 more provinces", burst 20) is a fact only; the king is never offered a decision (grant, garrison, tax) before the rising.

**H3. Nothing tells the player that war has begun or that they are losing.** Carthage declared war in Feb 269 (burst 9, in a 260-fact burst), raided 540,000 and occupied 15 districts, beat my squadron twice and took the Aeolian Isles, all while the burst printed 25 facts led by a Campanian polity ending and Spartan wars. There is no decision, letter or warning for the king. A Carthaginian garrison entering the home province in Aug 270 raised nothing. The war reopened in burst 21 (about day 995, four months after peace) likewise. A turn of play that did not issue an order lost 16 provinces. (The 16 Oct report found the same shape for Messana's loss.)

**H4. Performance still degrades with the world's age.** 90-day bursts took 71 s, 98 s, 169 s, 222 s (bursts 8-11), 274 s, 223 s, 280 s (bursts 21-23), with 7-12 model calls each. The run was only 1,112 days; the earlier 1,826-day run reached 10-22 minutes. A "let the quarter pass" would be five minutes by year three and fact counts of 530 by burst 23.

### Medium

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

### Low

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

### The Chronicle outputs

What comes out, and how it looks, from a hand-composed window of bursts 21-23 (20 Jun 268 to 17 Mar 267, one window of 930 facts; saved in `eval-out/hieron-run/chronicle-late.md` and `chronicle-result-late.json`):

- **Shape.** 10 calls, 10 passages, 0 overstated, **835 of 930 facts carried (not told)**. Each passage is a title, a body of one to five sentences, tags and a fact count (1-3 facts for most passages; one thread of about 70 facts).
- **Selection, by weight.** The thread with most facts mixed three years of war into one: a Roman grain-keeper's dole at Messana (three times), Etruscan, Bruttian and Apulian contingents crossing, Rome's peace with the Mamertines, the ten risings of Syracuse (nine to Carthage), "Carthage broke its peace" (three times) and Carthage refusing Syracuse's truce by silence. One passage was written from it ("The south falls away to Carthage, and Rome comes over the strait").
- **What the king reads is Carthaginian bookkeeping.** Four of the ten passages are about Carthage's council and its rising of south-eastern Sicania (a vote to let its feeding to a firm of Carthage; a refusal of bread; a rising's victory over a Mamertine garrison; the garrison of Panormus taking a camp). The capital rising ("Syracuse itself rises against the king") got its own passage; the loss of 23 provinces, repeated fleet defeats, the broken peace and the Carthaginian declaration got **no** passage of their own.
- **Noise passages.** "Parties in Syracuse fade" (three parties "no longer to be reckoned with"), "Aristomachus writes from the north-east" (three dispatches whose addressee is "Rome's government" and doubled sender prefix in the source facts), "Two Italian districts go over to the Bruttians" (a rising of the Campanian legion, which has no bearing on Syracuse).
- **Tags** show raw ids (a harness limit, see above); the entries carry `factIds`, `subjects`, `changes`, `quote` (null in all) and `storylineIds` (none here).
- **Window.** I composed three bursts at once (9 months), so the Chronicle there is one long window and the "recent titles" guard (no repeat headlines) had nothing earlier to read. In the game each burst is its own window.
- **Burst log output (what the player reads after each burst).** Order outcome lines, "under way" items, letters to answer, army lines (one per force the player commands, including risings after H1), then the top 25 facts. Observed problems: top facts are 40-60% other powers' elections, harvests and peculation audits; order lines never retire (M6, M4); the same war is told by army lines, `armies_facing` and `blockade` facts each month.

### What worked

- **A declared siege conquers.** War on Messana, siege by land and sea, breach at day 72, city yielded at 74; submission accepted by the Mamertine spokesman on the engine's counsel, with an army taking service. Peace by submission works for a beaten power (the 16 Oct H4 stays fixed).
- **Honest explained refusals.** Rome: "no men to spare", "no quarrel of ours" printed as counsel; Carthage: "not beaten" while it holds 17 provinces; the engine's counsel lines were consistent with the state.
- **Alliances bind in both directions.** Rome declared war on the Mamertines "as its alliance with Kingdom of Syracuse bound it to", and Syracuse is recorded as refusing a Roman war in return.
- **Relief and field outcomes read plausibly** (garrison "outnumbered three to one" withdraws; siege lifted "before the relief comes up"; storm and fleet storms: "13 of its ships were lost").
- **Treaty mechanics.** Indemnity clauses became an obligation (`Indemnity owed by Kingdom of Syracuse to Carthage`, 100,000 per 90 days).

### Files

- Goals: `eval-out/hieron-run/goals.md`. Raw notes in order: `notes.md`. Full burst log: `log.md`. Final save: `state.json` (day 1112); `facts.jsonl` holds every new fact from burst 20 on.
- Harness: `drive.mjs` (stubs, `COGWATCH`, `AUTOLETTERS`), `go.sh`, `loop.sh`, `build.mjs`/`lib.mjs`, `consul-run2.mts` (writes `facts.jsonl`), `compose-h.mts` (Chronicle test), answer files `a2.mjs` ... `a11.mjs` and `a6a-c.mjs`.
- To replay: delete `state.json`, `facts.jsonl` and `log.md`, run `bash eval-out/hieron-run/go.sh --span 30 --order "<order text>"` for the orders in `log.md`; hand answers on disk replay by prompt hash.

### Addendum: fixes made on 2026-10-22 and the second run

#### Corrections to the report above (found while fixing)
- **H4 (performance) is mostly harness.** A CPU profile of one 90-day burst (burst 23 replayed with the fixed engine) shows 35 s of CPU in a run that took 4 minutes wall-clock: `drive.mjs` re-runs the whole burst from the start after each model call it has to answer, so a burst with 12 calls is run 12 times. The engine's own hot spots are small (elections 2.5 s, zod parsing 5 s, `isEligibleFor` 1.4 s, `stepsFromCapital` 1.4 s). No engine change was made for it.
- **M1 is half right.** A hired host does pay a bounty out of the treasury (51,750 for 3,000 men in a test). What was wrong is that the army's monthly pay did not grow with its men (26,000 before and after). Fixed as below.
- **L5 (doubled "X writes:") is a game bug**, not the harness: `withoutWrites` in `letter-voice.ts` only stripped names made of capitalised words, so "Leptines of Syracuse writes:" was never stripped.
- **L1 is by design**: "Life has been going well ... nobody wishes him harm" is `readPersonalTension`, the person's own comfort ("the country's comfort is not his"), not a statement about the country.
- **M3's double storm needs two storm acts the same day** (the player's answer at the breach and a `siege_lay` with `assault`); I gave both, as in the 16 Oct run. The guard below makes it harmless anyway.

#### What was changed (all in `packages/sim/src`)
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

#### Second run (`eval-out/hieron-run2/`), same character and goals, played to 28 Feb 267 BC (day 1095, 18 bursts)
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

#### H2 fix and third run
Root cause found: nothing in the engine ever raised `controlFirmnessBps` of ground taken (at most 3,000) or surrendered. `reviewPowers` grows a province's yearning for its old master by 400 a month while firmness is under 5,000 (plus 300 under low stability), and shrinks it only at 7,000 and over, which was unreachable, so every absorbed province rose about fourteen months after its surrender whatever its holder did.

Change (`polity-end.ts`): ground that still wants its old master now settles, +250 firmness a month while its stability is at least 4,000, +250 more with a force of the holder's own in the province (and stability at least 2,500), up to 7,500. Misery and unrest do not settle it, so a starved, disordered province still rises. Test `absorbed-ground-settles.test.ts` (the quiet-hold case fails without the change).

Third run (`eval-out/hieron-run3/`, same orders as run 2 through Oct 269, then plain bursts unattended): Messana is still Syracuse's at 28 Jul 268 with firmness 7,500 and no Mamertine rising, where runs 1 and 2 lost it. The world then diverged: Carthage declared war in Jan 268 "as 'Carthage to Kingdom of Syracuse: an ultimatum' had said it would if no answer came". The new alarm stopped burst 12 on it, but my loop did not answer the ultimatum, so Syracuse ended with 6 provinces; that is my inattention in an unattended loop, and the ultimatum sat in "letter to answer" for the burst before. Full-suite check: 8 failures, 7 timeouts that pass alone and the unchanged `a-turn-spends-few-calls` assertion.

#### Ultimatum and truce alarm
New `packages/sim/src/deadlines.ts`: an `ultimatum` or `tribute_demand` awaiting the player's power, and an active `truce` within 30 days of its `untilStep`, are deadlines. A burst stops (`salient_event`) when one arrives, and `BurstResult.deadlines` lists every open one soonest first with its day and what follows (`onRefusal`); `consul-run.mts` prints `DEADLINE ...` lines. Replaying the third run (`eval-out/hieron-run4/`): burst 12 stopped on 25 Nov 269 BC with "DEADLINE ultimatum from Carthage ... due 4 January 268 BC (else war)", forty days before the war the unattended run had missed. Tests: `deadlines.test.ts`.

<a id="2026-10-22-hannibal-gisco-3y-hand-run"></a>

---

## Three-year hand run as Hannibal Gisco of Carthage: three goals, the bugs, the Chronicle

Date: 2026-10-22. Branch `chronicle-order-truth` (HEAD `446885b`, working tree as found). Nothing under `packages/` or `apps/` was edited. Run files are in `eval-out/carthage-run/` (a copy of `eval-out/player-run/`; `player-run` replaced in `go.sh`, `loop.sh`, `drive.mjs`, `compose-player.mts`; the default seat set to `hannibal-gisco`; the `COGWATCH` letter test in `drive.mjs` changed from "by Hieron II" to "by Hannibal Gisco"). This report is the only file added to `docs/`.

### What was played

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

### Goals

Written to `eval-out/carthage-run/goals.md` before the first burst. **Goal 2 was set before I had seen the fleet's size**, so its numeric bar is trivial (110 ships on day 0, my fault; I did not move it afterwards).

| # | Goal | Result |
|---|------|--------|
| G1 Military | Keep every Carthaginian province in Sicily, no lost field battle or city, and stand at Messana before Rome does | **Met on holdings, partly on Messana.** Carthage held 261 provinces at day 535 and at day 1,125 (32 of them Sicilian); no battle, no siege, no war involving Carthage at all. The fleet lay in Messana's province from 30 Apr 270 and Rome never took the city. But the garrison I wanted there never came: Hasdrubal did not march, and my marines order destroyed the fleet's organisation (H1). Rome keeps a consul's army in the "Uplands of the Sikeloi", Sicilian ground, the whole run. |
| G2 Economic / fleet | 60+ warships, treasury never in arrears, no debasement | **Met on the numbers**: 110 + 5 = 115 warships at the end; no arrears or debasement fact for Carthage in `facts.jsonl`; `carthage-treasury` 53.6M at day 1,000 and 56.8M at day 1,125. The fleet's own war chest vanished with the force in burst 24 (not found among accounts afterwards). |
| G3 Diplomacy | No Roman war on Carthage by day 1,100; bind Syracuse by a pact | **Met.** No war with Rome (the Rome-Carthage trade pact of 279 stands). The Syracuse pact (non-aggression and trade) was accepted and ratified in Sept 269. I also made an alliance with the Mamertines that I did not plan as a goal (the fleet was the thing I could offer). The engine nevertheless records all three treaty undertakings as **broken** (H2). |

**End state (day 1,125):** Carthage at peace with everybody, 261 provinces, treasury 56.8M; Syracuse 17 provinces and an alliance with Massalia "against Carthage" (burst 13), a 3,000-man army and 35 ships; the Mamertines (9 provinces, 1,400 men, allied to Carthage); Rome 73 provinces, 11.2M, its army still on Sicilian ground. My purse 4,970.

### Timeline

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

### High

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

### Medium

**M1. A stale or flipped order record.** After H1 the first order reads "failed" in the Chronicle's order lines for two bursts, though the fleet had done it. In burst 2 and burst 25 an order produced facts but no `order:` / `under way:` line; in burst 24 none either. The player cannot tell whether such an order is done, failed or lost.

**M2. Orders sometimes print no outcome.** Bursts 2, 24 and 25 printed no `order:` line. In burst 2 the fleet-movement order printed only the fact "Hannibal Gisco took the Carthaginian fleet ..." and a project-complete fact two lines down.

**M3. The player is told a refusal was "done, beyond his authority" and nothing more.** Four `authority_breach` facts (days 90, 215, 535, 715) and four orders annotated "beyond his authority", with no cost visible: the refusal to the Campanians went out "in the words of Himilco" and the letters to Mettius and Hieron were ratified by the Council. A new player cannot tell whether going over the government's name has a price. The wording "Hannibal Gisco set 'Five new warships ...' going on the pay chest of the Carthaginian fleet without leave to spend it" (burst 19, repeated in every later "under way" line) reads as an audit finding but the ships were built anyway.

**M4. A request to a general leaves no trace of the answer, and the general cannot be named.** "Ask Hasdrubal ... to march it to Messana": "nothing came of it" in the burst (9) and the stalled lines persist to the end (`under way (stalled)` printed in bursts 9-14 twice, once as my order and once as an auto-made "pursuit": "Ask the Punic army in Sicily to march to Messana. -- An intention only: nothing is being done about it"). The player is not told whether Hasdrubal refused, never saw it, or took it as a favour not owed. His character id is not printed in the order prompt either; I had to address the force (`recipientRef: force`).

**M5. A counsel line contradicts the prompt it sits in.** Mettius' prompt (burst 7) prints "They want: Hold Messana", "worried about no ally of their own: high", "it means to seek a protector before Syracuse closes on the city" and, under the letter, "What your interests and nature say: **no (no quarrel of ours)**". I followed my own judgement against it, with a reason. Hieron's prompt for the pact (bursts 14-15) printed **no counsel line at all** under "Letters awaiting their answer", so I decided from his stated nature.

**M6. A fleet's arrival is trespass, with no consequence told.** Burst 2: "Carthaginian fleet, an army of Carthage, entered North-eastern coast of the Sikeloi without leave from Mamertines of Messana, whose land it is." That is the fact for a 110-ship fleet anchoring in an unallied harbour. Nothing followed and a month later Mettius asked it to stay.

**M7. Fact and order outcome disagree.** Burst 17: `order: ... already so when ordered` and, in the same burst, `[60] movement: Hannibal Gisco brought the Carthaginian fleet into the harbour of Messana`, and `[55] promise_broken ... will shelter Messana` (H2).

**M8. Rome's army stays on Sicilian ground and the player is never told why or what it does.** Every year the Senate "settled the provinces ... to the army in Uplands of the Sikeloi", with 800-1,000 men "laid up" by sickness each summer, and "Rome's Allied contingents ... short rations ... in the depth of winter", but the player sees no army line for anyone but themselves and no warning that the force sits within a march of the allied city. This is part of the world, not a defect, but it is the kind of thing a player needs to know.

### Low

- **L1.** "Ugly stories about Hannibal Gisco are going round, and people are repeating them" (20 Mar 269 and again 13 Feb-15 Mar 268, same words) and a poison plot "traced to Hanno of Carthage" (the commander in Sicily) concern the player or his state; the player gets no cause, no option, no one to answer.
- **L2.** Himilco names "Hannibal the Barcid Admiral of the fleet of Carthage" in March 270 while the player, Hannibal Gisco, commands the only fleet; the burst never explains the second admiral.
- **L3.** The same fact is printed twice in a burst (e.g. four contingents "on short rations" listed twice in a thread, four duplicate "government: The Marshals has been organised" lines in burst 11).
- **L4.** `compose-player.mts` period lines always start at 1 Mar 270 and end at today's date (the composer takes the earliest carried fact); every passage window is "1 March 270 BC - <today>".
- **L5.** A promise is told as "has not yet kept ... will not make war" (burst 22 passage) though no war is on the record.
- **L6.** Fleet cohesion drops to "raw" after a rename/reform (H1).

### The Chronicle outputs

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

### As a player

- **I could not see what I commanded or what stood near me.** The army line names my fleet and its quality ("steady", "raw") and nothing of numbers; I learned "110 ships of 120 on the books" only from the order prompt (the harness prompt, which a web player may not see), the strength of my allies and of Rome near Messana never. I saw Rome's consul assigned to "Uplands of the Sikeloi" every spring and had no way to ask where that is.
- **No letters or warnings for the things that mattered.** Syracuse's alliance with Massalia against Carthage (burst 13, 18 Jul 269) was a fact of 60 in a 35-fact burst. A treaty undertaking "overdue" (burst 16) was a fact of 30 and became "broken" a month later (burst 17), which I read only after the fact.
- **"Done, beyond his authority"** (M3) and **"nothing came of it"** (M4, burst 9) leave me guessing: was the letter sent? was the general asked? What did it cost me to speak for the government?
- **Hidden losses.** The loss of my fleet's identity (H1) shows as one fact and one changed army line, not as a failure of the order.
- **The five warships' completion** shows only as a second line in the army list ("Five new warships of the fleet ... raw"); the order stays "Partly done" to the end of the run.
- **Gaps I felt as a player**: no money line (treasury, chest, purse) in the burst output; no way to see which of my orders is still in force; no sense of what the Council of Elders or Himilco think of me beyond "ugly stories".

### What worked

- **Letters and treaties bind**: a letter from a man without authority over the state was accepted by the Mamertines, ratified by the Council of Elders with a printed vote (78 to 1; 78 to 4) and recorded as an active alliance / non-aggression, and both counterparts answered in character.
- **The harness stops on what needs an answer**: `NEEDS ANSWER` on a cognition prompt for a power holding my letter (COGWATCH) worked for Mettius and Hieron; letters to answer and deadlines were printed with their due dates (`letter to answer [message-consul-1-492] ... answer due 10 July 270 BC`).
- **My mistakes were reported, not swallowed**: "dropped to keep the answer: deltas.0 ... Invalid option" (burst 3), and the engine asked again with "An earlier answer did not carry this out" (burst 18, my first `force_reinforce` for ships).
- **The war/peace/election machinery stayed quiet and consistent for 1,125 days**: no world-load failure, no crash, 26 bursts of 5-8 model calls each, 135 files of answers/prompts for 114 cognition and 12 orchestrate prompts. The first burst took 21 s wall-clock; I did not time the others.
- **A shipbuilding project can be set up by hand and delivers a force** (5 ships by burst 21).

### How far to trust this run

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

### Files

`eval-out/carthage-run/`: `goals.md`, `log.md` (all 26 bursts), `facts.jsonl`, `state.json` (day 1,125), `a1.mjs`-`a9.mjs` (order answers), `chronicle/burst-{1,2,5,8,11,15,19,22,26}.md` and the prompts/answers beside them, `g.sh`, `carry.mjs`, `pend.mjs`.

### Verdict

- **Goals met:** 3 of 3 on the numbers (all Sicilian holdings kept and no war; 115 ships and no arrears; no Roman war and a ratified Syracuse pact), but G1's Messana garrison never came and G2's bar was set before I knew the fleet's size.
- **Worst bug:** H1, a "land marines" order dissolved the 110-ship fleet into a "garrison" force and flipped the earlier order to "failed" (partly my badly shaped answer); with H2 close behind (every treaty clause "to do", broken by the head of government at its review day).
- **Chronicle as a record of this reign:** readable and well-formed passage by passage, but only partly a record of *this* player: it told the treaties and the sailing and then filled its pages with other powers' elections and audits, and it carried 961 untold facts, among them the Syracuse-Massalia alliance and the plot against Himilco.

### Addendum: fixes made on 2026-10-22 after this run

| Item | Change |
|---|---|
| H1 fleet drawn into "marines" | `apply/apply-deltas.ts` `force_create` from a force: when the source holds only ships and the order asks for land troops (or the reverse) it now refuses ("... holds no infantry to give: it is made up of warships"); men are drawn only of the kind asked for. Test `a-fleet-is-not-drawn-into-marines.test.ts`. |
| H2 treaty promises | `apply/apply-deltas.ts`, treaty undertakings: `form` is read from the words (`promiseFormOf`, so "will not make war" is a refraining, kept by holding back) instead of a hard-coded `"do"`; a duty written "other" that is plainly a sheltering or aid becomes `protection`, which the record can show as kept; the promisor is the man who signed where he commands that power's men (the admiral whose fleet shelters the city), else the head of the government. Test `a-treaty-promise-is-kept-by-who-can.test.ts`. |
| H3 burst report led by other powers' news | New `report-facts.ts` `factsForPlayer` (what touches the player personally, then their side, then their campaign, then the rest, each by weight); used by `scripts/consul-run.mts` and the `player-run` template. Test `report-facts.test.ts`. The web path does not print a top-25; whatever it prints can use the same function. |
| M2 one-part orders printed no outcome | The consul-run scripts print the part's line when the engine's own list is empty (the game answers a done one-part order with its passage; a hand run has none). |
| M4 order and its "pursuit" listed twice | `shared/src/authority/under-way.ts`: a pursuit whose `order` text is an order already listed is not listed again. Test added to `under-way.test.ts`. |
| M5 counsel | `letter-verdict.ts`: a power whose government names "no ally" as a high worry is no longer counselled "no quarrel of ours" to a protector's offer; a pact not to make war (`non_aggression`) now has counsel. Test `a-lonely-power-takes-a-protector.test.ts`. |

Not changed: M1 (an order whose force no longer exists reads "failed": rare once H1 cannot dissolve a fleet), M3 (what "beyond his authority" costs: a design question), M6-M8, L1-L6 and the Chronicle's repeat of carried facts (L3, M-Chronicle): none fixed in this pass. A second playtest prompt is in `docs/playtests/hand-playtest-prompt.md`.

<a id="2026-10-22-statius-mettius-3y-hand-run"></a>

---

## Three-year hand run as Statius Mettius, Leader of the Mamertines (Messana): playable, with caveats

Date: 2026-10-22. Branch `chronicle-order-truth` (HEAD `446885b`, working tree as found, including the uncommitted `apply-deltas.ts`). Nothing under `packages/` or `apps/` was edited. Run files are in `eval-out/mamertine-run/` (a copy of `eval-out/player-run/`; `player-run` replaced in `go.sh`, `loop.sh`, `drive.mjs`, `compose-player.mts`; default seat `mamertine-spokesman`; `COGWATCH` letter test now "by Statius Mettius"). My running notes are in `eval-out/mamertine-run/notes.md`; the burst log is `log.md`, goals are `goals.md`. This report is the only file added to `docs/`.

Seat: **Statius Mettius** (`mamertine-spokesman`, polity `mamertines`), 35, "bold, vengeful", leader of the city of Messana. Not played by earlier reports (Roman consul Genucius, Hieron II, Hannibal Gisco). Played **1 March 270 BC to 8 March 267 BC (1,103 game days), 58 bursts**. Everything the player sees is the burst output plus the Chronicle; I broke that rule in the places listed under "How far to trust".

### 1. Is the game playable?

**Verdict: playable with caveats.** A person with only the burst output and the Chronicle could give orders, write letters, go to war, win a field battle, lose and recover a siege, and see most of the consequences, over three years. They could not play it *well* or always understand why something happened. The three reasons that decide it:

1. **The core loop works and is legible where it matters.** Orders that the engine can carry out say so, with the right consequence: the Assembly votes the money for ships and a depot (`order: ... under way ... carried, The Assembly of the Mamertines carried "Motion of Statius Mettius: that 122120 be spent ..."`); a war declared on one's own word is marked `done, beyond his authority` with `act_usurped` [80/70], `peace_broken` [65] and `alliance_refused` [55] facts, and later a refusal to open the chest ("until it has forgiven him"); a field battle gives casualties, the wounded commander and the taken camp; a `player_decision` stops the burst; a `DEADLINE` line was printed twice for an ending truce; `letter to answer` lines list letters.
2. **The player is blind to the things they most need to act on.** The burst output never gives the strength of one's own army (I only saw "4400 men", "6356 fit" in the order status line the Chronicle prompt carries, and by reading prompts); it does not say what a `letter to answer` says (Rome's protest and warning, the Syracusan truce); it does not print Rome and Syracuse "leagued together against Mamertines of Messana: a war on one is a war on all" (only the Chronicle did); and it lists letters as answerable days before they arrive, then refuses the answer (B1). In 58 bursts the top-25 fact list led with illnesses, lustra and elections far more often than with anything about Messana.
3. **Several outcomes are wrong or false without saying so.** An order to write to Rome was read as "buy bread for our garrison" and reported "done" (B2). Facts attached to a refused answer still enter the record (B3). A truce "renewed" by letter is recorded as lapsing on its date (B4). The same decision was asked three times before it did anything (B5).

What a new player could not do: read their own army and treasury; know what a letter says without opening engine state; know whether a "done" order did what it said; choose a battle manoeuvre (the one that won the battle, `storm_camp`, is not a player option: the decision menu said "fight-fight: Offer battle" and, twice, did nothing); tell why the Chronicle's choice of facts left out the letter that mattered.

### 2. What was played

Goals were written before burst 1 (`goals.md`), numeric bars after burst 1 (garrison 1,400 men, treasury 763,607, purse 21,000, income ~77,500 a month, no ships, no ally).

| # | Goal | Bar | Result |
|---|------|-----|--------|
| G1 Military | Hold Messana and its provinces to the end; garrison never below 1,000, ideally 3,000 | Messana held at day 1,103; garrison 6,356 fit (up from 1,400) | **Met.** Held 13 provinces (9 at the start; 4 taken from Syracuse). Won one field battle (day 678), failed to hold a siege (day ~692), but lost nothing. |
| G2 Economic / fleet | 3,000+ hired men and 10+ ships by end of year 1; treasury above 300,000 | Men 4,400 by day 330, 6,356 by day 1,026; 10 warships complete day 270; **treasury 223,396 at the end (from 763,607)** | **Half.** Men and ships met (ships ahead of the year-1 date). The treasury bar was missed: 763k to 223k after the fleet (122k), two depots and bread votes, 6,000 mercenaries, and unfunded war. |
| G3 Diplomatic | An alliance or protection from Rome or Carthage by end of year 1; failing that, a truce with Syracuse | Truce with Syracuse day 412 (non-aggression, accepted); **alliance with Carthage day 712** (a year late); Rome refused three times | **Met late.** The Carthage alliance came only after I went to war and Carthage had its own war with Syracuse. |

Orders given, 58 bursts, about 40 orders (letters to Rome x4, Carthage x4, Syracuse x6, a protest answered; hires of 1,500 + 1,500 + 2,000 + 1,000; ships; grain depot; war on Syracuse; marches on three provinces; siege of Syracuse; offer of battle x2; walls; recall of the garrison; truce renewals). I wrote 33 `simulate_orchestrate` answers and 10 `simulate_cognition` answers by hand (see section 7).

Dated timeline (days from 1 March 270):

| Date (BC) | Day | What happened |
|---|---|---|
| 2 Mar 270 | 1 | Letter to Rome for alliance. Rome "refused by silence" on 16 May (my stub, see section 7). |
| 7 Mar 270 | 6 | Hired 1,500 mercenaries. |
| 16 May-Aug 270 | 76-170 | Letter to Carthage and a letter to Hieron; both unanswered because **I had lost `COGWATCH`** (harness failure, see B0). |
| 14 Sep 270 | 197 | Roman army takes Rhegium; Roman and Italian armies stand in "Uplands of the Sikeloi", starving. |
| Dec 270-Jan 269 | ~270 | 10-ship fleet complete; Carthage refused (Himilco, counsel "no"); Rome refused again (counsel "no"). |
| 24 Feb 269 | 360 | Rome's new consul Messalla refused (day 387). |
| 20 Apr 269 | 412 | Hieron accepted non-aggression and truce (my hand). |
| 13 Sep 269 | 562 | **I broke the truce and declared war on Syracuse** and marched on Sicelia on the Adranios (taken without a fight; later Sicelia on the Symaethus and Syracusia on the Amenanus). |
| 7 Nov 269 | 617 | Rome's protest "leave them be" (first letter to answer). Answer refused the first time: letter not delivered (B1). |
| 10 Dec 269-1 Jan 268 | 650-672 | Garrison before Syracuse; armies face; garrison out of bread. **Player decision** ("fight-fight"); asked 3 times. |
| 1-11 Jan 268 | 672-682 | **Battle**: "holds the field ... Syracusan army is beaten", 920 against 643 casualties; Hieron wounded; his camp taken. |
| 11-21 Jan 268 | 682-692 | Siege of Syracuse laid and lifted in the same burst; second battle inconclusive (550/591). Order line `failed`. |
| 10 Feb 268 | 712 | Carthage accepts alliance against Syracuse (against its own counsel, see B6). Rome warns (40 days). Syracuse asks for a truce. |
| 24 Feb 268 | 726 | Truce with Syracuse accepted (after a failed attempt 14 days earlier). |
| 16 Apr 268 | 776 | Hieron refuses peace (counsel "no, not beaten"). |
| 22 Aug 268 | 898 | Truce lapses (B4); war with Syracuse not resumed. 30 Aug 268: Carthage takes Eastern Syracusia after 123 days and makes peace with Syracuse. |
| 9 Oct 268 | 948 | Raising walls refused: "The Assembly ... will not open the public chest to Statius Mettius, who did what it had not allowed". |
| 4 Feb 267 | 1,056 | DEADLINE: truce ends 2 March. Extension asked, accepted, then lapses (B4). |
| 8 Mar 267 | 1,103 | End. Mamertines 13 provinces, garrison 6,356, 10 ships, treasury 223,396; Syracuse 11 provinces. |

### 3. Bugs, by severity

#### High

**B1. A letter is listed as awaiting an answer days before it can be answered, and its text is never shown.** Two bursts (31 and 41) printed `letter to answer [...] protest from Roman Republic: Roman Republic complains to Mamertines of Messana, answer due 12 January 268 BC` and (burst 40) the same for a Syracusan truce and a Roman warning. Answering them was refused by the engine: `"Roman Republic complains to Mamertines of Messana" has not reached Statius Mettius yet: it arrives in 6 day(s)` (burst 32); `"Kingdom of Syracuse asks for a truce" has not reached ... it arrives in 2 day(s)` and `... Roman Republic demands satisfaction ... arrives in 18 day(s)` (burst 41). The output lists only a subject; the body ("We require that you leave them be, for the appeal of Syracuse against the Mamertines. You have 40 days.", the six-month truce terms) is not in the burst output or in the `simulate_orchestrate` prompt; I read it from `state.json` (my deviation, flagged in section 7). A player cannot answer a letter they cannot read, and cannot answer one that has not arrived. This hides what the player needs and made two answers fail. Not traced to a file: the list is built from `status: awaiting_reply` messages, the delivery gate (`deliveredOnDay`) is a separate test.

**B2. An order was reported "done" for something it did not do.** Burst 20, order: `Write to Gaius Genucius, consul: Messana will sell grain to the Roman army in the uplands of the Sikeloi, and asks Rome's friendship in return.` The engine resolved it without a model call, read "grain" as provisioning our own garrison, and printed: `order: "Write to Gaius Genucius..." -- done: the vote passed: carried, The Assembly of the Mamertines carried "Motion of Statius Mettius: that 23049 be drawn from the chest ... for the bread of Mamertine garrison"`. No letter was sent, nothing was sold. The motion "begins nothing by itself" (the Chronicle's own words, burst 20), and the votes of 23,049 and 23,221 for bread never bought a loaf: the garrison "has eaten the bread it carried" at Syracuse at burst 35. A player is told twice that bread was voted, and the army starves anyway.

**B3. Facts of a refused answer still enter the record as true.** Burst 41: both of my answers (accept Syracuse's truce, answer Rome's warning) were refused (`order: ... -- refused: ... has not reached Statius Mettius yet`), yet the burst has `[70] diplomatic: Statius Mettius accepted Hieron's offer of a six-month truce between Messana and Syracuse.` and `[60] ... answered Rome's warning`. These came from my hand-written `facts` array, so the harness is part of the cause, but the engine kept them although it refused the deltas, and the Chronicle's thread then told the false acceptance as fact (burst 41, "Known to have happened"). A real model answer carries the same risk.

#### Medium

**B4. A truce "extended" by letter is still recorded as lapsing on its date.** Burst 51: `Hieron II agreed to renew the truce with Messana for six months`; burst 52: `[55] agreement_lapsed: The truce between Mamertines of Messana and Kingdom of Syracuse has run out.` Burst 57 printed `DEADLINE truce_ends ... due 2 March 267 BC`, burst 58 `agreed to extend the truce` [65] and `agreement_lapsed` [55] again. The `WARS` summary no longer listed the war afterwards, so peace persisted, but the record claims the renewal was accepted and then claims the truce ended. The `DEADLINE` for the truce is also printed again after the renewal was accepted (burst 51). I answered with `agreementKind: "truce"`; I did not check whether an `agreement_open` was needed.

**B5. A player decision does not decide the battle, and is asked again.** Burst 35 stopped on `player_decision`: `fight-fight: Offer battle | fight-refuse: Hold out | fight-fall-back: Fall back by night`. After `--decide fight-fight` the burst ran 0 days and stopped on the same decision (burst 36); again after another `--decide` it needed a third answer, in which I wrote `manoeuvre: "storm_camp"` and the battle was fought (burst 37). The model's prompt says "Carry out that answer. Do not ask it again.", but `force_engage` posture `offer_battle` on an already-engaged pair had no effect. The player has no way to name the manoeuvre. The decision text also says "You are the stronger" with no numbers.

**B6. The "counsel" for a letter can contradict its own prompt.** Himilco's counsel on the alliance against Syracuse (burst 39) said `no (no quarrel of ours)` in a prompt that also said `Their power is at war with Kingdom of Syracuse [syracuse], and has been for 0 days ... it goes well for them (more men under arms (7910 to 1847))`. Hieron's counsel (burst 52) was `no (not beaten)` on a Carthaginian peace offer on the same day the burst reported `peace_made ... Syracuse is beaten`. I went against Himilco's counsel with a stated reason; the second one I left alone.

**B7. Move/hire orders print no `order:` line.** The hire orders (bursts 3, 19, 39, 56), the marches (30, 31) and a recall (48) produced only a fact (`Statius Mettius hired fifteen hundred mercenaries ...`) and no `order:` line; letters answered in the same burst print only `letter_answered` [35]. Where the line exists it is useful; its absence means a player cannot tell "done" from "ignored".

**B8. The siege order says `failed` and the facts say it was laid, then lifted.** Burst 38: `order: "Lay siege to Syracuse with the Mamertine garrison" -- failed.` with no reason, beside `[55] siege_laid`, `[50] siege_lifted ... Mamertine garrison is no longer before its walls`, and `[28] province_occupied: ... Syracusia on the Kakyparis`. The cause (the Syracusan army came back and fought a drawn battle, 591 of my men lost) is only in the battle fact. The garrison had fallen from 4,203 to 2,639 fit men in 14 days and the output never says so.

**B9. Hiring bypasses the chest rule that blocks building.** After the usurpation the Assembly "will not open the public chest ... until it has forgiven him" (burst 54, walls refused). In burst 56 a hire of 1,000 mercenaries went straight through. Either the rule or the hire is wrong; the player is not told how to be forgiven or when.

#### Low

**B10. Noise leads the fact list.** Burst 1: 50 facts, about 25 are `takes his seat as Roman senator`. Burst 5 and 7: seven `closed the lustrum` facts at 45; elections of `Commander of horse` and `Roman quaestor` at 60 lead bursts 43, 52 and 58; illnesses of unknown chiefs at 65 lead most bursts. `audit ... mechanic_refused generic_entity_create (...): entity-consul-4-513` and `audit reference campaign_plan_set (gaius-genucius): No army "campanian-legion" exists` print raw ids to the player.
**B11. The `army:` line has no strength.** `army: Mamertine garrison at sic-q659z`, a raw province id, no men, no morale, no bread (burst 1 onward, 58 times).
**B12. Wording.** `Statius Mettius, Leader of the Mamertines, the non aggression with Kingdom of Syracuse be ended on his own word` (act_usurped, burst 27) is a broken sentence; `Carthage ... sends ... of Carthage` ("to Hanno of Carthage of Carthage"); duplicated lines in one thread (same `order waits` fact twice, burst 25); the same `Famine`/`short rations` facts re-told for months.
**B13. A letter from Rome is attributed to `rome-pontiff-34pgj7`**, and Messalla is `rome-augur-1j0j03` in id though "roman-consul" in office; a player cannot address an envoy by id and I had to look up two ids (Himilco and Messalla).

#### Failures that are mine, not the game's

**B0. Harness: `COGWATCH` lost.** I exported it in one shell call and the shell state did not persist, so from burst 2 to burst 14 every cognition prompt for Rome, Hanno and Hieron was auto-stubbed `{"actors":[]}`. The "refused by silence" results for my first three letters (Rome day 1; Carthage day 76; Syracuse day ~267: `diplomatic_silence`, `under way (stalled): ... Nothing came of it.`) are artefacts of that, not game behaviour. I fixed `go.sh` at burst 14 and re-sent the letters.
Other slips: I ran an accidental 1-day burst (burst 10, `--span 0`); I skipped the Chronicle after 38 of the 58 bursts (see section 4); I left one Chronicle prompt unanswered after burst 25; I once wrote a sentence in a Chronicle passage that the thread did not support (refused by Rome and Carthage, burst 18) and removed it; I read `state.json` and `st.mjs` a few times (section 7).

### 4. The Chronicle outputs

I composed the Chronicle for **20 of 58 bursts** (13, 14, 18, 19, 20, 22, 23, 25, 26, 27, 34, 37, 38, 40, 41, 44, 45, 52, 56, 58). I did not compose after bursts 1-12, 15-17, 21, 24, 28-33, 35, 36, 39, 42, 43, 46-51, 53-55, 57 (mostly small bursts, but 29, 39, 43, 46, 47, 55 and 57 had 18 to 111 facts; my omission). The number of passages per burst was small: 2 to 6, from 11 to 263 facts; "facts carried" in the header grew from 33 (burst 13) to 728 (burst 58) without the passages growing.

Three passages, verbatim, as composed (my prose from the thread's "Known to have happened" lines, through `compose-player.mts`):

> **Messana goes to war** (burst 27): "Statius Mettius broke the truce with Syracuse and declared war on Hieron II, marching the Mamertine garrison on Sicelia on the Adranios. He did it on his own word, without the Assembly, and the city holds it unlawful: his colleagues, the tribunes and the senators will not forget it, the Assembly will vote him nothing for it, and he will answer for it when his office ends. The city is in uproar, and every power that deals with Messana has seen what its word is worth. ..."

> **The day at Eastern Syracusia** (burst 37): "The Mamertine garrison went at the rampart of the Syracusan camp to take by storm the battle it would not give, held the field, and beat the Syracusan army: 920 casualties to the Mamertines, 643 to Syracuse. The Syracusan commander was wounded, and so was Hieron II. The Syracusan army came out of the day with its spirit failing, with the garrison still before it."

> **Rome and Syracuse league against Messana** (burst 45): "Rome wrote to Statius Mettius that all was not well between them and required that he leave Syracuse be ... he had forty days. ... But Rome and Syracuse have leagued together against Messana: a war on one is a war on all. In Rome and in Carthage alike they speak of Messana's growing power with dread: it has taken four provinces in a year, begun a war, and broken a peace. ..."

Facts told and carried per composed burst (headline, passages, "facts carried"): 13: 3 passages, 33 carried; 14: 5, 59; 18: 4, 47; 19: 2, 114; 20: 4, 316; 22: 3, 368; 23: 3, 402; 25: 3 (+1 unanswered), 419; 26: 4, 419; 27: 2, 422; 34: 2, 431; 37: 4, 435; 38: 4, 441; 40: 1, 443; 41: 3, 461; 44: 4, 461; 45: 6, 484; 52: 4, 486; 56: 5, 488; 58: 3, 728. The "carried" number is the whole record the composer was given, not the facts of the burst.

The five questions, over all 20:

1. *Does it say what mattered to this player in this burst?* Mostly yes when something happened to Messana: the usurpation and war (27), the battle (37), the siege failure (38), the Carthage alliance (40, but see below), the league against Messana (45), the truce (41, 44, 58). When nothing did, the passages were about Media Atropatene, the Semnones or the Lucanian contingents. In burst 40 (18 facts, two letters waiting: Syracuse's request for a truce and Rome's warning, each with a deadline) the Chronicle had **one** passage, about the Carthage alliance, and said nothing about the two letters. Burst 41's passage did say Hieron asked for a truce.
2. *Does it repeat headlines?* Two ways. Where the composer got nothing new it re-told old facts (burst 44: Hieron's truce request from burst 41 was re-carried; I returned `{"entries":[]}` and the composer then printed the raw fact headline as a passage: `## Hieron II wrote to Mamertines of Messana for Kingdom of Syracuse, asking for a truce  [narrated]`). And it re-told "short rations in the Uplands of the Sikeloi" and the Rome/Syracuse league in four bursts running.
3. *Are there raw ids?* In the passages, no. The tags line (`_tags: Roman Republic, Rhegium coast, ...`) and the `order status` lines contain ids in some prompts only. In the burst output yes (B10, B11, B13).
4. *Does it tell anything the player could not know?* The prompt marks unwitnessed facts `(word only, not witnessed)` and labels them as news that "reached the court" (good). It also marked the player ("the one whose reign this history is"). It told the Roman letter's text, which the burst output never gives (a gain for the Chronicle; a gap for the output). It told "4,400 fit" and "6,356 fit" from the order's status line, which the output does not show.
5. *Carried facts that should have been told?* Yes: the truce lapse [55] in burst 52 and 58 (the facts were carried but no thread took them); the Syracusan truce request and Rome's warning in burst 40; Carthage's war on Syracuse [70] (burst 40); the illness of, and plots on, the Roman and Carthaginian leaders were told instead.

Composer quirks: it adds "register" lines ("tell it with a straight face and a dry wit") to an order that was plain unlucky (burst 20: "gave orders to people who did not have to take them"). The false "accepted" fact (B3) was told as a fact in burst 41's thread.

### 5. As a player

What I could not tell from the burst output, and had to take from a prompt or from state:

- **Strength of my own army and treasury**: I never saw how many men I had. I knew 1,400 at the start and 2,900/4,400 after hires only because the orchestrate prompt and the order status lines carried them. The garrison fell from 4,203 to 2,639 fit in 14 days (battle and siege) with no line in the burst saying so.
- **What a letter says**: Rome's protest and warning, Syracuse's truce, the Roman "40 days". The output has `letter to answer [id] kind from X: subject, answer due D` only.
- **Whether a letter has reached me** (B1).
- **Why a counterpart answered as they did**: all cognition for powers I did not write to was stubbed, so Rome and Syracuse never moved against me. A real game would have had them move. I cannot say how the game plays when Rome and Syracuse use their "war on one is a war on all" league.
- **What "beyond his authority" costs.** The output says the city holds it unlawful; weeks later, a refused wall order says "until it has forgiven him". How long, how to be forgiven, or the effect on my own garrison's pay are not told.
- **What a player decision's options mean.** "Offer battle", "Hold out", "Fall back by night". No strengths, no supplies left, no consequence of "Hold out".
- **Where the enemy is.** I found the Syracusan army's location and strength only because the orchestrate prompt listed "Syracusan army - between 2,700 and 3,400 men at Eastern Syracusia ... about 80 km off". A player has "Syracusan army" in facts and nothing else.
- **Where my own provinces are.** I never saw a list of what I hold. The only way I learned "13 provinces" was by reading engine state.

### 6. What worked

- **Order outcomes where they exist** are honest and specific: `done, beyond his authority`, `refused: The Assembly ... will not open the public chest`, `nothing came of it: The province already answers to Messana`, `friction: ... the armies cannot meet in battle until one of them has marched to the other`.
- **The consequences of a rash act are legible and last.** The usurpation (burst 27) put one visible fact at 80, the Assembly later refused the walls (burst 54) with a reason naming the cause. A reasonable player would see: I did something the city dislikes and I will pay.
- **Alarms** fired and were useful: `DEADLINE truce_ends` 29 days before the end, twice; `letter to answer` lines; `player_decision`; the `salient_event` stop on the DEADLINE. 
- **The engine resolved some orders without any model call** (ships, depot) and routed money above the Leader's allowance through the Assembly, which then voted (122,120 for the fleet; 5,280 for the depot).
- **The war was real**: the field battle (920/643 casualties, camp taken, commander wounded), the failed siege, the Carthaginian conquest of Syracuse in 123 days with siege towers, a fleet fight and a storm that lost 11 ships. Syracuse's bankruptcy (taxes raised 4,581 of 192,000) and unrest in 11 provinces followed.
- **Order of the main chain**: letters, answers and `agreement` facts form a legible story (Rome no x3, Carthage no, then alliance once their own war began).

### 7. How far to trust this run

**Stubbed**: `write_mechanic` `{"mechanic":null}`, `reconcile_facts` `{"withdraw":[],"rewrite":[]}`, `repair_deltas` `{"deltas":[]}`; `simulate_cognition` `{"actors":[]}` for every power I did not write to. So Rome, Carthage and Syracuse took no initiative against Messana by cognition (they acted by engine rules only: the Carthaginian war on Syracuse, the Roman protest and warning, the Syracusan appeal to Rome did happen). A run with real cognition might see Rome or Syracuse attack Messana; mine never did. For about the first 14 bursts, **even the powers holding my letters were stubbed** (B0).

**Auto-filled**: `voice_letters` by `autoletters.mjs` (all letter bodies; the Roman protest's text is `voicedByModel: true` in state, filled by this harness).

**Hand-written, by me**:
- **33 `simulate_orchestrate` answers.** They match each order's words; where I added a manoeuvre (`storm_camp`, burst 37) or an agreement kind, I flagged it. Six had `facts` I wrote (the fact leak B3 is partly mine). Two orders were answered with a friction and no deltas, because the thing could not be done.
- **10 `simulate_cognition` answers**: Rome (Genucius, counsel "no", followed), Hanno (no counsel printed; countered, "send envoys to the suffetes"), Himilco (counsel "no", followed), Messalla (counsel "no", followed), Hieron (no counsel printed; accepted non-aggression, my reason: cautious, no clear superiority), Himilco again (**against** counsel, reason stated: Carthage already at war with Syracuse), Hieron (counsel "no, not beaten", followed, peace refused), Hieron (no counsel; accepted a truce renewal; reason: losing to Carthage, famine), Hieron (new truce, same reason), Hieron (extension; reason: bankrupt, eleven provinces restless). **Hieron accepted three truces and one non-aggression pact on my own reasoning** (no counsel); this is the main place where my hand shaped Syracuse's behaviour. Rome and Carthage refused four times on printed counsel.
- **The Chronicle**: 20 of 58 bursts, all prose mine from thread facts (one slip corrected; one prompt left over from burst 25 composed later).

**Deviations from "know only what the game shows a player"**:
- I read `state.json` or ran `st.mjs` about eight times: for the suffete's and Messalla's character ids, for the province ids and controllers of Sicelia and Syracusia (the `[PLACES]` section printed some but not their holders), for the text of the Roman protest and warning and the Syracusan truce, and for the garrison strength at burst 38 and the end state at burst 58. I did not use `state.json` to decide strategy (I chose war and marches before reading it) but I did use it to answer the letters, which a player could not.
- The `simulate_orchestrate` prompt gave me the garrison's strength, the treasury, the neighbours and the "worried about" lines; I used them. A web player sees these as the order composer's prompt, not the burst output.
- I did not filter facts; I read the first 12 to 30 lines of each burst (the output cap I set was `head`), so lower-significance facts beyond line ~25 in each burst were not read by me directly. The log in `log.md` has them all; I read the lines after `[40]` only for bursts 20, 31, 38, 54 and 58, and a few others.

**Fact kinds I did not read**: the long tail below significance 40 in most bursts (`magistrate` / `lustrum`, `office_filled`, `government`, `group_formed`, `kit_bought`, `chamber_sat`, `public_works_let`), and `engagement_turning_point` details for foreign wars. I did not follow Roman and Etruscan internal politics (peculation, quaestor elections) beyond what the Chronicle composed.

**Not exercised**: **no battle was fought against Rome**, no Roman or Carthaginian attack on Messana, no naval battle of my own fleet (it never left port), no sack, no rising in my own provinces (`province_unrest` hit Syracuse, not me), no loan or debasement, no diplomatic marriage, no trade pact, and no `DEADLINE` other than the truce. The ultimatum / tribute alarms the last report added did not fire (nothing was demanded of me in tribute). The game was **not** played to a loss.

**Time**: bursts took from a few seconds to about 8 minutes; I did not record each. The run reached day 1,103 without a crash and without a burst that did not finish. The state file is 3 to 4 MB.

### 8. Verdict (three lines)

- **Goals:** G1 met (Messana and 13 provinces held, 6,356 men); G3 met a year late (Carthage alliance at day 712); G2 half (men and ships met, treasury fell to 223k against a 300k bar).
- **Worst bug:** B1/B2 together: letters are listed before they can be answered and never shown, and an order to write to Rome was read as bread for our own garrison and reported "done"; both hide what the player needs.
- **Chronicle:** it read as a record of this player's reign in the bursts where Messana acted (the war, the battle, the league) and as a record of other people's illnesses and lustra in the rest; it missed the two letters that most needed an answer in burst 40.

### 9. Fixes made after the run (2026-10-23)

Re-reading the bugs against the code showed some were not the game's:

- **B3 (facts of a refused answer) was my stub, not the game.** The game already has a reconcile step that takes back facts about a refused act; `reconcile_facts` is stubbed `{"withdraw":[],"rewrite":[]}` by the harness. No code change.
- **B7 and B10 (no `order:` line for hires and marches; noise at the top of the fact list) came from a stale copy of the run script.** `eval-out/player-run/consul-run2.mts` predated `scripts/consul-run.mts`, which already prints a line for every part (`lineOf`) and sorts facts with `factsForPlayer`. The `player-run` and `mamertine-run` copies are now regenerated from `scripts/consul-run.mts`.

Changed in code:

| Bug | Change |
|---|---|
| B1 letters | `scripts/consul-run.mts` lists a letter to answer only once delivered (`isDelivered`) and prints its terms. The web path already did the first. |
| B11 army line | The `army:` line gives the province name, men fit and morale. |
| B2 grain letter read as bread | `order-templates.ts`: a letter or offer ("Write to... sell grain to the Roman army") is no longer the supply template. Test added in `a-routine-order-needs-no-model.test.ts`. |
| B4 truce extension | `apply-deltas.ts`: a truce accepted over a running truce extends it to the later date (and tells it as a fact) instead of being rejected as "already stand in truce". Test `a-truce-is-extended.test.ts`. |
| B5 decision loop | `engagement-decisions.ts`: an attacker already refused for days who answers "Offer battle" storms the camp. Test in `battles-that-last.test.ts`. |
| B6 counsel | `letter-verdict.ts`: refusing an alliance against a shared enemy says "no trust enough to bind ourselves", not "no quarrel of ours". |
| B8 failed siege | `order-outcomes.ts`: a siege laid and lifted says the siege was raised before the city fell. |
| B9 hiring | `competence-gate.ts`: men bought for one's own power's army are refused to a man the chamber will not fund after a usurpation, as spending already was. |
| B12 wording | `usurpation.ts`: "ordered that war be made ... on his own word"; `apply-deltas.ts`: no "Hanno of Carthage of Carthage" in a letter's fact. |

Not changed: B13 (ids of letter writers are in the world's own names), the Chronicle composer's choice of facts (section 4: the letter in burst 40 left out), and the re-telling of old facts in later bursts. These need a design decision, not a fix.

Checks: `tsc --noEmit` clean for `packages/sim` and `packages/shared`. Full `packages/sim` run: 6 failures at the 60 s timeout, all but one pass alone; `a-turn-spends-few-calls` (a second `write_mechanic` call in a turn) still fails and was not touched by these changes; it may come from the uncommitted change already in `apply-deltas.ts`, which I did not verify.
