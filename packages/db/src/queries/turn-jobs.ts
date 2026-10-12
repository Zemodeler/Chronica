import { and, asc, desc, eq, isNotNull, lt, sql } from "drizzle-orm";
import type { ChronicaDatabase } from "../database";
import { simulationBursts, turnJobAttempts, turnJobCalls, turnJobs } from "../schema/simulation";
import { assertCommitLoads, lockWorld, writeBurstCommit, type BurstCommit, type ChronicaTransaction } from "./world";

/**
 * Turns as durable work (0043).
 *
 * The lifecycle, one job per burst:
 *
 *   queued --claim--> leased --commitTurn--> committed (followups pending) --> committed
 *                       |  \--retryTurnJob--> queued (attempts left) / failed
 *                       |  \--failTurnJob---> failed
 *                       \--lease lapses--> claimed again (attempts left) / failed by settleTurnJobs
 *
 * Every write an attempt makes after its claim carries its fence -- the worker
 * id and the attempt number the claim returned -- and is refused once another
 * attempt holds the job. Time is the database's (`now()`), never a worker's,
 * so two machines with different clocks agree on when a lease lapsed.
 */

export type TurnJobStatus = "queued" | "leased" | "committed" | "failed";

/** What a claim hands the worker: the order as it was given, and its fence. */
export interface ClaimedTurnJob {
  readonly burstId: string;
  readonly gameId: string;
  /** "run" carries the turn out; "followups" only finishes what a commit left owed (its worker died after committing). */
  readonly kind: "run" | "followups";
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly input: unknown;
  readonly inputVersion: number;
  readonly baseRevision: number;
  readonly committedRevision: number | null;
}

export interface TurnLease {
  readonly workerId: string;
  readonly attempt: number;
}

/** The lease this attempt held was taken by another (it lapsed, or was revoked as stuck). Nothing it tried to write was kept. */
export class TurnLeaseLostError extends Error {
  constructor(readonly burstId: string, readonly attempt: number) {
    super(`Turn ${burstId} is no longer leased to attempt ${attempt}; its write was refused and nothing was saved.`);
    this.name = "TurnLeaseLostError";
  }
}

/** Postgres's 23505, whether drizzle hands it over bare or wrapped in a `DrizzleQueryError`. */
function isUniqueViolation(error: unknown): boolean {
  for (let current = error; typeof current === "object" && current !== null; current = (current as { cause?: unknown }).cause) {
    if ("code" in current && current.code === "23505") return true;
  }
  return false;
}

const interval = (ms: number) => sql`(${Math.max(0, Math.round(ms))}::double precision * interval '1 millisecond')`;

export interface TurnToEnqueue {
  readonly gameId: string;
  readonly playerUserId: string | null;
  readonly orderText: string | null;
  readonly idempotencyKey?: string | null | undefined;
  /** The order as given, read back by whichever worker takes the job. */
  readonly input: unknown;
  readonly inputVersion?: number | undefined;
  readonly baseRevision: number;
  readonly maxAttempts: number;
}

async function insertTurn(tx: ChronicaTransaction, turn: TurnToEnqueue): Promise<string> {
  const [burst] = await tx
    .insert(simulationBursts)
    .values({ gameId: turn.gameId, playerUserId: turn.playerUserId, orderText: turn.orderText, heartbeatAt: sql`now()`, progressAt: sql`now()`, idempotencyKey: turn.idempotencyKey ?? null })
    .returning({ id: simulationBursts.id });
  await tx.insert(turnJobs).values({
    burstId: burst!.id,
    gameId: turn.gameId,
    input: turn.input,
    inputVersion: turn.inputVersion ?? 1,
    baseRevision: turn.baseRevision,
    maxAttempts: Math.max(1, Math.floor(turn.maxAttempts)),
  });
  return burst!.id;
}

/**
 * Opens a burst and its job in one transaction, or returns null when either
 * unique index refuses it: another burst running for this world, or this very
 * order (by its idempotency key) already sent.
 */
export async function enqueueTurn(db: ChronicaDatabase, turn: TurnToEnqueue): Promise<string | null> {
  try {
    return await db.transaction((tx) => insertTurn(tx, turn));
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
}

interface ClaimRow extends Record<string, unknown> {
  burst_id: string;
  game_id: string;
  status: TurnJobStatus;
  attempts: number;
  max_attempts: number;
  input: unknown;
  input_version: number;
  base_revision: number;
  committed_revision: number | null;
}

/**
 * Leases the next job this worker may take, or returns null.
 *
 * Takes, oldest first: a queued job that is due; a leased job whose lease has
 * lapsed and that has attempts left (its holder died or stopped renewing); a
 * committed job whose followups were left owed by a holder that died after
 * the commit. `SKIP LOCKED`, so two workers never take the same job.
 *
 * Taking a lapsed job ends its previous attempt in the same transaction: the
 * attempt is recorded as `lease_expired`, and every model call it had started
 * and never heard back from is marked `uncertain`.
 */
export async function claimTurnJob(db: ChronicaDatabase, input: { readonly workerId: string; readonly leaseMs: number; readonly gameId?: string | undefined }): Promise<ClaimedTurnJob | null> {
  return db.transaction(async (tx) => {
    const result = await tx.execute<ClaimRow>(sql`
      with candidate as (
        select j.burst_id from ${turnJobs} j
        join ${simulationBursts} b on b.id = j.burst_id
        where ${input.gameId === undefined ? sql`true` : sql`j.game_id = ${input.gameId}`}
          and (
            (j.status = 'queued' and j.available_at <= now() and j.attempts < j.max_attempts and b.status = 'running')
            or (j.status = 'leased' and j.lease_expires_at <= now() and j.attempts < j.max_attempts and b.status = 'running')
            or (j.status = 'committed' and j.followups_pending and (j.lease_expires_at is null or j.lease_expires_at <= now()))
          )
        order by j.available_at, j.created_at
        limit 1
        for update of j skip locked
      )
      update ${turnJobs} j set
        status = case when j.status = 'committed' then j.status else 'leased'::turn_job_status end,
        attempts = case when j.status = 'committed' then j.attempts else j.attempts + 1 end,
        lease_owner = ${input.workerId},
        lease_expires_at = now() + ${interval(input.leaseMs)},
        updated_at = now()
      from candidate
      where j.burst_id = candidate.burst_id
      returning j.burst_id, j.game_id, j.status, j.attempts, j.max_attempts, j.input, j.input_version, j.base_revision, j.committed_revision
    `);
    const row = [...result][0];
    if (row === undefined) return null;
    const claimed: ClaimedTurnJob = {
      burstId: row.burst_id,
      gameId: row.game_id,
      kind: row.status === "committed" ? "followups" : "run",
      attempt: Number(row.attempts),
      maxAttempts: Number(row.max_attempts),
      input: row.input,
      inputVersion: Number(row.input_version),
      baseRevision: Number(row.base_revision),
      committedRevision: row.committed_revision === null ? null : Number(row.committed_revision),
    };
    if (claimed.kind === "run") {
      await endEarlierAttempts(tx, claimed.burstId, claimed.attempt, "lease_expired");
      await tx.insert(turnJobAttempts).values({ burstId: claimed.burstId, attempt: claimed.attempt, worker: input.workerId });
      // The burst is alive again as of this claim: the page polling it reads
      // the new attempt, not the silence of the old one.
      await tx.update(simulationBursts).set({ heartbeatAt: sql`now()`, progressAt: sql`now()` }).where(and(eq(simulationBursts.id, claimed.burstId), eq(simulationBursts.status, "running")));
    }
    return claimed;
  });
}

/** Closes every attempt before `attempt` still recorded as running, and marks its unanswered calls uncertain. */
async function endEarlierAttempts(tx: ChronicaTransaction, burstId: string, attempt: number, outcome: string): Promise<void> {
  await tx.update(turnJobAttempts).set({ outcome, endedAt: sql`now()` }).where(and(eq(turnJobAttempts.burstId, burstId), lt(turnJobAttempts.attempt, attempt), eq(turnJobAttempts.outcome, "running")));
  await tx.update(turnJobCalls).set({ status: "uncertain", endedAt: sql`now()`, error: "The worker making this call stopped before it was answered; whether the provider did the work is unknown." })
    .where(and(eq(turnJobCalls.burstId, burstId), lt(turnJobCalls.attempt, attempt), eq(turnJobCalls.status, "started")));
}

/** Calls of the attempt, and before, still waiting on an answer that will never be read. */
async function markAttemptCallsUncertain(tx: ChronicaTransaction, burstId: string, reason: string): Promise<void> {
  await tx.update(turnJobCalls).set({ status: "uncertain", endedAt: sql`now()`, error: reason }).where(and(eq(turnJobCalls.burstId, burstId), eq(turnJobCalls.status, "started")));
}

/** A finished job needs no answers kept for replay; the rows stay as the account of what was asked. */
async function dropReplayAnswers(tx: ChronicaTransaction, burstId: string): Promise<void> {
  await tx.update(turnJobCalls).set({ response: null }).where(and(eq(turnJobCalls.burstId, burstId), isNotNull(turnJobCalls.response)));
}

const fenced = (burstId: string, lease: TurnLease) => and(
  eq(turnJobs.burstId, burstId),
  eq(turnJobs.leaseOwner, lease.workerId),
  eq(turnJobs.attempts, lease.attempt),
  eq(turnJobs.status, "leased"),
);

/**
 * The holder says it is still working: the lease runs another `leaseMs` from
 * now, and the burst beats. False once the lease is no longer this attempt's,
 * so a worker that was given up for dead learns it and stops.
 */
export async function renewTurnLease(db: ChronicaDatabase, burstId: string, lease: TurnLease, leaseMs: number): Promise<boolean> {
  return db.transaction(async (tx) => {
    const renewed = await tx.update(turnJobs).set({ leaseExpiresAt: sql`now() + ${interval(leaseMs)}`, updatedAt: sql`now()` }).where(fenced(burstId, lease)).returning({ burstId: turnJobs.burstId });
    if (renewed.length === 0) return false;
    await tx.update(simulationBursts).set({ heartbeatAt: sql`now()` }).where(and(eq(simulationBursts.id, burstId), eq(simulationBursts.status, "running")));
    return true;
  });
}

/**
 * The attempt failed for good: the job and its burst are failed together,
 * with `message` for the player. False (nothing written) when the lease was
 * no longer this attempt's.
 */
export async function failTurnJob(db: ChronicaDatabase, burstId: string, lease: TurnLease, message: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const failed = await tx.update(turnJobs).set({ status: "failed", lastError: message, leaseOwner: null, leaseExpiresAt: null, updatedAt: sql`now()` }).where(fenced(burstId, lease)).returning({ burstId: turnJobs.burstId });
    if (failed.length === 0) return false;
    await finishFailed(tx, burstId, lease.attempt, "failed", message);
    return true;
  });
}

async function finishFailed(tx: ChronicaTransaction, burstId: string, attempt: number, outcome: string, message: string): Promise<void> {
  await tx.update(simulationBursts).set({ status: "failed", error: message, endedAt: sql`now()` }).where(and(eq(simulationBursts.id, burstId), eq(simulationBursts.status, "running")));
  await tx.update(turnJobAttempts).set({ outcome, error: message, endedAt: sql`now()` }).where(and(eq(turnJobAttempts.burstId, burstId), eq(turnJobAttempts.attempt, attempt), eq(turnJobAttempts.outcome, "running")));
  await markAttemptCallsUncertain(tx, burstId, "The turn ended before this call was answered; whether the provider did the work is unknown.");
  await dropReplayAnswers(tx, burstId);
}

/**
 * The attempt stopped for a reason another attempt may not share -- the
 * database dropped the connection, the worker is shutting down. Queued again
 * after `delayMs` while attempts are left (`outcome` is recorded on this
 * attempt), failed with `exhaustedMessage` once they are not.
 */
export async function retryTurnJob(
  db: ChronicaDatabase,
  burstId: string,
  lease: TurnLease,
  input: { readonly error: string; readonly delayMs: number; readonly outcome: "retry" | "interrupted"; readonly exhaustedMessage: string },
): Promise<"requeued" | "failed" | "lost"> {
  return db.transaction(async (tx) => {
    const [job] = await tx.select({ attempts: turnJobs.attempts, maxAttempts: turnJobs.maxAttempts }).from(turnJobs).where(fenced(burstId, lease)).for("update").limit(1);
    if (job === undefined) return "lost";
    if (job.attempts >= job.maxAttempts) {
      await tx.update(turnJobs).set({ status: "failed", lastError: input.error, leaseOwner: null, leaseExpiresAt: null, updatedAt: sql`now()` }).where(eq(turnJobs.burstId, burstId));
      await finishFailed(tx, burstId, lease.attempt, input.outcome, input.exhaustedMessage);
      return "failed";
    }
    await tx.update(turnJobs).set({ status: "queued", lastError: input.error, leaseOwner: null, leaseExpiresAt: null, availableAt: sql`now() + ${interval(input.delayMs)}`, updatedAt: sql`now()` }).where(eq(turnJobs.burstId, burstId));
    await tx.update(turnJobAttempts).set({ outcome: input.outcome, error: input.error, endedAt: sql`now()` }).where(and(eq(turnJobAttempts.burstId, burstId), eq(turnJobAttempts.attempt, lease.attempt)));
    await tx.update(turnJobCalls).set({ status: "uncertain", endedAt: sql`now()`, error: "The attempt stopped before this call was answered; whether the provider did the work is unknown." })
      .where(and(eq(turnJobCalls.burstId, burstId), eq(turnJobCalls.attempt, lease.attempt), eq(turnJobCalls.status, "started")));
    return "requeued";
  });
}

export interface TurnCommit {
  readonly commit: BurstCommit;
  readonly lease: TurnLease;
  /** Whether work is owed after the commit (opening the conversations the turn gave reason for). */
  readonly followups: boolean;
  /** How long the holder keeps the job to finish its followups before another worker may. */
  readonly followupLeaseMs: number;
  /** The next stretch of a turn cut off by its time limit, queued in the same transaction as this one's commit. */
  readonly continuation?: TurnToEnqueue | undefined;
}

/**
 * Commits a durable turn: the burst's commit (`writeBurstCommit`, with its
 * revision and still-running checks) and the job's, under the world's lock and
 * the attempt's fence, in one transaction -- and the continuation, when there
 * is one, beside them, so a cut-off turn is never committed without the
 * stretch that carries it on, nor carried on twice.
 *
 * Throws `TurnLeaseLostError` when another attempt holds the job, and every
 * error `commitBurst` throws; any throw writes nothing.
 */
export async function commitTurn(db: ChronicaDatabase, turn: TurnCommit): Promise<{ revision: number; continuationBurstId: string | null }> {
  assertCommitLoads(turn.commit);
  const { burstId } = turn.commit;
  return db.transaction(async (tx) => {
    await lockWorld(tx, turn.commit.gameId);
    const [job] = await tx.select({ burstId: turnJobs.burstId }).from(turnJobs).where(fenced(burstId, turn.lease)).for("update").limit(1);
    if (job === undefined) throw new TurnLeaseLostError(burstId, turn.lease.attempt);
    const revision = await writeBurstCommit(tx, turn.commit);
    await tx.update(turnJobs).set({
      status: "committed",
      committedAttempt: turn.lease.attempt,
      committedRevision: revision,
      followupsPending: turn.followups,
      leaseExpiresAt: turn.followups ? sql`now() + ${interval(turn.followupLeaseMs)}` : null,
      leaseOwner: turn.followups ? turn.lease.workerId : null,
      lastError: null,
      updatedAt: sql`now()`,
    }).where(eq(turnJobs.burstId, burstId));
    await tx.update(turnJobAttempts).set({ outcome: "committed", endedAt: sql`now()` }).where(and(eq(turnJobAttempts.burstId, burstId), eq(turnJobAttempts.attempt, turn.lease.attempt)));
    await dropReplayAnswers(tx, burstId);
    let continuationBurstId: string | null = null;
    if (turn.continuation !== undefined) {
      // In a savepoint: a continuation refused (this world has a decision
      // open, another burst slipped in) is a stretch not carried on, not a
      // commit thrown away.
      try {
        continuationBurstId = await tx.transaction((inner) => insertTurn(inner, turn.continuation!));
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    return { revision, continuationBurstId };
  });
}

/** The followups a commit left owed are done (or given up), and the job is let go. */
export async function completeTurnFollowups(db: ChronicaDatabase, burstId: string, workerId: string): Promise<boolean> {
  const rows = await db.update(turnJobs).set({ followupsPending: false, leaseOwner: null, leaseExpiresAt: null, updatedAt: sql`now()` })
    .where(and(eq(turnJobs.burstId, burstId), eq(turnJobs.status, "committed"), eq(turnJobs.leaseOwner, workerId)))
    .returning({ burstId: turnJobs.burstId });
  return rows.length > 0;
}

export async function getTurnJob(db: ChronicaDatabase, burstId: string) {
  const [row] = await db.select().from(turnJobs).where(eq(turnJobs.burstId, burstId)).limit(1);
  return row;
}

export async function listTurnJobAttempts(db: ChronicaDatabase, burstId: string) {
  return db.select().from(turnJobAttempts).where(eq(turnJobAttempts.burstId, burstId)).orderBy(asc(turnJobAttempts.attempt));
}

export interface TurnSettlement {
  /** Leased jobs whose lease lapsed with no attempts left. */
  readonly exhausted: number;
  /** Leased jobs alive but not getting anywhere, given back to the queue (or failed, with no attempts left). */
  readonly stuck: number;
  /** Queued jobs no worker took up in time. */
  readonly unclaimed: number;
}

/**
 * Settles what no worker will: jobs out of attempts whose last lease lapsed,
 * jobs whose holder renews its lease but has not got anywhere in
 * `noProgressMs` (revoked -- its next write is refused -- and queued again
 * while attempts are left), and queued jobs nobody has claimed in
 * `unclaimedMs` (no worker is running). Each failure fails its burst with the
 * matching message, so the page says why.
 */
export async function settleTurnJobs(
  db: ChronicaDatabase,
  input: {
    readonly gameId: string | null;
    readonly noProgressMs: number;
    readonly unclaimedMs: number;
    readonly messages: { readonly exhausted: string; readonly stuck: string; readonly unclaimed: string };
  },
): Promise<TurnSettlement> {
  const ofGame = input.gameId === null ? sql`true` : sql`j.game_id = ${input.gameId}`;
  const exhausted = await db.transaction(async (tx) => {
    const rows = await tx.execute<{ burst_id: string; attempts: number } & Record<string, unknown>>(sql`
      update ${turnJobs} j set status = 'failed', last_error = ${input.messages.exhausted}, lease_owner = null, lease_expires_at = null, updated_at = now()
      where ${ofGame} and j.status = 'leased' and j.lease_expires_at <= now() and j.attempts >= j.max_attempts
      returning j.burst_id, j.attempts`);
    for (const row of rows) await finishFailed(tx, row.burst_id, Number(row.attempts), "lease_expired", input.messages.exhausted);
    return [...rows].length;
  });
  const stuck = await db.transaction(async (tx) => {
    const rows = await tx.execute<{ burst_id: string; attempts: number; max_attempts: number } & Record<string, unknown>>(sql`
      select j.burst_id, j.attempts, j.max_attempts from ${turnJobs} j
      join ${simulationBursts} b on b.id = j.burst_id
      where ${ofGame} and j.status = 'leased' and j.lease_expires_at > now()
        and coalesce(b.progress_at, b.started_at) <= now() - ${interval(input.noProgressMs)}
      for update of j skip locked`);
    for (const row of rows) {
      const attempt = Number(row.attempts);
      if (attempt >= Number(row.max_attempts)) {
        await tx.update(turnJobs).set({ status: "failed", lastError: input.messages.stuck, leaseOwner: null, leaseExpiresAt: null, updatedAt: sql`now()` }).where(eq(turnJobs.burstId, row.burst_id));
        await finishFailed(tx, row.burst_id, attempt, "stuck", input.messages.stuck);
      } else {
        await tx.update(turnJobs).set({ status: "queued", lastError: input.messages.stuck, leaseOwner: null, leaseExpiresAt: null, availableAt: sql`now()`, updatedAt: sql`now()` }).where(eq(turnJobs.burstId, row.burst_id));
        await tx.update(turnJobAttempts).set({ outcome: "stuck", error: input.messages.stuck, endedAt: sql`now()` }).where(and(eq(turnJobAttempts.burstId, row.burst_id), eq(turnJobAttempts.attempt, attempt), eq(turnJobAttempts.outcome, "running")));
        await tx.update(turnJobCalls).set({ status: "uncertain", endedAt: sql`now()`, error: "The attempt was given up as stuck before this call was answered; whether the provider did the work is unknown." })
          .where(and(eq(turnJobCalls.burstId, row.burst_id), eq(turnJobCalls.attempt, attempt), eq(turnJobCalls.status, "started")));
      }
    }
    return [...rows].length;
  });
  const unclaimed = await db.transaction(async (tx) => {
    const rows = await tx.execute<{ burst_id: string; attempts: number } & Record<string, unknown>>(sql`
      update ${turnJobs} j set status = 'failed', last_error = ${input.messages.unclaimed}, updated_at = now()
      where ${ofGame} and j.status = 'queued'
        and (j.available_at <= now() - ${interval(input.unclaimedMs)} or j.attempts >= j.max_attempts)
      returning j.burst_id, j.attempts`);
    for (const row of rows) await finishFailed(tx, row.burst_id, Number(row.attempts), "failed", input.messages.unclaimed);
    return [...rows].length;
  });
  return { exhausted, stuck, unclaimed };
}

// ── What each attempt asked the model ────────────────────────────────────────

export interface TurnCallKey {
  readonly burstId: string;
  readonly attempt: number;
  readonly operation: string;
  readonly requestHash: string;
  readonly occurrence: number;
}

/** Written before the provider is asked: a worker that dies mid-call leaves this behind. */
export async function recordTurnCallStarted(db: ChronicaDatabase, key: TurnCallKey): Promise<number> {
  const [row] = await db.insert(turnJobCalls).values({ ...key }).returning({ id: turnJobCalls.id });
  return row!.id;
}

export async function recordTurnCallAnswered(db: ChronicaDatabase, callId: number, response: string): Promise<void> {
  await db.update(turnJobCalls).set({ status: "answered", response, error: null, endedAt: sql`now()` }).where(eq(turnJobCalls.id, callId));
}

export async function recordTurnCallFailed(db: ChronicaDatabase, callId: number, error: string): Promise<void> {
  await db.update(turnJobCalls).set({ status: "failed", error: error.slice(0, 2000), endedAt: sql`now()` }).where(eq(turnJobCalls.id, callId));
}

/** An answer an earlier attempt of this burst got to the very same request, the same nth time, if it is still kept. */
export async function findReplayableTurnCall(db: ChronicaDatabase, key: TurnCallKey): Promise<{ id: number; response: string } | undefined> {
  const [row] = await db
    .select({ id: turnJobCalls.id, response: turnJobCalls.response })
    .from(turnJobCalls)
    .where(and(
      eq(turnJobCalls.burstId, key.burstId),
      eq(turnJobCalls.requestHash, key.requestHash),
      eq(turnJobCalls.occurrence, key.occurrence),
      lt(turnJobCalls.attempt, key.attempt),
      eq(turnJobCalls.status, "answered"),
      isNotNull(turnJobCalls.response),
    ))
    .orderBy(desc(turnJobCalls.attempt))
    .limit(1);
  return row === undefined || row.response === null ? undefined : { id: row.id, response: row.response };
}

/** This attempt was handed an earlier attempt's answer: no provider call, nothing charged. */
export async function recordTurnCallReplayed(db: ChronicaDatabase, key: TurnCallKey, replayedFrom: number): Promise<void> {
  await db.insert(turnJobCalls).values({ ...key, status: "answered", replayedFrom, endedAt: sql`now()` });
}

/** How many calls of a burst ended each way, and how many were served from an earlier attempt. */
export async function summarizeTurnCalls(db: ChronicaDatabase, burstId: string): Promise<{ started: number; answered: number; failed: number; uncertain: number; replayed: number }> {
  const rows = await db.select({ status: turnJobCalls.status, replayedFrom: turnJobCalls.replayedFrom }).from(turnJobCalls).where(eq(turnJobCalls.burstId, burstId));
  const summary = { started: 0, answered: 0, failed: 0, uncertain: 0, replayed: 0 };
  for (const row of rows) {
    summary[row.status] += 1;
    if (row.replayedFrom !== null) summary.replayed += 1;
  }
  return summary;
}
