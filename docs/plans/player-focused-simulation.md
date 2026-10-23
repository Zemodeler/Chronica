# Player-focused simulation and fewer AI calls

Date: 2026-10-04  
Status: first implementation complete; live measurement and follow-up work remain.

## Objective

Keep the world detailed where the player is involved, while using deterministic rules for routine work and distant affairs. Reserve AI calls for decisions that need interpretation, negotiation, or a meaningful new choice.

The world must continue moving outside the player's attention. Lower detail must preserve people, resources, projects, consequences, and history so those areas can become important later.

## Why this change is needed

The inspected Rhegium burst took 976.686 seconds (16 minutes 17 seconds), ran 25 rounds, and made 77 AI calls: 50 simulation calls and 27 chronicle calls. It ended because its budget was exhausted.

Daily developments were repeatedly inviting character decisions and new chronicle composition. The existing simulation work budget did not cover every actual request, including historian calls. This plan addresses unnecessary decisions first, then measures the remaining cost and introduces a complete request budget.

## Detail policy

| Level | What belongs here | Behaviour |
|---|---|---|
| Direct interests | Player location, active orders and their objectives, linked armies and commanders, meaningful relationships, and personal stories | Detailed decisions; routine reconsideration approximately every seven game days when there is something new to consider |
| Connected affairs | Relevant polities, neighbouring campaign theatres, reachable sea routes, alliances, enemies, and diplomacy | Selective decisions; routine reconsideration approximately every fourteen game days |
| Background | Characters outside those interests | Existing deterministic systems continue their work without character cognition calls |

These are simulation days, not real-time delays. The current review memory lasts for one burst. A later phase will address continuity across bursts.

Interests are inferred from structured world state, rather than asking an AI to judge relevance. The first pass uses a bounded 300 km route expansion around focal provinces, plus political and story connections. This distance is an initial tuning choice, not a permanent gameplay rule.

Example: an order to reinforce an army and besiege Rhegium makes the army, commander, destination, and surrounding theatre relevant. Connected affairs around Messana remain visible through sea routes and public stories. Unrelated distant work continues under engine rules.

## Phase 1 — implemented

### Filter before allocating AI attention

Recalculate the player's interests as orders, ownership, diplomacy, and stories change. Exclude background characters before attention scoring and cast reservations, so they do not consume decision slots simply because they belong to the recurring cast.

Keep background characters available to existing deterministic statecraft behaviour. This pass does not add a complete new background economy or war simulator.

### Reconsider only when a decision changes

Daily income, minor siege progress, repeated reports, and an actor's own newly authored report do not automatically justify another decision.

Allow an earlier review for actionable changes such as a battle, new command responsibilities, an order changing state, supply conditions changing, political proceedings advancing, serious health or pressure changes, or a newly due plan step. Event reactions use facts known to the character.

Record the state after an actor's settled action so that the action itself does not cause an immediate repeat. Preserve the opportunity to respond when another actor subsequently changes circumstances.

### Continue approved work deterministically

Use the existing engine rules to progress approved projects and routine plan steps. Preserve scheduled decisions that require a fresh choice. Carry decisions deferred by a budget limit forward as owed work.

### Batch routine history

Combine routine chronicle windows into approximately weekly spans. Preserve the facts and accumulated narrative material. Compose the opening response, decisive events, and final record promptly instead of requiring a historian for every quiet day.

### Protect the final simulation budget slot

Limit a character batch when only one simulation work unit remains, and defer excess actors. This prevents a large batch from overflowing that allowance. It does not yet impose a ceiling on all provider requests.

## Phase 2 — measure the result

1. Benchmark matched scenarios: a quiet month, approved construction, the Rhegium campaign, diplomacy, and a sudden battle or political crisis.
2. Record total requests by operation, character decisions by detail level, chronicle requests, retries and repairs, burst duration, time to the first passage, and deferred decisions.
3. Explain each character request with its trigger: first review, meaningful state change, consequential known news, scheduled plan step, or elapsed review interval.
4. Compare world outcomes and narrative coverage as well as speed. Use repeated matched runs because model decisions can diverge.

Acceptance: routine activity produces substantially fewer requests, while urgent decisions, order outcomes, and major consequences remain represented. Set a live latency target from these measurements rather than promising a speedup from unit tests alone.

## Phase 3 — budget every actual request

Introduce a shared request allowance covering simulation, parallel character requests, historian composition, repairs, and retries. Keep separate operation counts for diagnosis.

Reserve capacity for the player's order and its closing account. Before dispatching a batch, reserve its actual request allocation. When the allowance is exhausted, continue safe deterministic work, preserve pending decisions and untold facts, and return a coherent result.

Acceptance: total requests stay within the configured allowance, including parallel dispatch and retry paths. Exhaustion never silently drops an order outcome or owed decision.

## Phase 4 — preserve attention between bursts

Persist compact review state so that starting a new burst does not automatically buy every relevant character another first review. Retain the last meaningful decision state, review date, handled events, and scheduled-step identity, with versioning for policy changes.

Test promotion and demotion explicitly: closing an order can reduce detail; a new order, relationship, threat, or diplomatic contact can restore it. Validate how a distant crisis becomes relevant before relying on background suppression for longer campaigns.

Acceptance: repeated short waits do not recreate daily AI churn, and newly relevant characters respond with the accumulated world state intact.

## Phase 5 — tune detail and player controls

Tune the geographical reach and political connections against real campaigns. Large allied or enemy polities should not make every character equally important.

If automatic inference proves insufficient, add an optional way to mark a person, place, polity, or story as an interest. Such a control would guide attention without requiring the player to manage the entire simulation.

Further deterministic rules should be selected from measured repeated AI decisions. Each rule needs explicit inputs, outcomes, and escalation conditions; unresolved negotiation and strategic choices still receive AI attention when relevant.

## Validation so far

- 157 focused tests passed, including attention filtering, deterministic distant project completion, scheduled decisions, owed work, budget protection, and chronicle batching.
- Type checking and lint passed for the changed simulation code.
- A controlled policy test reduced thirty daily routine updates to five personal reviews. This is not a measurement of total live requests or wall-clock speed.
- The broader suite still reports scenario and prompt-size failures. It is not fully green.
- Live performance after this change has not yet been measured.

## Implementation references

- `packages/sim/src/cognition-policy.ts`: interest inference and decision cadence.
- `packages/sim/src/attention.ts`: eligibility filtering before routing.
- `packages/sim/src/burst.ts`: policy integration, settled-state memory, and final-slot protection.
- `packages/sim/src/chronicle-windows.ts`: routine history batching.
- `docs/plans/simulation-speed-baseline.md`: earlier performance measurements.
