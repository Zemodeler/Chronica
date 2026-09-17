import {
  addMinutes,
  advanceWorldTo,
  type Fact,
  type Office,
  type OrderPartyRef,
  type PlayerDecision,
  type Proposal,
  type ScenarioClock,
  type StopReason,
  type WorldInstant,
  type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { AuthorityBreach } from "./apply/context";
import { routeAttention, type RoutedActor } from "./attention";
import { runCognition } from "./cognition";
import { materializeFacts } from "./facts";
import { orchestrate } from "./orchestrate";
import { createIdFactory, type SimModelPort } from "./ports";
import { buildWorldSlice, type SliceEvent } from "./slice";
import { runDeterministicTick } from "./tick";

/**
 * One simulation burst: everything that happens between the player pressing
 * send and the world handing control back (VISION §33).
 *
 * The shape of the loop is what keeps it affordable. Only three stages call a
 * model -- orchestration, batched cognition, and (outside this function) the
 * Chronicle. Everything else -- attention, arithmetic, authority, scheduling,
 * pressure, stopping -- is deterministic, which is why a normal interaction
 * costs two to four calls rather than dozens (VISION §29).
 */

export interface SimulationBudget {
  readonly maxIterations: number;
  readonly maxModelCalls: number;
  readonly maxSimulatedDays: number;
  readonly maxCausalDepth: number;
  readonly maxFocusedActors: number;
  readonly pressureThreshold: number;
}

export const DEFAULT_BUDGET: SimulationBudget = {
  maxIterations: 3,
  maxModelCalls: 4,
  maxSimulatedDays: 90,
  maxCausalDepth: 3,
  maxFocusedActors: 3,
  pressureThreshold: 100,
};

export interface ScheduledEventDraft {
  readonly id: string;
  readonly dueInstantSortKey: number;
  readonly kind: string;
  readonly summary: string;
  readonly payload: unknown;
  readonly causeFactId: string | null;
  readonly causalDepth: number;
}

/** An event the queue is still holding, as the burst needs to see it. */
export interface PendingEvent {
  readonly id: string;
  readonly dueInstantSortKey: number;
  readonly kind: string;
  readonly summary: string;
}

export interface BurstInput {
  readonly world: WorldState;
  readonly clock: ScenarioClock;
  readonly offices: readonly Office[];
  readonly burstId: string;
  readonly gameId: string;
  readonly actorRef: OrderPartyRef;
  readonly actorPolityId: string | null;
  readonly orderText: string | null;
  /** History already on record, for the slice and for visibility checks. */
  readonly knownFacts: readonly Fact[];
  /** Everything the queue still owes the world, due or not. */
  readonly queue: readonly PendingEvent[];
  readonly port: SimModelPort;
  readonly budget?: SimulationBudget;
}

export interface BurstResult {
  readonly world: WorldState;
  readonly newFacts: readonly Fact[];
  /** Fact id → the significance its author assigned it, for storage and pacing. */
  readonly significanceByFactId: ReadonlyMap<string, number>;
  readonly scheduled: readonly ScheduledEventDraft[];
  /** Queue entries this burst consumed, for the caller to retire. */
  readonly firedEventIds: readonly string[];
  readonly iterations: number;
  readonly modelCalls: number;
  readonly outcome: "continue" | "chronicle" | "player_decision";
  readonly stopReason: StopReason;
  readonly accumulatedSignificance: number;
  /** What happened, in the actors' own words -- the Chronicle's raw material. */
  readonly narrative: readonly string[];
  readonly frictions: readonly string[];
  readonly breaches: readonly AuthorityBreach[];
  readonly playerDecision: PlayerDecision | null;
  readonly parseFailures: readonly string[];
}

/** How long a reaction takes to form, when nothing scheduled says otherwise. */
const REACTION_DELAY_DAYS = 2;

export async function runSimulationBurst(input: BurstInput): Promise<BurstResult> {
  const budget = input.budget ?? DEFAULT_BUDGET;
  const ids = createIdFactory(input.burstId);
  const startDay = input.world.instant.day;

  let world = input.world;
  let modelCalls = 0;
  let iterations = 0;
  let significance = 0;
  const newFacts: Fact[] = [];
  const significanceByFactId = new Map<string, number>();
  const scheduled: ScheduledEventDraft[] = [];
  const narrative: string[] = [];
  const frictions: string[] = [];
  const breaches: AuthorityBreach[] = [];
  const parseFailures: string[] = [];
  let playerDecision: PlayerDecision | null = null;
  let stopReason: StopReason = "no_due_events";

  /** Applies one actor's proposal: deltas, then the facts and events it produced. */
  const applyProposal = (proposal: Proposal, actorRef: OrderPartyRef, causalDepth: number): void => {
    const result = applyDeltas(world, proposal.deltas, {
      now: world.instant,
      actorRef,
      offices: input.offices,
      ids,
      gameId: input.gameId,
    });
    world = result.world;
    breaches.push(...result.breaches);
    frictions.push(...proposal.frictions, ...result.rejected.map((rejection) => rejection.reason));

    const materialized = materializeFacts({
      proposals: proposal.facts,
      now: world.instant,
      atStep: world.elapsedStep,
      ids,
      causalDepth,
      assignedIds: result.assignedIds,
    });
    newFacts.push(...materialized.facts);
    for (const [factId, weight] of materialized.significanceByFactId) significanceByFactId.set(factId, weight);
    significance += materialized.significance;

    // A refused delta is still history: the world tried and could not, and the
    // player deserves to learn that from the Chronicle rather than silence.
    for (const rejection of result.rejected) {
      const friction = materializeFacts({
        proposals: [{
          localId: `friction_${scheduled.length}_${newFacts.length}`,
          kind: "execution_friction",
          summary: rejection.reason,
          affectedRefs: [actorRef],
          visibility: "polity",
          discoveryState: "polity",
          knowableInDays: 0,
          significance: 5,
        }],
        now: world.instant,
        atStep: world.elapsedStep,
        ids,
        causalDepth,
        assignedIds: result.assignedIds,
      });
      newFacts.push(...friction.facts);
      for (const [factId, weight] of friction.significanceByFactId) significanceByFactId.set(factId, weight);
      significance += friction.significance;
    }

    for (const event of proposal.schedule) {
      scheduled.push({
        id: ids.next("event"),
        dueInstantSortKey: (world.instant.day + event.dueInDays) * 1440 + world.instant.minute,
        kind: event.kind,
        summary: event.summary,
        payload: { subjectRefs: event.subjectRefs.map((ref) => result.assignedIds.get(ref.replace(/^local:/, "")) ?? ref) },
        causeFactId: event.causeFactLocalId === null ? null : materialized.factIds.get(event.causeFactLocalId) ?? null,
        causalDepth: causalDepth + 1,
      });
    }

    world = recordDelegations(world, proposal.delegations, ids, result.assignedIds);
    narrative.push(proposal.narrativeSummary);
  };

  const firedEventIds: string[] = [];
  const nowKey = () => world.instant.day * 1440 + world.instant.minute;

  /**
   * Everything that fell due on the way here: revenue collected, wages paid,
   * milestones reached. Deterministic, and therefore free.
   */
  const tickTo = (toDay: number): void => {
    const ticked = runDeterministicTick({ world, toDay, ids });
    world = ticked.world;
    if (ticked.factProposals.length > 0) {
      const materialized = materializeFacts({
        proposals: ticked.factProposals,
        now: world.instant,
        atStep: world.elapsedStep,
        ids,
        causalDepth: 0,
        assignedIds: new Map(),
      });
      newFacts.push(...materialized.facts);
      for (const [factId, weight] of materialized.significanceByFactId) significanceByFactId.set(factId, weight);
      significance += materialized.significance;
    }
    narrative.push(...ticked.notes);
  };

  /** Retires queue entries whose moment has arrived; the tick above is what actually resolved them. */
  const fireDueEvents = (): void => {
    for (const event of input.queue) {
      if (firedEventIds.includes(event.id)) continue;
      if (event.dueInstantSortKey <= nowKey()) firedEventIds.push(event.id);
    }
  };

  // Catch up before reading the order: anything that came due since the last
  // one was given happened before the player spoke, and the orchestrator must
  // see a world that already reflects it.
  tickTo(world.instant.day);
  fireDueEvents();

  // ── Iteration 0: the player's order ────────────────────────────────────
  const dueNow: SliceEvent[] = input.queue
    .filter((event) => event.dueInstantSortKey <= nowKey())
    .map((event) => ({ kind: event.kind, summary: event.summary, dueInDays: 0 }));
  const upcoming: SliceEvent[] = input.queue
    .filter((event) => event.dueInstantSortKey > nowKey())
    .sort((a, b) => a.dueInstantSortKey - b.dueInstantSortKey)
    .slice(0, 8)
    .map((event) => ({ kind: event.kind, summary: event.summary, dueInDays: Math.round((event.dueInstantSortKey - nowKey()) / 1440) }));

  const slice = buildWorldSlice({
    world,
    clock: input.clock,
    actorRef: input.actorRef,
    actorPolityId: input.actorPolityId,
    orderText: input.orderText,
    facts: input.knownFacts,
    dueEvents: dueNow,
    pendingEvents: upcoming,
  });

  const orchestration = await orchestrate(input.port, slice);
  modelCalls += orchestration.calls;
  iterations += 1;
  if (orchestration.parseFailure !== null) parseFailures.push(orchestration.parseFailure);
  applyProposal(orchestration.output, input.actorRef, 0);
  if (orchestration.output.playerDecision !== null) playerDecision = orchestration.output.playerDecision;

  const momentousAlready = significance >= budget.pressureThreshold;
  if (momentousAlready) stopReason = "threshold_crossed";

  // ── Advancing the world ────────────────────────────────────────────────
  //
  // The world moves only while an order is being carried out, so a burst has to
  // carry it far enough to be worth the asking. It walks to the next moment
  // that matters -- the next scheduled event, or simply far enough for word to
  // travel and someone to answer -- ticking the deterministic world as it goes,
  // and stops at the first of: a decision only the player can make, enough
  // accumulated history to be worth telling, the budget, or the scenario's own
  // maximum span.
  const maxDays = Math.min(budget.maxSimulatedDays, input.clock.maxSpanDays);
  let causalDepth = 1;

  while (!momentousAlready && playerDecision === null && iterations < budget.maxIterations && modelCalls < budget.maxModelCalls) {
    const elapsedDays = world.instant.day - startDay;
    if (elapsedDays >= maxDays) {
      stopReason = "max_span";
      break;
    }

    const nextScheduled = [...input.queue, ...scheduled]
      .map((event) => event.dueInstantSortKey)
      .filter((key) => key > nowKey())
      .sort((a, b) => a - b)[0];
    // The first step is short, so word can travel and the people the order
    // touches get their chance to answer it. After that the world jumps to
    // whatever is next on the calendar -- which is what lets a months-long
    // recruitment actually mature instead of creeping forward two days an order.
    const reactionKey = nowKey() + REACTION_DELAY_DAYS * 1440;
    const ceilingKey = (startDay + maxDays) * 1440 + world.instant.minute;
    const targetKey = Math.min(iterations === 1 ? reactionKey : nextScheduled ?? reactionKey, ceilingKey);

    world = advanceWorldTo(world, addMinutes(world.instant, Math.max(0, targetKey - nowKey())));
    tickTo(world.instant.day);
    fireDueEvents();

    const attention = routeAttention({
      world,
      facts: [...input.knownFacts, ...newFacts],
      offices: input.offices,
      excludeCharacterIds: input.actorRef.kind === "character" ? [input.actorRef.id] : [],
      maxFocused: budget.maxFocusedActors,
      maxCausalDepth: budget.maxCausalDepth,
    });

    // Actors who care but do not warrant a model call still record what they
    // mean to do about it, so their intent is visible to the next burst.
    world = recordActiveIntents(world, attention.active, ids);

    if (attention.focused.length > 0 && causalDepth <= budget.maxCausalDepth) {
      const cognition = await runCognition(input.port, attention.focused, world, input.clock);
      modelCalls += cognition.calls;
      iterations += 1;
      if (cognition.parseFailure !== null) parseFailures.push(cognition.parseFailure);
      for (const actor of cognition.output.actors) applyProposal(actor.proposal, actor.actorRef, causalDepth);
      causalDepth += 1;
    } else {
      iterations += 1;
    }

    if (significance >= budget.pressureThreshold) {
      stopReason = "threshold_crossed";
      break;
    }
    const spanned = world.instant.day - startDay;
    // Nothing left to wake for, and the world has run its minimum span: this is
    // as far as the order carries.
    if (nextScheduled === undefined && attention.focused.length === 0 && spanned >= input.clock.minSpanDays) {
      stopReason = "no_due_events";
      break;
    }
    if (modelCalls >= budget.maxModelCalls || iterations >= budget.maxIterations) {
      stopReason = "budget_exhausted";
      break;
    }
  }

  if (playerDecision !== null) stopReason = "player_decision";

  // VISION §23: a decision interrupts, accumulated history earns a Chronicle,
  // and a quiet burst simply continues -- still committed, just not narrated.
  const outcome: BurstResult["outcome"] =
    playerDecision !== null ? "player_decision" : significance > 0 ? "chronicle" : "continue";

  return {
    world,
    newFacts,
    significanceByFactId,
    scheduled,
    firedEventIds,
    iterations,
    modelCalls,
    outcome,
    stopReason,
    accumulatedSignificance: significance,
    narrative,
    frictions,
    breaches,
    playerDecision,
    parseFailures,
  };
}

/**
 * Records what the actors who care -- but do not warrant a model call -- mean
 * to do about it (VISION §19's "active" tier).
 *
 * Without this the router's middle tier was computed and thrown away every
 * burst. An intent is cheap, deterministic, and visible to the next burst's
 * slice, so a senator who has been quietly alarmed twice is on the record as
 * such before he ever becomes worth a call of his own.
 */
function recordActiveIntents(world: WorldState, active: readonly RoutedActor[], ids: { next(prefix: string): string }): WorldState {
  const wanting = active.filter(
    (actor) => !world.characterIntents.some((intent) => intent.actorCharacterId === actor.characterId && intent.status === "proposed"),
  ).slice(0, 6);
  if (wanting.length === 0) return world;

  return {
    ...world,
    characterIntents: [
      ...world.characterIntents,
      ...wanting.map((actor) => ({
        id: ids.next("intent"),
        actorCharacterId: actor.characterId,
        sourceGoalId: null,
        sourcePlotId: null,
        sourceCommitmentId: null,
        actionType: "prepare" as const,
        targetIds: [],
        rationale: `Watching events: ${actor.why}.`,
        prerequisites: [],
        intendedWorkflowIds: [],
        priority: Math.min(100, actor.score),
        status: "proposed" as const,
        createdAtStep: world.elapsedStep,
        reviewedAtStep: null,
        expiresAtStep: null,
        visibility: "private" as const,
        sourceEventIds: [],
        resolutionReason: null,
      })),
    ],
  };
}

/** The earliest scheduled moment worth waking for, or a plain reaction delay. */
function nextInstant(now: WorldInstant, scheduled: readonly ScheduledEventDraft[], fallbackDays: number): WorldInstant {
  const nowKey = now.day * 1440 + now.minute;
  const upcoming = scheduled.map((event) => event.dueInstantSortKey).filter((key) => key > nowKey).sort((a, b) => a - b)[0];
  const fallbackKey = nowKey + fallbackDays * 1440;
  const key = upcoming === undefined ? fallbackKey : Math.min(upcoming, fallbackKey);
  return addMinutes(now, key - nowKey);
}

/**
 * Delegations become order attempts the recipient answers for themselves
 * (VISION §13) -- not deltas the issuer applies on their behalf.
 */
function recordDelegations(
  world: WorldState,
  delegations: Proposal["delegations"],
  ids: { next(prefix: string): string },
  assignedIds: ReadonlyMap<string, string>,
): WorldState {
  if (delegations.length === 0) return world;
  const resolveParty = (ref: Proposal["delegations"][number]["issuerRef"]) =>
    ref.id.startsWith("local:") ? { ...ref, id: assignedIds.get(ref.id.slice("local:".length)) ?? ref.id } : ref;

  const attempts = delegations
    // An order to someone who does not exist is not an order. This happens when
    // the model names a person it only planned to create.
    .filter((delegation) => world.characters.some((character) => character.id === resolveParty(delegation.recipientRef).id))
    .map((delegation) => ({
    id: ids.next("order"),
    actionId: ids.next("action"),
    issuerRef: resolveParty(delegation.issuerRef),
    recipientRef: resolveParty(delegation.recipientRef),
    claimedAuthorityGrantId: null,
    // The instruction is snapshotted into the reason so the recipient's own
    // cognition can read what they were actually told.
    authorityCheck: { authorized: true, grant: null, standing: null, reason: delegation.instruction.slice(0, 400) },
    status: "issued" as const,
    recipientDecisionReason: null,
    issuedAtStep: world.elapsedStep,
    decidedAtStep: null,
    consequenceFactRefs: [],
  }));
  return { ...world, orderAttempts: [...world.orderAttempts, ...attempts] };
}
