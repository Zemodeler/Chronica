# Triage: Codex hand-mode play-test (2026-10-02)

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

## Engine bugs

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

## Model guards

| # | Fault | Guard | Workstream |
|---|---|---|---|
| M1 | A 0-amount payment | Reject `money_transfer` with an amount ≤ 0, and drop invalid goals. | 1 |
| M2 | World tasks written as player order parts | Drop parts that have no acts of the order's own and do not match the order text; audit them. | 1 |
| M3 | Delegation to oneself; deciding an already-decided attempt | Drop the delegation, or carry it out as one's own act. Treat a re-decision as an ignored no-op that is never attributed to a part. | 1, 2 |
| M4 | A drill by a man with no command sets the whole army drilling | Refuse it in `nobodyListens`, or apply it to his own unit only. | 2 |
| M5 | `character_create` with an office label seats someone, bypassing `whoseToGive` | Judge it as an `office_seat_set`. | 2 |

## Logic gaps

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

## Workstreams

1. **Save integrity and the order ledger.** E1–E11, M1–M3. Covers burst.ts (order ledger), orders.ts, order-goals.ts, order-outcomes.ts, under-way.ts and plans.ts.
2. **Authority and requests.** E12–E15, M3–M5, L4–L6. Covers own-business.ts, whose-to-give.ts, nobody-listens.ts, misfiled.ts, a new requests.ts, and ranks.ts.
3. **The player as a person.** E16–E21, L1–L3, L7–L11. Covers elections.ts, standing, money, ventures, mechanics, family and nemesis.
4. **War and the state.** E22–E27, L12–L15. Covers passage.ts, enact.ts, command-tenure.ts, slice.ts, submission, storylines, marches and senate.ts.
5. **Chronicle, budget and hand mode.** E28–E31, L16–L18. Covers tick taxes, far-news.ts, the burst hop loop, cognition.ts and packages/ai.

The model-quality caveat in the report still stands: faults 13 and 16 should be re-run at medium
effort once workstream 5 lands. Several outcome-line faults were partly a weak model meeting a
strict schema; with the real schema passed to Codex, that class should mostly disappear.
