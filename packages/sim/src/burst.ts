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
import { routeAttention } from "./attention";
import { runCognition } from "./cognition";
import { materializeFacts } from "./facts";
import { orchestrate } from "./orchestrate";
import { createIdFactory, type SimModelPort } from "./ports";
import { buildWorldSlice, type SliceEvent } from "./slice";

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
  readonly dueEvents: readonly SliceEvent[];
  readonly pendingEvents: readonly SliceEvent[];
  readonly port: SimModelPort;
  readonly budget?: SimulationBudget;
}

export interface BurstResult {
  readonly world: WorldState;
  readonly newFacts: readonly Fact[];
  /** Fact id → the significance its author assigned it, for storage and pacing. */
  readonly significanceByFactId: ReadonlyMap<string, number>;
  readonly scheduled: readonly ScheduledEventDraft[];
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

  // ── Iteration 0: the player's order ────────────────────────────────────
  const slice = buildWorldSlice({
    world,
    clock: input.clock,
    actorRef: input.actorRef,
    actorPolityId: input.actorPolityId,
    orderText: input.orderText,
    facts: input.knownFacts,
    dueEvents: input.dueEvents,
    pendingEvents: input.pendingEvents,
  });

  const orchestration = await orchestrate(input.port, slice);
  modelCalls += orchestration.calls;
  iterations += 1;
  if (orchestration.parseFailure !== null) parseFailures.push(orchestration.parseFailure);
  applyProposal(orchestration.output, input.actorRef, 0);
  if (orchestration.output.playerDecision !== null) playerDecision = orchestration.output.playerDecision;

  // ── Reaction iterations ────────────────────────────────────────────────
  let causalDepth = 1;
  while (
    playerDecision === null &&
    iterations < budget.maxIterations &&
    modelCalls < budget.maxModelCalls &&
    significance < budget.pressureThreshold &&
    causalDepth <= budget.maxCausalDepth
  ) {
    const elapsedDays = world.instant.day - startDay;
    if (elapsedDays >= Math.min(budget.maxSimulatedDays, input.clock.maxSpanDays)) {
      stopReason = "max_span";
      break;
    }

    // Time passes before anyone reacts: word has to reach them. This is also
    // what lets a "delayed" fact become knowable partway through a burst.
    world = advanceWorldTo(world, nextInstant(world.instant, scheduled, REACTION_DELAY_DAYS));

    const attention = routeAttention({
      world,
      facts: [...input.knownFacts, ...newFacts],
      offices: input.offices,
      excludeCharacterIds: input.actorRef.kind === "character" ? [input.actorRef.id] : [],
      maxFocused: budget.maxFocusedActors,
      maxCausalDepth: budget.maxCausalDepth,
    });

    if (attention.focused.length === 0) {
      stopReason = "no_due_events";
      break;
    }

    const cognition = await runCognition(input.port, attention.focused, world, input.clock);
    modelCalls += cognition.calls;
    iterations += 1;
    if (cognition.parseFailure !== null) parseFailures.push(cognition.parseFailure);

    if (cognition.output.actors.length === 0) {
      stopReason = "no_due_events";
      break;
    }

    for (const actor of cognition.output.actors) {
      applyProposal(actor.proposal, actor.actorRef, causalDepth);
    }
    causalDepth += 1;

    if (significance >= budget.pressureThreshold) {
      stopReason = "threshold_crossed";
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
