# Chronicle vs Pax Historia: brainstorm (4 October 2026)

Raw material for a plan. Nothing here is decided. Based on one Pax Historia sample (301 BC, three months, no orders sent) and a read of `chronicle.ts`, `narrator.ts`, `order-outcomes.ts` and the existing audits. No live Chronicle run was inspected for this note.

## 1. What is really different

- **Source of truth.** Pax Historia: the narrative is the truth, and treasury and map changes hang off each entry. Chronicle: the simulation is the truth, and the historian only writes prose from a gated list of facts. Chronicle is consistent but only as interesting as the facts the sim emits.
- **Incident supply.** Pax Historia generates a steady stream of NPC-initiated beats: assassination, insubordinate raid, peace overtures stalling, council debates. Chronicle caps entries per window (3), thresholds them (45 / 25 / 40) and only tells what the player could learn.
- **Omniscience vs epistemics.** Pax Historia shows enemy councils and senates in camera. Chronicle withholds them and tells distant events as "word came from…". More honest, less vivid.
- **Endings.** Pax Historia closes entries on a hook ("the war would continue"). Chronicle's prompt forbids summing up or looking ahead.
- **Clerk leakage.** Chronicle's prompt bans "recognized", "authorized strength", "was recorded as" and similar. The ban list is a symptom: the facts are ledger sentences and the prose has to launder them.
- **Orders.** Pax Historia had none in the sample. Chronicle treats an order as a standing object (parts, refusals, held stages, spend envelopes) that must always be answered.
- **Shared target.** The Chronicle prompt already copies Pax Historia's headline style almost verbatim.

## 2. Orders versus results (from the existing audits)

Sources: `docs/reports/270-bc-clepsina-run-audit-updated-2026-09-30.md`, `docs/reports/hand-run-reports.md`, `docs/plans/order-world-consistency.md`. Many faults were fixed afterwards; this is the failure pattern.

| Pattern | Example |
|---|---|
| Said but not done | "Carry Legio I to Messana": the legion stayed in Latium, the order was reported as in hand. |
| Done but hidden | Bread bought, pay executed, independent audit started, spy mission opened and paid for. None told. |
| Failure erased in prose | Two `order_part_unanswered` facts were in the entry; the prose said "the transport order would be used". |
| Substitution | Order to attack became "hold to honour the passage", attributed to the player. |
| Invention | Chronicle said a Roman legion was killed; it was alive. |
| Fact-only completion | A part with no goals and any fact read as "achieved". |
| Stalled | Bursts ended `budget_exhausted` mid-consequence. |

Common cause: the sim and the prose disagree and the player only sees the prose. `orderOutcomeLines` (a deterministic line per part, after the narrative) is the right patch direction.

## 3. Making the output more satisfying

- Order answers phrased as a person acting (legate refuses), with the engine outcome line kept separate.
- Put Pax-Historia-style hooks in the UI ("open threads" footer fed by storylines), not in the prose, so the no-moral rule holds.
- Callbacks: entries refer to earlier ones; storylines could supply them.
- Meaningful cost chips (treasury, men, map). Current change lists show bookkeeping such as a character entering the record.
- Quiet-month digest instead of silence.

## 4. Fixing the clerk problem

Prompt bans alone will not hold. Options, in suggested order:

1. Structured facts: subject, deed, motive, cost fields instead of a ledger sentence.
2. Lint-and-retry: cheap check for banned phrases, regenerate the offending entry once.
3. Route negative facts ("no crossing recorded", "nothing came of delegation") to the outcome lines only, never to the historian. Also cures erased failures.
4. Few-shot Pax Historia entry bodies in the prompt, not only headlines.

## 5. Linking the narrator to drama

`narrator.ts` is already a deterministic dramatic director (reads ruler comfort, decides that / where / how bad; the model decides what; none of it is a fact).

- Aim complications at open order parts (supply fails, rival counters, subordinate balks).
- Insubordination seeds: ambitious subordinate acts without orders (Agrippinus). `authority_breach` is detected but in `NEVER_PUBLISHED`; tell it as a person acting and give the player a decision.
- Three-beat arcs (omen, escalation, break) across bursts, cooldown of one per window.
- Delayed reveals: seed a secret, the court learns it late. Epistemics gives Chronicle this and Pax Historia cannot.
- Outside shocks (Agathocles-style) with a historical-plausibility guard.

## 6. Open question: separate order-interpreter call

See the conversation; summary below.

- The orchestrator already interprets the order (`intent.parts`, acts, goals) in the same call that proposes the world's response.
- A separate pre-pass would help with part splitting, goals and preconditions, feasibility checks against the world, and clarification before spending a burst. It would not fix hidden successes, erased failures, execution gaps or budget exhaustion, which are the larger share of the audit findings.
- Cheaper alternative: a verifier after the orchestrator that checks parts against acts (substitution, invented parts, existence-only goals), largely deterministic.
- Latency is the cost: bursts already hit the budget limit.

## 7. A part marked done with no effect

Where it comes from (`orderPartStatus`, `packages/shared/src/world/orders.ts:373`):

- A part with no goals and no work reads `achieved` as soon as one act is `carried` (line 407). "Carried" means the engine accepted the delta, not that the intended thing happened (E5: discharge accepted, `service` never cleared; R77: `construction_started` fact, project milestones still pending).
- A goal that is already true at order time (`exists` on an army that already exists) is met vacuously.
- A letter answered "accepted" reads `achieved` although the promised duty (withdrawal, restoration) was never executed.

Ideas:

1. **Effect checks per act kind.** Each act kind registers a postcondition evaluated on the world after applying (discharge: `service` is null; construction start: a milestone moved off pending; march: force has a destination). `carried` becomes `carried` plus `verified`; unverified shows as "ordered, effect not observed", never "done".
2. **Goals are mandatory.** The deterministic verifier after the orchestrator attaches a goal to every part or marks it explicitly "once only". `actsCarried > 0` alone can no longer mean achieved.
3. **Goal baselines.** Record whether each goal was true when the order was given. A goal true at the start cannot count as progress; use deltas ("army destroyed", "legion now at Messana") rather than existence.
4. **Provisional done.** `achieved` has to hold at the next tick or two. Catches reverts and fact/state mismatches.
5. **Fact/state parity pass.** After each burst, check every "started / done / taken" fact against state (R77). A mismatch is dropped before the Chronicle sees it and logged as an audit row.
6. **Done cites evidence.** The outcome line quotes the observed value ("done: Legio I at Messana, day 127"). If there is nothing to cite, the engine cannot print "done". This also makes invented killings (the "legion killed" case) impossible to print.
7. **One regression test per act kind:** applied implies postcondition (same style as `the-rhegium-orders.test.ts`).

## 8. Held stages that never resume

How it works now (`advanceStages`, `packages/sim/src/burst.ts:1210`): a stage stores a frozen delta or a `resume_instruction`, plus up to four conditions. Inside the hop loop it checks the conditions; if all are met it carries the act out (or delegates it), if one is impossible it fails.

Ways a stage can still be stranded (to verify, not yet reproduced):

- Only `transport_capacity` has a timeout (`heldSinceStep`). A `funds` wait or a `force_at` wait for an army that never moves has no deadline and no escalation.
- Stages advance in the burst loop; a burst that stops on `budget_exhausted` may never run it. This is deterministic code and should not depend on the model budget.
- `resume_instruction` hands the work to the best-ranked other officeholder (`order_attempt`, status `acknowledged`) and nothing then forces them to act.
- When the conditions are met but the replayed act is now invalid (the world moved on), the stage fails permanently with the engine's reason and no retry.
- Nothing creates the missing prerequisite. A stage waiting on ships does not start building ships (R66, R67).

Ideas:

1. **Every wait has a review date and an escalation.** At the date the engine chooses: retry, re-plan, fail loudly, or put "still waiting for X, your word?" in the player's list. Waiting never silently continues.
2. **Wake on event.** Conditions subscribe to the events that satisfy them (vote result, arrival, project done, letter reply). The stage is advanced by the tick, so it runs across bursts and after a budget stop, and after a reload (round-trip through a save).
3. **A hold must be satisfiable.** At creation, check the condition can come true. If the legion's crossing waits on ships and none exist or are being built, create the building project as part of the hold and wait on `project_done`.
4. **Re-plan instead of replay.** Prefer storing the intent and re-planning with the current world on resume, over replaying a frozen delta. One repair try, then hand it to the player as a decision.
5. **Tracked delegation.** The recipient gets a due date (as L4 requests do). Accepted with no work after N days becomes a new visible status, "stalled", and is reassigned or surfaced.
6. **Council shows every waiting stage:** "waiting for X since day N, lapses day M".
7. **Tests:** a held stage resumes in the same burst, in the next burst, after a budget-stopped burst, and after save and load.

Cheapest first: section 7 idea 6 (evidence in the outcome line) and section 8 idea 2 (tick-driven wake-up). Check first whether `advanceStages` runs when a burst stops on `budget_exhausted`.

## 9. Other ideas to fold into the same implementation

1. **Delegates report back in their own voice.** A subordinate writes a dispatch ("Coruncanius: the bread is bought, the legion fed to day 174"). Fixes hidden successes (R69, audit, spy mission receipt) and is drama content at the same time. The report is built from the engine's observed results, not from the model's memory.
2. **Verb-claim checking, not just killings.** The existing contradiction check covers killed and destroyed. Extend it to taken, appointed, arrived, began, paid, with numbers. Each sentence's claim is checked against state; a contradicting sentence is replaced by the outcome line.
3. **Protect order work in the model budget.** Reserve calls for the player's order parts before ambient events and speeches (R80, L17). Deterministic work (stage wake-ups, parity pass, outcome lines) never spends budget.
4. **Computed "what changed" panel.** After each burst, a diff from state, not from the model: treasury, positions, offices, open work. Satisfying to read and cannot lie.
5. **"Advance until something happens".** Pax Historia has Jump Forward. Here: run until a stage resolves, a narrator seed fires, or a reply is due.
6. **Dev inspector for the Chronicle.** Per entry: thread, fact ids, weight, why included or cut, which threshold. Needed to tune the thresholds (45 / 25 / 40) and the 3-per-window cap.
7. **Scorecard and replay fixtures.** Keep the Clepsina and Rhegium runs as fixtures with a scripted model. Track: percent of parts whose told outcome matches state, clerk words per 1,000, entries ending in a moral, entries with a quote, hidden successes. Optionally an LLM judge scoring "satisfying" against the Pax Historia sample as the reference.
8. **Per-assertion sourcing** (C05): observed, agent's report, rumour. Lets prose hedge naturally ("it was said") without a thread-wide flag.
9. **Stable identities** (R74): reuse an existing agent or visibly distinguish a new one, so a dispatch from "Publius Nerius" means one person.
