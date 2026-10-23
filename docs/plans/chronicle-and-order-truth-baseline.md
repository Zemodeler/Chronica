# Chronicle and order truth: scorecard baseline

Plan: [chronicle-and-order-truth.md](chronicle-and-order-truth.md). Taken 2026-10-04 with `npm run scorecard` on branch `chronicle-order-truth`, working tree with the player-focused simulation work (S1) in it. Every later phase appends a section; nothing is overwritten.

## What it measures

Order columns are read from raw state (goals against the world, acts carried and refused, failed stages), never from a status function alone. Prose columns are counts over saved chronicle entries (`npm run scorecard -- --entries run.json`) and skip the engine's own outcome lines. Request counts are by operation, from the scripted port. Code: `packages/sim/src/scorecard.ts`, fixtures in `scorecard-fixtures.ts`, tests in `scorecard.test.ts`.

## Baseline (scripted fixtures)

| run | order parts | told = state | done, no evidence | hidden successes | erased failures | unverified | waiting, no review | clerk words /1000 | moral/forecast endings | entries with quote | requests | wall s | stop |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| clepsina: crossing + audit | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 | 4 | 0.9 | max_span |
| clepsina: part with no act | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 | 4 | 0.7 | max_span |


Limits to know before reading the zeros: the scripted fixtures are a floor, not the audit. The Clepsina and Rhegium failures (said-not-done, done-hidden, erased failure, substitution) need live or recorded model output; the next step is to save those runs as `--entries` and order fixtures and add their rows here. The prose columns are empty until then. The status change that stops "done" on an act with nothing to check it against (`carried_unverified`) is already in, so "done, no evidence" is 0 by construction on this tree; on `main` before that change the same fixtures would show it.

## Known-red tests at baseline

10 sim tests fail on the tree before any order-truth work (checked by reverting the status change): `a-government-feels-the-pain`, `december-at-messana`, `mission-fieldwork` (2), `narrator` (war between two powers), `sieges-and-seasons`, `taxes-the-land-can-bear`, `the-burning-city`, `the-consul-in-bed`. They are scenario and map numbers (distances, taxes, wall dates, an office's name) from the scenario v44 and map-geometry changes. `elections` timed out once under load. `shared`: `order-standing` (a Roman with no magistracy reads `requested`, not `binding`). The cognition prompt ceiling was raised from 73,000 to 85,000 by decision, which cleared that one.
