# Simulation speed: baseline and what each step bought

The numbers section 1 of `what-the-engine-cannot-do-yet.md` is measured against. Every later
step appends a section here and reports against the baseline; nothing is overwritten.

## Setup

- Working tree at `4a358a2` (`player-as-a-character`) with the branch's uncommitted work, plus
  the `repair_deltas` operation split out of `simulate_orchestrate` so repairs show on their
  own line. Nothing else in the engine changed before the baseline.
- Provider `openai`; no `.chronica.local-ai.json`, so every operation runs on the first entry of
  `CHRONICA_LOCAL_OPENAI_MODELS`: **gpt-6-luna**. Reasoning effort: `low` for every JSON
  operation, the provider default for `compose_chronicle` (`CHRONICA_AI_CHRONICLE_EFFORT` unset).
- Timeouts at their defaults: stall 30 s, cap 150 s, one SDK retry.
- Save: a fresh Punic Wars game, scenario **v28**, played as Gaius Genucius Clepsina (Roman
  consul), game `1e6e50cc-f415-4eae-811c-fd9e5221ef1f`, created and driven with
  `scripts/play-turn.mts` (the same path as `submitOrder`, without the browser session).
- Five fixed orders, each waited to settle:
  1. `Raise two new legions.`
  2. `Send an embassy to Hieron of Syracuse offering alliance against Carthage.`
  3. Wait a month (`--wait 30`).
  4. `Levy a special tax in Latium to pay for a fleet of twenty galleys.`
  5. `March the field army to Messana and relieve the Mamertines.`
- A fresh game diverges after order 1, so later runs compare in distribution, not turn by turn.
  Wall clock is `simulation_bursts.started_at` to `ended_at` (`scripts/burst-timings.mts`), which
  spans burst, Chronicle and commit. Per-operation seconds are the `[burst <id>] …` line;
  `(wall …)` is the span the operation's concurrent calls occupied, which is what the player waits.

## Baseline (before any change)

Recorded 2026-09-25 from `scripts/burst-timings.mts 1e6e50cc-f415-4eae-811c-fd9e5221ef1f 5`.

| # | order | wall | calls | rounds | stop | orchestrate | repair | reconcile | cognition (wall) | chronicle (wall) |
|---|---|---:|---:|---:|---|---:|---:|---:|---:|---:|
| 1 | Raise two new legions | 99.3 s | 13 | 2 | watch_condition | 40.3 s | 8.4 s ×1 | 2.3 s ×1 | 39.6 s (17.5) ×3 | 84.3 s (30.1) ×7 |
| 2 | Embassy to Hieron | 108.1 s | 17 | 4 | max_span | 10.8 s | 3.7 s ×1 | 1.6 s ×1 | ≈144 s ×9 | 5 calls, ≈20 s wall * |
| 3 | Wait a month | 91.5 s | 13 | 3 | max_span | 29.4 s | – | 1.5 s ×1 | 94.5 s (44.7) ×6 | 40.4 s (15.3) ×5 |
| 4 | Special tax in Latium | 118.9 s | 22 | 4 | max_span | 34.0 s | – | 5.7 s ×3 | 134.3 s (60.1) ×9 | 79.8 s (21.8) ×9 |
| 5 | March to Messana | 114.9 s | 27 | 4 | watch_condition | 27.3 s | – | 13.5 s ×7 | 151.0 s (68.5) ×9 | 53.9 s (12.0) ×10 |

\* Turn 2's `[burst]` line was lost to an output filter; its per-call figures are read from the
`[AI]` lines that survived and the burst row (17 calls, 108.1 s).

**Median 108.1 s, p90 118.9 s, worst 118.9 s.** About 0.02 coins a turn on gpt-6-luna.

**First Chronicle entry:** at the end of the turn, i.e. 91–119 s after the order (nothing is
shown earlier today).

**The D gate (repair + reconcile as a share of wall clock):** 10.8 %, 4.9 %, 1.6 %, 4.8 %,
11.7 %; median 4.9 %, and 6.9 % summed over the five turns. Below the 15 % bar, so step D
(overlapping repairs and reconciles) is **not built**. The share is small because `salvage.ts`
and `bare-refs.ts` already keep most answers out of repair (3 of 5 turns made no repair call at
all), and a reconcile call is one to three seconds.

**Where the time goes, in order:**

1. Cognition: 17–68 s of wall per turn, three shards a round, two to four rounds. The slowest
   shard of each round (18–24 s, 2 000–2 700 output tokens) sets the round's pace.
2. Orchestration: 27–40 s on every order (3 400–5 200 output tokens at low effort); 11 s only on
   the short embassy answer. Nothing can be shown to the player before it ends, so the earliest
   a window-0 entry can appear at today's orchestration speed is 35–50 s, not 20 s. The 20 s
   target therefore depends on the effort/model step (or structured output) shortening
   orchestration, not on step C alone.
3. The Chronicle: 12–30 s of wall at the end, 5–10 calls, the slowest thread 15–22 s.
4. Repair and reconcile: see the gate above.

**Audit (`npm run audit:deltas -- --game …`):** 43 entries: 27 world/first, 6 reference/first,
6 refiled, 3 reference/repair, 1 ignored. 26 of the 27 world refusals are the same thing: an NPC
answering a diplomatic letter that "has already been answered". Those refusals are what
triggered the reconcile calls in turns 4 and 5 (3 and 7 of them). Worth fixing at the source
(the slice or the cognition prompt still offers an answered letter), and step E's "reconcile only
when a fact names a refused act" would stop the calls either way. The order's own acts:
6 unreadable as written, 3 still after repair (a troop kind that does not exist, twice; a
reinforcement naming a force nothing created).

## After B (burst off the request) and C (the Chronicle in time order)

Same five orders on a fresh v28 game (`08d1e2d3-ba1c-4085-8baf-8c864437f2bb`), 2026-09-25.

| # | order | wall | calls | rounds | orchestrate | cognition (wall) | chronicle (wall) | first passage |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | Raise two new legions | 101.1 s | 21 | 4 | 24.3 s | 119.0 s (63.5) ×6 | 115.6 s (76.5) ×13 | 54.6 s |
| 2 | Embassy to Hieron | 110.7 s | 24 | 4 | 26.4 s | 153.7 s (68.7) ×9 | 75.7 s (80.1) ×10 | 42.9 s |
| 3 | Wait a month | 98.2 s | 18 | 3 | 27.0 s | 101.1 s (49.6) ×6 | 71.7 s (67.5) ×9 | 59.6 s |
| 4 | Special tax in Latium | 104.1 s | 22 | 4 | 27.4 s | 130.7 s (58.2) ×9 | 94.3 s (76.1) ×12 | 38.6 s |
| 5 | March to Messana | 118.5 s | 27 | 4 | 26.1 s | 145.1 s (61.5) ×9 | 140.5 s (89.7) ×16 | 58.0 s |

**Median 104.1 s (baseline 108.1), p90/worst 118.5 s (118.9). First passage: median 54.6 s, worst
59.6 s (baseline: the end of the turn).** The record now reads in date order and the page shows it
as it is written; the whole-turn wall clock is as expected unchanged by B and C, since the same
calls are made. What C costs: 9–16 Chronicle calls a turn against 5–10, because each window pays
its own historian; the chronicle's wall span now overlaps the burst almost entirely (the "wall"
figure runs from the first window's call to the closing pass), and the tail after the burst
settles is 11–27 s (the last window's compose plus the closing pass over what no window told).

**Why the first passage is 40–60 s and not 20:** orchestration is 24–27 s on every order, and the
order's window then waits for all three of its threads to be written before publishing any of
them (the answer's passage is the longest, 20–30 s at low effort). Two things follow, in this
order: publish each passage the moment it and its predecessors are written, so the answer appears
at orchestration plus one compose; and shorten orchestration and the historian's passages through
the effort/model step. Step D stays skipped (repair + reconcile here: 0–5 % of wall).

**Audit:** 18 entries over the five turns (baseline 43): 11 "letter already answered" (the same
NPC fault), 4 unreadable acts of the order (a troop kind that does not exist, a reinforcement
naming a force nothing created), 2 duplicate `polity_create`, 1 vote before an institution that
cannot hold one. Six of the seven order acts were carried out as written.

## Section 3 trial: the delta union as a provider response schema (2026-09-25)

`scripts/structured-output-trial.mts`, with `packages/shared/src/sim/provider-schema.ts` turning the
Zod union into the providers' strict dialect (every key required, absent fields as null, no
defaults, records as key/value lists, bounds said in the description) and `restoreDefaults` turning
an answer back into what Zod expects.

- The schema in the dialect is 62 800 characters, 102 objects, 632 properties, 377 enum values,
  depth 12. The orchestrator prompt without it is **12 900 characters** against 63 000 today.
- **OpenAI (`gpt-6-luna`, strict `json_schema`)** accepted it on every call. Three orchestrator-sized
  calls on three corpus orders: 3 of 3 parsed clean after `restoreDefaults`, no salvage, no repair,
  4–12 deltas each, 17.7 / 18.8 / 23.4 s. Two things had to be learned on the way: a null where a
  field was absent must be dropped whatever Zod's complaint is (an enum complaint, not only a type
  one), and a bound the grammar cannot hold has to be said in words, or the model writes a strength
  of zero that the prompt's own copy of the schema would have forbidden.
- **Anthropic could not be tried on this machine:** `ANTHROPIC_API_KEY` is empty in `.env.local`,
  so every call failed before leaving the process. The SDK (0.122) takes the schema as
  `output_config.format` with no beta header, and the trial script is ready to run against
  `claude-haiku-4-5` the moment a key is set.

**Decision:** not wired into the adapters yet. The keep rule was "both providers accept"; one is
unverified. The transform, its tests and the trial script stay, and the adapter wiring (a per-call
`responseSchema` on the port, the prefill dropped on Anthropic, `json_object` replaced on OpenAI,
the schema removed from `orchestrate.ts` and `cognition.ts`) waits on the Anthropic run. Nothing in
section 2 needs the room, so nothing is blocked.

## Section 2, step 0: how many orders would pay for a mechanic call (2026-09-25)

The eval corpus (19 orders, ten chains) run once with the writer off (`--mechanics off`), one
chain at a time so the provider's 200k tokens-per-minute limit is not hit (four chains in parallel
plus the trial calls hit it and every 429 was recorded as an unreadable answer; that run was
discarded). Candidates are every `generic_entity_create` that is not a law, kept, floored or
authored, recorded as audit `mechanic_candidate`.

**6 of 19 orders produced a candidate; 8 candidates in all.** gaius-1 (a pursuit), gaius-2 (an
authored arrangement), consul-church (2), trade-rome-2-stall (1), trade-rome-3-loan (2),
trade-syracuse-2-guild (1). A pursuit relabelled rather than created is not a candidate. At two
writer calls a burst this is at most eight small calls over the whole corpus, against about 140
calls the corpus already makes: under a tenth, on the orders that need it.

## Section 2: the corpus with the writer on (2026-09-25, first pass)

All 26 orders (the 19 plus toll, dole, school, racket and tithe), one chain at a time, two writer
calls a burst allowed. **10 candidates; the writer wrote 4 rules, declined 5 as "no rule", and the
engine refused 1** (an end that was one of its own conditions). Declined: a loan, a guild, a season
of Greek, the protection racket, the cult's tithe. The last two are exactly the orders the section
exists for, and both need money out of other people's purses, which the warrant rule (an amendment
of this plan) allows only with their consent or the owner's authority; told so, the writer judged
there was no rule to write. No reuse: no two arrangements of one kind shared a rule.

**Two years of nothing** (`let-time-pass.mts`) on the chains' end worlds then showed every rule
dead: the dole fired once and lapsed, the school and the guild never fired and lapsed, the pursuit
waited on "changes hands" as a condition and ran out its term. Two engine faults, both fixed:

- A rule's keep was folded into the arrangement's upkeep at the smallest band of the *province's*
  tax capacity, about 400 a month here, and its setup at five percent of the same, about 900. A
  private purse of one or two thousand paid the setup and lapsed the arrangement at the first
  month's keep. Ventures already price private business at a tenth of that scale; a person's rule
  now uses `MECHANIC_PRIVATE_SCALE_SHARE` (a tenth of the province) for its sums and setup, and pays
  no keep of its own unless the model named one worth a band at the province's scale.
- "Changes hands" is an event, not a state: as a condition it never holds. The validator now refuses
  it as a condition or an end; it stays a valid trigger.

And one writer fault: a fee-paying school was written as a monthly expense, because the prompt
forbade writing the school's earnings and the model found something else to write with money. The
prompt now says a thing's earnings from the world at large are already settled and a rule need not
move money at all.

Against the kill criterion as it stands after this pass: 6 of 10 answers declined or refused
(> 50 %), 4 of 4 rules dud in two years (> 25 %). Both faults above are the engine's, not the
writer's, so the five new chains are rerun with the fixes before the criterion is applied.

**Second pass, the five new chains after the pricing fix.** 6 candidates: 3 rules written, 1
declined, 2 refused for money (a prophet the world had just invented has no purse; a purse the kept
venture had already emptied). Two years of nothing then: the school **fired 18 times in 24 months
and moved 864** from its fund to its owner (the fund is what its standing income pays into, so the
rule is the owner drawing his takings); a temple Carthage dedicated at Aveyron **never fired in a
year's term**, and a Bacchic fellowship never fired at all. Two more engine faults, both fixed with
tests: a year's wait arrives in one hop, and the term's end was judged before the months inside it
had fired (the months inside the term now fire first); and the arrangement's own fund was offered to
the writer before it existed, so a rule was written against money nothing ever paid in (the fund
is offered only once it is there). With the term fix the temple fires its twelve months.

Running tally against the kill criterion, first pass and second together: 16 writer answers, 7
rules, 6 declined, 3 refused for money -- **56 % declined or refused**, over the 50 % line -- with
the declines concentrated on exactly the orders that need money out of strangers' purses (the racket,
the tithe, a loan), which the warrant rule forbids without consent. The played campaign decides.

## Section 2: a played campaign (2026-09-25)

Six turns as the consul on a fresh game (`73550bd8…`): a toll-house on the bridge into Rome, a grain
dole from his own purse, a school for the allies' sons paid from the treasury, a season's wait, a
toll on the Via Appia collected by the aediles, another season. **One candidate in six turns**: a
consul's orders become projects, forces and treasury lines, not arrangements; only the dole was set
going as one. Its rule was written (each month, a slight sum from his purse to the dole's fund; ends
with him) and **fired twelve times in the two seasons, changing a number each time**, and the
Chronicle told "Three Monthly Grain Doles" twice. Rate over kept-or-floored acts: none to count;
novel share 0 of 1; the writer's one answer was a rule.

**Tally, corpus and campaign together:** 17 writer answers → 8 rules, 6 declined, 3 refused for
money (53 % declined or refused, against the 50 % stop line). Of the rules written after the four
engine faults were fixed, 3 of 4 run (the dole ×12, the school ×18, the temple ×8 in its term) and
1 waited on a fund that never filled (the cult, now impossible to write). The declines cluster on
exactly the orders that need money out of strangers' purses -- the racket, the tithe, a loan --
which the warrant rule forbids without their consent, so the writer is right to decline them; the
mechanism works where it applies. The decision the amendment leaves to the reader: the 53 % is over
the line by one answer, and the built system is left on (two calls a burst) pending it.

**Speed on that campaign:** 175 / 155 / 125 / 72 / 137 / 115 s, median 137 s; first passage 48–71 s.
Slower than the five-order runs for three reasons visible in the stages: orchestration was 40–50 s
on these orders (24–27 s at midday on the fixed five: longer orders, and provider variance), no
cognition round was skipped because the antagonist is in every cast and counts as pressing, and the
historian's tail after the burst settled was 20–40 s -- the last window's compose and then a
separate closing pass over what no window told, one call after the other. The closing pass is now
folded into the last window (one compose, not two).

## After E (skips) and F (shards knob), with the writer on (2026-09-25, afternoon)

Same five orders on a fresh v28 game (`0984e418-78aa-4798-a6b9-1858760a4b86`), skips on, default
shards, mechanics on (two calls a burst).

| # | order | wall | calls | rounds | orchestrate | cognition (wall) | chronicle (wall) | first passage | skipped |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | Raise two new legions | 142.4 s | 29 | 4 | 36.1 s | 156.8 s (66.8) ×9 | 145.7 s (94.3) ×15 | 52.8 s | none |
| 2 | Embassy to Hieron | 131.1 s | 23 | 4 | 18.6 s | 168.5 s (75.1) ×9 | 103.7 s (112.2) ×12 | 24.5 s | reconcile ×1 |
| 3 | Wait a month | 121.2 s | 23 | 4 | 34.4 s | 138.5 s (59.2) ×9 | 77.6 s (86.6) ×13 | 42.4 s | none |
| 4 | Special tax in Latium | 163.1 s | 26 | 4 | 57.5 s (×2) | 156.3 s (66.2) ×9 | 138.7 s (105.3) ×15 | 63.5 s | reconcile ×2 |
| 5 | March to Messana | 118.4 s | 21 (+1 rule) | 3 | 37.2 s | 114.9 s (45.6) ×6 | 117.7 s (71.3) ×11 | 77.1 s | reconcile ×1 |

**Median 131.1 s (after C: 104.1), worst 163.1 s. First passage: median 52.8 s, worst 77.1 s.**
Slower, and the stages say why, none of it the skips:

- **Orchestration ran 34–57 s** against 24–27 s in the morning on the same orders (turn 4 made
  two orchestrate calls). Turn 2, whose orchestration took 18.6 s, published its first passage at
  24.5 s: the 20 s target is a matter of orchestration alone once a passage follows at once.
- **No cognition round was skipped in any turn**, nor in the six-turn campaign: the antagonist is
  in every cast and counts as pressing by the plan's own rule, so "nobody is pressing" never
  holds. The reconcile skip fired four times (a refusal nobody's fact named) and the repair skip
  never (no own-purse refusals here). E as specified saves reconcile calls only.
- **The historian's tail after the world settled was 22–39 s**, in series: the penultimate
  window's compose, then the last window's (which waited for it), then a closing pass over what
  no window told (the `window -1` entries, 1–3 a turn). Fixed after this run: the last window
  no longer waits for anything and takes the pool as it stands with room for six passages, and
  the closing pass runs only when the record would otherwise be blank. What a window still being
  written leaves behind when the burst ends stays untold, as the plan's rule for untold threads
  already says.
- Cognition costs 9 calls in 4 rounds (7–9 before), the same 3 shards; the model calls are slower
  per call in the afternoon (5–6 s a call against 4–5), which is the provider, not the code.

## The effort/model step (2026-09-25, afternoon)

Two runs of the same five orders on fresh v28 games, skips on, writer on, after the last-window fix.

**Run 1, cognition on `gpt-5-nano` and the historian at low effort** (`ffe93280…`): 82 / 96 / 56 /
112 / 89 s, **median 88.9 s**, first passage median 37.5 s. Fast, and rejected: the small model's
cognition answers lost whole actors to the lenient reader (8–25 things dropped a turn against 3–5
on the standard model, among them `actors.0`, `actors.1`, `actors.3` entire), so the world's people
acted less, and the delta audit shows 14 entries against 22. That is acts lost, not saved.

**Run 2, the historian alone at low effort** (`56b3340a…`), cognition on the standard model:

| # | order | wall | calls | orchestrate | cognition (wall) | chronicle (wall) | first passage |
|---|---|---:|---:|---:|---:|---:|---:|
| 1 | Raise two new legions | 153.5 s | 20 | 45.9 s | 200.7 s (93.1) ×9 | 41.8 s (102.9) ×8 | 55.3 s |
| 2 | Embassy to Hieron | 110.7 s | 19 | 27.7 s | 176.3 s (71.7) ×9 | 30.1 s (77.9) ×8 | 38.0 s |
| 3 | Wait a month | 101.7 s | 19 | 32.1 s | 132.3 s (56.0) ×6 | 38.0 s (65.6) ×10 | 40.9 s |
| 4 | Special tax in Latium | 124.3 s | 17 | 48.4 s | 127.8 s (60.8) ×6 | 32.9 s (65.3) ×7 | 64.3 s |
| 5 | March to Messana | 102.4 s | 24 | 32.2 s | 137.4 s (63.9) ×14 | 49.5 s (69.9) ×14 | 34.2 s |

**Median 110.7 s (131.1 at default effort the same afternoon), first passage median 40.9 s
(52.8).** A Chronicle call takes 3.5–4.7 s at low effort against about 9.7 s at the default, and the
tail after the world settled is now 4–10 s (it was 22–39 s): the last-window fix and the cheaper
call together. The acts carried out are the same in kind (audit: 32 entries, the usual reference
misses and refiled creations, nothing the default-effort run did not also show).

**What low effort costs the prose:** it pads. Passages restate their one fact two or three ways
("The closure cut off movement by the coastal route for the remainder of the season; both
travellers and those carrying goods had to reckon with the slope covering the road"), and a
near-repeat is declined less often. Verdict: **not made the default.** The knob stays
(`CHRONICA_AI_EFFORT_COMPOSE_CHRONICLE=low`) for anyone who prefers a faster record to a better
written one; the plan's rule was "no loss", and this is a loss a reader notices.

**Two faults these runs found, both fixed:**

- An order every act of which was refused could leave no trace. The embassy to Hieron in run 1 was
  answered by the orchestrator with letters to answer that did not exist, all refused, and the
  `order_given` fallback did not fire because a fire in Latium and a quarrel between the consuls
  were written in the same answer and counted as the order being seen. The fallback now also fires
  when nothing of the order was carried out and something of it was refused, whatever else was
  said (`every-order-is-answered.test.ts`).
- The same march ordered three times made three journeys and three arrivals, told three times in
  one window ("Carthaginian Fleet and Army Enter Messana Without Mamertine Leave" twice and once
  more under another title in run 2's embassy turn): a commander asked in three cognition rounds
  answered "move on Messana" each time. A force already on the road to that province is no longer
  sent out again; the rest of the repeated order still happens (`a-long-march.test.ts`).
- A third, found by the shard run's second turn: a project the tick completed wrote a fact whose
  summary ran past the record's 600-character cap, and the schema parse failed the whole burst.
  The engine's facts are now cut to fit (`facts.ts`, tested); the tick's own completion summary is
  cut at the site as well. Nothing the tick says may end a turn.

## Shards (plan §1 F): stopped before it finished (2026-09-25)

Three month-long waits at two shards on the `56b3340a…` save ran before the user asked for no more
provider spend; the 3- and 4-shard legs were not run. At two shards a busy wait cost 77–92 s with
cognition at 52–59 s of wall for 4 calls in 3 rounds, against 56–72 s of wall for 6–9 calls at the
default three shards on the same kind of turn. Not enough to decide the knob: **left at three**,
and `CHRONICA_COGNITION_SHARDS` stays for whoever measures the rest.

## Section 2 reuse: removed (2026-09-25)

Over the corpus and the played campaign, 0 of 8 written rules were reused (no two arrangements of
one kind ever shared a rule), under the plan's five percent line: `shape.ts`, `world.mechanicShapes`
and the `mechanic_reused` audit kind are deleted; `shapeKey` stays on a rule as its fingerprint.
The four local saves that carried the empty collection had the key stripped by hand
(`update game_worlds set world = world - 'mechanicShapes'`), since the world schema is strict.
