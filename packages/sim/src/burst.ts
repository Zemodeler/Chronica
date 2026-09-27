import {
  addMinutes,
  assessOrderStanding,
  advanceWorldTo,
  factsKnownTo,
  formatWorldDate,
  ScheduledEventPayloadSchema,
  WorldStateSchema,
  type Fact,
  type FactProposalDraft,
  type Office,
  type SuccessionRule,
  type OrderPartyRef,
  type PlayerDecision,
  type Proposal,
  type ScenarioClock,
  type ScenarioHistoricalPressure,
  type ScheduledEventPayload,
  type ScenarioLifeRules,
  type ScenarioWealthRules,
  type ScenarioWarfareRules,
  type TerrainDefinition,
  type StopReason,
  nemesisOf,
  type WatchProposal,
  type WorldDelta,
  type WorldInstant,
  type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { BattleAccount } from "./battle";
import type { ApplyResult, AuthorityBreach, RejectedDelta } from "./apply/context";
import { keepAsArrangement } from "./apply/keep-as-arrangement";
import { whereTheActorIs } from "./apply/fill-gaps";
import { kindsIn } from "./bare-refs";
import { misfiledWorldActs } from "./apply/misfiled";
import { routeAmbientActors, routeAttention, type RoutedActor } from "./attention";
import { renderCharacterPortrait, runCognition } from "./cognition";
import { materializeFacts } from "./facts";
import { decideNarratorSeeds, engineWork, recordSeedsOffered, seedParticipants, seedWasTaken, type NarratorSeed } from "./narrator";
import { chooseNemesis, conductInWords, nemesisStance, recordNemesis, retireNemesis, shouldRetire, stanceInWords } from "./nemesis";
import { orchestrate } from "./orchestrate";
import { describeBreach, findWhoWouldNotice, noticersAsRefs } from "./oversight";
import { createIdFactory, type SimModelPort } from "./ports";
import { NEVER_PUBLISHED, type NarrativeLine, type UtteranceLine } from "./chronicle";
import { buildWorldSlice, renderWorldSlice, type AnsweredDecision, type SliceEvent } from "./slice";
import { successionDecision } from "./mortality";
import { factsNamingRefusals, reconcileFacts } from "./reconcile-facts";
import { repairDeltas, worthRepairing } from "./repair-deltas";
import { runDeterministicTick } from "./tick";
import { isWatchSatisfied } from "./watch";
import { attachMechanic } from "./mechanics/attach-mechanic";
import { newDebitLedger } from "./mechanics/instantiate";
import { mechanicInWords } from "./mechanics/mechanic-words";
import { readableRefsFor } from "./mechanics/refs";
import { runMechanics } from "./mechanics/run-mechanics";
import { validateMechanic } from "./mechanics/validate-mechanic";
import { writeMechanic } from "./mechanics/write-mechanic";
import { addressWaitingLetters } from "./letters";
import { dueSteps, emptyPlanTally, layPlan, markWoken, nextPlanDay, settleOverdueSteps, takeSteps, type PlanTally } from "./plans";
import { debatersOf, electiveOfficesOf, voteCalendarDays } from "./senate";
import { ensureConstitutions } from "./constitutions";

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
  /**
   * How many rounds a burst pays for in which nobody is pressing -- no
   * reaction, no priority, no antagonist, no order or letter to answer, no
   * thread in crisis -- and the cast is the rotation alone. The world elsewhere
   * still gets its look; it does not get one every hop.
   */
  readonly maxAmbientOnlyRounds: number;
  /**
   * Days of quiet after which fresh news starts a new chain of reactions,
   * with its own causal depth and its own look at the world elsewhere.
   *
   * The depth cap counted rounds for the whole burst, so a month let pass
   * spent all three in its first nine days and then walked three weeks
   * asking nobody: a garrison let into Messana on the twentieth was answered
   * by no one. A cascade is reactions within days of each other; news a
   * fortnight later is news. What a later chain costs comes out of
   * `maxModelCalls`, and a chain the budget cannot pay for is skipped rather
   * than ending the burst: only the order's own consequences may do that.
   */
  readonly newChainAfterDays: number;
  /** Deal a large cast onto this many cognition calls instead of the measured default (plan §1 F). */
  readonly cognitionShards?: number | undefined;
  /**
   * How many arrangements a burst may ask the model to write a mechanic for
   * (plan §2). Zero counts the candidates and asks nothing: what the corpus
   * would cost is measured before the call exists.
   */
  readonly maxMechanicCalls: number;
}

export const DEFAULT_BUDGET: SimulationBudget = {
  // Four rounds rather than three, six calls rather than four. The third round
  // is what the world away from the player actually costs: its people get a
  // look after the calendar has jumped, not only two days after the order,
  // which is when a foreign king has anything to do that is worth recording.
  maxIterations: 4,
  // Twenty calls rather than six, and not a single extra thing asked of the
  // world. A round's cast is dealt onto up to three calls that run at once
  // instead of one that generates ten people's answers end to end, so a round
  // costs three calls and the same tokens. Counted in calls, six would end the
  // burst after its first round; `maxIterations` is the budget that actually
  // bounds the work, and this is only the guard against a loop that will not
  // stop -- set above the worst honest case, three rounds of three calls each
  // with a repair apiece, rather than at it.
  maxModelCalls: 20,
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
  maxAmbientOnlyRounds: 1,
  newChainAfterDays: 10,
  // Two rules a burst: an order rarely sets more than one thing going, and
  // the world's own doings get the second. Counted apart from `maxModelCalls`.
  maxMechanicCalls: 2,
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

/**
 * What the world is doing, while it is doing it.
 *
 * A burst is several model calls long and says nothing until it has finished
 * all of them, so the player watches a still button for minutes. None of this
 * is the record -- the record is written at the end, from the finished burst,
 * and cannot honestly exist before then. This is the engine saying where it
 * has got to, and the most interesting thing it can say is the date: a season
 * visibly passing is what the waiting is actually for.
 *
 * Structured rather than phrased, so the words belong to the client and the
 * engine keeps knowing nothing about who is reading.
 */
export type BurstProgress =
  | { readonly kind: "orchestrating" }
  /** A round in which nobody was asked: the rotation alone, past what the burst pays for. */
  | { readonly kind: "skipped"; readonly date: string }
  /** The calendar moved. `date` is already formatted for this scenario's clock. */
  | { readonly kind: "advanced"; readonly date: string }
  | { readonly kind: "answering"; readonly date: string; readonly people: readonly string[] }
  | { readonly kind: "settled"; readonly date: string };

export interface BurstInput {
  readonly world: WorldState;
  readonly clock: ScenarioClock;
  readonly offices: readonly Office[];
  /** How the scenario's offices are filled; with it, an elective office's vacancy is refilled by election. */
  readonly successionRules?: readonly SuccessionRule[] | undefined;
  /** The scenario's warfare rules -- battle resolution is judged against them. */
  readonly warfare: ScenarioWarfareRules;
  /** The scenario's terrains, so an army is held to the crossings the map admits. */
  readonly terrains?: readonly TerrainDefinition[] | undefined;
  /**
   * The scenario's age bands. Left out, nobody in the world ages or dies --
   * which is what every game did until this was passed in.
   */
  readonly life?: ScenarioLifeRules | undefined;
  /** What a person of a given standing is worth here, so an invented one is worth it too. */
  readonly wealth?: ScenarioWealthRules | undefined;
  /** What the period tends toward, offered only where the world still looks like it. */
  readonly historicalPressures?: readonly ScenarioHistoricalPressure[] | undefined;
  readonly burstId: string;
  readonly gameId: string;
  readonly actorRef: OrderPartyRef;
  readonly actorPolityId: string | null;
  readonly orderText: string | null;
  /**
   * How far the player means to let the world run: a week, a month, a season.
   * Given, the world runs the whole of it unless something needs the player
   * first -- a decision, a watch met, a trap sprung, a death. Omitted, the
   * engine decides, stopping once nothing more is due.
   *
   * The engine alone used to choose how far each order carried the world, so
   * a player who wanted a quiet winter to pass had to write an order to get
   * it, and could not ask for less than a week or more than a season.
   */
  readonly spanDays?: number | undefined;
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
  /** Everything that stirs, for a test that wants to fix the whole batch. */
  readonly narratorSeeds?: readonly NarratorSeed[] | undefined;
  /**
   * Told where the burst has got to, as it gets there. Never awaited and never
   * allowed to fail the burst: this reports on the work, it is not part of it.
   */
  readonly onProgress?: ((progress: BurstProgress) => void) | undefined;
  /**
   * Handed each window of the burst as the clock is about to leave it, so the
   * record can be written while the world is still moving (see
   * `WindowSnapshot`). Same contract as `onProgress`: never awaited, never
   * allowed to fail the burst, and never handed anything it could mutate.
   */
  readonly onWindowClosed?: ((window: WindowSnapshot) => void) | undefined;
}

/**
 * One window of a burst: everything written between two moves of the clock.
 *
 * A burst walks time forward in hops and the clock never moves backwards, so
 * everything written during hop k is dated at or before hop k's instant, and
 * once the clock has advanced to hop k+1 nothing can later land before it.
 * That is what makes a record written window by window read in time order:
 * the historian can be handed window k the moment it closes, and nothing
 * written afterwards can belong before what she has already published.
 *
 * Window 0 is the order itself, at the day it was given; it closes when the
 * first hop begins. The last window closes when the burst ends.
 */
export interface WindowSnapshot {
  readonly index: number;
  readonly from: WorldInstant;
  readonly to: WorldInstant;
  readonly worldBefore: WorldState;
  readonly worldAfter: WorldState;
  /** The facts materialised in this window, in the order they were written. */
  readonly facts: readonly Fact[];
  /** Fact id → significance, for every fact of the burst so far. */
  readonly significanceByFactId: ReadonlyMap<string, number>;
  readonly narrative: readonly NarrativeLine[];
  readonly frictions: readonly NarrativeLine[];
  readonly utterances: readonly UtteranceLine[];
  readonly battleAccounts: readonly BattleAccount[];
  /** The facts that answer the order. Window 0 only; empty afterwards. */
  readonly orderFactIds: readonly string[];
  /** The last window of the burst: the clock will not move again, so it has the room to tell what the pool carried to it. */
  readonly final: boolean;
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
  /** Calls that wrote a mechanic (plan §2): counted apart, so they never end a burst early. */
  readonly mechanicCalls: number;
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
  /**
   * What happened in any battle this burst fought, for the historian.
   *
   * A death in the field has to be earned by the account of the fight that
   * caused it, and the fight used to reach the record as one line.
   */
  readonly battleAccounts: readonly BattleAccount[];
  readonly breaches: readonly AuthorityBreach[];
  readonly playerDecision: PlayerDecision | null;
  readonly parseFailures: readonly string[];
  /**
   * What the engine dropped out of otherwise good answers to spare a repair
   * call, in the schema's own words. Worth surfacing rather than swallowing:
   * a field that keeps appearing here is a prompt or a schema at fault, and
   * the whole point of salvaging is that it should be visible when it happens.
   */
  readonly salvaged: readonly string[];
  /** Every model call the burst decided not to make, and why. Logged, never silent. */
  readonly skipped: readonly { readonly stage: "cognition" | "reconcile" | "repair"; readonly reason: string }[];
  /** Every act refused, ignored or filled in, pass by pass, for the audit (see `AuditEntry`). */
  readonly audit: readonly AuditEntry[];
  /** How far people's plans moved in this burst, and how much of what they did belonged to one (gap §5). */
  readonly plans: PlanTally;
  /**
   * Rounds per chain of reactions, the order's own first; its first entry
   * counts the orchestration, as `iterations` does. VISION §29's two to four
   * is the bound on the first. Later chains are the world's own business
   * after a quiet stretch (see `newChainAfterDays`), and the call guard
   * bounds the whole.
   */
  readonly chainRounds: readonly number[];
  /** Rounds of plan owners alone, asked after their chain's depth was spent; each step wakes one at most once. */
  readonly planRounds: number;
}

/**
 * One act the engine did not carry out exactly as the model wrote it.
 *
 * A "reference" refusal never reaches the player -- by design, since "no
 * account named merchant-purse exists" is not history -- and so, before this,
 * nobody saw it at all: the order simply did less than it said. Kept per
 * burst, these are what show which parts of the engine are refusing plain
 * orders for want of a detail no player would ever know.
 */
export interface AuditEntry {
  readonly actorRef: OrderPartyRef;
  readonly op: string;
  /**
   * How the engine took it: refused by the world, unreadable, ignored by those
   * ordered, carried out with a detail filled in, kept as an arrangement after
   * it could not be read, or recorded as what the actor is now doing.
   */
  readonly kind: "world" | "reference" | "ignored" | "assumed" | "kept" | "pursuit" | "refiled" | "mechanic_candidate" | "mechanic" | "mechanic_refused" | "mechanic_effect" | "mechanic_warrant_lapsed";
  readonly ofTheOrder: boolean;
  /**
   * "first" for the answer as written; "repair" for the corrected attempt at
   * what the first refused; "keep" for an unreadable act kept as an
   * arrangement; "floor" for an order that left nothing else in the world.
   */
  readonly attempt: "first" | "repair" | "keep" | "floor";
  readonly reason: string;
  readonly delta: WorldDelta;
}

/**
 * What somebody is now doing, as an arrangement of kind "pursuit": the one
 * they already have, relabelled, or a new one where they stand.
 */
function pursuitOf(world: WorldState, actorRef: OrderPartyRef, summary: string, orderText: string): WorldDelta {
  const current = world.genericEntities.find((entity) => entity.kind === "pursuit" && entity.ownerRef?.kind === actorRef.kind
    && entity.ownerRef.id === actorRef.id && !("retiredAtStep" in entity.attributes));
  const label = summary.slice(0, 160);
  const attributes = { order: orderText.trim().slice(0, 160), sinceDay: world.instant.day };
  return current === undefined
    ? { op: "generic_entity_create", localId: "pursuit", kind: "pursuit", label, ownerRef: actorRef, attributes, provinceId: whereTheActorIs(world, actorRef), reason: "What the order set him to doing." }
    : { op: "generic_entity_update", entityRef: current.id, label, attributes, retire: false, reason: "What the order set him to doing now." };
}

/** What became of an order's own acts in one proposal. */
interface OrderActs {
  readonly carriedOut: number;
  /** Refused because the world would not have it, or ignored by those ordered: the order was tried. */
  readonly refusedByTheWorld: number;
  /** Refused for any reason, the engine's included: the order was written, and none of it stood. */
  readonly refused: number;
}

/** How long a reaction takes to form, when nothing scheduled says otherwise. */
const REACTION_DELAY_DAYS = 2;

export async function runSimulationBurst(input: BurstInput): Promise<BurstResult> {
  const budget = input.budget ?? DEFAULT_BUDGET;
  const ids = createIdFactory(input.burstId);
  const startDay = input.world.instant.day;

  // Every power's constitution exists before anybody is asked anything: a new
  // game's first order is answered before its first tick, and a world where
  // Carthage has no government yet is not one to answer it in.
  const governed = input.successionRules === undefined
    ? input.world
    : ensureConstitutions({ world: input.world, government: { offices: input.offices, successionRules: input.successionRules }, toDay: startDay });
  let world = governed;
  /**
   * Says where the burst has got to. Never allowed to fail the burst: a player
   * watching is a convenience, and a convenience that can lose an order is not
   * one.
   */
  const report = (progress: BurstProgress): void => {
    try {
      input.onProgress?.(progress);
    } catch {
      /* a listener's problem is never the world's */
    }
  };
  const today = (): string => formatWorldDate(world.instant, input.clock);
  /**
   * Where the current window began, as counts into the arrays below and the
   * world as it stood. A window is the slice from these marks to the present.
   */
  let windowIndex = 0;
  let windowMark = { facts: 0, narrative: 0, frictions: 0, utterances: 0, battles: 0, world: governed };
  let windowOrderFactIds: readonly string[] = [];
  /** Whether anybody has been asked anything since the window opened. */
  let askedSinceWindow = false;
  /** What every rule has taken from each purse this burst (`mechanics/instantiate.ts`). */
  const debitLedger = newDebitLedger(input.world);
  /** How far into `newFacts` the rules have looked, so an `on_fact` rule sees each fact once. */
  let factsSeenByMechanics = 0;
  let mechanicCalls = 0;
  const closeWindow = (final = false): void => {
    if (input.onWindowClosed === undefined) return;
    const snapshot: WindowSnapshot = {
      final,
      index: windowIndex,
      from: windowMark.world.instant,
      to: world.instant,
      worldBefore: windowMark.world,
      worldAfter: world,
      facts: newFacts.slice(windowMark.facts),
      significanceByFactId,
      narrative: narrative.slice(windowMark.narrative),
      frictions: frictions.slice(windowMark.frictions),
      utterances: utterances.slice(windowMark.utterances),
      battleAccounts: battleAccounts.slice(windowMark.battles),
      orderFactIds: windowOrderFactIds,
    };
    windowIndex += 1;
    windowMark = { facts: newFacts.length, narrative: narrative.length, frictions: frictions.length, utterances: utterances.length, battles: battleAccounts.length, world };
    windowOrderFactIds = [];
    askedSinceWindow = false;
    try {
      input.onWindowClosed(snapshot);
    } catch {
      /* a listener's problem is never the world's */
    }
  };
  let modelCalls = 0;
  let iterations = 0;
  let significance = 0;
  const newFacts: Fact[] = [];
  const significanceByFactId = new Map<string, number>();
  const scheduled: ScheduledEventDraft[] = [];
  const narrative: NarrativeLine[] = [];
  const frictions: NarrativeLine[] = [];
  const utterances: UtteranceLine[] = [];
  const battleAccounts: BattleAccount[] = [];
  const breaches: AuthorityBreach[] = [];
  const parseFailures: string[] = [];
  const salvaged: string[] = [];
  const skipped: { stage: "cognition" | "reconcile" | "repair"; reason: string }[] = [];
  let ambientOnlyRounds = 0;
  /** Who the passage of time took, so the burst can end on the question of who follows. */
  const deadThisBurst = new Set<string>();
  let playerDecision: PlayerDecision | null = null;
  let stopReason: StopReason = "no_due_events";
  /** Whether a plan laid in advance sprang while this burst was running. */
  let sprungThisBurst = false;
  /** What the ruler is waiting for, when the order was an open-ended one. */
  let watch: WatchProposal | null = null;
  /**
   * The world as the model was shown it, kept so a correction can be written
   * against the same facts the original answer was. Empty until the slice is
   * built, which is only before the first proposal there is anything to
   * correct in.
   */
  let sliceText = "";

  const audit: AuditEntry[] = [];
  /**
   * Every act the engine would not carry out as written, and every detail it
   * answered itself, before anything decides what the player hears of it.
   *
   * Taken from each pass separately: the merged result drops a first-pass
   * refusal the repair answered, and that refusal -- a whole model call spent
   * to put right something the engine could not read -- is exactly the one
   * worth counting.
   */
  const recordAudit = (pass: ApplyResult, actorRef: OrderPartyRef, attempt: AuditEntry["attempt"]): void => {
    for (const rejection of pass.rejected) {
      audit.push({ actorRef, op: rejection.delta.op, kind: rejection.kind, ofTheOrder: rejection.ofTheOrder === true, attempt, reason: rejection.reason, delta: rejection.delta });
    }
    for (const assumption of pass.assumptions) {
      audit.push({ actorRef, op: assumption.delta.op, kind: "assumed", ofTheOrder: assumption.ofTheOrder, attempt, reason: assumption.assumed.join(" "), delta: assumption.delta });
    }
  };

  /** Applies one actor's proposal: deltas, then the facts and events it produced. */
  const applyProposal = async (proposal: Proposal & { readonly worldDeltas?: readonly WorldDelta[] }, actorRef: OrderPartyRef, causalDepth: number, actsForTheWorld = false): Promise<OrderActs> => {
    // The world's own business first, so the order is carried out in the world
    // as it now stands -- a chieftain the world has just given the Boii is
    // somebody the order may write to. Only the orchestrator has two lists; an
    // actor thinking for himself has only his own acts.
    const worldDeltas = proposal.worldDeltas ?? [];
    // The world's own business written into the order is the world's, whichever
    // list it arrived in (`misfiledWorldActs`). Left where it stands, so what
    // it makes is made before whatever in the order names it.
    const misfiled = actsForTheWorld && proposal.worldDeltas !== undefined ? misfiledWorldActs(proposal.deltas, world, actorRef) : new Set<WorldDelta>();
    const orderDeltas = actsForTheWorld && proposal.worldDeltas !== undefined ? new Set<WorldDelta>(proposal.deltas.filter((delta) => !misfiled.has(delta))) : undefined;
    for (const delta of misfiled) {
      audit.push({ actorRef, op: delta.op, kind: "refiled", ofTheOrder: false, attempt: "first", reason: "Written into the order, but it makes something for another power with the actor nowhere in it: judged as the world's.", delta });
    }
    const aliveBefore = new Set(world.characters.filter((character) => character.alive).map((character) => character.id));
    const applyContext = (assignedIds?: ReadonlyMap<string, string>, order: ReadonlySet<WorldDelta> | undefined = orderDeltas) => ({
      now: world.instant,
      actorRef,
      offices: input.offices,
      ...(input.successionRules === undefined ? {} : { successionRules: input.successionRules }),
      warfare: input.warfare,
      ...(input.terrains === undefined ? {} : { terrains: input.terrains }),
      ...(input.wealth === undefined ? {} : { wealth: input.wealth }),
      ids,
      gameId: input.gameId,
      actsForTheWorld,
      playerCharacterId: input.actorRef.kind === "character" ? input.actorRef.id : null,
      ...(order === undefined ? {} : { orderDeltas: order }),
      ...(assignedIds === undefined ? {} : { assignedIds }),
    });

    let result = applyDeltas(world, [...worldDeltas, ...proposal.deltas], applyContext());
    recordAudit(result, actorRef, "first");
    /** The order's own acts the engine could not read, as they stand after every attempt. */
    const unreadable = (pass: ApplyResult) => pass.rejected.filter((rejection) => rejection.kind === "reference" && rejection.ofTheOrder === true);
    let unkept: RejectedDelta[] = unreadable(result);
    world = result.world;

    /**
     * One corrected attempt at the changes the engine refused over how they
     * were written. Nothing did this before: a delta that parsed and then
     * failed on the world was dropped in silence, so a player's order came
     * back half-done and the model was never told which half.
     *
     * Only engine rejections, and only while there is budget for the call --
     * a repair is a model call the player waits for, and the burst's ceiling
     * is what stops a bad answer costing an unbounded number of them.
     */
    const referenceRejections = result.rejected.filter((rejection) => rejection.kind === "reference");
    const repairable = referenceRejections.filter(worthRepairing);
    if (referenceRejections.length > 0 && repairable.length === 0) {
      skipped.push({ stage: "repair", reason: `${referenceRejections.length} refusal(s) no correction can cure: ${referenceRejections.map((rejection) => rejection.reason.slice(0, 80)).join(" | ")}` });
    }
    if (repairable.length > 0 && modelCalls < budget.maxModelCalls) {
      const repair = await repairDeltas({ port: input.port, worldText: sliceText, rejected: repairable, world });
      modelCalls += repair.calls;
      if (repair.failure !== null) parseFailures.push(repair.failure);
      if (repair.deltas.length > 0) {
        // A corrected act of the order's is still the order's. Which rejection
        // each correction answers is not kept, so a mixed batch is judged as
        // the order: the stricter reading, and the one that cannot be used to
        // launder a refusal.
        const correctsTheOrder = orderDeltas !== undefined && repairable.some((rejection) => rejection.ofTheOrder === true);
        const second = applyDeltas(world, repair.deltas, applyContext(result.assignedIds, correctsTheOrder ? new Set(repair.deltas) : undefined));
        recordAudit(second, actorRef, "repair");
        // The repair answers some of what was refused and says nothing of the
        // rest; which correction answers which refusal is not kept, so an act
        // counts as answered when the repair wrote one of the same kind.
        const answered = [...second.applied, ...second.rejected].map((entry) => entry.delta.op);
        unkept = [
          ...unkept.filter((rejection) => {
            const at = answered.indexOf(rejection.delta.op);
            if (at < 0) return true;
            answered.splice(at, 1);
            return false;
          }),
          ...unreadable(second),
        ];
        world = second.world;
        // The repaired batch replaces the rejections it was answering: what it
        // fixed is applied, and what it still could not write is refused on
        // its own terms rather than twice over.
        result = {
          world: second.world,
          applied: [...result.applied, ...second.applied],
          rejected: [...result.rejected.filter((rejection) => rejection.kind !== "reference"), ...second.rejected],
          breaches: [...result.breaches, ...second.breaches],
          factProposals: [...result.factProposals, ...second.factProposals],
          battleAccounts: [...result.battleAccounts, ...second.battleAccounts],
          assignedIds: second.assignedIds,
          assumptions: [...result.assumptions, ...second.assumptions],
        };
      }
    }

    // What still cannot be read is kept in the one form that can hold anything:
    // an arrangement, owned by whoever set it going, at the engine's price
    // (`keepAsArrangement`). Each on its own, so one that cannot be afforded
    // does not take the others with it.
    // By handle, not by object: the applier hands back a filled copy of what
    // it was given.
    const keptLocalIds = new Set<string>();
    for (const rejection of unkept) {
      const arrangement = keepAsArrangement(rejection.delta, world, actorRef, rejection.reason);
      if (arrangement === null) continue;
      if ("localId" in arrangement && typeof arrangement.localId === "string") keptLocalIds.add(arrangement.localId);
      const kept = applyDeltas(world, [arrangement], applyContext(result.assignedIds, new Set([arrangement])));
      world = kept.world;
      if (kept.applied.length === 0) {
        recordAudit(kept, actorRef, "keep");
      } else {
        audit.push({ actorRef, op: rejection.delta.op, kind: "kept", ofTheOrder: true, attempt: "keep", reason: `${rejection.reason} Kept as an arrangement: "${(arrangement as { label: string }).label}".`, delta: rejection.delta });
      }
      result = {
        world: kept.world,
        applied: [...result.applied, ...kept.applied],
        rejected: [...result.rejected.filter((candidate) => kept.applied.length === 0 || candidate !== rejection), ...kept.rejected],
        breaches: [...result.breaches, ...kept.breaches],
        factProposals: [...result.factProposals, ...kept.factProposals],
        battleAccounts: [...result.battleAccounts, ...kept.battleAccounts],
        assignedIds: kept.assignedIds,
        assumptions: [...result.assumptions, ...kept.assumptions],
      };
    }

    breaches.push(...result.breaches);
    // Whoever this proposal killed -- in a battle it fought, on a scaffold, in
    // a duel. Only deaths from the passage of time were counted, so a player
    // killed in a battle of his own ordering went on being asked for orders.
    for (const id of aliveBefore) {
      if (world.characters.some((character) => character.id === id && !character.alive)) deadThisBurst.add(id);
    }

    // A fact that belongs to a secret thread is secret, whatever the model
    // wrote in its visibility field: the thread's participants are the people
    // who know it, and nobody else can be. A prompt asking for "private" will
    // eventually be answered with "polity", and the record is what must hold.
    const resolveId = (ref: string): string => result.assignedIds.get(ref.replace(/^local:/, "")) ?? ref;
    const resolveStrict = (ref: string): string | null => (ref.startsWith("local:") ? result.assignedIds.get(ref.slice("local:".length)) ?? null : ref);
    // A fact about something that was never made did not happen. The model
    // writes its facts beside its deltas and cannot know which the engine will
    // refuse: "the Gauls flock to his banner" arrived with the army that was
    // never raised, and stood in the record contradicting the refusal next to
    // it. A fact naming a handle this batch never assigned goes with the thing
    // it was about.
    const madeReal = (ref: string): boolean => !ref.startsWith("local:") || resolveStrict(ref) !== null;
    const aboutRealThings = proposal.facts.filter((fact) =>
      fact.affectedRefs.every((ref) => madeReal(ref.id)) && (fact.storylineRef === null || madeReal(fact.storylineRef)));
    // And a fact about a refused act on something that does exist -- "a sum
    // left the consul's chest" beside a chest that stayed shut -- is taken
    // back by its author, who alone can tell which sentences described what.
    let happened = aboutRealThings;
    // Only the facts that name what was refused are asked about; the rest
    // stand. A letter refused as already answered used to send every fact of
    // the round to be reconsidered, at a call apiece.
    // An account a refused act names stands for its owner too, and the
    // order's own refusal stands for the ruler and his power: "a sum left
    // the consul's chest" names Rome, not the purse the engine refused.
    const namedBeside = new Set<string>();
    for (const rejection of result.rejected) {
      for (const value of Object.values(rejection.delta as Record<string, unknown>)) {
        if (typeof value !== "string") continue;
        const account = world.material.accounts.find((candidate) => candidate.id === value || candidate.id === value.replace(/^local:/, ""));
        if (account !== undefined) namedBeside.add(account.owner.id);
      }
      if (actsForTheWorld && rejection.ofTheOrder === true) {
        namedBeside.add(actorRef.id);
        if (input.actorPolityId !== null) namedBeside.add(input.actorPolityId);
      }
    }
    const naming = result.rejected.length === 0 ? [] : factsNamingRefusals(aboutRealThings, result.rejected, namedBeside);
    if (result.rejected.length > 0 && aboutRealThings.length > 0 && naming.length === 0) {
      skipped.push({ stage: "reconcile", reason: `${result.rejected.length} refusal(s), and none of ${aboutRealThings.length} fact(s) names them` });
    }
    if (naming.length > 0 && modelCalls < budget.maxModelCalls) {
      const reconciled = await reconcileFacts({ port: input.port, facts: naming, refused: result.rejected });
      modelCalls += reconciled.calls;
      if (reconciled.failure !== null) parseFailures.push(`fact reconciliation: ${reconciled.failure}`);
      const kept = new Set(reconciled.facts.map((fact) => fact.localId));
      const rewritten = new Map(reconciled.facts.map((fact) => [fact.localId, fact]));
      const asked = new Set(naming.map((fact) => fact.localId));
      happened = aboutRealThings.flatMap((fact) => (!asked.has(fact.localId) ? [fact] : kept.has(fact.localId) ? [rewritten.get(fact.localId)!] : []));
    }
    const keptSecret = happened.map((fact) => {
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
    // The account's fact handles are local ids until the batch assigns them.
    for (const account of result.battleAccounts) {
      battleAccounts.push({
        ...account,
        factIds: account.factIds.flatMap((localId) => {
          const assigned = materialized.factIds.get(localId);
          return assigned === undefined ? [] : [assigned];
        }),
      });
    }

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
    //
    // An order nobody obeyed is neither: it is a scene. Everybody who was
    // there saw a man give orders to people who do not take them from him,
    // and that travels.
    for (const rejection of result.rejected) {
      const isWorldFriction = rejection.kind === "world";
      const ignored = rejection.kind === "ignored";
      const friction = materializeFacts({
        proposals: [{
          localId: `friction_${scheduled.length}_${newFacts.length}`,
          kind: ignored ? "order_ignored" : isWorldFriction ? "execution_friction" : "engine_rejection",
          summary: rejection.reason,
          affectedRefs: [actorRef],
          visibility: ignored ? "public" : isWorldFriction ? "polity" : "private",
          discoveryState: ignored ? "public" : isWorldFriction ? "polity" : "private",
          knowableInDays: 0,
          significance: ignored ? 30 : isWorldFriction ? 5 : 0,
          knownToRefs: isWorldFriction || ignored ? [actorRef] : [],
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
    // Every arrangement this proposal set going that is not a law is a
    // candidate for a mechanic the model could write once and the engine run
    // for ever (plan §2). Counted whether or not a writer exists, so the
    // audit says how many orders would pay for the call before it is built.
    const candidates: { entityId: string; delta: WorldDelta; attempt: AuditEntry["attempt"]; ofTheOrder: boolean }[] = [];
    for (const applied of result.applied) {
      if (applied.delta.op !== "generic_entity_create" || applied.delta.kind === "law") continue;
      const madeId = result.assignedIds.get(applied.delta.localId) ?? applied.delta.localId;
      const attempt = keptLocalIds.has(applied.delta.localId) ? "keep" : "first";
      audit.push({
        actorRef, op: applied.delta.op, kind: "mechanic_candidate", ofTheOrder: applied.ofTheOrder === true, attempt,
        reason: `${madeId}: an arrangement of kind "${applied.delta.kind}" the world could be asked to write a mechanic for.`,
        delta: applied.delta,
      });
      candidates.push({ entityId: madeId, delta: applied.delta, attempt, ofTheOrder: applied.ofTheOrder === true });
    }
    if (candidates.length > 0) {
      const actText = actsForTheWorld && input.orderText !== null ? input.orderText : proposal.narrativeSummary;
      await offerMechanics(candidates, actorRef, actText);
    }
    return {
      carriedOut: result.applied.filter((entry) => entry.ofTheOrder === true).length,
      refusedByTheWorld: result.rejected.filter((rejection) => rejection.ofTheOrder === true && rejection.kind !== "reference").length,
      refused: result.rejected.filter((rejection) => rejection.ofTheOrder === true).length,
    };
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
  const plans = emptyPlanTally();
  let planFactSerial = 0;
  const tickTo = (toDay: number): void => {
    const ticked = runDeterministicTick({
      world, toDay, ids, warfare: input.warfare,
      ...(input.life === undefined ? {} : { life: input.life }),
      ...(input.successionRules === undefined ? {} : { government: { offices: input.offices, successionRules: input.successionRules } }),
      playerCharacterId: input.actorRef.kind === "character" ? input.actorRef.id : null,
    });
    // The tick writes the world directly, not through `applyDeltas`, so
    // nothing checked what it wrote. One impossible row from it -- a transfer
    // from an account to itself, an id past its length -- was then carried by
    // every batch after it, and `applyDeltas` refuses a whole batch that ends
    // in an invalid world: the player's order, and every reaction to it, were
    // refused for a fault that was not theirs, and the bad world was saved
    // anyway. A hop whose bookkeeping will not hold is dropped instead; the
    // clock has already moved, and the next hop tries again from good state.
    const holds = WorldStateSchema.safeParse(ticked.world);
    if (!holds.success) {
      const [issue] = holds.error.issues;
      parseFailures.push(`the tick to day ${toDay} wrote a world that would not load and was set aside (${issue === undefined ? "unknown" : `${issue.path.join(".")}: ${issue.message}`})`);
      return;
    }
    world = holds.data;
    // A plan the ruler laid has sprung by itself. The burst stops at the end of
    // this hop and hands him back the wheel: he prepared against exactly this
    // moment, and reading about it in a month's Chronicle is no use to him.
    // `watch_condition` is the honest name for it -- a condition he set, which
    // fired -- rather than a tenth stop reason meaning the same thing.
    if (ticked.sprungContingencies.length > 0) sprungThisBurst = true;
    battleAccounts.push(...ticked.contingencyBattles);
    // A death the world produced, not one anybody ordered. Held until the
    // burst ends: the deltas of this hop are still being applied, and the
    // Chronicle writes the death before the player is asked who follows.
    for (const id of ticked.died) deadThisBurst.add(id);
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
    // Then the rules the world wrote, on the world the tick left: real deltas
    // through the applier, with the context the tick does not have.
    const ruled = runMechanics({
      world, toDay, ids, recentFacts: newFacts.slice(factsSeenByMechanics), ledger: debitLedger,
      apply: {
        offices: input.offices, warfare: input.warfare, gameId: input.gameId,
        ...(input.terrains === undefined ? {} : { terrains: input.terrains }),
        ...(input.wealth === undefined ? {} : { wealth: input.wealth }),
        playerCharacterId: input.actorRef.kind === "character" ? input.actorRef.id : null,
      },
    });
    world = ruled.world;
    for (const row of ruled.audit) audit.push({ actorRef: row.actorRef, op: row.op, kind: row.kind, ofTheOrder: false, attempt: "first", reason: row.reason, delta: row.delta });
    if (ruled.facts.length > 0) {
      const materialized = materializeFacts({ proposals: ruled.facts, now: world.instant, atStep: world.elapsedStep, ids, causalDepth: 0, assignedIds: new Map() });
      newFacts.push(...materialized.facts);
      for (const [factId, weight] of materialized.significanceByFactId) significanceByFactId.set(factId, weight);
      significance += materialized.significance;
    }
    factsSeenByMechanics = newFacts.length;
    // Plans whose steps passed their day undone. Each owner's own record of
    // it, and the step left for the router to wake him with.
    const behind = settleOverdueSteps(world, input.clock, (prefix) => `${prefix}_${newFacts.length}_${(planFactSerial += 1)}`);
    if (behind.missed > 0) {
      world = behind.world;
      plans.missed += behind.missed;
      const materialized = materializeFacts({ proposals: behind.facts, now: world.instant, atStep: world.elapsedStep, ids, causalDepth: 0, assignedIds: new Map() });
      newFacts.push(...materialized.facts);
      for (const [factId, weight] of materialized.significanceByFactId) significanceByFactId.set(factId, weight);
      significance += materialized.significance;
    }
  };

  /**
   * Offers each arrangement somebody just set going to the rule behind it
   * (plan §2): a shape the world already holds for that kind, refilled for this
   * owner at no call; or, while the budget allows, one call to write it. A
   * refused rule leaves the plain arrangement, never nothing.
   */
  const offerMechanics = async (
    candidates: readonly { readonly entityId: string; readonly delta: WorldDelta; readonly attempt: AuditEntry["attempt"]; readonly ofTheOrder: boolean }[],
    actorRef: OrderPartyRef,
    actText: string,
  ): Promise<void> => {
    for (const candidate of candidates) {
      const entity = world.genericEntities.find((item) => item.id === candidate.entityId);
      if (entity === undefined || entity.ownerRef === null || entity.mechanic !== undefined) continue;
      const owner = entity.ownerRef;
      const refs = readableRefsFor(world, owner, entity);
      const ownerCharacterId = owner.kind === "character" ? owner.id : null;
      const attach = (draft: Parameters<typeof validateMechanic>[0]): boolean => {
        const checked = validateMechanic(draft, world, refs, input.offices);
        if (!checked.ok) {
          audit.push({ actorRef, op: candidate.delta.op, kind: "mechanic_refused", ofTheOrder: candidate.ofTheOrder, attempt: candidate.attempt, reason: `${entity.id}: ${checked.reason}`, delta: candidate.delta });
          return false;
        }
        const attached = attachMechanic({ world, entity, draft: checked.draft, origin: "written", warrants: checked.warrants, refs, ids, offices: input.offices, warfare: input.warfare, gameId: input.gameId });
        if (!attached.ok) {
          audit.push({ actorRef, op: candidate.delta.op, kind: "mechanic_refused", ofTheOrder: candidate.ofTheOrder, attempt: candidate.attempt, reason: `${entity.id}: ${attached.reason}`, delta: candidate.delta });
          return false;
        }
        world = attached.world;
        const materialized = materializeFacts({ proposals: attached.facts, now: world.instant, atStep: world.elapsedStep, ids, causalDepth: 0, assignedIds: new Map() });
        newFacts.push(...materialized.facts);
        for (const [factId, weight] of materialized.significanceByFactId) significanceByFactId.set(factId, weight);
        significance += materialized.significance;
        const dropped = checked.dropped.length === 0 ? "" : ` Dropped: ${checked.dropped.join("; ")}.`;
        audit.push({ actorRef, op: candidate.delta.op, kind: "mechanic", ofTheOrder: candidate.ofTheOrder, attempt: candidate.attempt, reason: `${entity.id}: ${mechanicInWords(checked.draft, world)}.${dropped}`, delta: candidate.delta });
        return true;
      };
      if (mechanicCalls >= budget.maxMechanicCalls) continue;
      const ownerText = ownerCharacterId !== null && ownerCharacterId === (input.actorRef.kind === "character" ? input.actorRef.id : null) && sliceText.length > 0
        ? sliceText
        : ownerCharacterId === null ? `The power ${owner.id}.` : renderCharacterPortrait(ownerCharacterId, world.characters.find((character) => character.id === ownerCharacterId)?.name ?? ownerCharacterId, world, input.clock);
      const written = await writeMechanic({ port: input.port, world, entity, act: candidate.delta, actText, ownerText, refs });
      mechanicCalls += written.calls;
      if (written.failure !== null) parseFailures.push(`mechanic for ${entity.id}: ${written.failure}`);
      if (written.draft === null) {
        audit.push({ actorRef, op: candidate.delta.op, kind: "mechanic_refused", ofTheOrder: candidate.ofTheOrder, attempt: candidate.attempt, reason: `${entity.id}: ${written.failure === null ? "the writer judged it no rule" : "the writer's answer could not be read"}`, delta: candidate.delta });
        continue;
      }
      attach(written.draft);
    }
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

  // ── The ruler's antagonist ──────────────────────────────────────────────
  //
  // Asked before the order, so the man is in the room for the whole burst. The
  // choice is the engine's and the campaign is his: all this does is decide
  // that somebody has become the ruler's problem, open the thread it will be
  // told in, and make sure he is heard every round instead of whenever the
  // week's facts happen to reach him.
  const playerId = input.actorRef.kind === "character" ? input.actorRef.id : null;
  let nemesis = nemesisOf(world.nemeses, playerId);
  if (nemesis !== undefined && shouldRetire(world, nemesis)) {
    world = retireNemesis(world, nemesis);
    nemesis = undefined;
  }
  if (nemesis === undefined && playerId !== null) {
    const chosen = chooseNemesis({ world, gameId: input.gameId, playerCharacterId: playerId, ownPolityId: input.actorPolityId });
    if (chosen !== null) {
      world = recordNemesis(world, chosen, playerId, ids);
      nemesis = nemesisOf(world.nemeses, playerId);
    }
  }
  /**
   * How he fights, and where he stands this season.
   *
   * Two halves on purpose: the first is a fact about the man, read off his
   * temperament and his drives, and the second is a fact about the situation.
   * A stalwart rival and a treacherous one holding the same office against the
   * same ruler should not be handed the same brief, and before this they were.
   */
  const antagonistNote = (): string | undefined => {
    if (nemesis === undefined || playerId === null) return undefined;
    const rival = world.characters.find((character) => character.id === nemesis.characterId);
    if (rival === undefined) return undefined;
    const ruler = world.characters.find((character) => character.id === playerId)?.name ?? "the ruler";
    return `${conductInWords(rival, ruler)} ${stanceInWords(nemesisStance(world, nemesis, input.actorPolityId), ruler)}`;
  };

  /**
   * No order goes unanswered, whatever became of it.
   *
   * The Chronicle's promise that an order is always answered rested on the
   * order having produced something its giver could see. Three ways it did
   * not: the model's answer could not be read at all; everything it wrote was
   * refused over how it was written -- an office nobody had created, an army
   * nobody had raised -- which is kept out of the record as the engine's own
   * business; or all it did was private to other people. In every one of those
   * the player wrote an order and the record said nothing, which reads as the
   * game ignoring them.
   *
   * So when nothing of the order reached its giver, the order itself does:
   * what they ordered, and what stood in the way where anything did. A
   * military access nobody needed, a courtship that led nowhere, a bid for an
   * office that failed -- each is still a thing that happened in the reign.
   *
   * "Reached its giver" is judged on the order's own acts, not on whether
   * anything at all was said: the orchestrator writes the world's doings in
   * the same breath as the order's, and an embassy the engine refused to
   * send once left no trace because a fire in Latium and a quarrel between
   * the consuls were written beside it. An order every act of which was
   * refused is answered whatever else the answer held.
   */
  const answerTheOrder = (answer: readonly Fact[], acts: OrderActs): void => {
    if (input.orderText === null || input.orderText.trim().length === 0) return;
    const seen = factsKnownTo(answer, input.actorRef, input.actorPolityId, world.instant)
      .filter((fact) => !NEVER_PUBLISHED.has(fact.kind));
    const allRefused = acts.carriedOut === 0 && acts.refused > 0;
    if (seen.length > 0 && !allRefused) return;
    const who = world.characters.find((character) => character.id === input.actorRef.id)?.name ?? "The ruler";
    const order = input.orderText.trim().replace(/\s+/g, " ");
    const quoted = order.length > 300 ? `${order.slice(0, 297)}...` : order;
    const obstacles = answer.filter((fact) => fact.kind === "engine_rejection" || fact.kind === "execution_friction").map((fact) => fact.summary);
    const outcome = orchestration.parseFailure !== null && answer.length === 0
      ? "Word of it went out, and nothing came back that anyone could make sense of."
      : obstacles.length > 0
        ? `It could not be done as given: ${obstacles.slice(0, 3).join(" ")}`
        : "Nothing came of it that anyone could see.";
    const answered = materializeFacts({
      proposals: [{
        localId: "order_answered",
        kind: "order_given",
        summary: `${who} ordered: "${quoted}" ${outcome}`.slice(0, 600),
        affectedRefs: [input.actorRef],
        visibility: "private",
        discoveryState: "private",
        knowableInDays: 0,
        knownToRefs: [input.actorRef],
        significance: 20,
      }],
      now: world.instant,
      atStep: world.elapsedStep,
      ids,
      causalDepth: 0,
      assignedIds: new Map(),
    });
    newFacts.push(...answered.facts);
    for (const [factId, weight] of answered.significanceByFactId) significanceByFactId.set(factId, weight);
  };

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

  // The world makes trouble of its own (VISION §32). Decided here, before the
  // orchestrator, so it can be carried out in the call the order was already
  // paying for -- and decided as a batch, because a burst covers a season and
  // one stirring a season is not a world that moves on its own.
  // A power's waiting letters, put to the one person who answers for it.
  world = addressWaitingLetters(world, input.offices);

  const seeds: readonly NarratorSeed[] = input.narratorSeeds !== undefined
    ? input.narratorSeeds
    : input.narratorSeed !== undefined
      ? (input.narratorSeed === null ? [] : [input.narratorSeed])
      : decideNarratorSeeds({
        world,
        gameId: input.gameId,
        ownPolityId: input.actorPolityId,
        playerCharacterId: input.actorRef.kind === "character" ? input.actorRef.id : null,
        facts: [...input.knownFacts, ...newFacts],
        // What this order may carry the world through, so the batch is the
        // season's and not the morning's.
        spanDays: Math.min(input.spanDays ?? budget.maxSimulatedDays, input.clock.maxSpanDays),
        // What tells a fleet from an army, so a storm at sea catches ships and
        // never a legion in the open field.
        warfare: input.warfare,
        ...(input.historicalPressures === undefined ? {} : { pressures: input.historicalPressures }),
      });
  world = recordSeedsOffered(world, seeds, world.instant.day + Math.min(input.spanDays ?? budget.maxSimulatedDays, input.clock.maxSpanDays));

  // The stirrings that are arithmetic and a line of news are the engine's to
  // carry out (`engineWork`), before the orchestrator is asked anything; it
  // is shown only the ones that need somebody to decide something.
  const offeredSeeds: NarratorSeed[] = [];
  for (const seed of seeds) {
    const work = engineWork(seed);
    if (work === null) {
      offeredSeeds.push(seed);
      continue;
    }
    const done = applyDeltas(world, [...work.deltas], {
      now: world.instant, actorRef: input.actorRef, offices: input.offices, ...(input.successionRules === undefined ? {} : { successionRules: input.successionRules }), warfare: input.warfare, ids, gameId: input.gameId,
      actsForTheWorld: true,
      playerCharacterId: input.actorRef.kind === "character" ? input.actorRef.id : null,
      ...(input.terrains === undefined ? {} : { terrains: input.terrains }),
      ...(input.wealth === undefined ? {} : { wealth: input.wealth }),
    });
    if (done.applied.length === 0) {
      offeredSeeds.push(seed);
      continue;
    }
    world = done.world;
    const materialized = materializeFacts({ proposals: [work.fact], now: world.instant, atStep: world.elapsedStep, ids, causalDepth: 0, assignedIds: new Map() });
    newFacts.push(...materialized.facts);
    for (const [factId, weight] of materialized.significanceByFactId) significanceByFactId.set(factId, weight);
    significance += materialized.significance;
  }

  const slice = buildWorldSlice({
    world,
    clock: input.clock,
    offices: input.offices,
    ...(input.successionRules === undefined ? {} : { successionRules: input.successionRules }),
    warfare: input.warfare,
    actorRef: input.actorRef,
    actorPolityId: input.actorPolityId,
    orderText: input.orderText,
    ...(input.answeredDecision === undefined ? {} : { answeredDecision: input.answeredDecision }),
    facts: input.knownFacts,
    dueEvents: dueNow,
    pendingEvents: upcoming,
    narratorSeeds: offeredSeeds,
  });

  sliceText = renderWorldSlice(slice);
  report({ kind: "orchestrating" });
  const orchestration = await orchestrate(input.port, slice, kindsIn(world));
  modelCalls += orchestration.calls;
  iterations += 1;
  if (orchestration.parseFailure !== null) parseFailures.push(orchestration.parseFailure);
  salvaged.push(...orchestration.salvaged);
  const factsBefore = newFacts.length;
  const acts = await applyProposal(orchestration.output, input.actorRef, 0, true);
  // An order that left nothing in the world -- no act carried out, none the
  // world refused -- is still something the player is now doing. Without a
  // trace, "I start selling cutlery in Rome" answered only in prose was
  // forgotten by the next order: nothing in the world said he sold anything.
  // One pursuit per person, the latest replacing the last; it does nothing and
  // costs nothing, and it is what a later act can build on. A question asks
  // for nothing to be done, and an unreadable answer is already its own fault.
  // Nor does a wait: the web's "let a month pass" sends no order text at all.
  if (
    acts.carriedOut === 0 && acts.refusedByTheWorld === 0
    && input.orderText !== null && input.answeredDecision === undefined
    && orchestration.parseFailure === null && !/\?\s*$/.test(input.orderText.trim())
    && input.actorRef.kind === "character"
  ) {
    const pursuing = pursuitOf(world, input.actorRef, orchestration.output.intent.summary, input.orderText);
    const recorded = applyDeltas(world, [pursuing], {
      now: world.instant, actorRef: input.actorRef, offices: input.offices, ...(input.successionRules === undefined ? {} : { successionRules: input.successionRules }), warfare: input.warfare, ids, gameId: input.gameId,
      ...(input.terrains === undefined ? {} : { terrains: input.terrains }),
    });
    if (recorded.applied.length > 0) {
      world = recorded.world;
      audit.push({ actorRef: input.actorRef, op: pursuing.op, kind: "pursuit", ofTheOrder: true, attempt: "floor", reason: `The order left nothing in the world; recorded as a pursuit: "${orchestration.output.intent.summary}".`, delta: pursuing });
      if (pursuing.op === "generic_entity_create") {
        const madeId = recorded.assignedIds.get("pursuit") ?? "pursuit";
        audit.push({ actorRef: input.actorRef, op: pursuing.op, kind: "mechanic_candidate", ofTheOrder: true, attempt: "floor", reason: `${madeId}: a pursuit the world could be asked to write a mechanic for.`, delta: pursuing });
        await offerMechanics([{ entityId: madeId, delta: pursuing, attempt: "floor", ofTheOrder: true }], input.actorRef, input.orderText);
      }
    } else {
      recordAudit(recorded, input.actorRef, "floor");
    }
  }
  answerTheOrder(newFacts.slice(factsBefore), acts);
  const orderFactIds = newFacts.slice(factsBefore).map((fact) => fact.id);
  windowOrderFactIds = orderFactIds;
  if (orchestration.output.playerDecision !== null) playerDecision = orchestration.output.playerDecision;

  // Who the stirrings landed on decides who is asked first what they do about
  // it. The ledger was written when they were offered: a batch is not
  // re-offered, so there is nothing further to record here.
  const priorityCharacterIds: string[] = offeredSeeds
    .filter((seed) => seedWasTaken(world, newFacts.slice(factsBefore), seed))
    .flatMap((seed) => seedParticipants(world, seed))
    .filter((id) => input.actorRef.kind !== "character" || id !== input.actorRef.id);

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
  // The player's own span where he gave one, never past what the scenario's
  // clock allows a single burst to cover.
  const maxDays = Math.max(1, Math.min(input.spanDays ?? budget.maxSimulatedDays, input.clock.maxSpanDays));
  const minDays = input.spanDays === undefined ? input.clock.minSpanDays : maxDays;
  let causalDepth = 1;
  // The chain of reactions being answered (see `newChainAfterDays`). The
  // first is the order's; each later one reacts only to news no round has
  // yet seen: what was written after the last round's cast was chosen, and
  // what has since arrived from further off.
  let chain = 1;
  // The orchestration is the order's chain's first round, as it is the first of `iterations`.
  const chainRounds: number[] = [1];
  let planRounds = 0;
  let chainStartIterations = 0;
  let chainNewsFrom = 0;
  // Facts known before the burst began are news only if they arrive during it:
  // the rest were there to be answered last time, and re-reading them woke
  // the same people about the same things every order.
  let chainNewsAfterKey = input.world.instant.day * 1440 + input.world.instant.minute;
  // Who has been asked about what, and who wrote what, this burst (see
  // `routeAttention`'s `alreadyAnswered`).
  const answeredBy = new Map<string, Set<string>>();
  const authorOf = new Map<string, string>();
  let lastAskedDay: number | null = null;
  let factsSeenByLastRound = 0;
  let lastRoundKey = 0;
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

    // A plan is on the calendar too: the week a step comes into, and the day
    // it passes undone, are moments somebody has to be asked about.
    const planDay = nextPlanDay(world);
    // And so is word arriving. A letter written on the 3rd that reaches its
    // king on the 8th is the 8th's business: with only a project milestone
    // three months off on the calendar, the burst jumped straight to it, and
    // both kings "refused by silence" letters they were never shown.
    // Older news arrives at depth 0 (see `reactTo`); this burst's only while a reaction to it is still allowed.
    const arrivals = [...input.knownFacts, ...newFacts.filter((fact) => fact.causalDepth < budget.maxCausalDepth)]
      .flatMap((fact) => (fact.discovery.knowableAtInstant === null ? [] : [fact.discovery.knowableAtInstant.day * 1440 + fact.discovery.knowableAtInstant.minute]));
    const nextScheduled = [...input.queue, ...scheduled]
      .map((event) => event.dueInstantSortKey)
      .concat(planDay === undefined ? [] : [planDay * 1440])
      .concat(arrivals)
      // A chamber's debate and its vote: a long jump used to carry the world
      // past both, and the question sat undecided past its day.
      .concat(voteCalendarDays(world, electiveOfficesOf(world, input.offices, input.successionRules ?? [])).map((day) => day * 1440))
      .filter((key) => key > nowKey())
      .sort((a, b) => a - b)[0];
    // The first step is short, so word can travel and the people the order
    // touches get their chance to answer it. After that the world jumps to
    // whatever is next on the calendar -- which is what lets a months-long
    // recruitment actually mature instead of creeping forward two days an order.
    const reactionKey = nowKey() + REACTION_DELAY_DAYS * 1440;
    const ceilingKey = (startDay + maxDays) * 1440 + world.instant.minute;
    // Asked to let a month pass, and nothing on the calendar: the rest of the
    // month goes by in one step rather than two days at a time, each of which
    // would stop to ask the world's people what they make of nothing.
    const idle = input.spanDays === undefined ? reactionKey : ceilingKey;
    const targetKey = Math.min(hops === 1 ? reactionKey : nextScheduled ?? idle, ceilingKey);

    // The clock is about to move: everything written so far is dated at or
    // before this instant, and nothing written after can land before it. The
    // order is a window of its own; after that a window is cut only once
    // somebody has been asked something, so a run of quiet hops -- the world
    // jumping a fortnight at a time to the next thing on the calendar -- is
    // one window and one look by the historian, not one per hop.
    if (windowIndex === 0 || askedSinceWindow) closeWindow();
    world = advanceWorldTo(world, addMinutes(world.instant, Math.max(0, targetKey - nowKey())));
    tickTo(world.instant.day);
    fireDueEvents();
    report({ kind: "advanced", date: today() });

    const playerCharacterIds = input.actorRef.kind === "character" ? [input.actorRef.id] : [];
    if (lastAskedDay !== null && causalDepth > 1 && world.instant.day - lastAskedDay >= budget.newChainAfterDays) {
      chain += 1;
      causalDepth = 1;
      ambientOnlyRounds = 0;
      chainStartIterations = iterations;
      chainNewsFrom = factsSeenByLastRound;
      chainNewsAfterKey = lastRoundKey;
    }
    const arrivedSince = (fact: Fact): boolean => {
      const at = fact.discovery.knowableAtInstant;
      return at !== null && at.day * 1440 + at.minute > chainNewsAfterKey;
    };
    // Old news arriving now is news to this chain, at its first depth; old
    // news long since answered is not news at all.
    const reactTo = [
      ...[...input.knownFacts, ...newFacts.slice(0, chainNewsFrom)].filter(arrivedSince).map((fact) => ({ ...fact, causalDepth: 0 })),
      ...newFacts.slice(chainNewsFrom),
    ];
    const attention = routeAttention({
      world,
      facts: reactTo,
      offices: input.offices,
      excludeCharacterIds: playerCharacterIds,
      maxFocused: budget.maxFocusedActors,
      maxCausalDepth: budget.maxCausalDepth,
      alreadyAnswered: answeredBy,
      authorOf,
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
    const due = dueSteps(world, input.clock, playerCharacterIds);
    // Who owes the world something now: a plan's step, or their word on a
    // question about to be voted. Both wake a man as pressing, once a round.
    const wanted = new Map<string, string>([
      ...debatersOf(world, input.offices, world.instant.day, playerCharacterIds, input.successionRules ?? []),
      ...due.map((entry) => [entry.ownerId, entry.why] as const),
    ]);
    const ambient = routeAmbientActors({
      world,
      facts: [...input.knownFacts, ...newFacts],
      offices: input.offices,
      excludeCharacterIds: [...playerCharacterIds, ...attention.focused.map((actor) => actor.characterId)],
      max: budget.maxAmbientActors,
      // The first round only: whoever the narrator just handed a problem to is
      // asked what they do about it before the rotation has its say.
      priorityCharacterIds: hops === 1 ? priorityCharacterIds : [],
      // Every round, not only the first: a quarrel that goes quiet whenever the
      // week is busy is not a quarrel, it is a coincidence.
      nemesisCharacterId: nemesis?.characterId ?? null,
      dueStepOwners: wanted,
    });

    // Where the antagonist stands is the world's to know and his to act on, so
    // it is said in his own section and nowhere else. Nothing tells him what he
    // is; he is told what his situation is, which is what anybody knows.
    const note = antagonistNote();
    // A man a plan wants who is also answering news is told both: the router
    // that woke him for the news knows nothing of his plan, and without this
    // the step came due while he was being asked about something else.
    const dueWhy = wanted;
    const cast = [...attention.focused, ...ambient].map((actor) => {
      const planned = actor.impetus === "own_business" ? undefined : dueWhy.get(actor.characterId);
      const told = planned === undefined ? actor : { ...actor, why: `${actor.why}; and ${planned}` };
      return nemesis !== undefined && told.characterId === nemesis.characterId && note !== undefined ? { ...told, note } : told;
    });
    // Reactions to reactions stop at a depth; a man's own plan is not a
    // reaction. Past that depth the burst used to walk the rest of its span
    // asking nobody, so a month let pass spent its three rounds in the first
    // nine days, and four steps went by their day with their owners never
    // asked -- found by playing it by hand. Now whoever a plan wants is still
    // asked, alone with the others it wants: each step wakes him once, and the
    // call budget still bounds the whole.
    const reactionsSpent = causalDepth > budget.maxCausalDepth;
    const asking = reactionsSpent ? cast.filter((actor) => dueWhy.has(actor.characterId)) : cast;
    // Nobody pressing means the rotation alone, and the burst pays for only
    // so many of those rounds: the world elsewhere gets its look, not a look
    // every hop. Logged, never silent.
    const ambientOnly = asking.length > 0 && !asking.some((actor) => actor.pressing);
    let asked = false;
    if (ambientOnly && ambientOnlyRounds >= budget.maxAmbientOnlyRounds) {
      skipped.push({ stage: "cognition", reason: `hop ${hops} on ${today()}: a cast of ${asking.length} with nobody pressing, ${ambientOnlyRounds} such round(s) already answered` });
      report({ kind: "skipped", date: today() });
    }
    const wantsAnswering = asking.length > 0 && !(ambientOnly && ambientOnlyRounds >= budget.maxAmbientOnlyRounds);
    if (wantsAnswering) {
      asked = true;
      if (ambientOnly) ambientOnlyRounds += 1;
      // Somebody has something to say and there is nothing left to pay them
      // with. Stopping here is honest; carrying on would silence them.
      const spent = modelCalls >= budget.maxModelCalls || (!reactionsSpent && iterations - chainStartIterations >= budget.maxIterations);
      // The order's own consequences stop the burst when they cannot be paid
      // for, and so does anything in a burst the player gave no span: he gets
      // the wheel back rather than a world that went quiet. A span he asked
      // for is his to have, so there a later chain is skipped instead.
      if (spent && !reactionsSpent && (chain === 1 || input.spanDays === undefined)) {
        stopReason = "budget_exhausted";
        break;
      }
    }
    // The world's later business, and a plan's, are not the order's: a round
    // of them the budget cannot pay for is skipped, and the span carries on.
    const canPay = modelCalls < budget.maxModelCalls && (reactionsSpent || iterations - chainStartIterations < budget.maxIterations);
    if (wantsAnswering && !canPay) {
      asked = false;
      skipped.push({ stage: "cognition", reason: `hop ${hops} on ${today()}: chain ${chain}, the call budget is spent; ${asking.length} left unasked` });
    }
    if (wantsAnswering && canPay) {
      // Measured from the last round that answered news, not from a round of
      // plans alone: those come every few days, and would put off the next
      // chain for ever. What they write is news for it.
      if (!reactionsSpent) {
        lastAskedDay = world.instant.day;
        lastRoundKey = nowKey();
        factsSeenByLastRound = newFacts.length;
      }
      report({ kind: "answering", date: today(), people: asking.map((actor) => actor.name) });
      // Only now that they are really being asked: a step whose owner the
      // budget turned away stays due, and wakes him next time.
      const castIds = new Set(asking.map((actor) => actor.characterId));
      // What each of them is being shown now is theirs to have answered.
      for (const actor of asking) {
        const seen = answeredBy.get(actor.characterId) ?? new Set<string>();
        for (const fact of actor.knownFacts) seen.add(fact.id);
        answeredBy.set(actor.characterId, seen);
      }
      const woken = due.filter((entry) => castIds.has(entry.ownerId));
      world = markWoken(world, woken);
      plans.woken += woken.length;
      const cognition = await runCognition(
        input.port, asking, world, input.clock,
        budget.cognitionShards === undefined ? undefined : { maxBatches: budget.cognitionShards, actorsPerCall: Math.ceil(asking.length / budget.cognitionShards) },
      );
      modelCalls += cognition.calls;
      iterations += 1;
      if (reactionsSpent) planRounds += 1;
      else chainRounds[chain - 1] = (chainRounds[chain - 1] ?? 0) + 1;
      askedSinceWindow = true;
      if (cognition.parseFailure !== null) parseFailures.push(cognition.parseFailure);
      salvaged.push(...cognition.salvaged);
      for (const actor of cognition.output.actors) {
        const factsBeforeActor = newFacts.length;
        await applyProposal(actor.proposal, actor.actorRef, causalDepth);
        // A plan is laid, and a step taken, only by a person who was asked --
        // never by the player, who is in no cast, and never by somebody the
        // answer merely named. Steps first: they name the plan as it stood.
        if (actor.actorRef.kind !== "character" || !castIds.has(actor.actorRef.id)) continue;
        const ownerId = actor.actorRef.id;
        for (const fact of newFacts.slice(factsBeforeActor)) authorOf.set(fact.id, ownerId);
        const leftAMark = newFacts.length > factsBeforeActor;
        const took = takeSteps(world, ownerId, actor.stepsTaken, leftAMark);
        world = took.world;
        plans.taken += took.taken;
        let laid = false;
        if (actor.plan !== null) {
          const planned = layPlan(world, ownerId, actor.plan, ids);
          world = planned.world;
          laid = planned.ambitionId !== null;
          if (laid) plans.laid += 1;
        }
        if (leftAMark) {
          plans.acted += 1;
          if (laid || took.taken > 0) plans.actedOnAPlan += 1;
        }
      }
      causalDepth += 1;
    }

    const spanned = world.instant.day - startDay;
    if (sprungThisBurst) {
      stopReason = "watch_condition";
      break;
    }
    if (watch !== null && isWatchSatisfied(watch.predicate, input.world, world)) {
      stopReason = "watch_condition";
      break;
    }
    // Nothing left to wake for, and the world has run its minimum span: this is
    // as far as the order carries. An order still waiting on something keeps
    // going regardless -- that is what asking to be woken on arrival means, and
    // the maximum span is what bounds the waiting.
    if (watch === null && nextScheduled === undefined && !asked && spanned >= minDays) {
      stopReason = "no_due_events";
      break;
    }
  }

  // The player is dead, and nothing else that happened this burst is the
  // question any more. This pre-empts whatever the orchestrator asked, because
  // a world that asks "shall we winter in Sicily?" of a corpse is not asking
  // anybody anything -- and there is always at least one name on it, because a
  // dead end is the one thing this branch's constraints forbid outright.
  if (playerId !== null && deadThisBurst.has(playerId)) {
    playerDecision = successionDecision(world, playerId, world.instant.day);
  }

  if (playerDecision !== null) stopReason = "player_decision";
  // The last window: the clock will not move again in this burst.
  closeWindow(true);
  report({ kind: "settled", date: today() });

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
    mechanicCalls,
    outcome,
    stopReason,
    accumulatedSignificance: significance,
    orderFactIds,
    narrative,
    frictions,
    utterances,
    battleAccounts,
    breaches,
    playerDecision,
    parseFailures,
    salvaged,
    skipped,
    audit,
    plans,
    chainRounds,
    planRounds,
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
