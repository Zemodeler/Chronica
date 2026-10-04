# Plan: a Chronicle that tells the truth about orders, and is worth reading

Opened 4 October 2026. Source: [chronicle-drama-brainstorm.md](chronicle-drama-brainstorm.md) (read it for the evidence and the rejected options). Findings are cited by their audit ids (R/C) and triage ids (E/M/L) from `docs/reports/`.

## Goal

1. What the player is told about an order is what the world shows. No "done" without evidence, no erased failure, no hidden success.
2. An order held for something resumes when that thing happens, whatever the model budget did.
3. The Chronicle reads like a historian wrote it (Pax Historia's headlines and scenes, without its invention), and the world makes trouble where the player is looking.

Out of scope: a separate model call to interpret orders (see decision D1), changing the epistemic gate, rewriting stored chronicles (needs a separate backed-up correction).

## Decisions taken

- **D1. No interpreter model call.** The orchestrator already interprets (`intent.parts`). Add a deterministic verifier after it (phase 1). An optional "will this be refused" pre-flight is deferred until the scorecard (phase 6) shows a gap it would close.
- **D2. The sim stays the source of truth.** Prose is a view. Anything the player must be able to rely on (outcomes, costs, "done") is written by code from state, not by the historian.
- **D3. Hooks live in the UI, not the prose.** The "no summing up, no moral" rule stays. Pax Historia's forward-looking endings become an "open threads" footer fed by storylines.

## Phases

Each phase ships on its own, behind its own tests, in this order.

### Phase 0: scorecard and fixtures (starts first, runs through everything)

Why first: every later phase needs a before/after number.

- Keep the Clepsina and Rhegium runs as fixtures with a scripted model (extend `intent-to-proof.test.ts` and `the-rhegium-orders.test.ts`).
- Metrics per run: share of order parts whose told outcome matches state; hidden successes (acts that worked and were never told); erased failures; clerk words per 1,000; entries ending in a moral or forecast; entries with a quote; entries per window.
- Baseline them on current `main` before changing anything.

Acceptance: a single command prints the scorecard; the baseline is committed in `docs/plans/simulation-speed-baseline.md` style.

### Phase 1: the outcome contract

Files: `packages/shared/src/world/orders.ts`, `packages/shared/src/world/goals.ts`, `packages/sim/src/order-goals.ts`, `packages/sim/src/order-outcomes.ts`, `packages/sim/src/burst.ts` (`recordOrder`), `packages/sim/src/apply/apply-deltas.ts`.

1. **Verifier after the orchestrator** (D1). Each part must have goals, or be explicitly once-only. Reject or flag: substitution (act contradicts the wording), parts that are world tasks not the player's (E7/M2), existence-only goals for an action order. Mostly deterministic.
2. **Goal baselines.** Record at order time whether each goal was already true; only a change counts as progress.
3. **Effect checks per act kind.** A postcondition evaluated against the world after applying. `carried` gains `verified`. Start with the kinds that failed in audits: discharge, construction start, march, appointment, payment, letter terms.
4. **Status change.** `orderPartStatus` stops returning `achieved` on `actsCarried > 0` alone (line 407). New label for carried-but-unverified: "ordered, effect not observed".
5. **Evidence in the outcome line.** `lineOf` cites the observed value ("done: Legio I at Messana, day 127"). No evidence, no "done".
6. **Fact/state parity pass.** After each burst, check "started / taken / done" facts against state (R77); mismatches are dropped before the Chronicle and logged as audit rows.
7. **Claim checking in prose.** Extend the contradiction check from killed/destroyed to taken, appointed, arrived, began, paid, with numbers. A contradicting sentence is replaced by the outcome line.
8. **Every clause reported (C02, R65).** Each part gets a told outcome line even when the historian drops it; negative facts ("no crossing recorded") go to the outcome lines only, never to the historian.

Tests: one regression per act kind (applied implies postcondition); the audit table in `270-bc-clepsina-run-audit-updated` as fixtures (said-not-done, done-hidden, erased failure, substitution, invention).

Acceptance: scorecard shows zero erased failures and zero "done" without evidence on the fixtures.

### Phase 2: held stages wake on the tick

Files: `packages/sim/src/burst.ts` (`advanceStages`, `stageStatus`/`conditionReading`), `packages/sim/src/order-stages.ts`, `packages/sim/src/tick.ts`, `packages/shared/src/world/orders.ts`.

1. **Verify first:** does `advanceStages` run when a burst stops on `budget_exhausted`? Write the failing test before changing anything.
2. **Move stage advancement into the tick** (deterministic, no model budget). It runs across bursts, after a budget stop, and after reload.
3. **Review date for every wait.** Add `reviewAtStep` to `OrderStage`. At the date: retry, re-plan, fail loudly, or put "still waiting for X, your word?" in the player's list.
4. **Satisfiable holds.** On creation, check the condition can come true. A wait for ships with none existing or being built creates the building project and waits on `project_done` (R66, R67).
5. **Re-plan, don't replay.** Prefer storing intent and re-planning against the current world; one repair attempt on failure, then a decision for the player.
6. **Tracked delegation.** `resume_instruction` recipients get a due date (as L4 requests do). Accepted with no work after N days becomes a new status, `stalled`, and is reassigned or surfaced.
7. **Council shows every waiting stage:** "waiting for X since day N, lapses day M".

Tests: resumes in the same burst, next burst, after a budget-stopped burst, and after save/load; a funds wait and a force-arrival wait both reach their review date.

Acceptance: no stage in the fixtures is `waiting` without a review date; none is stranded by a budget stop.

### Phase 3: structured facts and the clerk-word fix

Files: `packages/shared/src/sim/proposal.ts`, `packages/shared/src/sim/provider-schema.ts`, `packages/sim/src/chronicle.ts` (`CHRONICLE_SYSTEM_PROMPT`), fact creation sites.

1. **Structured facts.** Add optional subject, deed, motive and cost fields. Fill them where the engine creates facts; the orchestrator fills them for model-proposed facts. The historian is handed these as story seeds.
2. **Lint and retry.** A banned-phrase check on each passage ("recognized", "authorized strength", "was recorded as", hedging clerk phrases); one regeneration with the offending sentence quoted.
3. **Exemplars.** Add three or four Pax Historia entry bodies (not only headlines) to the prompt as register examples. Respect prompt-size ceilings (`prompt-ceilings.test.ts`).
4. **Per-assertion sourcing** (C05): observed, agent's report, rumour, so prose hedges naturally.
5. **Order answers as people acting.** Where an order is refused or delayed, the fact names the person and what they did; the engine outcome line stays separate beneath.

Tests: `chronicle.test.ts` additions; scorecard clerk-words metric drops against baseline.

Acceptance: clerk words per 1,000 at or below an agreed target (set from the baseline in phase 0).

### Phase 4: delegate dispatches and visible work

Files: `packages/sim/src/letters.ts`, `packages/sim/src/burst.ts` (delegations), Council UI under `apps/web`.

1. Delegates report back in their own voice, built from observed results (supply bought, audit started, mission receipt). Fixes R69, R70, R72, R73.
2. Fix the report's recipient resolution (it named a nonexistent player id, R69).
3. Private receipt for confidential work: payer, cost, agent, pending status (R72, R73).
4. Stable agent identities (R74): reuse an existing agent or visibly distinguish a new one.
5. A computed "what changed" panel from state after each burst (treasury, positions, offices, open work).

Acceptance: every successful order part appears in the player's surfaces within the burst that did it.

### Phase 5: the narrator, aimed at the player

Files: `packages/sim/src/narrator.ts` and its callers; `packages/sim/src/chronicle.ts` (`NEVER_PUBLISHED`).

1. **Aim at open order parts.** Complications (supply, rival, balking subordinate) target what the player is attempting.
2. **Insubordination seeds.** An ambitious subordinate acts without orders; publish `authority_breach` as a person acting and give the player a decision. Replaces its place in `NEVER_PUBLISHED` with a person-facing form.
3. **Three-beat arcs** across bursts (omen, escalation, break), cooldown of one per window, built on `openStorylines`.
4. **Delayed reveals.** Seed a secret, let the court learn it late ("word came weeks after…"). Uses the existing epistemic gate; this is Chronicle's advantage over Pax Historia.
5. **Outside shocks** (Agathocles-style) with a historical-plausibility guard on the scenario's pressures.
6. **Open-threads footer** (D3) and callbacks to earlier entries, fed by storylines.
7. **Quiet-month digest** so a thin month still reads as a living world.
8. **Advance until something happens**: run until a stage resolves, a seed fires or a reply is due.

Guardrail: the model still never sees why trouble was seeded (existing rule), so the Chronicle cannot expose a contrivance. Watch the scorecard for a drama-per-month rate that feels engineered.

Acceptance: playtest of a "comfortable" reign shows at least one seeded beat per in-game quarter that touches an open order or a subordinate, with cooldown respected.

### Phase 6: tuning and dev tools

1. Dev inspector: per entry, thread, fact ids, weight, why included or cut.
2. Re-tune the thresholds (45 / 25 / 40) and the 3-per-window cap from the scorecard.
3. Reserve model calls for the player's order parts before ambient events (R80, L17); deterministic work never spends budget.
4. Decide on the optional pre-flight ("will this likely be refused, and why") from the scorecard's remaining gap.

## Order and dependencies

0 starts first and continues. 1 and 2 are independent and can run in parallel (different files). 3 depends on 1 only for the outcome-line routing. 4 depends on 1 (observed results to report). 5 depends on 2 (stages and review dates) and 3 (people-acting facts). 6 follows the rest.

## Risks

- **Verifier too strict** rejects legitimate orders. Mitigation: it flags and asks before it rejects; track false rejections in the scorecard.
- **Effect checks drift** from the act's real behaviour. Mitigation: the per-act test pairing.
- **Prompt size.** Exemplars and structured fields grow the prompt. Mitigation: `prompt-ceilings.test.ts` stays green; trim parser defaults as in the Rhegium work.
- **Narrator feels contrived.** Mitigation: cooldowns, scorecard rate, model never sees the motive.
- **Working tree is dirty** (many modified files on `main`). Do this on a branch from a clean commit, and keep concurrent performance work (`simulation-speed-baseline.md`) in mind.
- **Stored chronicles keep old fabrications.** Not touched here.

## Open questions

- Targets for each scorecard metric (set after the phase 0 baseline).
- Does `advanceStages` run on the budget-stop path today? (Phase 2, step 1.)
- Which act kinds need effect checks first beyond the audited ones?
- How should "stalled" appear to the player, and after how many days (N)?

## Integration with the player-focused simulation plan (added 4 October 2026)

The other plan (player-focused simulation, fewer AI calls) is mostly implemented in the working tree: `cognition-policy.ts`, `attention.ts`, `chronicle-windows.ts`, final-slot protection in `burst.ts`. Its phases are called S1-S5 here. This plan builds on it; it does not replace it.

### Merges and ownership

- **One measurement harness.** Phase 0 here and S2 are the same job. The scorecard gains the S2 columns (requests by operation, character decisions by detail level, chronicle requests, retries, duration, time to first passage, deferred decisions). Baseline once, on the current tree with the weekly windows in, since window batching changes entries-per-window.
- **One request budget.** Phase 6.3 here is S3. Drop it from phase 6; S3 owns it. Every new model call in this plan (lint retry, re-plan, pre-flight, seed arcs) counts against S3's allowance and reserves its slot before it is made.
- **One review state.** `reviewAtStep` on stages (phase 2.3) and the `stalled` delegation due dates (2.6) are scheduled-step identities in S4's persisted review state, not a second clock. Their dates follow the 7/14-day cadence unless the order sets its own.
- **Phase 2 and S1 share the deterministic path.** `advanceStages` already runs in the tick with no model budget (verified; test in `an-order-is-remembered.test.ts`). S1's "continue approved work deterministically" is the same principle; keep stages inside it.

### Conflicts and how to resolve them

1. **Background characters get no cognition (S1) vs insubordination, delayed reveals and arcs (phase 5).** A subordinate who acts without orders is background unless something promotes him. Rule: a seeded beat, a held stage, a delegation recipient and a named storyline person are direct interests while that thread is open. Add these to interest inference and test the demotion when the thread closes.
2. **Fewer chronicle calls (S1 batching) vs the Chronicle quality work (phase 3 lint-and-retry, exemplars; phase 5 digest).** Retries add calls; exemplars grow a prompt already over its ceiling. Rule: lint locally first, retry only the offending passage, one retry per window, counted in S3. The quiet-month digest is the weekly batch, not a new call. Outcome lines are code and cost nothing.
3. **Prompt ceilings.** `prompt-ceilings.test.ts` already fails on the tree (cognition prompt 73,943 over 73,000). Phase 3 cannot add exemplars until that is fixed. Trim first.
4. **Thresholds (45/25/40) and the 3-per-window cap** were set for daily windows. Retune after S1 batching, so phase 6.2 moves behind the new baseline.
5. **"Advance until something happens" (phase 5.8)** must not bring back daily churn; it uses S1's actionable-change triggers (order state change, due step, battle) as stop conditions.
6. **Re-plan on failure (2.5)** is a model call; it needs an S3 reservation and must still give the player a decision when the allowance is spent (S3's acceptance).

### What is left, in order

1. Fix the red baseline on the tree (10 sim failures incl. the prompt ceiling; they predate the order-truth work) so the scorecard starts clean.
2. Phase 0 + S2 combined harness and baseline.
3. S3 request allowance (needed before any new model call here).
4. Phase 1 remainder (verifier, goal baselines, effect checks, evidence in lines, parity, claim checks, every clause reported) and phase 2 remainder (review dates, satisfiable holds, stalled, Council view). Independent of S3 except re-plan.
5. S4 persisted review state, with phase 2 review dates in it.
6. Phases 3 and 4 here.
7. Phase 5 here with S5 tuning, after the promotion rules in conflict 1 exist.
8. Phase 6 (inspector, thresholds) and S5's optional interest marking, which suits the "open threads" footer.

Done so far: phase 2 step 1 verified; `carried_unverified` status (phase 1.4, first part); S1 implemented per its own notes, live measurement still missing.
