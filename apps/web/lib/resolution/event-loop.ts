import "server-only";

import {
  MAX_REACTION_CAUSAL_DEPTH,
  REAL_AGENT_SELECTOR,
  addMinutes,
  compareWorldInstant,
  emitFacts,
  factualEventToFact,
  midnight,
  nextDueEvent,
  type ActionPlan,
  type AffectedAgentSelection,
  type AffectedAgentSelector,
  type Fact,
  type FactualEvent,
  type InterventionDecision,
  type WorldEventKind,
  type WorldEventRecord,
  type WorldInstant,
  type WorldState,
} from "@chronica/shared";
import {
  claimWorldEvent,
  insertWorldEvents,
  listDuePendingEvents,
  releaseExpiredWorldEventClaims,
  type ChronicaDatabase,
  type NewWorldEvent,
} from "@chronica/db";
import { runMidnightTick } from "./midnight-tick";
import { resolveActionPhase } from "./action-phase-tick";

/**
 * Per-event-instant resolution loop (docs/32, Phase 7): the mechanism that
 * replaces one unconditional per-turn `advanceWorldDynamics` call with a
 * queue-driven loop that (1) selects the next due event by exact time,
 * (2) applies one action phase or world-process tick, (3) emits Facts,
 * (4) hands off to Part B's agent selector, (5) enforces the 3-causal-layer
 * reaction cap, (6) schedules resulting events, and (7) continues to a
 * decision point or the current window's end.
 */

/**
 * The loop's only dependency on persistence, isolated behind a small port so
 * `advanceEventQueue` itself is a pure-ish, DB-agnostic orchestration
 * function testable with an in-memory fake (`event-loop.test.ts`) rather
 * than a live database. `createDbEventQueuePort` below is the real adapter,
 * a thin wrapper over `packages/db/src/queries/events.ts`.
 */
export interface EventQueuePort {
  listDuePendingEvents(atOrBefore: WorldInstant): Promise<WorldEventRecord[]>;
  claimEvent(id: string): Promise<boolean>;
  /**
   * Only ever used to seed a future placeholder (`ensureMidnightTickSeeded`/
   * `ensureProjectTicksSeeded`) -- an unresolved, idempotently-checked
   * pending row that carries no turn content, so writing it immediately
   * (outside the eventual commit transaction) is safe: if the turn never
   * commits, the seeded row simply sits pending, exactly as if this turn had
   * not run at all. The loop's OWN resolutions and follow-up events
   * (docs/32 corrective pass, requirement 4) are never written through this
   * port -- see `EventLoopResult.pendingEventInserts`/`pendingResolutions`.
   */
  insertEvents(events: readonly NewWorldEvent[]): Promise<void>;
}

export function createDbEventQueuePort(db: ChronicaDatabase, gameId: string, claimedBy = "event-loop"): EventQueuePort {
  return {
    listDuePendingEvents: (atOrBefore) => listDuePendingEvents(db, gameId, atOrBefore),
    claimEvent: (id) => claimWorldEvent(db, id, claimedBy, new Date(Date.now() + 60_000), null),
    insertEvents: async (events) => {
      if (events.length > 0) await insertWorldEvents(db, gameId, events);
    },
  };
}

export interface EventHandlerResult {
  readonly world: WorldState;
  readonly events: readonly Omit<FactualEvent, "id">[];
  /** Additional events this handler wants scheduled as a direct consequence of resolving this one. */
  readonly followUpEvents?: readonly Omit<NewWorldEvent, "gameId">[];
  /** True if this handler's output should stop the loop at a decision point rather than continuing. */
  readonly requiresPlayerDecision?: boolean;
}

export type EventHandler = (world: WorldState, event: WorldEventRecord, atStep: number) => EventHandlerResult | Promise<EventHandlerResult>;

/** One handler per non-midnight event kind; `midnight_tick` is always `runMidnightTick`, not overridable. */
export interface EventLoopHandlers {
  readonly action_phase?: EventHandler;
  readonly world_process_tick?: EventHandler;
  readonly order_deadline?: EventHandler;
  readonly reaction_window?: EventHandler;
}

const noOpHandler: EventHandler = (world) => ({ world, events: [] });

/**
 * The event loop's dependency on the multi-agent runtime (docs/32
 * corrective pass, requirement 3) -- isolated behind a port for exactly the
 * same reason `EventQueuePort` is: the loop's own ordering/dispatch logic
 * stays testable with an in-memory fake, with no AI adapter involved. The
 * real implementation (`apps/web/lib/resolution/agents/reaction-runner.ts`)
 * runs each selected NPC/star-context agent sequentially, with
 * `deferMutations` on, and converts their validated actions into the
 * `scheduledEvents` this returns.
 */
export interface AffectedAgentRunnerInput {
  readonly world: WorldState;
  readonly selection: AffectedAgentSelection;
  readonly event: WorldEventRecord;
  readonly facts: readonly Fact[];
  readonly atStep: number;
}
export interface AffectedAgentRunnerResult {
  readonly scheduledEvents: readonly Omit<NewWorldEvent, "gameId">[];
}
export interface AffectedAgentRunner {
  runReactions(input: AffectedAgentRunnerInput): Promise<AffectedAgentRunnerResult>;
}
export const NO_OP_AGENT_RUNNER: AffectedAgentRunner = { runReactions: () => Promise.resolve({ scheduledEvents: [] }) };

export interface EventLoopOptions {
  readonly gameId: string;
  readonly handlers?: EventLoopHandlers;
  readonly agentSelector?: AffectedAgentSelector;
  readonly agentRunner?: AffectedAgentRunner;
  /** Safety valve so one turn's resolution cannot loop indefinitely. Default 200. */
  readonly maxEventsPerCall?: number;
  /**
   * Unified action runtime, Stage 5: called after each event's own facts and
   * immediate reactions are folded in, with every fact this loop has
   * produced so far (a caller with facts from BEFORE this call started, e.g.
   * the turn's own actor agents, folds those in via closure) and the
   * world's current plans. Returning `requiresIntervention: true` stops the
   * loop at a real decision point -- `stopReason: "decision_point"`, with
   * the decision itself on `EventLoopResult.interventionDecision` -- instead
   * of continuing to the next due event or window end. Absent for a caller
   * that wants the pre-Stage-5 behavior of running unconditionally to
   * window end or budget (the pre-turn backlog catch-up, which runs before
   * the player's own directives are even evaluated, still does this).
   */
  readonly checkIntervention?: (factsSoFar: readonly Fact[], plans: readonly ActionPlan[]) => InterventionDecision;
}

export interface EventLoopResult {
  readonly world: WorldState;
  readonly facts: Fact[];
  /**
   * Every handler's raw `Omit<FactualEvent, "id">` output, in resolution
   * order -- preserved alongside `facts` so an existing caller built around
   * `advanceWorldDynamics`'s `{world, events}` shape (e.g. `pipeline.ts`'s
   * `factualEvents` construction) can keep working unchanged during
   * migration, without needing to reconstruct a `FactualEvent` from a `Fact`
   * (the two are not losslessly convertible -- `Fact` does not retain
   * `actorId`/`parameters`/`materialConsequence`).
   */
  readonly handlerEvents: Omit<FactualEvent, "id">[];
  readonly resolvedEventIds: string[];
  readonly stoppedAt: WorldInstant;
  readonly stopReason: "window_end" | "decision_point" | "budget_exhausted";
  readonly agentSelections: readonly { readonly event: WorldEventRecord; readonly selection: AffectedAgentSelection }[];
  /**
   * Follow-up/self-scheduled events this run produced, staged for the
   * caller to persist inside the SAME transaction as the turn's committed
   * snapshot (docs/32 corrective pass, requirement 4) -- never written here.
   */
  readonly pendingEventInserts: readonly Omit<NewWorldEvent, "gameId">[];
  /** Which claimed events this run resolved, and with which fact ids -- staged for the same commit transaction. */
  readonly pendingResolutions: readonly { readonly id: string; readonly atStep: number; readonly factIds: readonly string[] }[];
  /** Set only when `checkIntervention` is what caused a "decision_point" stop (unified action runtime, Stage 5). */
  readonly interventionDecision?: InterventionDecision;
}

const DEFAULT_MAX_EVENTS_PER_CALL = 200;

/**
 * Ensures the next day's `midnight_tick` gets enqueued once the current
 * day's resolves, the way `advanceWorldDevelopments` already self-schedules
 * its next review. Callers seed day 0's tick once at game start.
 */
function nextMidnightTickInput(gameId: string, day: number, atStep: number): NewWorldEvent {
  return {
    kind: "midnight_tick",
    instant: midnight(day),
    subjectRef: { kind: "world", id: gameId },
    payload: { kind: "midnight_tick" },
    createdAtStep: atStep,
  };
}

function handlerFor(kind: WorldEventKind, handlers: EventLoopHandlers | undefined): EventHandler {
  if (kind === "midnight_tick") return (world, _event, atStep) => runMidnightTick(world, atStep);
  // docs/32 corrective pass, requirement 3: `action_phase` always resolves
  // through the real workflow executor by default -- a caller may still
  // override it (tests do, to isolate ordering/dispatch logic with a fake
  // handler), but production callers no longer need to remember to wire
  // this in for a scheduled reaction to ever take effect.
  if (kind === "action_phase") return handlers?.action_phase ?? resolveActionPhase;
  return handlers?.[kind] ?? noOpHandler;
}

/**
 * Runs the loop against an injected `EventQueuePort`. Production callers use
 * `advanceEventQueue` below (which wires the real DB port); tests inject an
 * in-memory fake to exercise the ordering/dispatch/reaction-cap logic
 * without a live database.
 */
export async function advanceEventQueueWithPort(
  port: EventQueuePort,
  gameId: string,
  world: WorldState,
  windowEnd: WorldInstant,
  atStep: number,
  options: Omit<EventLoopOptions, "gameId">,
): Promise<EventLoopResult> {
  // docs/32 corrective pass, requirement 3: the live path now uses the real,
  // fact-scoped, budget-respecting selector by default -- `NO_OP_AGENT_SELECTOR`
  // remains available (`@chronica/shared`) for a caller that explicitly wants
  // no selection (e.g. a test isolating unrelated loop behavior).
  const agentSelector = options.agentSelector ?? REAL_AGENT_SELECTOR;
  const maxEvents = options.maxEventsPerCall ?? DEFAULT_MAX_EVENTS_PER_CALL;

  let currentWorld = world;
  const allFacts: Fact[] = [];
  const allHandlerEvents: Omit<FactualEvent, "id">[] = [];
  const resolvedEventIds: string[] = [];
  const agentSelections: { event: WorldEventRecord; selection: AffectedAgentSelection }[] = [];
  const pendingResolutions: { id: string; atStep: number; factIds: readonly string[] }[] = [];
  let stoppedAt: WorldInstant = world.instant ?? midnight(0);
  let stopReason: EventLoopResult["stopReason"] = "window_end";
  let interventionDecision: InterventionDecision | undefined;
  let exhaustedBudget = true;

  // A follow-up this loop schedules (a handler's own, or a reaction's) is
  // visible to THIS SAME call's later iterations -- staged in memory with a
  // synthetic id rather than the DB port, exactly the way `pendingEventInserts`
  // below is never written until the caller's own commit. Without this, a
  // multi-day elastic continuation (unified action runtime, Stage 5) could
  // never resolve a same-run follow-up (e.g. a reaction due an hour later)
  // until a LATER call's pre-turn catch-up picked it up from the DB.
  const stagedPending = new Map<string, WorldEventRecord>();
  const stagedOriginals = new Map<string, Omit<NewWorldEvent, "gameId">>();
  let stagedIdCounter = 0;

  for (let i = 0; i < maxEvents; i += 1) {
    const dbPending = await port.listDuePendingEvents(windowEnd);
    const due = nextDueEvent([...dbPending, ...stagedPending.values()], windowEnd);
    if (due === null) {
      stopReason = "window_end";
      exhaustedBudget = false;
      break;
    }

    const isStaged = stagedPending.has(due.id);
    if (isStaged) {
      stagedPending.delete(due.id);
    } else {
      const claimed = await port.claimEvent(due.id);
      if (!claimed) continue; // lost the race to another resolver; re-select next iteration.
    }

    stoppedAt = due.instant;
    const handler = handlerFor(due.kind, options.handlers);
    const result = await handler(currentWorld, due, atStep);
    currentWorld = result.world;
    allHandlerEvents.push(...result.events);

    const draftedFacts = result.events.map((eventDraft, index) =>
      factualEventToFact({ ...eventDraft, id: `${due.id}-${index}` }, due.instant, "public", undefined, {
        sourceEventId: due.id,
        causalDepth: due.causalDepth,
      }),
    );
    const newFacts = emitFacts(draftedFacts.map(({ id: _id, ...draft }) => draft));
    allFacts.push(...newFacts);

    const selection = agentSelector.selectAffectedAgents(currentWorld, newFacts, due);
    agentSelections.push({ event: due, selection });

    // docs/32 corrective pass, requirement 3: real NPC/star-context agents,
    // run sequentially against the world as it stands at THIS point in the
    // loop (never a frozen pre-turn snapshot) -- their validated actions
    // come back as scheduled events, not immediate mutations, and feed the
    // exact same causal-depth-capped follow-up scheduling below.
    const agentRunner = options.agentRunner ?? NO_OP_AGENT_RUNNER;
    const reactionEvents = selection.npcCharacterIds.length + selection.starContextRefs.length > 0
      ? (await agentRunner.runReactions({ world: currentWorld, selection, event: due, facts: newFacts, atStep })).scheduledEvents
      : [];

    // The 3-causal-layer reaction cap: a follow-up past MAX_REACTION_CAUSAL_DEPTH
    // does not enqueue immediately -- it is recorded as "scheduled later" and
    // reopens as a fresh, depth-reset chain at least a day out.
    const followUps: NewWorldEvent[] = [];
    for (const followUp of [...(result.followUpEvents ?? []), ...reactionEvents]) {
      const proposedDepth = due.causalDepth + 1;
      if (proposedDepth > MAX_REACTION_CAUSAL_DEPTH) {
        followUps.push({ ...followUp, instant: addMinutes(midnight(due.instant.day + 1), followUp.instant.minute), causalDepth: 0, causedByEventId: due.id });
      } else {
        followUps.push({ ...followUp, causalDepth: proposedDepth, causedByEventId: due.id });
      }
    }
    // `midnight_tick` always self-schedules the next day's tick, mirroring
    // `advanceWorldDevelopments`'s existing self-scheduling of its next review.
    if (due.kind === "midnight_tick") {
      followUps.push(nextMidnightTickInput(gameId, due.instant.day + 1, atStep));
    }
    // docs/32 corrective pass, requirement 4: neither the follow-up events
    // nor this event's own resolution are written here -- both are staged
    // for the caller to persist inside the same transaction as the turn's
    // committed snapshot, so a turn that fails after this point leaves no
    // resolved event or fact behind. Staged in memory (see above) rather
    // than immediately, so a follow-up due within this same call's window
    // is still resolved here, not merely re-discovered by a future call.
    for (const followUp of followUps) {
      const stagedId = `staged-${stagedIdCounter += 1}`;
      stagedOriginals.set(stagedId, followUp);
      stagedPending.set(stagedId, {
        id: stagedId,
        gameId,
        scheduledForTurnId: null,
        kind: followUp.kind,
        status: "pending",
        instant: followUp.instant,
        priority: followUp.priority ?? 0,
        isPlayerAction: followUp.isPlayerAction ?? false,
        subjectRef: followUp.subjectRef,
        actionId: followUp.actionId ?? null,
        operationId: followUp.operationId ?? null,
        payload: followUp.payload,
        causalDepth: followUp.causalDepth ?? 0,
        causedByEventId: followUp.causedByEventId ?? null,
        causedByFactId: followUp.causedByFactId ?? null,
        createdAtStep: followUp.createdAtStep,
        resolvedAtStep: null,
        resolvedFactIds: [],
      });
    }
    // A staged follow-up this same call already resolved never touched the
    // DB, so there is no real row for the caller to mark resolved either --
    // only a genuinely DB-sourced due event gets a pendingResolutions entry.
    if (!isStaged) pendingResolutions.push({ id: due.id, atStep, factIds: newFacts.map((f) => f.id) });
    resolvedEventIds.push(due.id);

    if (result.requiresPlayerDecision) {
      stopReason = "decision_point";
      exhaustedBudget = false;
      break;
    }

    // Unified action runtime, Stage 5: the real player-intervention decision,
    // evaluated after this event and its immediate reaction window -- the
    // design's own step 7. A caller with nothing to add (the pre-turn
    // backlog catch-up) simply omits `checkIntervention` and this is a no-op.
    if (options.checkIntervention) {
      const decision = options.checkIntervention(allFacts, currentWorld.plans ?? []);
      if (decision.requiresIntervention) {
        interventionDecision = decision;
        stopReason = "decision_point";
        exhaustedBudget = false;
        break;
      }
    }
  }

  if (exhaustedBudget) stopReason = "budget_exhausted";

  // Whatever is still staged and unresolved at the end of this run -- never
  // written by the loop itself -- is exactly what the caller must persist as
  // still-pending, alongside any follow-up never even reached this call's
  // window (which was never staged in memory in the first place; see below).
  const pendingEventInserts: Omit<NewWorldEvent, "gameId">[] = [...stagedPending.keys()].map((id) => stagedOriginals.get(id)!);

  return {
    world: { ...currentWorld, instant: stoppedAt },
    facts: allFacts,
    handlerEvents: allHandlerEvents,
    resolvedEventIds,
    pendingEventInserts,
    pendingResolutions,
    stoppedAt,
    stopReason,
    agentSelections,
    ...(interventionDecision !== undefined ? { interventionDecision } : {}),
  };
}

/**
 * Guarantees at least one pending `midnight_tick` exists at or before `day`
 * before the loop runs, so a game with no seeded queue yet (every game
 * predating this phase, and a brand-new game before its first turn) still
 * gets its daily background resolution. Idempotent: a no-op once a pending
 * tick for the day already exists (including one this same call already
 * seeded on a prior turn, or one a previous tick's own self-scheduling
 * already produced).
 */
export async function ensureMidnightTickSeeded(port: EventQueuePort, gameId: string, day: number, atStep: number): Promise<void> {
  const pending = await port.listDuePendingEvents(midnight(day));
  if (pending.some((event) => event.kind === "midnight_tick")) return;
  await port.insertEvents([
    {
      kind: "midnight_tick",
      instant: midnight(day),
      subjectRef: { kind: "world", id: gameId },
      payload: { kind: "midnight_tick" },
      createdAtStep: atStep,
    },
  ]);
}

/** Production entry point: wires the real DB-backed `EventQueuePort`. */
export async function advanceEventQueue(
  db: ChronicaDatabase,
  world: WorldState,
  windowEnd: WorldInstant,
  atStep: number,
  options: EventLoopOptions,
): Promise<EventLoopResult> {
  await releaseExpiredWorldEventClaims(db, options.gameId);
  const port = createDbEventQueuePort(db, options.gameId);
  await ensureMidnightTickSeeded(port, options.gameId, windowEnd.day, atStep);
  return advanceEventQueueWithPort(port, options.gameId, world, windowEnd, atStep, options);
}

export { compareWorldInstant };
