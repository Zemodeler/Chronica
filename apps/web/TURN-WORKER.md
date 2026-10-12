# Durable turns and the turn worker

An order is a **durable turn**: the request writes the burst row and a `turn_jobs` row holding
the order as it was given, answers at once, and a **worker** carries the turn out under a lease.
The web process that took the order may be restarted, redeployed or scaled away without failing
the turn: whichever worker polls next takes a lapsed turn up again, a bounded number of times, and
every write of the old attempt is refused from then on.

The code: `packages/db/src/queries/turn-jobs.ts` (the lifecycle, in SQL), `apps/web/lib/turn-worker.ts`
(the worker loop and the fenced run), `apps/web/lib/turn-evidence.ts` (what each attempt asked the
model), `apps/web/lib/turn-input.ts` (the stored order), `apps/web/lib/burst-runner.ts` (one attempt of
a burst, which the terminal driver still runs in-process), migration `0043_durable_turns.sql`.

## Two ways to run it

| Mode | How | When |
| --- | --- | --- |
| **Embedded** (default) | Nothing to do: the web server starts its own worker from `instrumentation.ts` on boot, and nudges it when an order is queued in that process. | A single `npm run dev` or `next start`, as before. |
| **External** | `CHRONICA_TURN_WORKER=external` on every web server (they only queue), and `npm run worker -w @chronica/web` as its own process, any number of times, against the same `DATABASE_URL`. | Several web replicas, or a web tier that is restarted more often than a turn takes. |

Both modes run the same code. Mixing them is safe: an embedded worker and an external one against
one database never take the same job (`SELECT ... FOR UPDATE SKIP LOCKED`).

The external worker reads the repository root's `.env*` files like the web does, needs `DATABASE_URL`,
and stops on SIGINT/SIGTERM: it takes no new turn, waits up to `CHRONICA_TURN_WORKER_DRAIN_MS`
(60 s) for the turns in hand, then hands any still running back to the queue, where the next worker
takes them up at once.

The embedded worker hands its turns back on SIGINT/SIGTERM too, with no drain, best effort: the web
server exits on its own schedule, so a turn the hand-back did not reach is taken up again when its
lease lapses (90 s). In the dev server the worker runs the code loaded when the server started; a
change to the worker's own files needs the dev server restarted, not a hot reload. A worker that was
stopped is never reused: `startEmbeddedTurnWorker` replaces it.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `CHRONICA_TURN_WORKER` | `embedded` | `external` makes the web servers queue only. |
| `CHRONICA_TURN_MAX_ATTEMPTS` | 3 (1 to 10) | Leases a turn may take before it is failed. |
| `CHRONICA_TURN_WORKER_CONCURRENCY` | 2 (1 to 16) | Turns one worker carries out at once. |
| `CHRONICA_TURN_WORKER_DRAIN_MS` | 60000 | How long the external worker waits for turns in hand when stopping. |
| `CHRONICA_TEST_DATABASE_URL` | unset | The disposable Postgres the `*.db.test.ts` suites migrate and write to. Never `DATABASE_URL`. |

## The lifecycle

```
queued --claim--> leased --commitTurn--> committed (followups pending) --> committed
                    |  \--retryTurnJob--> queued (attempts left) / failed
                    |  \--failTurnJob---> failed
                    \--lease lapses--> claimed again (attempts left) / failed by settleTurnJobs
```

- **Claim.** The oldest due job: queued, or leased with a lapsed lease, or committed with followups
  owed. The claim ends the previous attempt (`lease_expired`), marks every model call it had started
  and never heard back from `uncertain`, and hands the worker a fence: its worker id and the attempt
  number.
- **Lease.** Renewed on every heartbeat (20 s), it runs 90 s (`TURN_LEASE_MS`), the same cutoff a
  burst's heartbeat always had. A live worker never lets it lapse, and a long model call does not
  touch it: the heartbeat is a timer, not a sign of progress. Time is the database's `now()`, so two
  machines with different clocks agree.
- **Fence.** Every write after the claim (renew, fail, requeue, commit) is an `UPDATE ... WHERE
  lease_owner = me AND attempts = mine AND status = 'leased'`. A worker given up for dead that wakes
  up finds its renew refused, stops asking the provider (`TurnLeaseLostError` from the model port),
  and its commit writes nothing.
- **Commit.** One transaction under the world's advisory lock: the burst's commit as before (revision
  check, still-running check), the job's, and, for a turn cut off by its time limit, the queued
  continuation beside it, so a cut-off turn is never committed without the stretch that carries it on,
  nor carried on twice. A commit whose acknowledgement was lost is looked up before anything is
  retried: if it landed under this attempt, it is this attempt's success. `chronicle_checkpoints`
  carries a unique (burst, ordinal), so a replayed commit cannot enter a passage twice.
- **Retry.** Only a failure another attempt might not share is queued again (`transient-errors.ts`:
  the connection dropped, the database restarted, a deadlock), after 5 s, while attempts are left.
  The turn's own failures (the provider refusing the account, the world moving under the turn
  because a conversation committed meanwhile, a world that would not load) fail it at once, because
  another attempt would fail the same way and every attempt makes paid calls.
- **Settle.** What no worker will take is failed with a sentence the page shows (`settleTurnJobs`,
  run by the workers, by the orphan sweep at startup and by the status poll): out of attempts
  (`EXHAUSTED_ERROR`); leased but not getting anywhere for 8 min (revoked and queued again, or
  failed on the last attempt: `STUCK_ERROR`); queued and unclaimed for 10 min (`UNCLAIMED_ERROR`:
  no worker is running).
- **Followups.** The conversations a commit gives reason for are opened after it, under a short lease;
  a worker that died between the commit and them leaves `followups_pending`, which the next claim
  finishes against the world as committed.

## What each attempt asked the model

`turn_job_calls` keeps every request, written **before** the provider is asked (operation, a hash of
the prompts, which nth asking it is) and the answer after. A later attempt that asks the very same
thing is handed the earlier answer (`replayed_from`) rather than asking and paying again; a call left
`started` by a dead attempt is `uncertain` and is asked again. Answers are dropped when the job ends;
the rows stay as the account of what was asked.

This does **not** promise a provider call is billed exactly once: a worker that dies after the provider
received the request and before the answer was written has paid for an answer nobody read, and nothing
here can know. The coin hold such a call took names its turn and attempt (`credit_holds.turn_burst_id`,
`turn_attempt`, migration `0044_turn_owned_holds.sql`): the stale-hold sweep keeps it for as long as that
attempt holds a live lease, however long the call runs, and gives it back at the first sweep after the
lease is lost (lapsed, revoked as stuck, handed back) or the job has ended -- decided under the hold's row
lock and a share lock on the job, so a renewal, a settlement or a second sweep racing it never releases
it twice. A hold with no turn (a conversation's, a letter's, any written before 0044) is given back by
age: past the longest call the configured limits allow (`CHRONICA_AI_MAX_MS` times one more than
`CHRONICA_AI_MAX_RETRIES`, plus a minute), and never under 6 min (`staleHoldMs`). What it promises is that an answer an earlier attempt received is not asked for
again, and that of two attempts that both believe they hold a turn, at most one writes the world.

## The page

`/bursts/<id>` reports `phase` (`queued`, `running`, `retrying`), `attempt` and `maxAttempts`. Passages
written while a turn runs are provisional: shown as they are written, said to be so in words, and
tagged with the attempt that wrote them; when another attempt takes the turn up, the page drops them
and says the work is being taken up again. A burst with no job (a letter, a peace table, the terminal
driver) is shown and reaped as before.

The Chronicle is paged by keyset, 200 entries at a time: the view carries the newest page and
`chronicleOlder`, and `/api/games/<id>/chronicle?before=<orderKey>` reads the page before it. The key
is the full reading order (day entered, written at, to the microsecond, ordinal, id), so a page
boundary never falls between rows that sort as one and a commit never shifts the pages under the
reader. The unread badge counts the whole record (`unreadTotal`), not the page in hand.

## Deploying and upgrading

1. **Migrate first.** `0043` adds tables and indexes and changes nothing stored; a web server on the
   old code keeps running turns in-process against the migrated schema. The unique
   (burst, ordinal) index is created only where the stored record already holds to it; a save that
   does not is left as it is, with a notice, never rewritten or refused.
2. **Then the new code.** New web servers queue jobs; a worker must be running to carry them out.
   The embedded one is, unless `CHRONICA_TURN_WORKER=external`, in which case start the external
   workers before switching the web servers over. A queued turn no worker takes up in 10 min is failed
   with `UNCLAIMED_ERROR`.
3. **Restarts mid-turn.** A deploy or a crash during a turn costs one attempt: the turn is handed back
   (or its lease lapses) and taken up again, with the answers it already had. Three restarts inside
   one turn fail it (`CHRONICA_TURN_MAX_ATTEMPTS`).
4. **The stored order is versioned** (`TURN_INPUT_VERSION`). A job written by a build this one cannot
   read is failed with a sentence, never guessed at; bump the version when the shape changes.
5. **Rolling back** to the pre-0043 code is safe for the world: jobs left queued or leased are bursts
   the old code reaps as silent after 90 s. The tables may stay.
6. **`0044`** adds two nullable columns to `credit_holds`; nothing stored changes, and the code before it
   reads and writes the table as it did (holds it writes have no owner and are expired by age). The
   migration's header carries the three statements that take it out again; it is safe to re-run.

## Tests

| Suite | Needs | What it shows |
| --- | --- | --- |
| `apps/web/lib/turn-evidence.test.ts`, `durable-turn-status.test.ts`, `use-game-view.test.ts` | nothing | evidence and replay rules, the page's reading of a durable burst, paging merges |
| `packages/db/src/durable-turns.db.test.ts` | `CHRONICA_TEST_DATABASE_URL` | leases, fencing, replay, rollback, continuation, settlement, paging past one page with ties |
| `packages/db/src/durable-turns-upgrade.db.test.ts` | `CHRONICA_TEST_DATABASE_URL` | 0043 on a database with saves in it |
| `packages/db/src/turn-owned-holds.db.test.ts` | `CHRONICA_TEST_DATABASE_URL` | a healthy turn's aged hold kept; a lost lease's, a superseded attempt's and a handed-back attempt's released; renewal, settlement and sweeps racing never release twice; holds with no turn by age |
| `packages/db/src/turn-owned-holds-upgrade.db.test.ts` | `CHRONICA_TEST_DATABASE_URL` | 0044 over old holds, its rollback and re-apply |
| `apps/web/lib/turn-worker.db.test.ts` | `CHRONICA_TEST_DATABASE_URL` | real turns with the mock model: a vanished worker, a commit the database interrupted, a shutdown mid-turn, the embedded worker's lifecycle |
| `apps/web/e2e/chronicle-history.spec.ts` | a browser, a Postgres | the record turned back past 200 entries, an order sent twice |

`CHRONICA_TEST_DATABASE_URL` must name a database whose name contains `test` and must not equal
`DATABASE_URL`; the suites migrate it from empty and write to it. Unset, they are skipped. The CI's
database tier (`.github/workflows/ci.yml`) sets it to a service container; the browser tier is
started by hand.

The workspace packages are resolved by source path in `apps/web/tsconfig.json`, `apps/web/vitest.config.mts`
and `packages/db/vitest.config.ts`, so a linked worktree checks and tests the sources of its own branch
rather than the checkout its `node_modules` points at.
