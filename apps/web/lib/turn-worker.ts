import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import {
  claimTurnJob,
  commitTurn,
  completeTurnFollowups,
  createDatabase,
  expireStaleHolds,
  failTurnJob,
  findReplayableTurnCall,
  getTurnJob,
  getWorldView,
  markBurstProgress,
  recordTurnCallAnswered,
  recordTurnCallFailed,
  recordTurnCallReplayed,
  recordTurnCallStarted,
  renewTurnLease,
  retryTurnJob,
  settleTurnJobs,
  summarizeTurnCalls,
  type ChronicaDatabase,
  type ClaimedTurnJob,
  type TurnLease,
} from "@chronica/db";
import { whoSeeksThePlayer } from "@chronica/sim";
import type { WorldState } from "@chronica/shared";
import { EXHAUSTED_ERROR, TURN_LEASE_MS, staleHoldMs } from "./burst-status";
import { MAX_LEGS, MIN_LEG_DAYS, loadBurstJob, restoreAskingCharacter, runBurstToCommit, turnInputOf, turnMaxAttempts, turnSettlement, type BurstJob, type RunControl, type RunHooks } from "./burst-runner";
import { openInitiatedDialogue } from "./initiated-dialogue";
import { unopenableSave } from "./save-errors";
import { isTransientInfrastructureError } from "./transient-errors";
import { evidencePort, type TurnCallStore } from "./turn-evidence";
import { TURN_INPUT_VERSION, parseTurnInput, type TurnInput } from "./turn-input";

/**
 * Carries out durable turns: claims a job, runs its burst under the job's
 * lease, commits under the same lease, and goes back for the next.
 *
 * It runs in one of two places, and is the same code in both:
 *
 * - inside the web server (`instrumentation.ts`), the default, so a single
 *   `npm run dev` or `next start` still plays -- and now survives its own
 *   restart, since a turn in flight is a queued job, not a closure;
 * - as its own process (`apps/web/worker/turn-worker.ts`, `npm run worker`),
 *   with `CHRONICA_TURN_WORKER=external` on the web servers so they only
 *   queue. Any number of these may run against one database.
 *
 * Recovery is the claim: a worker that dies stops renewing its lease, the
 * lease lapses within `TURN_LEASE_MS`, and whichever worker polls next takes
 * the job up as a new attempt, a bounded number of times. Calls the dead
 * attempt had in flight are marked uncertain; calls it had answered are
 * replayed to the new attempt rather than asked (and paid for) again
 * (`turn-evidence.ts`). The commit is fenced by the attempt, so of two
 * attempts that both believe they hold a turn, at most one writes the world.
 */

/** What `runClaimedTurn` hands the commit's followups, and the conversations it opens. */
export async function openConversations(db: ChronicaDatabase, job: Pick<BurstJob, "gameId" | "playerId" | "actorRef">, world: WorldState): Promise<void> {
  for (const initiation of whoSeeksThePlayer({ world, playerRef: job.actorRef })) {
    await openInitiatedDialogue(db, job.gameId, job.playerId, initiation.characterId, initiation.openingLine);
  }
}

/** How long an attempt stopped by the database waits before it may be taken up again. */
const RETRY_DELAY_MS = 5_000;

function callStore(db: ChronicaDatabase): TurnCallStore {
  return {
    findReplayable: (key) => findReplayableTurnCall(db, key),
    recordReplayed: (key, from) => recordTurnCallReplayed(db, key, from),
    recordStarted: (key) => recordTurnCallStarted(db, key),
    recordAnswered: (id, response) => recordTurnCallAnswered(db, id, response),
    recordFailed: (id, error) => recordTurnCallFailed(db, id, error),
  };
}

/**
 * The run's writes under the job's lease. A failure the database caused is
 * queued again; any other is the turn's and fails it. A commit whose
 * acknowledgement was lost is looked up before anything is retried: if it
 * landed under this attempt, it is this attempt's success, not a reason to run
 * the turn again.
 */
export function durableControl(db: ChronicaDatabase, job: BurstJob, claimed: ClaimedTurnJob, input: TurnInput, lease: TurnLease): RunControl {
  const { burstId } = job;
  const evidence = { counts: null as ReturnType<typeof evidencePort>["counts"] | null };
  const finalFailure = async (message: string): Promise<void> => {
    const failed = await failTurnJob(db, burstId, lease, message);
    if (failed && input.askedAs !== undefined) await restoreAskingCharacter(db, job.playerId, input.askedAs);
  };
  return {
    attempt: lease.attempt,
    holdOwner: { burstId, attempt: lease.attempt },
    beat: () => renewTurnLease(db, burstId, lease, TURN_LEASE_MS),
    progressed: () => markBurstProgress(db, burstId),
    wrapPort: (port) => {
      const wrapped = evidencePort(callStore(db), { burstId, attempt: lease.attempt }, port);
      evidence.counts = wrapped.counts;
      return wrapped.port;
    },
    fail: async (message, cause) => {
      if (isTransientInfrastructureError(cause)) {
        const reason = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
        const outcome = await retryTurnJob(db, burstId, lease, { error: reason, delayMs: RETRY_DELAY_MS, outcome: "retry", exhaustedMessage: EXHAUSTED_ERROR });
        console.warn(`[burst ${burstId}] attempt ${lease.attempt} of ${claimed.maxAttempts} stopped (${reason}); ${outcome === "requeued" ? "queued to be taken up again" : outcome === "failed" ? "no attempts left, failed" : "another attempt already holds it"}`);
        if (outcome === "failed" && input.askedAs !== undefined) await restoreAskingCharacter(db, job.playerId, input.askedAs);
        return;
      }
      await finalFailure(message);
    },
    commit: async (commit, outcome) => {
      const continues = outcome.continuationDays !== null && outcome.continuationDays >= MIN_LEG_DAYS && input.leg < MAX_LEGS && commit.decision === undefined;
      try {
        await commitTurn(db, {
          commit,
          lease,
          followups: true,
          followupLeaseMs: TURN_LEASE_MS,
          ...(continues ? {
            continuation: {
              gameId: job.gameId,
              playerUserId: job.userId,
              orderText: "(time passes)",
              idempotencyKey: `continuation:${burstId}`,
              input: turnInputOf({ gameId: job.gameId, userId: input.userId, playerId: input.playerId, characterId: job.actorRef.id, orderText: null, spanDays: outcome.continuationDays, continuation: true }, input.leg + 1),
              inputVersion: TURN_INPUT_VERSION,
              baseRevision: job.view.revision + 1,
              maxAttempts: turnMaxAttempts(process.env),
            },
          } : {}),
        });
      } catch (error) {
        if (!isTransientInfrastructureError(error)) throw error;
        // Did it land? The transaction may have committed and only its answer been lost.
        const after = await getTurnJob(db, burstId).catch(() => undefined);
        if (after?.status === "committed" && after.committedAttempt === lease.attempt) {
          console.warn(`[burst ${burstId}] the commit's acknowledgement was lost, but it landed under this attempt`);
          return "committed";
        }
        throw error;
      }
      if (evidence.counts !== null && (evidence.counts.replayed > 0 || evidence.counts.unrecorded > 0)) {
        console.info(`[burst ${burstId}] attempt ${lease.attempt}: ${evidence.counts.asked} call(s) asked, ${evidence.counts.replayed} answered from an earlier attempt${evidence.counts.unrecorded === 0 ? "" : `, ${evidence.counts.unrecorded} answered but not recorded`}`);
      }
      return "committed";
    },
  };
}

/**
 * Carries out one claimed job to a commit, a requeue or a failure. Never
 * throws for the player's sake: whatever goes wrong ends in a job row that
 * says so (or, if even that write fails, in a lease that lapses and is taken
 * up again).
 */
export async function runClaimedTurn(db: ChronicaDatabase, claimed: ClaimedTurnJob, workerId: string, options: { readonly hooks?: RunHooks | undefined } = {}): Promise<void> {
  const lease: TurnLease = { workerId, attempt: claimed.attempt };
  if (claimed.kind === "followups") {
    await runFollowups(db, claimed, workerId);
    return;
  }
  const input = parseTurnInput(claimed.input, claimed.inputVersion);
  if (input === null) {
    console.error(`[burst ${claimed.burstId}] its stored order (input version ${claimed.inputVersion}) cannot be read by this build`);
    await failTurnJob(db, claimed.burstId, lease, "This order was stored by a different version of the game and cannot be carried out. Your world is as it was; give the order again.");
    return;
  }
  if (claimed.attempt > 1) {
    const calls = await summarizeTurnCalls(db, claimed.burstId).catch(() => null);
    console.warn(`[burst ${claimed.burstId}] taken up again by ${workerId}, attempt ${claimed.attempt} of ${claimed.maxAttempts}${calls === null ? "" : ` (earlier attempts: ${calls.answered} answered, ${calls.uncertain} uncertain, ${calls.failed} failed)`}`);
  }
  let job: BurstJob;
  try {
    job = await loadBurstJob(db, { ...input, gameId: claimed.gameId, burstId: claimed.burstId });
  } catch (error) {
    const unopenable = unopenableSave(error);
    console.error(`[burst ${claimed.burstId}] could not be loaded:`, error);
    if (isTransientInfrastructureError(error)) {
      await retryTurnJob(db, claimed.burstId, lease, { error: String(error), delayMs: RETRY_DELAY_MS, outcome: "retry", exhaustedMessage: EXHAUSTED_ERROR }).catch(() => undefined);
      return;
    }
    await failTurnJob(db, claimed.burstId, lease, unopenable ?? (error instanceof Error ? error.message : String(error))).catch(() => undefined);
    if (input.askedAs !== undefined) await restoreAskingCharacter(db, input.playerId, input.askedAs);
    return;
  }
  const hooks = options.hooks ?? {};
  await runBurstToCommit(db, job, {
    ...hooks,
    control: durableControl(db, job, claimed, input, lease),
    afterCommit: async (database, finished, world, stopReason) => {
      try {
        await hooks.afterCommit?.(database, finished, world, stopReason);
        await openConversations(database, finished, world);
      } finally {
        await completeTurnFollowups(database, finished.burstId, workerId);
      }
    },
  });
}

/**
 * A commit whose worker died before opening the conversations it gave reason
 * for. Opened now against the world as committed; if another turn has
 * committed since, that turn has already judged who seeks the player.
 */
async function runFollowups(db: ChronicaDatabase, claimed: ClaimedTurnJob, workerId: string): Promise<void> {
  try {
    const input = parseTurnInput(claimed.input, claimed.inputVersion);
    const view = await getWorldView(db, claimed.gameId);
    if (input !== null && view !== undefined && view.revision === claimed.committedRevision) {
      await openConversations(db, { gameId: claimed.gameId, playerId: input.playerId, actorRef: { kind: "character", id: input.characterId } }, view.world);
    }
  } catch (error) {
    console.warn(`[burst ${claimed.burstId}] its followups could not be finished:`, error);
  } finally {
    await completeTurnFollowups(db, claimed.burstId, workerId).catch(() => undefined);
  }
}

export interface TurnWorkerOptions {
  readonly databaseUrl: string;
  /** Stable for the process; shows in `turn_job_attempts.worker`. */
  readonly workerId?: string | undefined;
  /** Turns carried out at once by this worker. */
  readonly concurrency?: number | undefined;
  /** How often an idle worker looks for work. */
  readonly pollMs?: number | undefined;
  /** How long `stop` waits for turns in hand before handing them back to the queue. */
  readonly drainMs?: number | undefined;
  readonly hooks?: RunHooks | undefined;
}

export interface TurnWorker {
  readonly workerId: string;
  /** Look for work now rather than at the next poll (a turn was just queued in this process). */
  readonly nudge: () => void;
  /** Stops claiming, waits up to `drainMs` for turns in hand, then hands any still running back to the queue. Idempotent. */
  readonly stop: () => Promise<void>;
  /** Turns in hand right now. */
  readonly running: () => number;
  /** False once `stop` was called or the loop ended: such a worker claims nothing more and is not to be reused. */
  readonly alive: () => boolean;
}

export function workerIdentity(): string {
  return `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
}

/** `CHRONICA_TURN_WORKER_CONCURRENCY`, 2 by default, 1 to 16. */
export function workerConcurrency(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const raw = Number(env.CHRONICA_TURN_WORKER_CONCURRENCY?.trim());
  return Number.isInteger(raw) && raw >= 1 && raw <= 16 ? raw : 2;
}

/**
 * The worker loop: settle what nobody will, claim, run, repeat. Each slot
 * runs one turn at a time; the loop never throws and never holds the process
 * open on its own timers.
 */
export function startTurnWorker(options: TurnWorkerOptions): TurnWorker {
  const workerId = options.workerId ?? workerIdentity();
  const concurrency = Math.max(1, options.concurrency ?? workerConcurrency());
  const pollMs = Math.max(100, options.pollMs ?? 1_000);
  const drainMs = Math.max(0, options.drainMs ?? 60_000);
  const { db, close } = createDatabase(options.databaseUrl);
  const inHand = new Map<string, Promise<void>>();
  let stopping = false;
  let wake: (() => void) | null = null;
  let lastSettled = 0;

  const sleep = (ms: number) => new Promise<void>((resolve) => {
    const timer = setTimeout(() => { wake = null; resolve(); }, ms);
    timer.unref?.();
    wake = () => { clearTimeout(timer); wake = null; resolve(); };
  });

  const settle = async (): Promise<void> => {
    if (Date.now() - lastSettled < 10_000) return;
    lastSettled = Date.now();
    const [settled, holds] = await Promise.all([
      settleTurnJobs(db, turnSettlement(null)),
      expireStaleHolds(db, new Date(Date.now() - staleHoldMs())),
    ]);
    const jobs = settled.exhausted + settled.stuck + settled.unclaimed;
    if (jobs > 0 || holds > 0) console.warn(`[turn worker ${workerId}] settled ${settled.exhausted} turn(s) out of attempts, ${settled.stuck} stuck, ${settled.unclaimed} never taken up, and ${holds} stale coin hold(s)`);
  };

  let ended = false;
  const loop = (async () => {
    console.info(`[turn worker ${workerId}] carrying out turns, ${concurrency} at a time`);
    while (!stopping) {
      try {
        await settle();
        if (inHand.size < concurrency) {
          const claimed = await claimTurnJob(db, { workerId, leaseMs: TURN_LEASE_MS });
          if (claimed !== null) {
            const run = runClaimedTurn(db, claimed, workerId, { hooks: options.hooks })
              .catch((error: unknown) => { console.error(`[burst ${claimed.burstId}] the worker lost hold of it:`, error); })
              .finally(() => { inHand.delete(claimed.burstId); wake?.(); });
            inHand.set(claimed.burstId, run);
            continue;
          }
        }
      } catch (error) {
        console.warn(`[turn worker ${workerId}] could not look for work:`, error);
      }
      await sleep(pollMs);
    }
  })().finally(() => { ended = true; });

  let stopped: Promise<void> | null = null;
  const stop = async (): Promise<void> => {
    stopping = true;
    wake?.();
    await loop;
    if (inHand.size > 0) {
      console.info(`[turn worker ${workerId}] waiting up to ${Math.round(drainMs / 1000)}s for ${inHand.size} turn(s) in hand`);
      await Promise.race([Promise.allSettled([...inHand.values()]), new Promise((resolve) => { setTimeout(resolve, drainMs).unref?.(); })]);
    }
    // Whatever is still running is handed back rather than left to lapse:
    // the next worker can take it up at once. Its process is about to end,
    // and anything it writes after this is refused by the fence -- the job
    // is queued again with its attempt number, so the old attempt's lease
    // no longer matches.
    for (const burstId of inHand.keys()) {
      const job = await getTurnJob(db, burstId).catch(() => undefined);
      if (job?.status !== "leased" || job.leaseOwner !== workerId) continue;
      const outcome = await retryTurnJob(db, burstId, { workerId, attempt: job.attempts }, { error: "The worker carrying it out was shut down.", delayMs: 0, outcome: "interrupted", exhaustedMessage: EXHAUSTED_ERROR }).catch(() => "lost" as const);
      console.info(`[burst ${burstId}] handed back at shutdown: ${outcome}`);
    }
    await close();
  };

  return {
    workerId,
    nudge: () => wake?.(),
    running: () => inHand.size,
    alive: () => !stopping && !ended,
    stop: () => { stopped ??= stop(); return stopped; },
  };
}

/**
 * The worker this process runs inside the web server, if it runs one: what
 * `nudgeTurnWorker` wakes. Held on `globalThis` under a well-known symbol
 * rather than in this module's scope, because the dev server may evaluate
 * this module more than once (a hot reload) and each copy must find the one
 * worker, not start another.
 */
const EMBEDDED = Symbol.for("chronica.turnWorker");
const EXIT_HOOKED = Symbol.for("chronica.turnWorker.exitHook");
type WithWorker = typeof globalThis & { [EMBEDDED]?: TurnWorker; [EXIT_HOOKED]?: true };

/**
 * Whether the web server carries turns out itself. `CHRONICA_TURN_WORKER`:
 * "embedded" (the default) or "external" (only queue; run `npm run worker`).
 */
export function runsEmbeddedWorker(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return (env.CHRONICA_TURN_WORKER?.trim() || "embedded") !== "external";
}

/**
 * The web server's own worker, started once per process. A worker already
 * running is returned as it is; one that was stopped (the process is going
 * down, or a reload stopped it) is replaced rather than handed back, since
 * it claims nothing. On SIGINT/SIGTERM the turns in hand are handed back
 * to the queue at once, best effort -- the web server exits on its own
 * schedule, so what the hand-back does not reach is taken up again when its
 * lease lapses (`TURN_LEASE_MS`).
 */
export function startEmbeddedTurnWorker(databaseUrl: string): TurnWorker {
  const holder = globalThis as WithWorker;
  const existing = holder[EMBEDDED];
  if (existing !== undefined && existing.alive()) return existing;
  if (existing !== undefined) console.warn(`[turn worker ${existing.workerId}] had stopped; starting another in its place`);
  const worker = startTurnWorker({ databaseUrl, drainMs: 0 });
  holder[EMBEDDED] = worker;
  if (holder[EXIT_HOOKED] !== true) {
    holder[EXIT_HOOKED] = true;
    const release = (signal: string): void => {
      const running = holder[EMBEDDED];
      if (running === undefined || !running.alive()) return;
      console.info(`[turn worker ${running.workerId}] ${signal}: handing the turns in hand back to the queue`);
      void running.stop().catch((error: unknown) => { console.warn(`[turn worker ${running.workerId}] did not stop cleanly:`, error); });
    };
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => release(signal));
  }
  return worker;
}

/** The embedded worker, if this process runs one and it is alive. */
export function embeddedTurnWorker(): TurnWorker | undefined {
  const worker = (globalThis as WithWorker)[EMBEDDED];
  return worker !== undefined && worker.alive() ? worker : undefined;
}

/** A turn was just queued by this process: let its own worker look now. A no-op where the web runs none. */
export function nudgeTurnWorker(): void {
  embeddedTurnWorker()?.nudge();
}
