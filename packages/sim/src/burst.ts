import {
  addMinutes,
  assessOrderStanding,
  advanceWorldTo,
  ScheduledEventPayloadSchema,
  type Fact,
  type FactProposalDraft,
  type Office,
  type OrderPartyRef,
  type PlayerDecision,
  type Proposal,
  type ScenarioClock,
  type ScenarioHistoricalPressure,
  type ScheduledEventPayload,
  type ScenarioWarfareRules,
  type TerrainDefinition,
  type StopReason,
  type WatchProposal,
  type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { AuthorityBreach } from "./apply/context";
import { routeAmbientActors, routeAttention, type RoutedActor } from "./attention";
import { runCognition } from "./cognition";
import { materializeFacts } from "./facts";
import { decideNarratorSeed, recordSeedOffered, recordSeedOutcome, seedParticipants, seedWasTaken, type NarratorSeed } from "./narrator";
import { orchestrate } from "./orchestrate";
import { describeBreach, findWhoWouldNotice, noticersAsRefs } from "./oversight";
import { createIdFactory, type SimModelPort } from "./ports";
import type { NarrativeLine, UtteranceLine } from "./chronicle";
import { buildWorldSlice, type AnsweredDecision, type SliceEvent } from "./slice";
import { runDeterministicTick } from "./tick";
import { isWatchSatisfied } from "./watch";

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
  /**
   * How many people getting on with their own business ride along in the
   * batched cognition call. They cost prompt tokens, never an extra call.
   */
  readonly maxAmbientActors: number;
  /** A guard on the walk itself. Hops are deterministic and cost nothing. */
  readonly maxHops: number;
}

export const DEFAULT_BUDGET: SimulationBudget = {
  // Four rounds rather than three, six calls rather than four. The third round
  // is what the world away from the player actually costs: its people get a
  // look after the calendar has jumped, not only two days after the order,
  // which is when a foreign king has anything to do that is worth recording.
  maxIterations: 4,
  maxModelCalls: 6,
  maxSimulatedDays: 90,
  maxCausalDepth: 3,
  // Ten people to a round rather than six. A month in which four people in the
  // whole world did anything is a month with two entries in it, and a reign
  // read back as two entries a month is a reign nothing happens in. These cost
  // prompt and output tokens inside a call that is already being made, never an
  // extra call -- which is why this is the cheap place to buy a busier world.
  maxFocusedActors: 4,
  maxAmbientActors: 6,
  maxHops: 64,
};

export interface ScheduledEventDraft {
  readonly id: string;
  readonly dueInstantSortKey: number;
  readonly kind: string;
  readonly summary: string;
  readonly payload: ScheduledEventPayload;
  readonly causeFactId: string | null;
  readonly causalDepth: number;
}

/** An event the queue is still holding, as the burst needs to see it. */
export interface PendingEvent {
  readonly id: string;
  readonly dueInstantSortKey: number;
  readonly kind: string;
  readonly summary: string;
  /** As stored; parsed with `ScheduledEventPayloadSchema` when it fires. */
  readonly payload?: unknown;
}

export interface BurstInput {
  readonly world: WorldState;
  readonly clock: ScenarioClock;
  readonly offices: readonly Office[];
  /** The scenario's warfare rules -- battle resolution is judged against them. */
  readonly warfare: ScenarioWarfareRules;
  /** The scenario's terrains, so an army is held to the crossings the map admits. */
  readonly terrains?: readonly TerrainDefinition[] | undefined;
  /** What the period tends toward, offered only where the world still looks like it. */
  readonly historicalPressures?: readonly ScenarioHistoricalPressure[] | undefined;
  readonly burstId: string;
  readonly gameId: string;
  readonly actorRef: OrderPartyRef;
  readonly actorPolityId: string | null;
  readonly orderText: string | null;
  /** Set when this burst is resuming a decision the world had put to the player. */
  readonly answeredDecision?: AnsweredDecision | undefined;
  /** History already on record, for the slice and for visibility checks. */
  readonly knownFacts: readonly Fact[];
  /** Everything the queue still owes the world, due or not. */
  readonly queue: readonly PendingEvent[];
  readonly port: SimModelPort;
  readonly budget?: SimulationBudget;
  /**
   * What stirs this burst, decided in advance. Tests use it to put a known
   * seed to a scripted orchestrator; play leaves it undefined and the narrator
   * decides. Null means nothing stirs.
   */
  readonly narratorSeed?: NarratorSeed | null | undefined;
}

export interface BurstResult {
  readonly world: WorldState;
  readonly newFacts: readonly Fact[];
  /**
   * Facts already on record that somebody has now discovered. Not new history:
   * the same events, with a wider audience, for the caller to write back.
   */
  readonly rediscoveredFacts: readonly Fact[];
  /**
   * The facts this burst produced in answering the order itself.
   *
   * The Chronicle's guarantee that an order is always answered rests on this:
   * a floor under the answer to the question actually asked, rather than under
   * the whole category of the reign's business.
   */
  readonly orderFactIds: readonly string[];
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
  /**
   * What happened, in the actors' own words -- the Chronicle's raw material.
   * Each line names who gave the account and which facts it is an account of,
   * so the Chronicle can withhold one the player could not have heard.
   */
  readonly narrative: readonly NarrativeLine[];
  readonly frictions: readonly NarrativeLine[];
  /**
   * What people actually said, for the one line of somebody's own voice the
   * Chronicle is allowed to print. Only people: the orchestrator speaks for the
   * world, and the world has no mouth.
   */
  readonly utterances: readonly UtteranceLine[];
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
  const narrative: NarrativeLine[] = [];
  const frictions: NarrativeLine[] = [];
  const utterances: UtteranceLine[] = [];
  const breaches: AuthorityBreach[] = [];
  const parseFailures: string[] = [];
  let playerDecision: PlayerDecision | null = null;
  let stopReason: StopReason = "no_due_events";
  /** What the ruler is waiting for, when the order was an open-ended one. */
  let watch: WatchProposal | null = null;

  /** Applies one actor's proposal: deltas, then the facts and events it produced. */
  const applyProposal = (proposal: Proposal, actorRef: OrderPartyRef, causalDepth: number, actsForTheWorld = false): void => {
    const result = applyDeltas(world, proposal.deltas, {
      now: world.instant,
      actorRef,
      offices: input.offices,
      warfare: input.warfare,
      ...(input.terrains === undefined ? {} : { terrains: input.terrains }),
      ids,
      gameId: input.gameId,
      actsForTheWorld,
    });
    world = result.world;
    breaches.push(...result.breaches);

    // A fact that belongs to a secret thread is secret, whatever the model
    // wrote in its visibility field: the thread's participants are the people
    // who know it, and nobody else can be. A prompt asking for "private" will
    // eventually be answered with "polity", and the record is what must hold.
    const resolveId = (ref: string): string => result.assignedIds.get(ref.replace(/^local:/, "")) ?? ref;
    const resolveStrict = (ref: string): string | null => (ref.startsWith("local:") ? result.assignedIds.get(ref.slice("local:".length)) ?? null : ref);
    const keptSecret = proposal.facts.map((fact) => {
      if (fact.storylineRef === null) return fact;
      const storyline = world.storylines.find((candidate) => candidate.id === resolveId(fact.storylineRef!));
      if (storyline === undefined || storyline.visibility !== "private" || fact.visibility === "private") return fact;
      const participants: OrderPartyRef[] = storyline.participantIds.map((id) => ({ kind: "character" as const, id }));
      return { ...fact, visibility: "private" as const, discoveryState: "private" as const, knownToRefs: [...fact.knownToRefs, ...participants] };
    });

    // An act carried out without the authority to carry it out is history too
    // -- private history, known to the one who did it, which is what an audit
    // later discovers. Computed and dropped, a breach was insubordination
    // nobody could ever find out about.
    const actorName = world.characters.find((character) => character.id === actorRef.id)?.name ?? actorRef.id;
    const breachFacts: FactProposalDraft[] = result.breaches.map((breach, index) => {
      // Who, going about their own duties, would come across this -- and how
      // long it takes them. A consequence nobody can ever learn of is not a
      // consequence, and this fact used to be known to its author alone, in
      // the engine's own audit language, forever.
      // Unless the act itself was covert. A man whose whole business this turn
      // was secret has covered his tracks, and the ordinary reading of the
      // books does not catch him -- without this a conspirator's first
      // unauthorised move is seen by his own government's auditors, and no
      // plot survives the turn it begins in.
      const covert = keptSecret.some((fact) => fact.visibility === "private");
      const noticers = covert ? [] : findWhoWouldNotice(world, input.offices, breach, actorRef.id);
      const soonest = noticers.reduce((days, noticer) => Math.min(days, noticer.afterDays), Number.POSITIVE_INFINITY);
      return {
        localId: `breach_${newFacts.length}_${index}`,
        kind: "authority_breach",
        summary: describeBreach(breach.delta, world, actorName),
        affectedRefs: [actorRef],
        visibility: "private",
        // Nobody notices some things, and that has to stay possible: a world
        // where every irregularity is always caught is one where nobody would
        // ever try anything.
        discoveryState: noticers.length === 0 ? "private" : "delayed",
        knowableInDays: noticers.length === 0 ? 0 : soonest,
        knownToRefs: [actorRef, ...noticersAsRefs(noticers)],
        significance: 25,
      };
    });

    // What the engine itself made true (casualties, seizures) counts as history
    // exactly as much as what the actor said they were doing.
    const materialized = materializeFacts({
      proposals: [...keptSecret, ...result.factProposals, ...breachFacts],
      now: world.instant,
      atStep: world.elapsedStep,
      ids,
      causalDepth,
      assignedIds: result.assignedIds,
    });
    newFacts.push(...materialized.facts);
    for (const [factId, weight] of materialized.significanceByFactId) significanceByFactId.set(factId, weight);
    significance += materialized.significance;
    world = linkFactsToStorylines(world, materialized.storylineByFactId);

    // An account travels with the facts it is an account of, and so does a
    // reported difficulty. Unattached, they went into the Chronicle whoever had
    // said them -- which is how a Roman consul read a Carthaginian's private
    // deliberations. Only what the world could not do is worth reporting at all:
    // a malformed reference is the engine's business, and handing it to the
    // historian put "no province called Latium existed" into a Chronicle.
    //
    // The world's own account is not evidence. It describes the order and
    // the stage-setting and the secret in one breath, and no gate can split a
    // sentence: given the ruler's ref it reached the record by identity, and
    // attached to the visible facts it still told the ruler what the Boii had
    // been given and what a plotter had begun. The facts carry what happened;
    // the account is kept for inspection and attached to nothing. Reported
    // difficulties still travel with the visible facts: friction is the
    // order's own business.
    const visibleDescribed = materialized.facts.filter((fact) => fact.visibility !== "private").map((fact) => fact.id);
    const describes = actsForTheWorld ? visibleDescribed : materialized.facts.map((fact) => fact.id);
    const author = actsForTheWorld ? null : actorRef;
    narrative.push({ actorRef: author, line: proposal.narrativeSummary, factIds: actsForTheWorld ? [] : describes });
    // A quotation has to have been said by somebody. The orchestrator answers
    // for the whole world in one breath -- for Rome and for the Boii chieftain
    // and for the weather -- so anything it "said" is attributable to no one,
    // and a record that prints it is inventing a speaker.
    if (proposal.utterance !== null && !actsForTheWorld && actorRef.kind === "character") {
      utterances.push({
        actorRef,
        speaker: world.characters.find((character) => character.id === actorRef.id)?.name ?? actorRef.id,
        line: proposal.utterance.line,
        occasion: proposal.utterance.occasion,
        factIds: describes,
      });
    }
    for (const line of [
      ...proposal.frictions,
      ...result.rejected.filter((rejection) => rejection.kind === "world").map((rejection) => rejection.reason),
    ]) frictions.push({ actorRef: author, line, factIds: describes });

    // A refused delta is still history -- the world tried and could not, and the
    // player deserves to learn that rather than wonder. But only when the world
    // was the obstacle: a proposal that named someone who does not exist is the
    // engine catching a malformed payload, and belongs in the record for
    // debugging rather than in the ruler's Chronicle.
    for (const rejection of result.rejected) {
      const isWorldFriction = rejection.kind === "world";
      const friction = materializeFacts({
        proposals: [{
          localId: `friction_${scheduled.length}_${newFacts.length}`,
          kind: isWorldFriction ? "execution_friction" : "engine_rejection",
          summary: rejection.reason,
          affectedRefs: [actorRef],
          visibility: isWorldFriction ? "polity" : "private",
          discoveryState: isWorldFriction ? "polity" : "private",
          knowableInDays: 0,
          significance: isWorldFriction ? 5 : 0,
          knownToRefs: isWorldFriction ? [actorRef] : [],
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
        // Everything resolved now, so the day it fires needs no memory of this
        // batch's handles.
        // A handle nothing in this batch created resolves to nothing: an event
        // stored with "local:plague" in it named a thread that never opened.
        payload: {
          subjectIds: event.subjectRefs.map(resolveStrict).filter((id): id is string => id !== null),
          visibility: event.visibility,
          significance: event.significance,
          knownTo: event.knownToRefs.flatMap((ref) => {
            const id = resolveStrict(ref.id);
            return id === null ? [] : [{ kind: ref.kind, id }];
          }),
          storylineId: event.storylineRef === null ? null : resolveStrict(event.storylineRef),
        },
        causeFactId: event.causeFactLocalId === null ? null : materialized.factIds.get(event.causeFactLocalId) ?? null,
        causalDepth: causalDepth + 1,
      });
    }

    applyDiscoveries(proposal.discoveries, causalDepth);
    world = recordDelegations(world, proposal.delegations, ids, result.assignedIds, input.offices);
  };

  const firedEventIds: string[] = [];
  const nowKey = () => world.instant.day * 1440 + world.instant.minute;

  /** Facts already on record whose discovery changed this burst, for the caller to persist. */
  const rediscovered = new Map<string, Fact>();

  /**
   * A secret coming to light (VISION §14).
   *
   * Nothing new happened -- the fact was always true. What changed is that
   * somebody now knows it, which is what intelligence work buys. The fact is
   * amended in place rather than duplicated, because two records of the same
   * event with different audiences is how a Chronicle ends up reporting a thing
   * twice.
   */
  const applyDiscoveries = (discoveries: Proposal["discoveries"], causalDepth: number): void => {
    for (const discovery of discoveries) {
      const known = [...input.knownFacts, ...newFacts, ...rediscovered.values()];
      const fact = known.find((candidate) => candidate.id === discovery.factId);
      // A discovery of something that never happened is the engine catching a
      // malformed payload, not a failed operation the player should hear about.
      if (fact === undefined) continue;

      const already = fact.discovery.discoveredBy.some(
        (entry) => entry.observerRef.kind === discovery.observerRef.kind && entry.observerRef.id === discovery.observerRef.id,
      );
      if (already) continue;

      const learnedAt = addMinutes(world.instant, discovery.knowableInDays * 1440);
      const amended: Fact = {
        ...fact,
        discovery: {
          ...fact.discovery,
          discoveredBy: [...fact.discovery.discoveredBy, { observerRef: discovery.observerRef, atInstant: learnedAt, via: discovery.via }],
        },
        causalDepth: Math.max(fact.causalDepth, causalDepth),
      };
      rediscovered.set(fact.id, amended);

      const index = newFacts.findIndex((candidate) => candidate.id === fact.id);
      if (index >= 0) newFacts[index] = amended;
    }
  };

  /**
   * Everything that fell due on the way here: revenue collected, wages paid,
   * milestones reached. Deterministic, and therefore free.
   */
  const tickTo = (toDay: number): void => {
    const ticked = runDeterministicTick({ world, toDay, ids, warfare: input.warfare });
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
    // The world's own account of its bookkeeping, kept out of the Chronicle.
    //
    // These lines are the engine talking about itself -- "Two new legions
    // [project-3] stands ready, 8000 strong" -- and attaching them to the
    // tick's facts made them publishable, so the machine's voice arrived in the
    // historian's hands beside the actors' own. Nothing is lost: everything a
    // note describes already emits a fact of its own, written to be read. A
    // line nobody said, about facts it is not an account of, belongs to the
    // record of the burst rather than to the record of the reign.
    for (const note of ticked.notes) narrative.push({ actorRef: null, line: note, factIds: [] });
  };

  /**
   * Retires queue entries whose moment has arrived.
   *
   * Retiring one is not enough. A scheduled event is the world's own promise
   * that something happens later (VISION §17), and for a long time this method
   * quietly broke that promise: an event with a kind the tick knows nothing
   * about was marked fired and vanished, so "SCHEDULED AHEAD" listed things
   * that could never occur. Every event that comes due now enters the fact
   * stream, where the attention router and the Chronicle can see it like
   * anything else.
   */
  const fireDueEvents = (): void => {
    // Including what this burst scheduled a moment ago. An order that sets a
    // march in motion and then walks the world to its arrival must see the
    // arrival happen; before, only events inherited from earlier bursts could
    // fire, so the burst arrived on the day and nothing occurred.
    const due = [...input.queue, ...scheduled].filter((event) => !firedEventIds.includes(event.id) && event.dueInstantSortKey <= nowKey());
    if (due.length === 0) return;
    for (const event of due) firedEventIds.push(event.id);

    // An event fires as it was scheduled to be known. It used to fire as public
    // news naming nobody, whatever it was: a secret's next step became an
    // announcement, and the router had nothing to route on.
    const materialized = materializeFacts({
      proposals: due.map((event, index) => {
        const payload = ScheduledEventPayloadSchema.safeParse(event.payload ?? {});
        const details = payload.success ? payload.data : ScheduledEventPayloadSchema.parse({});
        return {
          localId: `due_${event.id}_${index}`,
          kind: event.kind,
          summary: event.summary,
          affectedRefs: details.subjectIds.flatMap((id) => {
            const ref = inferPartyRef(world, id);
            return ref === null ? [] : [ref];
          }),
          visibility: details.visibility,
          discoveryState: details.visibility,
          knowableInDays: 0,
          knownToRefs: details.knownTo,
          storylineRef: details.storylineId,
          // Its author's weighting, or the default: the moment a thing was
          // scheduled to happen is worth noting without being worth interrupting
          // for, and what it causes carries its own weight.
          significance: details.significance,
        };
      }),
      now: world.instant,
      atStep: world.elapsedStep,
      ids,
      causalDepth: 0,
      assignedIds: new Map(),
    });
    newFacts.push(...materialized.facts);
    for (const [factId, weight] of materialized.significanceByFactId) significanceByFactId.set(factId, weight);
    significance += materialized.significance;
    world = linkFactsToStorylines(world, materialized.storylineByFactId);
  };

  // Catch up before reading the order: anything that came due since the last
  // one was given happened before the player spoke, and the orchestrator must
  // see a world that already reflects it.
  tickTo(world.instant.day);
  fireDueEvents();

  // ── Iteration 0: the player's order ────────────────────────────────────
  const threadOf = (event: PendingEvent): string | undefined => {
    const payload = ScheduledEventPayloadSchema.safeParse(event.payload ?? {});
    const storylineId = payload.success ? payload.data.storylineId : null;
    const storyline = storylineId === null ? undefined : world.storylines.find((candidate) => candidate.id === storylineId);
    return storyline === undefined ? undefined : `${storyline.title} [${storyline.id}]`;
  };
  const dueNow: SliceEvent[] = input.queue
    .filter((event) => event.dueInstantSortKey <= nowKey())
    .map((event) => ({ kind: event.kind, summary: event.summary, dueInDays: 0, thread: threadOf(event) }));
  const upcoming: SliceEvent[] = input.queue
    .filter((event) => event.dueInstantSortKey > nowKey())
    .sort((a, b) => a.dueInstantSortKey - b.dueInstantSortKey)
    .slice(0, 8)
    .map((event) => ({ kind: event.kind, summary: event.summary, dueInDays: Math.round((event.dueInstantSortKey - nowKey()) / 1440), thread: threadOf(event) }));

  // The world makes trouble of its own (VISION §32). Decided here, once, so a
  // burst carries at most one seed, and before the orchestrator so it can be
  // carried out in the call the order was already paying for.
  const seed: NarratorSeed | null = input.narratorSeed === undefined
    ? decideNarratorSeed({
      world,
      gameId: input.gameId,
      ownPolityId: input.actorPolityId,
      playerCharacterId: input.actorRef.kind === "character" ? input.actorRef.id : null,
      facts: [...input.knownFacts, ...newFacts],
      ...(input.historicalPressures === undefined ? {} : { pressures: input.historicalPressures }),
    })
    : input.narratorSeed;
  if (seed !== null) world = recordSeedOffered(world, seed);

  const slice = buildWorldSlice({
    world,
    clock: input.clock,
    offices: input.offices,
    actorRef: input.actorRef,
    actorPolityId: input.actorPolityId,
    orderText: input.orderText,
    ...(input.answeredDecision === undefined ? {} : { answeredDecision: input.answeredDecision }),
    facts: input.knownFacts,
    dueEvents: dueNow,
    pendingEvents: upcoming,
    narratorSeed: seed,
  });

  const orchestration = await orchestrate(input.port, slice);
  modelCalls += orchestration.calls;
  iterations += 1;
  if (orchestration.parseFailure !== null) parseFailures.push(orchestration.parseFailure);
  const factsBefore = newFacts.length;
  applyProposal(orchestration.output, input.actorRef, 0, true);
  const orderFactIds = newFacts.slice(factsBefore).map((fact) => fact.id);
  if (orchestration.output.playerDecision !== null) playerDecision = orchestration.output.playerDecision;

  // Whether the seed was taken up decides the ledger, and who it landed on
  // decides who is asked first what they do about it.
  let priorityCharacterIds: string[] = [];
  if (seed !== null) {
    const taken = seedWasTaken(world, newFacts.slice(factsBefore), seed);
    world = recordSeedOutcome(world, seed, taken);
    if (taken) priorityCharacterIds = seedParticipants(world, seed).filter((id) => input.actorRef.kind !== "character" || id !== input.actorRef.id);
  }

  // An open-ended order says what would end it. The world then carries on until
  // that happens rather than until this burst runs out of things to do.
  watch = orchestration.output.watch;

  // ── Advancing the world ────────────────────────────────────────────────
  //
  // The world moves only while an order is being carried out, so a burst has to
  // carry it far enough to be worth the asking. It walks to the next moment
  // that matters -- the next scheduled event, or simply far enough for word to
  // travel and someone to answer -- ticking the deterministic world as it goes.
  //
  // It stops when it needs the player, and not merely when something worth
  // telling has happened. Those used to be the same test: weight accumulated
  // past a threshold ended the burst, so a won battle, an ally mobilizing, any
  // news at all handed control back. A campaign that should have been one order
  // took six, and four of them asked the player nothing. Interesting and
  // actionable are different things -- what is merely interesting belongs in the
  // Chronicle, which now tells several threads of it at once, and the world
  // carries on until it genuinely wants an answer.
  //
  // So the stops are: a decision only the player can make, a reaction the call
  // budget cannot pay for, the calendar running out of anything to wake for, or
  // the scenario's own maximum span.
  const maxDays = Math.min(budget.maxSimulatedDays, input.clock.maxSpanDays);
  let causalDepth = 1;
  let hops = 0;

  while (playerDecision === null) {
    const elapsedDays = world.instant.day - startDay;
    if (elapsedDays >= maxDays) {
      stopReason = "max_span";
      break;
    }
    // Time is walked in hops, and a hop that nobody answers costs nothing but
    // arithmetic. The cap is a guard against a pathological queue, not a budget.
    if (hops >= budget.maxHops) {
      stopReason = "budget_exhausted";
      break;
    }
    hops += 1;

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
    const targetKey = Math.min(hops === 1 ? reactionKey : nextScheduled ?? reactionKey, ceilingKey);

    world = advanceWorldTo(world, addMinutes(world.instant, Math.max(0, targetKey - nowKey())));
    tickTo(world.instant.day);
    fireDueEvents();

    const playerCharacterIds = input.actorRef.kind === "character" ? [input.actorRef.id] : [];
    const attention = routeAttention({
      world,
      facts: [...input.knownFacts, ...newFacts],
      offices: input.offices,
      excludeCharacterIds: playerCharacterIds,
      maxFocused: budget.maxFocusedActors,
      maxCausalDepth: budget.maxCausalDepth,
    });

    // Actors who care but do not warrant a model call still record what they
    // mean to do about it, so their intent is visible to the next burst.
    world = recordActiveIntents(world, attention.active, ids);

    // The world elsewhere moves too: people with their own business, chosen
    // without reference to anything the player did. They ride along in the
    // batched call the reactors were already making, so a living world costs
    // prompt tokens rather than model calls.
    //
    // Every round they can be afforded, not once per burst. Given one look two
    // days after the order, a foreign king sensibly answers that nothing has
    // changed yet; it is after the world jumps a month to the next thing on the
    // calendar that his own business has somewhere to go.
    const ambient = routeAmbientActors({
      world,
      facts: [...input.knownFacts, ...newFacts],
      offices: input.offices,
      excludeCharacterIds: [...playerCharacterIds, ...attention.focused.map((actor) => actor.characterId)],
      max: budget.maxAmbientActors,
      // The first round only: whoever the narrator just handed a problem to is
      // asked what they do about it before the rotation has its say.
      priorityCharacterIds: hops === 1 ? priorityCharacterIds : [],
    });

    const cast = [...attention.focused, ...ambient];
    const wantsAnswering = cast.length > 0 && causalDepth <= budget.maxCausalDepth;
    if (wantsAnswering) {
      // Somebody has something to say and there is nothing left to pay them
      // with. Stopping here is honest; carrying on would silence them.
      if (modelCalls >= budget.maxModelCalls || iterations >= budget.maxIterations) {
        stopReason = "budget_exhausted";
        break;
      }
      const cognition = await runCognition(input.port, cast, world, input.clock);
      modelCalls += cognition.calls;
      iterations += 1;
      if (cognition.parseFailure !== null) parseFailures.push(cognition.parseFailure);
      for (const actor of cognition.output.actors) applyProposal(actor.proposal, actor.actorRef, causalDepth);
      causalDepth += 1;
    }

    const spanned = world.instant.day - startDay;
    if (watch !== null && isWatchSatisfied(watch.predicate, input.world, world)) {
      stopReason = "watch_condition";
      break;
    }
    // Nothing left to wake for, and the world has run its minimum span: this is
    // as far as the order carries. An order still waiting on something keeps
    // going regardless -- that is what asking to be woken on arrival means, and
    // the maximum span is what bounds the waiting.
    if (watch === null && nextScheduled === undefined && cast.length === 0 && spanned >= input.clock.minSpanDays) {
      stopReason = "no_due_events";
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
    rediscoveredFacts: [...rediscovered.values()],
    significanceByFactId,
    scheduled,
    firedEventIds,
    iterations,
    modelCalls,
    outcome,
    stopReason,
    accumulatedSignificance: significance,
    orderFactIds,
    narrative,
    frictions,
    utterances,
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

/** A stored id, as a party the facts can name -- or null when nothing in the world answers to it any more. */
function inferPartyRef(world: WorldState, id: string): OrderPartyRef | null {
  if (world.characters.some((character) => character.id === id)) return { kind: "character", id };
  if (world.material.forces.some((force) => force.id === id)) return { kind: "force", id };
  if (world.map.provinces.some((province) => province.id === id)) return { kind: "province", id };
  if (world.map.polities.some((polity) => polity.id === id)) return { kind: "polity", id };
  if (world.projects.some((project) => project.id === id)) return { kind: "project", id };
  if (world.material.institutions.some((institution) => institution.id === id)) return { kind: "institution", id };
  if (world.material.accounts.some((account) => account.id === id)) return { kind: "account", id };
  return null;
}

/** A fact that says which thread it belongs to is written into that thread, most recent last. */
function linkFactsToStorylines(world: WorldState, storylineByFactId: ReadonlyMap<string, string>): WorldState {
  if (storylineByFactId.size === 0) return world;
  const byStoryline = new Map<string, string[]>();
  for (const [factId, storylineId] of storylineByFactId) byStoryline.set(storylineId, [...(byStoryline.get(storylineId) ?? []), factId]);
  return {
    ...world,
    storylines: world.storylines.map((storyline) => {
      const added = byStoryline.get(storyline.id);
      return added === undefined ? storyline : { ...storyline, causalFactIds: [...storyline.causalFactIds, ...added].slice(-16) };
    }),
  };
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
  offices: readonly Office[],
): WorldState {
  if (delegations.length === 0) return world;
  const resolveParty = (ref: Proposal["delegations"][number]["issuerRef"]) =>
    ref.id.startsWith("local:") ? { ...ref, id: assignedIds.get(ref.id.slice("local:".length)) ?? ref.id } : ref;

  const attempts = delegations
    // An order to someone who does not exist is not an order. This happens when
    // the model names a person it only planned to create.
    .filter((delegation) => world.characters.some((character) => character.id === resolveParty(delegation.recipientRef).id))
    .map((delegation) => {
      const issuerRef = resolveParty(delegation.issuerRef);
      const recipientRef = resolveParty(delegation.recipientRef);
      // Every delegation ever recorded said `authorized: true`. It was a
      // constant, so a merchant's request and a consul's command were the same
      // record, and the instruction itself was smuggled through a field
      // documented as a snapshot of the authority check.
      const verdict = assessOrderStanding({ world, offices, issuerRef, recipientRef });
      return {
        id: ids.next("order"),
        actionId: ids.next("action"),
        issuerRef,
        recipientRef,
        claimedAuthorityGrantId: verdict.grant?.id ?? null,
        authorityCheck: {
          authorized: verdict.standing === "binding",
          grant: verdict.grant,
          standing: verdict.grant?.standing ?? null,
          reason: verdict.reason,
        },
        instruction: delegation.instruction.slice(0, 400),
        standing: verdict.standing,
        status: "issued" as const,
        recipientDecisionReason: null,
        issuedAtStep: world.elapsedStep,
        decidedAtStep: null,
        consequenceFactRefs: [],
      };
    });
  return { ...world, orderAttempts: [...world.orderAttempts, ...attempts] };
}
