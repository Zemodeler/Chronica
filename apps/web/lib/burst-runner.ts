import { InsufficientCoinsError, createAiAdapter, createTimedPort } from "@chronica/ai";
import {
  BurstNoLongerRunningError,
  TurnLeaseLostError,
  WorldRevisionConflictError,
  WorldWouldNotLoadError,
  appendBurstProgress,
  commitBurst,
  enqueueTurn,
  expireStaleHolds,
  factRowOf,
  failBurst,
  findBurstByIdempotencyKey,
  findRunningBurst,
  getOpenDecision,
  getWorldView,
  heartbeatBurst,
  listPendingEvents,
  markBurstProgress,
  listRecentFacts,
  listUntoldFacts,
  reapStaleBursts,
  schema,
  settleTurnJobs,
  startBurst,
  subjectsOfRecentReports,
  titlesOfRecentReports,
  type BurstCommit,
  type ChronicaDatabase,
} from "@chronica/db";
import { FactSchema, abortsTheTurn, formatWorldDate, type Fact, type Office, type OrderPartyRef, type ScenarioClock, type WorldState } from "@chronica/shared";
import { DEFAULT_BUDGET, allowanceFromEnv, closeTheBooks, createRequestLedger, meteredPort, createWindowWriter, openThreadsEntry, orderOutcomeLines, runSimulationBurst, whatChangedEntry, withOrderOutcomes, type AnsweredDecision, type BurstProgress, type BurstResult, type ChronicleEntry, type SimModelPort } from "@chronica/sim";
import { eq } from "drizzle-orm";
import { ABANDONED_ERROR, BURST_DEADLINE_MS, EXHAUSTED_ERROR, HEARTBEAT_MS, STALE_HOLD_MS, STUCK_ERROR, UNCLAIMED_ERROR, UNCLAIMED_TURN_MS, livenessAt, noProgressAllowedMs } from "./burst-status";
import { unopenableSave } from "./save-errors";
import { TURN_INPUT_VERSION, turnInput, type TurnInput } from "./turn-input";

/**
 * One turn, from the order to the commit, with no request around it.
 *
 * `simulation-service.ts` used to do all of this inside the HTTP request that
 * carried the order, which bound the turn to the connection: a tab closed was
 * a burst nobody could watch, and a turn longer than the client's patience was
 * a turn with a hard ceiling. Now the request only *prepares* a burst -- loads
 * the world, checks the guards, opens the row -- and hands the job to this
 * runner, which finishes it on its own and says where it has got to through
 * `burst_progress`. The terminal driver (`scripts/play-turn.mts`) runs the very
 * same two functions, so a turn measured from a script is the turn a player
 * gets.
 *
 * Nothing here may touch the request: no `headers()`, no session. Everything
 * the run needs is in the job.
 */

type WorldView = NonNullable<Awaited<ReturnType<typeof getWorldView>>>;

export interface BurstJob {
  readonly gameId: string;
  readonly burstId: string;
  readonly userId: string;
  readonly playerId: string;
  readonly actorRef: OrderPartyRef;
  readonly actorPolityId: string | null;
  readonly view: WorldView;
  readonly offices: readonly Office[];
  readonly knownFacts: readonly Fact[];
  readonly queue: readonly { id: string; dueInstantSortKey: number; kind: string; summary: string; payload: unknown }[];
  readonly recentSubjects: Awaited<ReturnType<typeof subjectsOfRecentReports>>;
  /** News of earlier runs that no passage has told (`listUntoldFacts`). */
  readonly untold: { readonly facts: readonly Fact[]; readonly significanceByFactId: ReadonlyMap<string, number> };
  readonly recentTitles: Awaited<ReturnType<typeof titlesOfRecentReports>>;
  readonly orderText: string | null;
  readonly spanDays: number | undefined;
  readonly continuation: boolean;
  readonly answeredDecision: AnsweredDecision | undefined;
  /** The decision this burst answers, closed with the commit. */
  readonly resolvesDecision: { readonly id: string; readonly optionId: string } | undefined;
  /** Whose eyes the player answered from, restored if the answer does not take (a succession swaps them before the burst). */
  readonly askedAs: string | undefined;
}

export type PreparedBurst =
  | { readonly status: "ready"; readonly job: BurstJob }
  /** The same order, sent again under the same client id: the burst the first send opened, whatever became of it. */
  | { readonly status: "existing"; readonly burstId: string }
  | { readonly status: "error"; readonly message: string };

/** What the player asked for, and on whose behalf: everything a burst is prepared from. */
export interface TurnRequest {
  readonly gameId: string;
  readonly userId: string;
  readonly playerId: string;
  readonly characterId: string;
  readonly orderText: string | null;
  readonly spanDays?: number | undefined;
  /** A further stretch of a cut-off turn. */
  readonly continuation?: boolean | undefined;
  readonly answeredDecision?: AnsweredDecision | undefined;
  readonly resolvesDecision?: { readonly id: string; readonly optionId: string } | undefined;
  readonly askedAs?: string | undefined;
  /** The client's own id for this order: sent twice, it finds the first burst rather than paying for a second. */
  readonly idempotencyKey?: string | undefined;
}

type Guarded =
  | { readonly status: "clear"; readonly view: WorldView }
  | { readonly status: "existing"; readonly burstId: string }
  | { readonly status: "error"; readonly message: string };

const ALREADY_MOVING = { status: "error", message: "The world is already moving on an earlier order. Wait for it to settle." } as const;

/** Everything the request must settle before a burst may be opened: a resend, what a dead process left, the world, a waiting decision, a burst already moving. */
async function guardTurn(db: ChronicaDatabase, input: TurnRequest): Promise<Guarded> {
  const { gameId } = input;
  const key = input.idempotencyKey;
  if (key !== undefined) {
    const sent = await findBurstByIdempotencyKey(db, gameId, key);
    if (sent !== undefined) return { status: "existing", burstId: sent.id };
  }
  // What an earlier process left behind: a burst that stopped beating or
  // stopped getting anywhere, a durable job out of attempts or never taken
  // up, and the coins a call it never finished still holds. Cleared before
  // the guards are read, so a dead burst never refuses a live order.
  const now = new Date();
  const [reaped, expired, settled] = await Promise.all([
    reapStaleBursts(db, gameId, livenessAt(now), ABANDONED_ERROR),
    expireStaleHolds(db, new Date(now.getTime() - STALE_HOLD_MS)),
    settleTurnJobs(db, turnSettlement(gameId)),
  ]);
  const jobs = settled.exhausted + settled.stuck + settled.unclaimed;
  if (reaped > 0 || expired > 0 || jobs > 0) console.warn(`[game ${gameId}] cleared ${reaped} abandoned burst(s), ${jobs} durable turn(s) and ${expired} stale coin hold(s)`);
  let read;
  try {
    read = await Promise.all([getWorldView(db, gameId), getOpenDecision(db, gameId), findRunningBurst(db, gameId, livenessAt(now))]);
  } catch (error) {
    // A save that will not open is refused here, with a sentence that says
    // so, rather than escaping the request as a 500.
    const unopenable = unopenableSave(error);
    if (unopenable === null) throw error;
    console.error(`[game ${gameId}] ${error instanceof Error ? error.message : String(error)}`);
    return { status: "error", message: unopenable };
  }
  const [view, open, running] = read;
  if (view === undefined) return { status: "error", message: "This world has no state to act on yet." };
  // An answer carries its own decision, and is the one order allowed to run
  // while one is open -- it is what closes it.
  if (input.answeredDecision === undefined && open !== undefined) return { status: "error", message: "A decision is waiting on you before the world can move on." };
  // One burst at a time, and refused at the door rather than at the commit.
  // The read turns most second orders away; the insert turns away the one
  // sent in the same breath, which read "nothing running" too.
  if (running !== undefined) {
    // The same order sent twice in one breath: both passed the key check
    // above before either was written, and the running burst is the first.
    const sent = key === undefined ? undefined : await findBurstByIdempotencyKey(db, gameId, key);
    return sent === undefined ? ALREADY_MOVING : { status: "existing", burstId: sent.id };
  }
  return { status: "clear", view };
}

/** A burst's opening was refused by a unique index: the same order sent in the same breath (find it), or another burst running. */
async function refusedOpening(db: ChronicaDatabase, gameId: string, key: string | undefined): Promise<Exclude<PreparedBurst, { status: "ready" }>> {
  const sent = key === undefined ? undefined : await findBurstByIdempotencyKey(db, gameId, key);
  return sent === undefined ? ALREADY_MOVING : { status: "existing", burstId: sent.id };
}

/**
 * Everything the request must settle before the burst is handed off, and the
 * burst opened and loaded to run in this process (the terminal driver's path,
 * `scripts/play-turn.mts`). The web queues a durable job instead (`enqueueBurst`).
 */
export async function prepareBurst(db: ChronicaDatabase, input: TurnRequest): Promise<PreparedBurst> {
  const guarded = await guardTurn(db, input);
  if (guarded.status !== "clear") return guarded;
  const burstId = await startBurst(db, { gameId: input.gameId, playerUserId: input.userId, orderText: input.orderText ?? "(time passes)", idempotencyKey: input.idempotencyKey ?? null });
  if (burstId === null) return refusedOpening(db, input.gameId, input.idempotencyKey);
  return { status: "ready", job: await loadBurstJob(db, { ...input, burstId }, guarded.view) };
}

export type EnqueuedBurst =
  | { readonly status: "queued"; readonly burstId: string }
  | { readonly status: "existing"; readonly burstId: string }
  | { readonly status: "error"; readonly message: string };

/**
 * Settles the guards and queues the order as a durable job: the burst row and
 * the job, with the order as given (`TurnInput`), in one transaction. Nothing
 * runs here; a worker leases the job (`turn-worker.ts`).
 */
export async function enqueueBurst(db: ChronicaDatabase, input: TurnRequest & { readonly leg?: number | undefined }): Promise<EnqueuedBurst> {
  const guarded = await guardTurn(db, input);
  if (guarded.status !== "clear") return guarded;
  const burstId = await enqueueTurn(db, {
    gameId: input.gameId,
    playerUserId: input.userId,
    orderText: input.orderText ?? "(time passes)",
    idempotencyKey: input.idempotencyKey ?? null,
    input: turnInputOf(input, input.leg ?? 1),
    inputVersion: TURN_INPUT_VERSION,
    baseRevision: guarded.view.revision,
    maxAttempts: turnMaxAttempts(process.env),
  });
  if (burstId === null) return refusedOpening(db, input.gameId, input.idempotencyKey);
  return { status: "queued", burstId };
}

/** The stored form of a request (`turn_jobs.input`). */
export function turnInputOf(input: TurnRequest, leg: number): TurnInput {
  return turnInput({
    userId: input.userId,
    playerId: input.playerId,
    characterId: input.characterId,
    orderText: input.orderText,
    spanDays: input.spanDays,
    continuation: input.continuation === true,
    leg,
    answeredDecision: input.answeredDecision,
    resolvesDecision: input.resolvesDecision,
    askedAs: input.askedAs,
  });
}

/** How many leases a durable turn may take before it is failed: `CHRONICA_TURN_MAX_ATTEMPTS`, 3 by default, 1 to 10. */
export function turnMaxAttempts(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const raw = Number(env.CHRONICA_TURN_MAX_ATTEMPTS?.trim());
  return Number.isInteger(raw) && raw >= 1 && raw <= 10 ? raw : 3;
}

/** The cutoffs and messages `settleTurnJobs` judges durable turns by. */
export function turnSettlement(gameId: string | null) {
  return {
    gameId,
    noProgressMs: noProgressAllowedMs(),
    unclaimedMs: UNCLAIMED_TURN_MS,
    messages: { exhausted: EXHAUSTED_ERROR, stuck: STUCK_ERROR, unclaimed: UNCLAIMED_ERROR },
  };
}

/**
 * Reads everything one attempt of a burst works from: the world as it stands
 * now, the recent record, the queue. Throws what `getWorldView` throws for a
 * save that will not open.
 */
export async function loadBurstJob(db: ChronicaDatabase, input: TurnRequest & { readonly burstId: string }, given?: WorldView): Promise<BurstJob> {
  const { gameId, burstId, userId, playerId, characterId } = input;
  // Everything the turn reads, in one round of the database rather than six.
  const [view, factRows, queueRows, recentSubjects, recentTitles, untoldRows] = await Promise.all([
    given === undefined ? getWorldView(db, gameId) : Promise.resolve(given),
    listRecentFacts(db, gameId),
    listPendingEvents(db, gameId),
    subjectsOfRecentReports(db, gameId),
    titlesOfRecentReports(db, gameId),
    listUntoldFacts(db, gameId),
  ]);
  if (view === undefined) throw new Error("This world has no state to act on yet.");
  const actorRef: OrderPartyRef = { kind: "character", id: characterId };
  const actorPolityId = view.world.characters.find((character) => character.id === characterId)?.polityId ?? null;
  return {
    gameId,
    burstId,
    userId,
    playerId,
    actorRef,
    actorPolityId,
    view,
    // Offices are scenario data, not world state, and authority derivation needs them.
    offices: view.scenarioGovernment.offices,
    knownFacts: factRows.flatMap((row) => {
      const parsed = FactSchema.safeParse(row.fact);
      return parsed.success ? [parsed.data] : [];
    }),
    queue: queueRows.map((row) => ({ id: row.id, dueInstantSortKey: row.dueInstantSortKey, kind: row.kind, summary: row.summary, payload: row.payload })),
    recentSubjects,
    recentTitles,
    untold: {
      facts: untoldRows.flatMap((row) => {
        const parsed = FactSchema.safeParse(row.fact);
        return parsed.success ? [parsed.data] : [];
      }),
      significanceByFactId: new Map(untoldRows.map((row) => [row.id, row.significance])),
    },
    orderText: input.orderText,
    spanDays: input.spanDays,
    continuation: input.continuation === true,
    answeredDecision: input.answeredDecision,
    resolvesDecision: input.resolvesDecision,
    askedAs: input.askedAs,
  };
}

/** A line for the player while the world is still moving. Nothing here is history and none of it is kept as such. */
export interface ProgressLine {
  readonly stage: "orchestrating" | "advanced" | "answering" | "settled" | "chronicling" | "committing";
  readonly line: string;
}

/** Turns what the engine reports into something worth reading. */
export function phrase(progress: BurstProgress): ProgressLine {
  switch (progress.kind) {
    case "orchestrating":
      return { stage: "orchestrating", line: "Your order reaches the palace." };
    case "skipped":
      return { stage: "advanced", line: `${progress.date}: the world goes about its business.` };
    case "advanced":
      return { stage: "advanced", line: `The world turns to ${progress.date}.` };
    case "answering": {
      // Names, because "four people are considering it" is a progress bar and
      // "Hanno and Hamilcar are considering it" is the game.
      const named = progress.people.slice(0, 3).join(", ");
      const rest = progress.people.length - Math.min(3, progress.people.length);
      const who = rest > 0 ? `${named} and ${rest} other${rest === 1 ? "" : "s"}` : named;
      return { stage: "answering", line: who.length === 0 ? `${progress.date}: the world goes about its business.` : `${progress.date}: ${who} decide what to do.` };
    }
    case "settled":
      return { stage: "settled", line: `The season closes on ${progress.date}.` };
  }
}

export interface RunHooks {
  /** Free, and outside the burst: reports on what already happened rather than causing anything. */
  readonly afterCommit?: ((db: ChronicaDatabase, job: BurstJob, world: WorldState, stopReason: string) => Promise<void>) | undefined;
  /** Also shown on the terminal, when there is one. */
  readonly onProgress?: ((line: ProgressLine) => void) | undefined;
  /** How the run keeps its row: in this process by default, or under a durable job's lease (`turn-worker.ts`). */
  readonly control?: RunControl | undefined;
}

/**
 * The writes a run makes about itself, and the one that ends it.
 *
 * In-process (`inProcessControl`), these are the burst row's own: beat it,
 * fail it, commit it. Under a durable job, each carries the attempt's lease,
 * a failure that another attempt might not share is queued again rather than
 * failed, and the commit is the job's as well as the burst's.
 */
export interface RunControl {
  /** Which lease of a durable job this run is; absent in-process. Written on every passage handed to the page. */
  readonly attempt?: number | undefined;
  /** The timer's sign of life. False once the run is no longer this one's to finish. */
  readonly beat: () => Promise<boolean>;
  /** The run got somewhere. False once it is no longer this one's to finish. */
  readonly progressed: () => Promise<boolean>;
  /** Wraps the metered port, below the progress counting: a durable run records and replays its calls here. */
  readonly wrapPort?: ((port: SimModelPort) => SimModelPort) | undefined;
  /** The run ended without a commit; `message` is the player's, `cause` what went wrong (null when nothing threw). */
  readonly fail: (message: string, cause: unknown) => Promise<void>;
  /** Commits the burst. "lost" when the run turned out not to be this one's to commit: nothing was written and nothing more should be. */
  readonly commit: (commit: BurstCommit, outcome: { readonly stopReason: string; readonly continuationDays: number | null }) => Promise<"committed" | "lost">;
}

/** A burst run by this process alone, as every burst was before durable turns. */
export function inProcessControl(db: ChronicaDatabase, job: BurstJob): RunControl {
  return {
    beat: () => heartbeatBurst(db, job.burstId),
    progressed: () => markBurstProgress(db, job.burstId),
    fail: async (message) => {
      await failBurst(db, job.burstId, message).catch((error: unknown) => { console.error(`[burst ${job.burstId}] could not record its own failure:`, error); });
      if (job.askedAs !== undefined) await restoreAskingCharacter(db, job.playerId, job.askedAs);
    },
    commit: async (commit) => {
      await commitBurst(db, commit);
      return "committed";
    },
  };
}

/**
 * Runs a prepared burst to its commit, or to a `failed` row that says why.
 *
 * Never throws for the player's sake: whatever goes wrong, the burst row ends
 * in a state the page can read. Two signs of life go to the row while it
 * runs. The heartbeat says the process is alive, on a timer; progress says
 * the burst is getting somewhere, and moves only when a stage is reported, a
 * model call answers or a passage is written. A process that dies is found out
 * by its silence, and one alive but stuck by its lack of progress -- either
 * way the row is reaped, and a commit arriving after that is refused.
 *
 * And a burst that is getting somewhere slowly is told to stop at
 * `burstDeadlineMs`: between hops, keeping what it has done.
 */
/** The most stretches a cut-off turn goes on in, and the fewest days worth starting one for. */
export const MAX_LEGS = 8;
export const MIN_LEG_DAYS = 3;

/**
 * A turn cut off by its time limit goes on where it stopped, as a further
 * stretch of the same span with no order of its own, up to `MAX_LEGS` in all:
 * the player is not asked to give the order again to see the march finish.
 * Returns the jobs run, in order.
 */
export async function runBurstWithContinuations(db: ChronicaDatabase, job: BurstJob, hooks: RunHooks = {}): Promise<BurstJob[]> {
  const ran: BurstJob[] = [];
  let current = job;
  for (let leg = 1; leg <= MAX_LEGS; leg += 1) {
    ran.push(current);
    const cut: { days: number | null } = { days: null };
    await runBurstToCommit(db, current, {
      ...hooks,
      afterCommit: async (database, finished, world, stopReason) => {
        await hooks.afterCommit?.(database, finished, world, stopReason);
        if (stopReason === "deadline" && finished.spanDays !== undefined) cut.days = finished.spanDays - (world.instant.day - finished.view.world.instant.day);
      },
    });
    if (cut.days === null || cut.days < MIN_LEG_DAYS || leg === MAX_LEGS) break;
    const next = await prepareBurst(db, { gameId: current.gameId, orderText: null, spanDays: cut.days, continuation: true, userId: current.userId, playerId: current.playerId, characterId: current.actorRef.id });
    if (next.status !== "ready") break;
    current = next.job;
  }
  return ran;
}

export async function runBurstToCommit(db: ChronicaDatabase, job: BurstJob, hooks: RunHooks = {}): Promise<void> {
  const { gameId, burstId, userId, actorRef, actorPolityId, view, offices } = job;
  const control = hooks.control ?? inProcessControl(db, job);
  // Set once the row says the burst is no longer running -- reaped by a page
  // that judged it dead, or its lease taken by another worker -- so the work
  // stops rather than running on to a commit that will be refused.
  let reaped = false;
  const beat = (alive: Promise<boolean>, what: string): void => {
    void alive.then((running) => { if (!running) reaped = true; }, (error: unknown) => { console.warn(`[burst ${burstId}] could not record ${what}:`, error); });
  };
  const heartbeat = setInterval(() => beat(control.beat(), "a heartbeat"), HEARTBEAT_MS);
  const progressed = (): void => beat(control.progressed(), "progress");
  let progressWrites = Promise.resolve();
  const say = (line: ProgressLine): void => {
    hooks.onProgress?.(line);
    progressed();
    // Not awaited: the burst never waits on its own commentary. A line that
    // cannot be written is said in the log, never swallowed.
    progressWrites = progressWrites.then(() => appendBurstProgress(db, { gameId, burstId, kind: "progress", payload: line })).then(() => {})
      .catch((error: unknown) => { console.warn(`[burst ${burstId}] a progress line was not recorded:`, error); });
  };
  const fail = async (message: string, cause: unknown = null): Promise<void> => {
    await control.fail(message, cause).catch((error: unknown) => { console.error(`[burst ${burstId}] could not record its own failure:`, error); });
  };

  try {
    const adapter = createAiAdapter();
    const timed = createTimedPort({ db, userId, gameId, adapter });
    const asked = control.wrapPort === undefined ? timed.port : control.wrapPort(timed.port);
    // Every answered call is progress, whichever stage asked for it.
    const counted: SimModelPort = {
      complete: async (operation, system, user) => {
        const answer = await asked.complete(operation, system, user);
        progressed();
        return answer;
      },
    };
    // One allowance for the whole turn: the order, the world's decisions, repairs, retries and the historian (S3).
    const requests = createRequestLedger(allowanceFromEnv(process.env.CHRONICA_REQUEST_ALLOWANCE));
    const port = meteredPort(counted, requests);
    const turnStartedAt = performance.now();
    const turnStartedMs = Date.now();
    // Time the player is asked to wait: 75 s for a week, 4 minutes for a month. Past it the remaining days pass without
    // anybody being asked; the hard deadline is only for a round that hangs.
    const budgetMs = turnBudgetMs(job.spanDays, process.env);
    const deadline = budgetMs === null ? burstDeadlineMs(process.env, adapter.free === true) : budgetMs + HARD_STOP_AFTER_MS;
    const deadlineAt = deadline === null ? null : Date.now() + deadline;
    const from = view.world.instant;
    const clock = view.scenarioClock;

    // The record is written window by window while the burst runs, and each
    // passage is handed to the page the moment it exists. The commit writes
    // the same passages, in the same order: nothing shown is ever reordered.
    let ordinal = 0;
    const writer = createWindowWriter({
      port,
      clock,
      observer: actorRef,
      observerPolityId: actorPolityId,
      offices,
      recentSubjects: job.recentSubjects,
      recentTitles: job.recentTitles,
      untold: job.untold,
      ...(budgetMs === null ? {} : { skipRetries: () => Date.now() - turnStartedMs > budgetMs }),
      // Dev inspector (6.1): what each window's entries were made of, with CHRONICA_INSPECT=1.
      onOverstated: (overstated: number, passages: number, window: number) => { console.warn(`[burst ${burstId}] window ${window}: ${overstated} of ${passages} passage(s) said more than the world shows and were replaced by the engine's line`); },
      ...(process.env.CHRONICA_INSPECT === "1" ? { onInspection: (inspection: unknown, window: number) => { console.info(`[burst ${burstId}] window ${window} inspection: ${JSON.stringify(inspection)}`); } } : {}),
      onEntry: async (entry, window) => {
        ordinal += 1;
        await appendBurstProgress(db, {
          gameId,
          burstId,
          kind: "chronicle_entry",
          payload: {
            window,
            ordinal,
            // Which attempt wrote it: a passage of an attempt that did not
            // commit is shown as provisional and dropped when the next takes over.
            ...(control.attempt === undefined ? {} : { attempt: control.attempt }),
            kind: entry.kind,
            title: entry.title,
            body: entry.body,
            date: dateLabel(entry.toInstantSortKey, clock),
            subjects: entry.subjects,
            tags: entry.tags,
            changes: entry.changes,
            quote: entry.quote,
            factIds: entry.factIds,
          },
        }).catch((error: unknown) => { console.warn(`[burst ${burstId}] a written passage was not handed to the page (the commit still keeps it):`, error); });
        progressed();
      },
    });

    let result;
    try {
      result = await runSimulationBurst({
        world: view.world,
        clock,
        offices,
        // How those offices are filled, so a consulship that runs out is
        // refilled by election rather than left empty for good.
        successionRules: view.scenarioGovernment.successionRules,
        warfare: view.scenarioWarfare,
        terrains: view.scenarioMap.terrains,
        life: view.scenarioLife,
        wealth: view.scenarioWealth,
        historicalPressures: view.scenarioHistoricalPressures,
        burstId,
        gameId,
        actorRef,
        actorPolityId,
        orderText: job.orderText,
        ...(job.spanDays === undefined ? {} : { spanDays: job.spanDays }),
        ...(job.continuation ? { continuation: true } : {}),
        // The world's own people are asked while the order is read: the player's wait is the longer of the two, not the sum.
        prefetch: budgetMs !== null,
        onProgress: (progress: BurstProgress) => say(phrase(progress)),
        onWindowClosed: writer.closed,
        ...(job.answeredDecision === undefined ? {} : { answeredDecision: job.answeredDecision }),
        knownFacts: job.knownFacts,
        queue: job.queue,
        port,
        requests,
        // Stop between hops once the burst has run too long, or once the row
        // says it has been given up; what was done so far is kept.
        shouldStop: () => reaped || (deadlineAt !== null && Date.now() > deadlineAt),
        ...(budgetMs === null ? {} : { outOfTime: () => Date.now() - turnStartedMs > budgetMs }),
        ...(cognitionShardsFromEnv() === undefined ? {} : { budget: { ...DEFAULT_BUDGET, cognitionShards: cognitionShardsFromEnv() } }),
      });
    } catch (error) {
      if (error instanceof InsufficientCoinsError) { await fail("You have run out of coins.", error); return; }
      // The provider refusing every call -- no credit on the account, a key it
      // will not take -- stops the turn before anything is saved, and says so,
      // rather than a season passing in which nothing came of the order.
      if (abortsTheTurn(error)) {
        console.error(`[burst ${burstId}] the model provider refused the turn:`, error);
        await fail("The model provider refused the request (its account may be out of credit). Nothing was saved and your world is unchanged; try again once it is restored.", error);
        return;
      }
      console.error(`[burst ${burstId}] the burst failed:`, error);
      await fail(error instanceof Error ? error.message : String(error), error);
      return;
    }

    say({ stage: "chronicling", line: "The historian finishes writing." });
    // Every request, by operation, whichever path sent it (S3).
    console.info(`[burst ${burstId}] requests ${requests.spent} of ${requests.allowance.total}: ${JSON.stringify(requests.counts())}`);
    // The last window closes as the burst returns; this waits for it to be
    // written, and for the closing passage if no window told anything. Whatever the historian does, the turn has happened: the
    // facts are kept either way, only the prose is lost.
    const chronicle = await writer.finish();

    // And the books close because the calendar turned, not because anybody
    // asked. No model call, no historian, no judgment -- arithmetic. They
    // follow the passages rather than being sorted among them: the passages
    // are already in time order and the page has already shown them so.
    // What each part of the order came to, in the engine's words, under the
    // passage that answers it (`withOrderOutcomes`): read from the world as
    // the burst left it, so a crossing begun and one landed read differently.
    const answered = result.orderRecordId === null
      ? chronicle.entries
      : withOrderOutcomes(chronicle.entries, [
        ...orderOutcomeLines(result.world, result.orderRecordId, clock),
        // A turn cut short for want of calls says so, rather than passing the
        // engine's limit off as the world's quiet (R52, R80). What was left
        // stays on the order, and the next order takes it up.
        ...(result.stopReason === "budget_exhausted" || result.stopReason === "deadline" ? ["This report ends here for now; what is still open stays in hand for your next order."] : []),
        ...(result.stopReason === "tick_failed" ? ["The days could not be carried forward: something in the world's books would not hold, and the turn has stopped where it was whole. Nothing past this day has happened; give the order again, or tell those who keep the game."] : []),
      ], result.orderFactIds, result.world.instant.day * 1440 + result.world.instant.minute);
    // What the turn changed, read from the two worlds: whatever the prose chose to tell (4.5).
    const changedEntry = whatChangedEntry({ before: view.world, after: result.world, polityId: actorPolityId, characterId: actorRef.kind === "character" ? actorRef.id : null }, result.world.instant.day * 1440 + result.world.instant.minute);
    // A turn cut by its time limit goes on in a further stretch, which ends with what is still open.
    const openEntry = result.stopReason === "deadline" ? null : openThreadsEntry(result.world, actorRef.kind === "character" ? actorRef.id : null, result.world.instant.day * 1440 + result.world.instant.minute);
    const entries: ChronicleEntry[] = [
      ...answered,
      ...(changedEntry === null ? [] : [changedEntry]),
      // What the player can still look for, outside the prose (D3).
      ...(openEntry === null ? [] : [openEntry]),
      ...closeTheBooks({ world: result.world, clock, from, to: result.world.instant, polityId: actorPolityId }),
    ];

    // A model answer the engine could not read is the one failure that leaves
    // no trace anywhere; it costs a line to say so. A salvage is work saved
    // rather than lost, and still said out loud: a field that keeps showing up
    // here is a prompt or a schema that wants fixing.
    if (result.parseFailures.length > 0) {
      console.warn(`[burst ${burstId}] the model's answer could not be read (${result.parseFailures.length}): ${result.parseFailures.join(" | ")}`);
    }
    if (result.salvaged.length > 0) {
      console.warn(`[burst ${burstId}] dropped ${result.salvaged.length} thing(s) to keep the answer: ${result.salvaged.join(", ")}`);
    }
    if (result.stopReason === "deadline") {
      console.warn(`[burst ${burstId}] stopped ${reaped ? "because its row was given up" : `at its deadline (${Math.round((deadline ?? 0) / 1000)}s)`}; committing what it had done`);
    }

    say({ stage: "committing", line: "The record is entered." });
    await progressWrites;
    // What is left of a span its time limit cut off, for the stretch that carries it on.
    const continuationDays = result.stopReason === "deadline" && job.spanDays !== undefined ? job.spanDays - (result.world.instant.day - view.world.instant.day) : null;
    try {
      const committed = await control.commit({
        gameId,
        expectedRevision: view.revision,
        world: result.world,
        burstId,
        facts: result.newFacts.map((fact) => factRowOf(fact, result.significanceByFactId.get(fact.id) ?? 0)),
        // Amendments to history already written, not additions to it: a secret
        // that somebody has now found out about.
        rediscoveredFacts: result.rediscoveredFacts.map((fact) => factRowOf(fact, result.significanceByFactId.get(fact.id) ?? 0)),
        scheduled: result.scheduled,
        firedEventIds: result.firedEventIds,
        burst: {
          iterations: result.iterations,
          modelCalls: result.modelCalls + chronicle.calls,
          outcome: result.outcome,
          stopReason: result.stopReason,
          accumulatedSignificance: result.accumulatedSignificance,
          // Everything the burst set down, kept with it rather than only
          // printed below: what the budget turned away, what could not be
          // read, and what was dropped to keep an answer.
          skipped: workNotDone(result),
          chronicleCalls: chronicle.calls,
        },
        ...(entries.length === 0 ? {} : {
          checkpoints: entries.map((entry) => ({
            kind: entry.kind,
            title: entry.title,
            body: entry.body,
            factIds: entry.factIds,
            subjects: entry.subjects,
            tags: entry.tags,
            changes: entry.changes,
            quote: entry.quote,
            fromInstantSortKey: entry.fromInstantSortKey,
            toInstantSortKey: entry.toInstantSortKey,
          })),
        }),
        ...(result.playerDecision === null ? {} : { decision: { prompt: result.playerDecision.prompt, options: result.playerDecision.options } }),
        ...(job.resolvesDecision === undefined ? {} : { resolvesDecision: job.resolvesDecision }),
        audit: result.audit.map((entry) => ({
          actorKind: entry.actorRef.kind,
          actorId: entry.actorRef.id,
          op: entry.op,
          kind: entry.kind,
          ofTheOrder: entry.ofTheOrder,
          attempt: entry.attempt,
          reason: entry.reason,
          delta: entry.delta,
        })),
      }, { stopReason: result.stopReason, continuationDays });
      if (committed === "lost") {
        console.warn(`[burst ${burstId}] its commit was not this run's to make (another attempt holds the turn); nothing was written`);
        return;
      }
    } catch (error) {
      // A conversation (or any other writer) moved the world under the turn.
      // Not retried: the world it read is gone, and another attempt would ask
      // the provider -- and charge the player -- all over again.
      if (error instanceof WorldRevisionConflictError) { await fail("The world moved while your order was being carried out. Try again.", error); return; }
      // Given up while it worked, and the page already told the player so --
      // or, durable, taken up by another attempt that owns the turn now.
      // Nothing to write: the row already says so.
      if (error instanceof BurstNoLongerRunningError || error instanceof TurnLeaseLostError) {
        console.warn(`[burst ${burstId}] ${error.message}`);
        if (job.askedAs !== undefined && error instanceof BurstNoLongerRunningError) await restoreAskingCharacter(db, job.playerId, job.askedAs);
        return;
      }
      if (error instanceof WorldWouldNotLoadError) {
        console.error(`[burst ${burstId}] ${error.message}`);
        await fail("Something in this turn would have damaged the save, so it was not kept. Your world is as it was; try the order again.", error);
        return;
      }
      console.error(`[burst ${burstId}] the commit failed:`, error);
      await fail(error instanceof Error ? error.message : String(error), error);
      return;
    }

    // What the engine would not do as written, said where somebody will see it:
    // an unreadable refusal of the order's own is the order quietly doing less.
    const unreadable = (attempt: "first" | "repair") => result.audit.filter((entry) => entry.ofTheOrder && entry.kind === "reference" && entry.attempt === attempt);
    const filled = result.audit.filter((entry) => entry.kind === "assumed").length;
    if (unreadable("first").length > 0 || filled > 0) {
      const still = unreadable("repair");
      console.warn(`[burst ${burstId}] audit: ${filled} detail(s) filled in, ${unreadable("first").length} of the order's act(s) unreadable as written, ${still.length} still after repair${still.length === 0 ? "" : `: ${still.map((entry) => `${entry.op}: ${entry.reason}`).join(" | ")}`}`);
    }

    // Every call the burst decided not to make, and why: a stage that keeps
    // being skipped for the same reason is a prompt or a router to look at.
    for (const skip of result.skipped) console.log(`[burst ${burstId}] skipped ${skip.stage}: ${skip.reason}`);
    // How much of what the world's people did belonged to a plan (gap §5).
    const plans = result.plans;
    if (plans.acted > 0 || plans.laid > 0 || plans.missed > 0) {
      console.log(`[burst ${burstId}] plans: ${plans.laid} laid, ${plans.taken} step(s) taken, ${plans.missed} missed, ${plans.woken} owner(s) woken; ${plans.actedOnAPlan} of ${plans.acted} who acted did so on a plan`);
    }
    // What the turn actually cost in seconds, per stage: the only place the
    // call budget and the player's wait are written down together.
    console.log(
      `[burst ${burstId}] ${((performance.now() - turnStartedAt) / 1000).toFixed(1)}s total | ${timed.summary()} | ${result.iterations} rounds, ${result.modelCalls + chronicle.calls} calls${result.mechanicCalls === 0 ? "" : ` (+${result.mechanicCalls} for rules)`}, stopped on ${result.stopReason}${result.parseFailures.length === 0 ? "" : `, ${result.parseFailures.length} unreadable`}${result.skipped.length === 0 ? "" : ` | skipped: ${[...new Set(result.skipped.map((skip) => skip.stage))].map((stage) => `${stage} ×${result.skipped.filter((skip) => skip.stage === stage).length}`).join(", ")}`}`,
    );

    if (hooks.afterCommit !== undefined) {
      try {
        await hooks.afterCommit(db, job, result.world, result.stopReason);
      } catch (error) {
        console.warn(`[burst ${burstId}] after the commit:`, error);
      }
    }
  } catch (error) {
    // Nothing above should reach here; if it does, the row still says so.
    console.error(`[burst ${burstId}] escaped:`, error);
    await fail(error instanceof Error ? error.message : String(error), error);
  } finally {
    clearInterval(heartbeat);
  }
}

/**
 * Everything a burst set down, as the rows `simulation_bursts.skipped` keeps:
 * calls the budget or the router turned away, answers that could not be
 * read, and fields dropped to keep an answer. Nothing here is the player's.
 */
export function workNotDone(result: Pick<BurstResult, "skipped" | "parseFailures" | "salvaged">): { stage: string; reason: string }[] {
  return [
    ...result.skipped.map((skip) => ({ stage: skip.stage, reason: skip.reason })),
    ...result.parseFailures.map((reason) => ({ stage: "unreadable", reason })),
    ...result.salvaged.map((reason) => ({ stage: "salvaged", reason })),
  ];
}

/** What the player waits: 75 s for a week, rising to 4 minutes for a month, from the order to the last commit being 40 s or so beyond it. */
export function turnBudgetMs(spanDays: number | undefined, env: Readonly<Record<string, string | undefined>> = process.env): number | null {
  const set = env.CHRONICA_TURN_BUDGET_MS?.trim();
  if (set !== undefined && set.length > 0) {
    const ms = Number(set);
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  }
  if (env.CHRONICA_HAND_RESPONDER?.trim() !== "codex") return null;
  const span = spanDays ?? 14;
  return Math.round(Math.min(240, Math.max(60, 75 + (span - 7) * 6.5)) * 1000);
}
/** A round that hangs is stopped this long after the time was spent. */
const HARD_STOP_AFTER_MS = 90_000;

/**
 * How long the simulation may run before it is told to stop, in ms, or null
 * for no deadline. `CHRONICA_BURST_DEADLINE_MS` overrides it (0 turns it
 * off). A burst answered by hand waits on a person, not a provider, so it has
 * none unless one is asked for.
 */
export function burstDeadlineMs(env: Readonly<Record<string, string | undefined>> = process.env, freeAdapter?: boolean): number | null {
  const raw = env.CHRONICA_BURST_DEADLINE_MS?.trim();
  if (raw !== undefined && raw.length > 0) {
    const ms = Number(raw);
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  }
  // A turn answered by the Codex subscription is held to what a player will wait for; one answered by a person waits on the person.
  if (freeAdapter ?? (env.CHRONICA_AI_MODE === "hand")) return null;
  return BURST_DEADLINE_MS;
}

/** `CHRONICA_COGNITION_SHARDS`: 2, 3 or 4 calls for a large cast, to measure against the default (plan §1 F). Unset means the default. */
function cognitionShardsFromEnv(): number | undefined {
  const raw = process.env.CHRONICA_COGNITION_SHARDS?.trim();
  if (raw === undefined || raw.length === 0) return undefined;
  const shards = Number(raw);
  return Number.isInteger(shards) && shards >= 1 && shards <= 6 ? shards : undefined;
}

/** A stored sort key, as the date a reader sees at the head of an entry. */
export function dateLabel(sortKey: number, clock: ScenarioClock | undefined): string | null {
  if (clock === undefined) return null;
  return formatWorldDate({ day: Math.floor(sortKey / 1440), minute: sortKey % 1440 }, clock);
}

/** Puts the player back behind the eyes they answered from, when the answer did not take. */
export async function restoreAskingCharacter(db: ChronicaDatabase, playerId: string, characterId: string): Promise<void> {
  await db.update(schema.players).set({ characterId }).where(eq(schema.players.id, playerId)).catch(() => undefined);
}

export { ABANDONED_ERROR };
