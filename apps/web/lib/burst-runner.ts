import { InsufficientCoinsError, createAiAdapter, createTimedPort } from "@chronica/ai";
import {
  WorldRevisionConflictError,
  WorldWouldNotLoadError,
  appendBurstProgress,
  commitBurst,
  expireStaleHolds,
  factRowOf,
  failBurst,
  findRunningBurst,
  getOpenDecision,
  getWorldView,
  heartbeatBurst,
  listPendingEvents,
  listRecentFacts,
  reapStaleBursts,
  schema,
  startBurst,
  subjectsOfRecentReports,
  titlesOfRecentReports,
  type ChronicaDatabase,
} from "@chronica/db";
import { FactSchema, abortsTheTurn, formatWorldDate, type Fact, type Office, type OrderPartyRef, type ScenarioClock, type WorldState } from "@chronica/shared";
import { DEFAULT_BUDGET, closeTheBooks, createWindowWriter, runSimulationBurst, type AnsweredDecision, type BurstProgress, type ChronicleEntry } from "@chronica/sim";
import { eq } from "drizzle-orm";
import { ABANDONED_ERROR, BURST_STALE_MS, HEARTBEAT_MS, STALE_HOLD_MS } from "./burst-status";

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
  readonly recentTitles: Awaited<ReturnType<typeof titlesOfRecentReports>>;
  readonly orderText: string | null;
  readonly spanDays: number | undefined;
  readonly answeredDecision: AnsweredDecision | undefined;
  /** The decision this burst answers, closed with the commit. */
  readonly resolvesDecision: { readonly id: string; readonly optionId: string } | undefined;
  /** Whose eyes the player answered from, restored if the answer does not take (a succession swaps them before the burst). */
  readonly askedAs: string | undefined;
}

export type PreparedBurst = { readonly status: "ready"; readonly job: BurstJob } | { readonly status: "error"; readonly message: string };

/** Everything the request must settle before the burst is handed off. */
export async function prepareBurst(
  db: ChronicaDatabase,
  input: {
    readonly gameId: string;
    readonly userId: string;
    readonly playerId: string;
    readonly characterId: string;
    readonly orderText: string | null;
    readonly spanDays?: number | undefined;
    readonly answeredDecision?: AnsweredDecision | undefined;
    readonly resolvesDecision?: { readonly id: string; readonly optionId: string } | undefined;
    readonly askedAs?: string | undefined;
  },
): Promise<PreparedBurst> {
  const { gameId, userId, playerId, characterId } = input;
  // What an earlier process left behind: a burst that stopped beating, and
  // the coins a call it never finished still holds. Cleared before the guards
  // are read, so a dead burst never refuses a live order.
  const now = Date.now();
  const [reaped, expired] = await Promise.all([
    reapStaleBursts(db, gameId, new Date(now - BURST_STALE_MS), ABANDONED_ERROR),
    expireStaleHolds(db, new Date(now - STALE_HOLD_MS)),
  ]);
  if (reaped > 0 || expired > 0) console.warn(`[game ${gameId}] cleared ${reaped} abandoned burst(s) and ${expired} stale coin hold(s)`);
  // Everything the turn reads, in one round of the database rather than seven.
  const [view, open, running, factRows, queueRows, recentSubjects, recentTitles] = await Promise.all([
    getWorldView(db, gameId),
    getOpenDecision(db, gameId),
    findRunningBurst(db, gameId, new Date(Date.now() - BURST_STALE_MS)),
    listRecentFacts(db, gameId),
    listPendingEvents(db, gameId),
    subjectsOfRecentReports(db, gameId),
    titlesOfRecentReports(db, gameId),
  ]);
  if (view === undefined) return { status: "error", message: "This world has no state to act on yet." };
  if (view.scenarioClock === undefined) return { status: "error", message: "This scenario declares no clock." };
  if (view.scenarioWarfare === undefined) return { status: "error", message: "This scenario declares no rules of war." };
  // An answer carries its own decision, and is the one order allowed to run
  // while one is open -- it is what closes it.
  if (input.answeredDecision === undefined && open !== undefined) return { status: "error", message: "A decision is waiting on you before the world can move on." };
  // One burst at a time, and refused at the door rather than at the commit.
  if (running !== undefined) return { status: "error", message: "The world is already moving on an earlier order. Wait for it to settle." };

  const actorRef: OrderPartyRef = { kind: "character", id: characterId };
  const actorPolityId = view.world.characters.find((character) => character.id === characterId)?.polityId ?? null;
  const burstId = await startBurst(db, { gameId, playerUserId: userId, orderText: input.orderText ?? "(time passes)" });
  return {
    status: "ready",
    job: {
      gameId,
      burstId,
      userId,
      playerId,
      actorRef,
      actorPolityId,
      view,
      // Offices are scenario data, not world state, and authority derivation needs them.
      offices: view.scenarioGovernment?.offices ?? [],
      knownFacts: factRows.flatMap((row) => {
        const parsed = FactSchema.safeParse(row.fact);
        return parsed.success ? [parsed.data] : [];
      }),
      queue: queueRows.map((row) => ({ id: row.id, dueInstantSortKey: row.dueInstantSortKey, kind: row.kind, summary: row.summary, payload: row.payload })),
      recentSubjects,
      recentTitles,
      orderText: input.orderText,
      spanDays: input.spanDays,
      answeredDecision: input.answeredDecision,
      resolvesDecision: input.resolvesDecision,
      askedAs: input.askedAs,
    },
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
  readonly afterCommit?: ((db: ChronicaDatabase, job: BurstJob, world: WorldState) => Promise<void>) | undefined;
  /** Also shown on the terminal, when there is one. */
  readonly onProgress?: ((line: ProgressLine) => void) | undefined;
}

/**
 * Runs a prepared burst to its commit, or to a `failed` row that says why.
 *
 * Never throws for the player's sake: whatever goes wrong, the burst row ends
 * in a state the page can read. It heartbeats while it runs so a process that
 * dies mid-turn is found out by its silence rather than by a clock.
 */
export async function runBurstToCommit(db: ChronicaDatabase, job: BurstJob, hooks: RunHooks = {}): Promise<void> {
  const { gameId, burstId, userId, actorRef, actorPolityId, view, offices } = job;
  const heartbeat = setInterval(() => { void heartbeatBurst(db, burstId).catch(() => undefined); }, HEARTBEAT_MS);
  const say = (line: ProgressLine): void => {
    hooks.onProgress?.(line);
    // Fire and forget: the burst never waits on its own commentary.
    void appendBurstProgress(db, { gameId, burstId, kind: "progress", payload: line }).catch(() => undefined);
  };
  const fail = async (message: string): Promise<void> => {
    await failBurst(db, burstId, message).catch(() => undefined);
    if (job.askedAs !== undefined) await restoreAskingCharacter(db, job.playerId, job.askedAs);
  };

  try {
    const timed = createTimedPort({ db, userId, gameId, adapter: createAiAdapter() });
    const port = timed.port;
    const turnStartedAt = performance.now();
    const from = view.world.instant;
    const clock = view.scenarioClock!;

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
      onEntry: async (entry, window) => {
        ordinal += 1;
        await appendBurstProgress(db, {
          gameId,
          burstId,
          kind: "chronicle_entry",
          payload: {
            window,
            ordinal,
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
        }).catch(() => undefined);
      },
    });

    let result;
    try {
      result = await runSimulationBurst({
        world: view.world,
        clock: view.scenarioClock!,
        offices,
        // How those offices are filled, so a consulship that runs out is
        // refilled by election rather than left empty for good.
        ...(view.scenarioGovernment === undefined ? {} : { successionRules: view.scenarioGovernment.successionRules }),
        warfare: view.scenarioWarfare!,
        ...(view.scenarioMap === undefined ? {} : { terrains: view.scenarioMap.terrains }),
        ...(view.scenarioLife === undefined ? {} : { life: view.scenarioLife }),
        ...(view.scenarioWealth === undefined ? {} : { wealth: view.scenarioWealth }),
        ...(view.scenarioHistoricalPressures === undefined ? {} : { historicalPressures: view.scenarioHistoricalPressures }),
        burstId,
        gameId,
        actorRef,
        actorPolityId,
        orderText: job.orderText,
        ...(job.spanDays === undefined ? {} : { spanDays: job.spanDays }),
        onProgress: (progress: BurstProgress) => say(phrase(progress)),
        onWindowClosed: writer.closed,
        ...(job.answeredDecision === undefined ? {} : { answeredDecision: job.answeredDecision }),
        knownFacts: job.knownFacts,
        queue: job.queue,
        port,
        ...(cognitionShardsFromEnv() === undefined ? {} : { budget: { ...DEFAULT_BUDGET, cognitionShards: cognitionShardsFromEnv() } }),
      });
    } catch (error) {
      if (error instanceof InsufficientCoinsError) { await fail("You have run out of coins."); return; }
      // The provider refusing every call -- no credit on the account, a key it
      // will not take -- stops the turn before anything is saved, and says so,
      // rather than a season passing in which nothing came of the order.
      if (abortsTheTurn(error)) {
        console.error(`[burst ${burstId}] the model provider refused the turn:`, error);
        await fail("The model provider refused the request (its account may be out of credit). Nothing was saved and your world is unchanged; try again once it is restored.");
        return;
      }
      console.error(`[burst ${burstId}] the burst failed:`, error);
      await fail(error instanceof Error ? error.message : String(error));
      return;
    }

    say({ stage: "chronicling", line: "The historian finishes writing." });
    // The last window closes as the burst returns; this waits for it to be
    // written, and for the closing passage if no window told anything. Whatever the historian does, the turn has happened: the
    // facts are kept either way, only the prose is lost.
    const chronicle = await writer.finish();

    // And the books close because the calendar turned, not because anybody
    // asked. No model call, no historian, no judgment -- arithmetic. They
    // follow the passages rather than being sorted among them: the passages
    // are already in time order and the page has already shown them so.
    const entries: ChronicleEntry[] = [
      ...chronicle.entries,
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

    say({ stage: "committing", line: "The record is entered." });
    try {
      await commitBurst(db, {
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
      });
    } catch (error) {
      if (error instanceof WorldRevisionConflictError) { await fail("The world moved while your order was being carried out. Try again."); return; }
      if (error instanceof WorldWouldNotLoadError) {
        console.error(`[burst ${burstId}] ${error.message}`);
        await fail("Something in this turn would have damaged the save, so it was not kept. Your world is as it was; try the order again.");
        return;
      }
      console.error(`[burst ${burstId}] the commit failed:`, error);
      await fail(error instanceof Error ? error.message : String(error));
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
    // What the turn actually cost in seconds, per stage: the only place the
    // call budget and the player's wait are written down together.
    console.log(
      `[burst ${burstId}] ${((performance.now() - turnStartedAt) / 1000).toFixed(1)}s total | ${timed.summary()} | ${result.iterations} rounds, ${result.modelCalls + chronicle.calls} calls${result.mechanicCalls === 0 ? "" : ` (+${result.mechanicCalls} for rules)`}, stopped on ${result.stopReason}${result.parseFailures.length === 0 ? "" : `, ${result.parseFailures.length} unreadable`}${result.skipped.length === 0 ? "" : ` | skipped: ${(["cognition", "reconcile", "repair"] as const).map((stage) => `${stage} ×${result.skipped.filter((skip) => skip.stage === stage).length}`).join(", ")}`}`,
    );

    if (hooks.afterCommit !== undefined) {
      try {
        await hooks.afterCommit(db, job, result.world);
      } catch (error) {
        console.warn(`[burst ${burstId}] after the commit:`, error);
      }
    }
  } catch (error) {
    // Nothing above should reach here; if it does, the row still says so.
    console.error(`[burst ${burstId}] escaped:`, error);
    await fail(error instanceof Error ? error.message : String(error));
  } finally {
    clearInterval(heartbeat);
  }
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
async function restoreAskingCharacter(db: ChronicaDatabase, playerId: string, characterId: string): Promise<void> {
  await db.update(schema.players).set({ characterId }).where(eq(schema.players.id, playerId)).catch(() => undefined);
}

export { ABANDONED_ERROR };
