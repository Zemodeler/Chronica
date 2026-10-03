import { missionGoals, preserveDestination } from "./mission-intent";
import {
  addMinutes,
  readDepartments,
  ProposalSchema,
  CognitionProposalSchema,
  STATECRAFT_LOG_MAX,
  CAST_SIZE_DEFAULT,
  difficultyRules,
  type StatecraftEntry,
  spentForOrderPart,
  allOffices,
  passageFor,
  passagePlanFor,
  releaseMoneyReservation,
  calendarDateOf,
  isWinterMonth,
  normalizeName,
  spelledAlike,
  whoIsNamed,
  assessOrderStanding,
  advanceWorldTo,
  factsKnownTo,
  formatWorldDate,
  ScheduledEventPayloadSchema,
  WorldStateSchema,
  WorldDeltaSchema,
  type Fact,
  type FactProposal,
  type FactProposalDraft,
  type Office,
  type SuccessionRule,
  type OrderPartyRef,
  type PlayerDecision,
  type Proposal,
  type OrchestratorOutput,
  type ScenarioClock,
  type ScenarioHistoricalPressure,
  type ScheduledEventPayload,
  type ScenarioLifeRules,
  type ScenarioWealthRules,
  type ScenarioWarfareRules,
  type TerrainDefinition,
  type StopReason,
  nemesisOf,
  MAX_NEWS_DAYS,
  newsArrivalsAt,
  type WatchProposal,
  type WorldDelta,
  type WorldInstant,
  type WorldState,
  type OrderWorkRef,
  type OrderGoal,
  type OrderPart,
  type OrderStage,
  type StageCondition,
  goalMet,
  orderPartRef,
  findOrderPart,
  MAX_OWED_BURSTS,
  capOrders,
  availableBalance,
  openReservation,
  isOrderPartOpen,
  orderPartStatus,
  ORDER_PART_STATUS_LABEL,
  completeOrderAttempt,
  abandonOrderAttempt,
  isOrderPartStale,
  OrderRecordSchema,
  OrderPartSchema,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { settleRatifications } from "./ratification";
import { commandChanges } from "./command-changes";
import type { BattleAccount } from "./battle";
import type { ApplyResult, AuthorityBreach, MadeMoney, RejectedDelta } from "./apply/context";
import { keepAsArrangement } from "./apply/keep-as-arrangement";
import { actsBehindFacts, asClaim, isClaim, whereTheActorIs } from "./apply/fill-gaps";
import { kindsIn } from "./bare-refs";
import { misfiledWorldActs } from "./apply/misfiled";
import { hasSomethingNew, playersPeopleFirst, routeAmbientActors, routeAttention } from "./attention";
import { renderCharacterPortrait, runCognition } from "./cognition";
import { materializeFacts } from "./facts";
import { answerByTemper } from "./insubordination";
import { recordActiveIntents } from "./intents";
import { decideNarratorSeeds, engineWork, recordSeedsOffered, seedParticipants, seedWasTaken, type NarratorSeed } from "./narrator";
import { chooseNemesis, conductInWords, nemesisStance, recordNemesis, retireNemesis, shouldRetire, stanceInWords } from "./nemesis";
import { orchestrate } from "./orchestrate";
import { describeBreach, findWhoWouldNotice, noticersAsRefs } from "./oversight";
import { createIdFactory, type SimModelPort } from "./ports";
import { NEVER_PUBLISHED, OWN_BUSINESS_FLOOR, type NarrativeLine, type UtteranceLine } from "./chronicle";
import { buildWorldSlice, renderWorldSlice, type AnsweredDecision, type SliceEvent } from "./slice";
import { successionDecision, takeUpTheHouse } from "./mortality";
import { answerEngagement, engagementDecision } from "./engagement-decisions";
import { answerSiege, siegeDecision } from "./siege-decisions";
import { commandersFollowTheirArmies } from "./commanders-in-the-field";
import { fieldDecision, playerPlight, resolveFieldPerils } from "./field-perils";
import { factsNamingRefusals, reconcileFacts } from "./reconcile-facts";
import { reconcileTheRound, repairTheRound, unanswered, type CorrectionCalls, type RoundCorrection } from "./round-corrections";
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
import { aLetterWaitsOnItsReader, addressWaitingLetters, lettersOwed, markLettersPut, nextReplyDueKey } from "./letters";
import { dueSteps, emptyPlanTally, layPlan, markWoken, nextPlanDay, settleOverdueSteps, takeSteps, type PlanTally } from "./plans";
import { claimPromisesKept } from "./promises";
import { goalsOfAct, mergeGoals, refResolver, resolveGoal } from "./order-goals";
import { findInvariantViolations } from "./invariants";
import { debatersOf, electiveOfficesOf, voteCalendarDays } from "./senate";
import { ensureConstitutions } from "./constitutions";
import { decideStatecraft, ledgerEntry, rulerOptions, type StatecraftInput } from "./statecraft";
import { castDossier, reviewCast } from "./cast";
import { reviewPushback } from "./pushback";
import { decideVillainy, seizeThrones, usurpations } from "./villainy";
import { newsRelations, powersDealtWith, powersNearThePlayer } from "./far-powers";
import { groundOfForce } from "./force-ground";
import { farBusinessFloor, keepFarNewsHome } from "./far-news";
import { brokenBy, whyItWillNotLoad } from "./checkpoint";
import { theOrdersOwnParts } from "./order-parts";
import { actsHeCanDo, dedupeStages, resolveHandles } from "./order-stages";
import { stampOrderMoney } from "./order-money";

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

/** How often the powers make their own moves by rule (`statecraft.ts`). */
const STATECRAFT_EVERY_DAYS = 30;

export interface SimulationBudget {
  readonly maxIterations: number;
  /** The hard ceiling on a burst's model calls, however long it runs (`callCapFor`). */
  readonly maxModelCalls: number;
  /**
   * What a burst may spend, by how long it runs: this many calls, and one
   * more for every `modelCallDays` days of its span, never past
   * `maxModelCalls`. One number for every span spent a week's budget on a
   * month or a month's on a week (L17).
   */
  readonly baseModelCalls: number;
  readonly modelCallDays: number;
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
  /** The standing cast's size (docs/plans/a-living-world.md §4): a budget setting, not a difficulty. */
  readonly castSize?: number | undefined;
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
  //
  // And then scaled by the span (L17). Twenty for any span was spent in the
  // first three days of a month: in the Codex play-test every turn hit it with
  // up to 26 of 29 days nobody was asked about. A round now costs one or two
  // calls and at most one repair and one reconciliation, so eight calls and
  // one for every three days -- eighteen for a month, forty at most for a
  // season -- walks the whole span.
  maxModelCalls: 40,
  baseModelCalls: 8,
  modelCallDays: 3,
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

/** The model calls a burst over this many days may spend (`baseModelCalls`), never past `maxModelCalls`. */
export function callCapFor(budget: SimulationBudget, spanDays: number): number {
  return Math.min(budget.maxModelCalls, budget.baseModelCalls + Math.ceil(Math.max(0, spanDays) / Math.max(1, budget.modelCallDays)));
}

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
  /**
   * Asked before each hop; true stops the burst there, with what it has done
   * kept (stop reason `deadline`). The caller owns the clock -- the engine
   * never reads one -- so a burst-level deadline lives with whoever runs it.
   */
  readonly shouldStop?: (() => boolean) | undefined;
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

/**
 * A model call the burst decided not to make, or work it set down, and why.
 * Every one is kept with the burst (`simulation_bursts.skipped`), never only
 * printed: a stage that keeps turning up here is a budget, a prompt or a
 * router to look at.
 */
export interface BurstSkip {
  readonly stage: "cognition" | "reconcile" | "repair" | "fact_places" | "engine_facts" | "mechanic" | "private_minds" | "invariant";
  readonly reason: string;
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
  /** The order as the ledger keeps it (`world.orders`), when this burst answered one: what each part came to is read from it at the end. */
  readonly orderRecordId: string | null;
  /**
   * The order's own acts the engine could not read after every attempt, in
   * its own words. For scoring a run (`outcomeOfOrder`), never for the
   * player: these were once facts, and reached him (E11).
   */
  readonly unwritten: readonly string[];
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
  readonly skipped: readonly BurstSkip[];
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
  readonly kind: "world" | "reference" | "ignored" | "assumed" | "kept" | "pursuit" | "refiled" | "mechanic_candidate" | "mechanic" | "mechanic_refused" | "mechanic_effect" | "mechanic_warrant_lapsed"
    /** An act placed in a part of an order, or credited to a delegated one, by its words alone. */
    | "attribution_uncertain"
    /** The order's reading named a goal its own act contradicts; the act's stood. */
    | "goal_conflict";
  readonly ofTheOrder: boolean;
  /**
   * "first" for the answer as written; "repair" for the corrected attempt at
   * what the first refused; "keep" for an unreadable act kept as an
   * arrangement; "floor" for an order that left nothing else in the world.
   */
  readonly attempt: "first" | "repair" | "keep" | "floor";
  readonly reason: string;
  /** The act, or -- for a part of the order refiled as the world's -- the part as the orchestrator wrote it. */
  readonly delta: WorldDelta | { readonly op: "order_part"; readonly said: string; readonly acts: readonly number[] };
}

/** Acts that only make sense where the army has got to: fighting, a siege, a raid. */
const ON_ARRIVAL: ReadonlySet<string> = new Set(["force_engage", "siege_lay", "force_raid"]);

/**
 * A part that waits on an earlier one keeps its fighting until then.
 *
 * "March to Agrigentum, then engage the Carthaginians there" was answered with
 * the engagement in the order's acts, so it was tried the day of the order --
 * "cannot fight until one of them marches" -- and again on arrival, two
 * failures told for one part. What a dependent part fights with is held for
 * when what it depends on is done (`deferredActs`).
 */
function holdForArrival<T extends { readonly output: OrchestratorOutput }>(orchestration: T): T {
  const { output } = orchestration;
  const held = new Set<number>();
  for (const [index, part] of output.intent.parts.entries()) {
    if ((part.afterParts ?? []).filter((at) => at !== index).length === 0) continue;
    for (const at of part.acts) if (output.deltas[at] !== undefined && ON_ARRIVAL.has(output.deltas[at]!.op)) held.add(at);
  }
  if (held.size === 0) return orchestration;
  const moved = new Map<number, number>();
  const deltas = output.deltas.filter((_, at) => {
    if (held.has(at)) return false;
    moved.set(at, moved.size);
    return true;
  });
  const parts = output.intent.parts.map((part) => {
    const mine = part.acts.filter((at) => held.has(at)).map((at) => output.deltas[at]!);
    return {
      ...part,
      acts: part.acts.filter((at) => moved.has(at)).map((at) => moved.get(at)!),
      ...(mine.length === 0 ? {} : { deferredActs: [...(part.deferredActs ?? []), ...mine].slice(0, 6) }),
    };
  });
  return { ...orchestration, output: { ...output, deltas, intent: { ...output.intent, parts } } };
}

/** How long what a man said he was doing stands once he has gone on to real work. */
const PURSUIT_LAPSES_DAYS = 60;

/** How long a crossing is held for ships before they are not coming. */
const TRANSPORT_WAIT_DAYS = 60;

/**
 * What the player is told of an act of his order the engine could not read:
 * that it could not be done as he wrote it, never the engine's reason -- "No
 * force legio-phantasma exists" reached the Chronicle and the Council (E11).
 */
const UNWRITTEN = "It could not be carried out as written.";

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

/**
 * Acts that change only a mind or a story: what somebody means, believes or
 * thinks of a power, and a thread moved on in words. An answer made only of
 * these, or of facts alone, changed nothing in the world.
 */
const CHANGES_NOTHING: ReadonlySet<string> = new Set(["character_intent_set", "belief_set", "polity_stance_shift", "storyline_advance"]);

/**
 * The most a fact may weigh when the answer that wrote it changed nothing.
 *
 * "Decius reviewed the legion's readiness", "Hieron renewed discreet inquiries",
 * "Curius reaffirmed his recommendation": fifteen of each in one campaign, every
 * one a fact, every one told. A man who only reviewed is not news; below
 * `OWN_BUSINESS_FLOOR` it is kept on record and told only if something joins it.
 */
const IDLE_FACT_WEIGHT = 10;

/**
 * A fact's reference to something that exists, where it names it by name or by
 * a slug of its name. Only unambiguous readings; anything else is left as
 * written.
 */
function resolveFactRef<T extends { readonly kind: string; readonly id: string }>(world: WorldState, ref: T): T {
  if (ref.id.startsWith("local:")) return ref;
  const spoken = ref.id.replace(/[-_]+/g, " ");
  if (ref.kind === "character") {
    if (world.characters.some((character) => character.id === ref.id)) return ref;
    const named = whoIsNamed(world.characters, spoken);
    return named === null ? ref : { ...ref, id: named.id };
  }
  if (ref.kind === "polity") {
    if (world.map.polities.some((polity) => polity.id === ref.id)) return ref;
    const matches = world.map.polities.filter((polity) => normalizeName(polity.name) === normalizeName(spoken) || spelledAlike(polity.name, spoken));
    return matches.length === 1 ? { ...ref, id: matches[0]!.id } : ref;
  }
  return ref;
}

/** What became of an order's own acts in one proposal. */
interface OrderActs {
  /** Acts of any kind the world took from this answer that changed more than a mind (`CHANGES_NOTHING`). */
  readonly changed: number;
  /** The answer's own facts that came to be, by the localIds it gave them. */
  readonly factLocalIds: ReadonlySet<string>;
  /** Why the order's acts the world would not have were refused. */
  readonly refusals: readonly string[];
  readonly carriedOut: number;
  /** Refused because the world would not have it, or ignored by those ordered: the order was tried. */
  readonly refusedByTheWorld: number;
  /** Refused for any reason, the engine's included: the order was written, and none of it stood. */
  readonly refused: number;
  /** Each of the order's own acts, in its own words, and what became of it -- so each part of the order is judged by its own. */
  readonly ownActs?: readonly OwnAct[];
  /** The places in the answer's `deltas` of the acts that changed more than a mind. */
  readonly changedIndexes: ReadonlySet<number>;
  /** The ids its facts were given, by the localIds it wrote. */
  readonly factIdsByLocalId?: ReadonlyMap<string, string>;
  /** The ids its handles were given. */
  readonly assignedIds?: ReadonlyMap<string, string>;
  /** The places in `deltas` of acts written into the order that were the world's business (`misfiledWorldActs`). */
  readonly misfiledIndexes?: ReadonlySet<number>;
  /** The order's own acts the engine could not read after every attempt, in its own words: for the audit's count, never the player. */
  readonly unwritten?: readonly string[];
  /** What it left its round to correct (`round-corrections.ts`). */
  readonly correction?: RoundCorrection;
}

/** How one pass of an answer is applied, beyond whose it is (`round-corrections.ts`). */
interface ProposalPass {
  /** Who pays for correcting what the engine refused. */
  readonly calls: CorrectionCalls;
  /** Handles an earlier pass of the same answer was given, which this one may name. */
  readonly seedIds?: ReadonlyMap<string, string> | undefined;
  /** A later pass of the same answer: its acts are corrections, its facts were already read for the acts behind them. */
  readonly later?: "repair" | "facts" | undefined;
  /** Facts the world writes about the act lighter than this are not written down at all: the powers' far business (L16). */
  readonly factFloor?: number | undefined;
}

/** A part of the order as the orchestrator read it. */
type IntentPart = OrchestratorOutput["intent"]["parts"][number];

/** One of an order's own acts, and what became of it. */
interface OwnAct {
  readonly said: string;
  readonly carried: boolean;
  readonly refusal: string | null;
  readonly work?: readonly OrderWorkRef[];
  readonly delta?: WorldDelta;
  readonly breach?: string | null;
  /** Its place in the answer's `deltas`, which is how a part names it; null for an act the engine wrote. */
  readonly index?: number | null;
  /** What it was for, read from the act (`goalsOfAct`). */
  readonly goals?: readonly OrderGoal[];
  /** The money it moved and the obligations it left, to be filed as its part's (`stampOrderMoney`). */
  readonly money?: MadeMoney | undefined;
  /**
   * Refused because the engine could not read it, and not put right. Never
   * the part's refusal -- "No force legio-phantasma exists" is not history --
   * but a part whose only acts were these did not come about (E5, E11).
   */
  readonly unwritten?: boolean;
}

/**
 * Which part each of an order's acts belongs to. By the part that named it
 * first: the answer that wrote the act said what it was for. A one-part order
 * owns everything. Only an act no part named is placed by its words, and a
 * placing by words is a guess, kept as one.
 */
function assignActs(parts: readonly { readonly said: string; readonly acts?: readonly number[] }[], own: readonly OwnAct[]): { readonly part: number | null; readonly guessed: boolean }[] {
  const saids = parts.map((part) => part.said);
  return own.map((act) => {
    if (act.index !== undefined && act.index !== null) {
      const named = parts.findIndex((part) => (part.acts ?? []).includes(act.index!));
      if (named >= 0) return { part: named, guessed: false };
    }
    // An answer to an order put to him is no part of an order he gives:
    // placed by its words, "already answered" became a new order's refusal (E6).
    if (act.delta?.op === "order_attempt_decide") return { part: null, guessed: false };
    if (parts.length === 1) return { part: 0, guessed: false };
    return { part: partOfAct(saids, act.said), guessed: true };
  });
}

/** A part of an order whose words ask a body to vote: "petition the Senate", "put it to the assembly". */
export function asksAVote(said: string): boolean {
  return /^\W*(petition|ask|move|propose|put|lay|seek|request)\w*\b[^.;:]{0,60}\b(senate|assembly|council|comitia|people|elders|vote|decree)\b/i.test(said);
}

/** An act that is a vote asked or carried: what a part that asks for a vote can own. */
function isVoteAct(act: OwnAct): boolean {
  return act.delta?.op === "political_procedure_open" || act.delta?.op === "political_procedure_resolve" || act.delta?.op === "political_support_set"
    || (act.work ?? []).some((ref) => ref.kind === "procedure");
}

/**
 * A force renamed, re-flagged, put under a new man or set to drill, carried:
 * done the moment it is. "Rename the field army to Legio I" was renamed, and its
 * receipt said nothing came of it, for want of anything to read it by.
 */
function renamedOrRecommanded(delta: WorldDelta, resolve: (ref: string, kind: "force") => string | null): OrderGoal[] {
  // So is a man's own resolve in the ranks: "in the next battle I mean to win
  // glory" is done the moment he means it, and joining an army the moment he
  // joins. Its receipt said nothing came of it, like a rename's once did.
  if (delta.op === "force_membership_set" && (delta.change === "conduct" || delta.change === "enlist")) {
    const forceId = resolve(delta.forceRef, "force");
    return forceId === null ? [] : [{ kind: "exists", of: "force", id: forceId }];
  }
  if (delta.op !== "force_modify" || delta.locationId !== undefined) return [];
  const forceId = resolve(delta.forceRef, "force");
  return forceId === null ? [] : [{ kind: "exists", of: "force", id: forceId }];
}

/** The ids an answer said it served whose acts changed the world. */
function servedByChange(serves: readonly { readonly ref: string; readonly acts: readonly number[] }[], changed: ReadonlySet<number>): string[] {
  return [...new Set(serves.filter((entry) => entry.acts.some((at) => changed.has(at))).map((entry) => entry.ref))];
}

/** The accounts and forces an act names, resolved: what a breach of it is a breach of. */
function refsOfAct(delta: WorldDelta, resolve: (ref: string) => string): OrderPartyRef[] {
  const refs: OrderPartyRef[] = [];
  for (const [key, value] of Object.entries(delta as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    if (/AccountRef$/.test(key)) refs.push({ kind: "account", id: resolve(value) });
    else if (key === "forceRef") refs.push({ kind: "force", id: resolve(value) });
  }
  return refs.slice(0, 4);
}

/** A rendered slice without the directives near its end (`renderSlice`): what follows them is kept. */
function withoutDirectives(sliceText: string): string {
  const cuts = ["COUNTRIES WITH NOBODY IN THEM:", "THE WORLD STIRS"].map((heading) => sliceText.indexOf(heading)).filter((at) => at >= 0);
  if (cuts.length === 0) return sliceText;
  const from = Math.min(...cuts);
  const resumes = ["\nACTIVE PROJECTS", "\nDUE NOW", "\nSCHEDULED AHEAD"].map((heading) => sliceText.indexOf(heading, from)).filter((at) => at >= 0);
  return `${sliceText.slice(0, from).trimEnd()}${resumes.length === 0 ? "" : `\n${sliceText.slice(Math.min(...resumes)).trim()}`}`;
}

/** Calls kept back from the world's own business for the people the player's order waits on. */
const ORDER_RESERVE_CALLS = 3;

/** Calls each later chain a span has room for keeps back from the chains before it: a round of one cognition call and its correction (L17). */
const LATER_CHAIN_CALLS = 2;

/** How many facts losing a place are told one by one in a burst's log; the rest are counted in one line (E29). */
const FACT_PLACES_TOLD = 3;

/** How much of a private intent's words a fact must share to be that intent said aloud. */
const PRIVATE_MIND_OVERLAP = 0.5;

/** Words to compare by: lower case, five-letter stems, the small words left out. */
function wordStems(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^\p{L}]+/u).filter((word) => word.length > 3).map((word) => word.slice(0, 5)));
}

/**
 * What one carried act of an order set going, read from the world before and
 * after it: the project, the vote, the letter, the audit, the plot, the army.
 * A march is a project the engine makes (`setOutOn`), found by the force it moves.
 */
function workMadeBy(before: WorldState, after: WorldState, delta: WorldDelta, assignedIds: ReadonlyMap<string, string>): OrderWorkRef[] {
  const made = "localId" in delta && typeof delta.localId === "string" ? assignedIds.get(delta.localId) ?? null : null;
  const isNew = <T extends { readonly id: string }>(list: readonly T[], id: string | null): id is string =>
    id !== null && list.some((entry) => entry.id === id);
  switch (delta.op) {
    case "project_create":
      return isNew(after.projects, made) ? [{ kind: "project", id: made }] : [];
    case "political_procedure_open": {
      if (!isNew(after.material.politicalProcedures, made)) return [];
      // What the measure would pay for, waiting on it: the order's work too.
      const measured = after.projects.filter((project) => project.status === "proposed" && !before.projects.some((old) => old.id === project.id))
        .map((project) => ({ kind: "project" as const, id: project.id }));
      return [{ kind: "procedure", id: made }, ...measured];
    }
    case "diplomatic_message_send":
      return isNew(after.diplomacy, made) ? [{ kind: "message", id: made }] : [];
    case "covert_plot_open":
      return isNew(after.covertPlots, made) ? [{ kind: "plot", id: made }] : [];
    case "service_contract_open":
      return isNew(after.material.contracts, made) ? [{ kind: "contract", id: made }] : [];
    case "force_create":
      return isNew(after.material.forces, made) ? [{ kind: "force", id: made }] : [];
    case "generic_entity_create":
      return isNew(after.genericEntities, made) ? [{ kind: "entity", id: made }] : [];
    case "siege_lay": {
      // Laid now, or the one already under way that the act pressed or stormed.
      const forceId = assignedIds.get(delta.forceRef.replace(/^local:/, "")) ?? delta.forceRef;
      const siege = after.sieges.filter((candidate) => candidate.forceId === forceId
        && (candidate.status === "active" || before.sieges.some((old) => old.id === candidate.id && old.status === "active"))).at(-1);
      return siege === undefined ? [] : [{ kind: "siege", id: siege.id }];
    }
    default: {
      // Audits, marches and crossings are made without a handle of their own:
      // whatever of their kind is new since the act.
      const newAudits = after.audits.filter((audit) => !before.audits.some((old) => old.id === audit.id)).map((audit) => ({ kind: "audit" as const, id: audit.id }));
      if (delta.op === "audit_open") return newAudits.slice(-1);
      if (delta.op === "force_modify" && delta.locationId !== undefined) {
        const journeys = after.projects.filter((project) => !before.projects.some((old) => old.id === project.id)
          && project.completionOutcome?.kind === "force_move");
        return journeys.slice(-1).map((project) => ({ kind: "project" as const, id: project.id }));
      }
      return [];
    }
  }
}

/** An act's own prose: its reason, label, duties, subject -- every field written in words rather than ids. */
function wordsOfAct(delta: WorldDelta): string {
  return Object.values(delta as Record<string, unknown>).filter((value): value is string => typeof value === "string" && value.includes(" ")).join(" ");
}

/** The words that tell one part of an order from another. */
const PART_FILLER = new Set(["that", "this", "with", "from", "into", "have", "make", "sure", "them", "they", "their", "there", "will", "shall", "would", "could", "should", "about", "which", "when", "then", "than", "only", "does", "tell", "send", "order", "ordered"]);

/**
 * Which part of an order an act belongs to: the one its words share most with,
 * two words or one long one, or none. A shipmaster hired "using personal money
 * if Rome does not support it" is the part that said so, not the part that
 * argued the fleet before the Senate.
 */
export function partOfAct(parts: readonly string[], act: string): number | null {
  const stems = (text: string): Set<string> => new Set(text.toLowerCase().split(/[^a-z]+/)
    .filter((word) => word.length >= 4 && !PART_FILLER.has(word)).map((word) => word.slice(0, 5)));
  const ours = stems(act);
  let best: number | null = null;
  let bestScore = 0;
  for (const [index, part] of parts.entries()) {
    const shared = [...stems(part)].filter((stem) => ours.has(stem));
    const long = shared.length === 1 && part.toLowerCase().split(/[^a-z]+/).some((word) => word.length >= 6 && word.startsWith(shared[0]!));
    if ((shared.length >= 2 || long) && shared.length > bestScore) {
      best = index;
      bestScore = shared.length;
    }
  }
  return best;
}

/** How long a reaction takes to form, when nothing scheduled says otherwise. */
const REACTION_DELAY_DAYS = 2;

export async function runSimulationBurst(input: BurstInput): Promise<BurstResult> {
  const budget = input.budget ?? DEFAULT_BUDGET;
  const ids = createIdFactory(input.burstId);
  input = { ...input, world: WorldStateSchema.parse(input.world) };
  const startDay = input.world.instant.day;

  // Every power's constitution exists before anybody is asked anything: a new
  // game's first order is answered before its first tick, and a world where
  // Carthage has no government yet is not one to answer it in.
  const governed = input.successionRules === undefined
    ? input.world
    : ensureConstitutions({ world: input.world, government: { offices: input.offices, successionRules: input.successionRules }, toDay: startDay });
  let world = commandersFollowTheirArmies(governed);
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
    // Far news that is not worth the telling stays with the powers it
    // happened to (`far-news.ts`): the Chronicle reads only what reached us.
    keepFarNewsHome(newFacts, windowMark.facts, world, input.actorRef.kind === "character" ? input.actorRef.id : null, significanceByFactId);
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
  /** What this burst may spend, by how long it may run (`callCapFor`). */
  const callCap = callCapFor(budget, Math.max(1, Math.min(input.spanDays ?? budget.maxSimulatedDays, input.clock.maxSpanDays)));
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
  const skipped: BurstSkip[] = [];
  /** Facts that lost a place no army of theirs stands at or is bound for (`FACT_PLACES_TOLD`). */
  let placesDropped = 0;
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

  /** The last world known to load whole: the one the burst was given, then each tick that held. */
  let lastSound: WorldState = world;
  /**
   * A step of the burst's own bookkeeping, kept only if what it wrote loads.
   *
   * The tick is held to the schema (`tickTo`) and so is every batch of acts
   * (`applyDeltas`); the order ledger, held acts, envelopes and plans were
   * written straight into the world, and a single bad field from any of them
   * -- a plan step slipped a fourth time, a "paid" goal of nothing -- left a
   * saved world that would not load (E1). A step that would is set aside,
   * with what it wrote, and the path it broke is kept with the burst.
   */
  const checkpoint = (stage: string, step: () => void): boolean => {
    const before = world;
    const factsBefore = newFacts.length;
    step();
    if (world === before) return true;
    const broken = brokenBy(before, world);
    if (broken === null) return true;
    world = before;
    newFacts.splice(factsBefore);
    skipped.push({ stage: "invariant", reason: `${stage} wrote what would not load, and was set aside: ${broken}` });
    return false;
  };

  /** Applies one actor's proposal: deltas, then the facts and events it produced. */
  /**
   * Work done by somebody holding an accepted order, credited to it.
   *
   * Tiberius Coruncanius accepted "arrange the transport and the provisioning"
   * and nothing he did afterwards was ever connected to it: the order said
   * accepted for ever, the player could not tell agreement from progress, and
   * nothing could say it had been carried out. His acts join the ledger part
   * that handed him the order -- by their words where he holds several.
   */
  const creditDelegatedWork = (
    recipientId: string,
    acts: readonly { readonly said: string; readonly delta: WorldDelta; readonly work: readonly OrderWorkRef[]; readonly index: number | null; readonly goals: readonly OrderGoal[]; readonly money?: MadeMoney | undefined }[],
    factIds: readonly string[],
    serves: readonly { readonly ref: string; readonly acts: readonly number[] }[],
  ): void => {
    const held = world.orderAttempts.filter((attempt) => attempt.recipientRef.id === recipientId && attempt.status === "accepted");
    if (held.length === 0) return;
    const instructions = held.map((attempt) => attempt.instruction);
    const credited = new Map<string, { work: OrderWorkRef[]; goals: OrderGoal[]; guessed: boolean; money: (MadeMoney | undefined)[] }>();
    for (const act of acts) {
      // By the order he said the act was for; where he held one order only,
      // that one; only otherwise by its words, and then as a guess.
      const named = act.index === null ? undefined : serves.find((entry) => entry.acts.includes(act.index!) && held.some((attempt) => attempt.id === entry.ref));
      const index = named !== undefined ? held.findIndex((attempt) => attempt.id === named.ref) : held.length === 1 ? 0 : partOfAct(instructions, act.said);
      if (index === null || index < 0) continue;
      const guessed = named === undefined && held.length > 1;
      if (guessed) audit.push({ actorRef: { kind: "character", id: recipientId }, op: act.delta.op, kind: "attribution_uncertain", ofTheOrder: false, attempt: "first", reason: `Work credited to "${held[index]!.instruction.slice(0, 120)}" by its words alone.`, delta: act.delta });
      const entry = credited.get(held[index]!.id) ?? { work: [], goals: [], guessed: false, money: [] };
      credited.set(held[index]!.id, { work: [...entry.work, ...act.work], goals: [...entry.goals, ...act.goals], guessed: entry.guessed || guessed, money: [...entry.money, act.money] });
    }
    if (credited.size === 0) return;
    // What he spent doing it is the order's spending (`stampOrderMoney`).
    for (const attempt of held) {
      const entry = credited.get(attempt.id);
      if (entry !== undefined && attempt.servesRef !== null) world = stampOrderMoney(world, entry.money, attempt.servesRef);
    }
    world = {
      ...world,
      orderAttempts: world.orderAttempts.map((attempt) => !credited.has(attempt.id) ? attempt : {
        ...attempt,
        consequenceFactRefs: [...attempt.consequenceFactRefs, ...factIds].slice(-8),
      }),
      orders: world.orders.map((order) => ({
        ...order,
        parts: order.parts.map((part) => {
          const extra = part.workRefs.flatMap((ref) => ref.kind === "order_attempt" ? [credited.get(ref.id)].filter((entry) => entry !== undefined) : []);
          if (extra.length === 0) return part;
          const fresh = extra.flatMap((entry) => entry.work).filter((ref) => !part.workRefs.some((known) => known.kind === ref.kind && known.id === ref.id));
          // A part that named no goal of its own takes the goals of the work
          // done for it: the legate's march says where the legion is going.
          const goals = part.goals.length > 0 ? part.goals : mergeGoals(extra.flatMap((entry) => entry.goals), []).goals;
          return { ...part, goals, workRefs: [...part.workRefs, ...fresh].slice(0, 12), attribution: extra.some((entry) => entry.guessed) ? "guessed" as const : part.attribution };
        }),
      })),
    };
  };

  /**
   * An accepted order whose part is achieved has been carried out; one whose
   * part can no longer come about has been abandoned. Read from the part --
   * its goals and the rest of its work -- and never from the order itself
   * having been taken up, which is what made "accepted" read as done.
   */
  const settleDelegations = (): void => {
    let changed = false;
    const attempts = world.orderAttempts.map((attempt) => {
      if (attempt.status !== "accepted") return attempt;
      const self = { kind: "order_attempt" as const, id: attempt.id };
      const parts = world.orders.flatMap((order) => order.parts).filter((part) => part.workRefs.some((ref) => ref.kind === self.kind && ref.id === self.id));
      if (parts.length === 0) return attempt;
      // With nothing else to read -- no goal and no other work -- there is
      // nothing yet to settle it by.
      const readable = parts.filter((part) => part.goals.length > 0 || part.workRefs.some((ref) => ref.kind !== "order_attempt"));
      if (readable.length === 0) return attempt;
      const statuses = readable.map((part) => orderPartStatus(world, part, { without: self }));
      if (statuses.every((status) => status === "achieved" || status === "partly_done")) {
        changed = true;
        return completeOrderAttempt(attempt, world.elapsedStep);
      }
      if (statuses.every((status) => status === "failed" || status === "refused" || status === "blocked")) {
        changed = true;
        return abandonOrderAttempt(attempt, world.elapsedStep);
      }
      return attempt;
    });
    if (changed) world = { ...world, orderAttempts: attempts };
  };

  /**
   * Parts of orders nothing has moved for in two months, closed as lapsed
   * (`isOrderPartStale`). Parts never lapsed: a season's dead orders stood
   * beside the live ones, and the next order's words were matched against
   * all of them (E6).
   */
  const lapseStaleParts = (): void => {
    if (!world.orders.some((order) => order.parts.some((part) => isOrderPartStale(world, order, part)))) return;
    world = {
      ...world,
      orders: world.orders.map((order) => !order.parts.some((part) => isOrderPartStale(world, order, part)) ? order : {
        ...order,
        parts: order.parts.map((part) => !isOrderPartStale(world, order, part) ? part : {
          ...part,
          closedAtStep: world.elapsedStep,
          note: `Lapsed: nothing more was done for it in ${world.elapsedStep - order.givenAtStep} days${part.note === null ? "" : `; ${part.note}`}`.slice(0, 400),
        }),
      }),
    };
  };

  /** Where a held act's condition stands. */
  const conditionReading = (condition: StageCondition, heldSinceStep: number | null = null): "met" | "not_yet" | "impossible" => {
    switch (condition.kind) {
      case "transport_capacity": {
        const force = world.material.forces.find((candidate) => candidate.id === condition.forceId);
        if (force === undefined) return "impossible";
        if (passageFor(world, force, condition.provinceId, input.warfare).by !== null || passagePlanFor(world, force, condition.provinceId, input.warfare) !== null) return "met";
        // Ships that have not come in two months are not coming: the wait
        // could never end, and the crossing stood held for ever (E10).
        return heldSinceStep !== null && world.elapsedStep - heldSinceStep >= TRANSPORT_WAIT_DAYS ? "impossible" : "not_yet";
      }
      case "force_named":
        return world.material.forces.some((force) => force.polityId === condition.polityId && normalizeName(force.name).includes(normalizeName(condition.name))) ? "met" : "not_yet";
      case "procedure_passed":
        return goalMet(world, { kind: "procedure_passed", procedureId: condition.procedureId });
      case "force_at":
        return goalMet(world, { kind: "force_at", forceId: condition.forceId, provinceId: condition.provinceId });
      case "funds": {
        const account = world.material.accounts.find((candidate) => candidate.id === condition.accountId);
        if (account === undefined) return "impossible";
        return account.balance >= condition.amount ? "met" : "not_yet";
      }
      case "project_done":
        return goalMet(world, { kind: "project_done", projectId: condition.projectId });
      case "letter_answered": {
        const message = world.diplomacy.find((candidate) => candidate.id === condition.messageId);
        if (message === undefined) return "impossible";
        if (message.status === "awaiting_reply") return "not_yet";
        if (condition.answer === "any") return message.answer === "ignored" ? "impossible" : "met";
        // Silence is a refusal of what was asked.
        const given = message.answer === "ignored" ? "refused" : message.answer;
        return given === condition.answer ? "met" : "impossible";
      }
    }
  };

  /** A condition as the player reads it, for the reason a held act failed. */
  const conditionInWords = (condition: StageCondition, heldSinceStep: number | null = null): string => {
    switch (condition.kind) {
      case "transport_capacity": return heldSinceStep === null ? "enough ships are available to carry the army" : `no ships enough to carry the army came in ${world.elapsedStep - heldSinceStep} days`;
      case "force_named": return `a force named ${condition.name} is raised`;
      case "procedure_passed": {
        const vote = world.material.politicalProcedures.find((procedure) => procedure.id === condition.procedureId);
        return vote === undefined ? "the vote it waited on is gone" : `the vote on "${vote.label}" ${vote.outcome === "failed" ? "failed" : `was ${vote.outcome ?? "never held"}`}`;
      }
      case "force_at": {
        const force = world.material.forces.find((candidate) => candidate.id === condition.forceId);
        return force === undefined ? "the army it waited on is gone" : `${force.name} never reached ${world.map.provinces.find((province) => province.id === condition.provinceId)?.name ?? condition.provinceId}`;
      }
      case "funds":
        return "the account it was to be paid from is gone";
      case "project_done":
        return `${world.projects.find((project) => project.id === condition.projectId)?.label ?? "the work it waited on"} came to nothing`;
      case "letter_answered": {
        const message = world.diplomacy.find((candidate) => candidate.id === condition.messageId);
        return message === undefined ? "the letter it waited on is gone" : `the letter "${message.subject}" was ${message.answer ?? "never answered"}`;
      }
    }
  };

  /**
   * Acts of the player's orders held until what they waited on was settled,
   * taken up again once it is (`OrderStage`). "Seek the Senate's leave and
   * carry the legion over" was refused for want of leave; the leave came ten
   * days later, and the record said "what it allows waits on somebody's
   * order" -- although the order had been given. A held act is tried again as
   * the order's the moment everything it waits on is so, and what it makes
   * joins its part; one whose condition can no longer come about fails, and
   * says why.
   */
  const advanceStages = (): void => {
    let orders = world.orders;
    let changed = false;
    for (const [orderIndex, order] of orders.entries()) {
      for (const [partIndex, part] of order.parts.entries()) {
        if (part.closedAtStep !== null || !part.stages.some((stage) => stage.status === "waiting")) continue;
        let next: OrderPart = part;
        const ref = orderPartRef(order.id, partIndex);
        // What an act held here made, by the handle it was written with, for
        // the acts held beside it that name it (E9).
        const handles = new Map<string, string>();
        /** Held acts done as the order's, by the man who gave it, and what became of them. */
        const carryOut = (acts: readonly WorldDelta[], stage: OrderStage, stageIndex: number): OrderStage => {
          const actorRef = { kind: "character" as const, id: order.actorCharacterId };
          const before = world;
          const tried = applyDeltas(world, acts, {
            now: world.instant, actorRef, offices: input.offices, ...(input.successionRules === undefined ? {} : { successionRules: input.successionRules }), warfare: input.warfare, ids, gameId: input.gameId,
            clock: input.clock, orderDeltas: new Set(acts), assignedIds: handles,
            // A vote it waited on, carried, is the act's authority.
            ...(stage.waitsOn.some((condition) => condition.kind === "procedure_passed") ? { sanctionedDeltas: new Set(acts) } : {}),
            playerCharacterId: input.actorRef.kind === "character" ? input.actorRef.id : null,
            ...(input.terrains === undefined ? {} : { terrains: input.terrains }),
            ...(input.wealth === undefined ? {} : { wealth: input.wealth }),
          });
          recordAudit(tried, actorRef, "repair");
          if (tried.applied.length === 0) {
            // The engine's own refusal is the audit's, never the order's
            // answer: "No force ... exists" reached the Council as a part's
            // refusal (E11).
            const rejection = tried.rejected[0];
            const unreadable = rejection === undefined || rejection.kind === "reference";
            const reason = unreadable ? UNWRITTEN : rejection.reason.slice(0, 400);
            next = unreadable ? { ...next, whyNot: UNWRITTEN } : { ...next, refusal: reason, refusedAtStep: world.elapsedStep };
            return { ...stage, status: "failed", reason, failedAtStep: world.elapsedStep };
          }
          world = tried.world;
          for (const [handle, id] of tried.assignedIds) handles.set(handle, id);
          world = stampOrderMoney(world, tried.applied.map((entry) => entry.madeMoney), ref);
          const made = acts.flatMap((act) => workMadeBy(before, world, act, tried.assignedIds));
          const resolve = refResolver(world, tried.assignedIds);
          const goals = mergeGoals([...next.goals, ...acts.flatMap((act) => goalsOfAct(before, act, made, resolve))], []).goals;
          next = {
            ...next, refusal: null, refusedAtStep: null, goals, actsCarried: Math.min(99, next.actsCarried + tried.applied.length),
            workRefs: [...next.workRefs, ...made.filter((work) => !next.workRefs.some((known) => known.id === work.id))].slice(0, 12),
          };
          const materialized = materializeFacts({
            proposals: [...tried.factProposals, {
              localId: `order_resumed_${partIndex}_${stageIndex}`,
              kind: "order_resumed",
              summary: `What it waited on was settled, and the order was taken up again: "${part.said}".`.slice(0, 600),
              affectedRefs: [actorRef],
              visibility: "private" as const,
              discoveryState: "private" as const,
              knowableInDays: 0,
              knownToRefs: [actorRef],
              significance: 30,
            }],
            now: world.instant, forces: world.material.forces, atStep: world.elapsedStep, ids, causalDepth: 0, assignedIds: tried.assignedIds,
          });
          newFacts.push(...materialized.facts.map((fact) => ({ ...fact, sourceActionId: ref })));
          for (const [factId, weight] of materialized.significanceByFactId) significanceByFactId.set(factId, weight);
          return { ...stage, status: "resumed" };
        };
        for (let stageIndex = 0; stageIndex < next.stages.length; stageIndex += 1) {
          // Read from the part as it now stands: an act held beside one just
          // done may name what that one made.
          const stage = next.stages[stageIndex]!;
          if (stage.status !== "waiting") continue;
          const since = stage.heldSinceStep ?? order.givenAtStep;
          const readings = stage.waitsOn.map((condition) => conditionReading(condition, since));
          const blocked = stage.waitsOn.find((_, at) => readings[at] === "impossible");
          let settled: OrderStage | null = null;
          if (blocked !== undefined && blocked.kind === "letter_answered" && world.diplomacy.find((message) => message.id === blocked.messageId)?.status !== "awaiting_reply" && world.diplomacy.some((message) => message.id === blocked.messageId)) {
            // The letter was answered the other way: what was held for the
            // other case is not needed, which is neither a failure nor a refusal.
            settled = { ...stage, status: "resumed", reason: `Not needed: ${conditionInWords(blocked)}.`.slice(0, 400) };
            next = { ...next, note: settled.reason, closedAtStep: world.elapsedStep };
          } else if (blocked !== undefined) {
            const why = conditionInWords(blocked, blocked.kind === "transport_capacity" ? since : null);
            settled = { ...stage, status: "failed", reason: `It could not go ahead: ${why}.`.slice(0, 400), failedAtStep: world.elapsedStep };
            next = { ...next, refusal: `It could not go ahead: ${why}.`.slice(0, 600), refusedAtStep: world.elapsedStep };
          } else if (readings.every((reading) => reading === "met")) {
            if (stage.held.op === "resume_instruction") {
              const instruction = String(stage.held.instruction);
              // What he commands, or is, he does himself (E10); only the rest is handed on.
              const his = actsHeCanDo(world, order.actorCharacterId, next.goals, instruction);
              if (his.length > 0) {
                settled = carryOut(his, stage, stageIndex);
              } else {
                const military = /force|legion|defend|troops|ships|transport|hunt/i.test(instruction);
                const officesForWork = new Set(allOffices(world, input.offices).filter((office) => office.authorisedActionIds.includes(military ? "force_modify" : "project_create")).map((office) => office.id));
                const qualified = (id: string) => world.material.officeSeats.some((seat) => seat.holderCharacterId === id && seat.status === "held" && officesForWork.has(seat.officeId));
                const recipient = world.characters.filter((character) => character.alive && character.id !== order.actorCharacterId && character.polityId === world.characters.find((actor) => actor.id === order.actorCharacterId)?.polityId && world.material.officeSeats.some((seat) => seat.holderCharacterId === character.id && seat.status === "held"))
                  .sort((a, b) => Number(qualified(b.id)) - Number(qualified(a.id)) || (b.skills.subSkills.logistics ?? 0) - (a.skills.subSkills.logistics ?? 0) || b.prestigeBps - a.prestigeBps)[0];
                if (recipient !== undefined) {
                  const before = new Set(world.orderAttempts.map((attempt) => attempt.id));
                  world = recordDelegations(world, [{ localId: `resume_${partIndex}_${stageIndex}`, issuerRef: { kind: "character", id: order.actorCharacterId }, recipientRef: { kind: "character", id: recipient.id }, claimedAuthorityGrantRef: null, instruction, part: null }], ids, new Map(), input.offices);
                  const attempt = world.orderAttempts.find((candidate) => !before.has(candidate.id));
                  if (attempt !== undefined) { world = { ...world, orderAttempts: world.orderAttempts.map((candidate) => candidate.id === attempt.id ? { ...candidate, servesRef: ref } : candidate) }; next = { ...next, whyNot: null, workRefs: [...next.workRefs, { kind: "order_attempt", id: attempt.id }] }; settled = { ...stage, status: "resumed" }; }
                }
              }
            } else {
              const parsed = WorldDeltaSchema.safeParse(resolveHandles(stage.held, handles));
              settled = parsed.success ? carryOut([parsed.data], stage, stageIndex) : { ...stage, status: "failed", reason: "The act it held could no longer be read.", failedAtStep: world.elapsedStep };
            }
          }
          if (settled !== null) {
            const done = settled;
            next = { ...next, stages: next.stages.map((old, at) => (at === stageIndex ? done : old.status === "waiting" ? { ...old, held: resolveHandles(old.held, handles) } : old)) };
          }
        }
        if (next !== part) {
          const replaced = next;
          orders = orders.map((candidate, index) => index !== orderIndex ? candidate : { ...candidate, parts: candidate.parts.map((old, at) => at === partIndex ? replaced : old) });
          changed = true;
        }
      }
    }
    if (changed) world = { ...world, orders };
  };

  /** Terms accepted abroad and voted at home, opened; refused, told (`ratification.ts`). */
  const ratifyWhatWasVoted = (): void => {
    if (!world.diplomacy.some((message) => message.ratification?.status === "waiting")) return;
    const settled = settleRatifications(world, {
      now: world.instant, actorRef: input.actorRef, offices: input.offices, ...(input.successionRules === undefined ? {} : { successionRules: input.successionRules }), warfare: input.warfare, ids, gameId: input.gameId,
      clock: input.clock,
      playerCharacterId: input.actorRef.kind === "character" ? input.actorRef.id : null,
      ...(input.terrains === undefined ? {} : { terrains: input.terrains }),
      ...(input.wealth === undefined ? {} : { wealth: input.wealth }),
    });
    world = settled.world;
    if (settled.facts.length === 0) return;
    const materialized = materializeFacts({ proposals: settled.facts, now: world.instant, forces: world.material.forces, atStep: world.elapsedStep, ids, causalDepth: 0, assignedIds: new Map() });
    newFacts.push(...materialized.facts);
    for (const [factId, weight] of materialized.significanceByFactId) significanceByFactId.set(factId, weight);
  };

  /**
   * What an order allowed a part to spend, set aside once it may be spent --
   * at once where no vote stands in the way, the day the vote passes where one
   * does -- and the part's work paid out of it (`SpendEnvelope`). "Allocate up
   * to 3,000" used to survive only as words: the Senate passed it, nothing was
   * set aside, and the inquiry's agents were paid from the consul's own purse
   * without anybody being told.
   */
  const holdEnvelopes = (): void => {
    let changed = false;
    let reservations = world.material.reservations;
    let projects = world.projects;
    const told: FactProposalDraft[] = [];
    const orders = world.orders.map((order) => ({
      ...order,
      parts: order.parts.map((part, index) => {
        if (part.spend === null) return part;
        const status = orderPartStatus(world, part);
        if (part.closedAtStep !== null || ["achieved", "partly_done", "failed", "refused", "unanswered"].includes(status)) {
          const held = reservations.find((reservation) => reservation.id === part.spend!.reservationId && reservation.status === "active");
          if (held !== undefined) { reservations = reservations.map((reservation) => reservation.id === held.id ? releaseMoneyReservation(reservation, world.elapsedStep) : reservation); changed = true; }
          return part;
        }
        let spend = part.spend;
        let note = part.note;
        if (spend.reservationId === null) {
          const votes = part.workRefs.filter((ref) => ref.kind === "procedure")
            .map((ref) => world.material.politicalProcedures.find((procedure) => procedure.id === ref.id));
          // A part that asks for a vote spends nothing before the vote is
          // put: an envelope on "petition the Senate for a navy" once held
          // 7,500 of the treasury for a vote that was never opened.
          if (votes.length === 0 && asksAVote(part.said)) return part;
          if (votes.some((vote) => vote === undefined || vote.outcome === null)) return part;
          if (votes.length > 0 && !votes.some((vote) => vote?.outcome === "passed")) return part;
          const account = world.material.accounts.find((candidate) => candidate.id === spend.payerAccountId);
          const amount = Math.min(Math.max(0, spend.cap - spentForOrderPart(world, part)), availableBalance({ accounts: world.material.accounts, reservations }, spend.payerAccountId));
          if (account === undefined || amount <= 0) return part;
          const reservation = openReservation({ accounts: world.material.accounts, reservations }, {
            id: ids.next("reservation"), accountId: account.id, currencyId: account.currencyId, amount,
            purposeId: orderPartRef(order.id, index), purposeKind: "order_part", atStep: world.elapsedStep,
          });
          if (reservation === null) return part;
          reservations = [...reservations, reservation];
          spend = { ...spend, reservationId: reservation.id };
          changed = true;
        }
        // The part's work draws on it. Work paid from another purse than the
        // one the order named is done, and said.
        for (const ref of part.workRefs.filter((candidate) => candidate.kind === "project")) {
          const project = projects.find((candidate) => candidate.id === ref.id);
          if (project === undefined || project.reservationId !== null || project.status === "completed") continue;
          if (project.fundingAccountId === spend.payerAccountId) {
            projects = projects.map((candidate) => candidate.id === project.id ? { ...candidate, reservationId: spend.reservationId } : candidate);
            changed = true;
          } else if (project.fundingAccountId !== null && !(note ?? "").includes(project.label)) {
            const other = world.material.accounts.find((account) => account.id === project.fundingAccountId);
            note = `${note === null ? "" : `${note}; `}${project.label} was paid from ${other?.owner.kind === "character" ? "a private purse" : "another chest"}, not the one the order named`.slice(0, 400);
            told.push({
              localId: `envelope_payer_${project.id}`.slice(0, 60),
              kind: "envelope_breach",
              summary: `${project.label} was paid for from another account than the one the order named.`,
              affectedRefs: [{ kind: "character", id: order.actorCharacterId }, { kind: "project", id: project.id }],
              visibility: "private", discoveryState: "private", knowableInDays: 0,
              knownToRefs: [{ kind: "character", id: order.actorCharacterId }], significance: 35,
            });
            changed = true;
          }
        }
        return spend === part.spend && note === part.note ? part : { ...part, spend, note };
      }),
    }));
    if (!changed) return;
    world = { ...world, orders, projects, material: { ...world.material, reservations } };
    if (told.length > 0) {
      const materialized = materializeFacts({ proposals: told, now: world.instant, atStep: world.elapsedStep, ids, causalDepth: 0, assignedIds: new Map() });
      newFacts.push(...materialized.facts);
      for (const [factId, weight] of materialized.significanceByFactId) significanceByFactId.set(factId, weight);
    }
  };

  /**
   * Facts about work an order set going are that order's, whenever they come:
   * the march that ends, the crossing stopped by a fleet, the vote that
   * passes. Each is stamped with its part, so the Chronicle tells it as that
   * part's matter (`matterKeys`) and never as a stranger's.
   */
  const stampWorkFacts = (from: number): void => {
    const byWork = new Map<string, string>();
    for (const order of world.orders) {
      for (const [index, part] of order.parts.entries()) {
        if (part.closedAtStep !== null && part.closedAtStep < world.elapsedStep - 60) continue;
        // Work of its own: an army or an arrangement is in many matters, and
        // a fact naming the legion is not the transport's for naming it.
        for (const ref of part.workRefs) if (ref.kind !== "force" && ref.kind !== "entity") byWork.set(ref.id, orderPartRef(order.id, index));
      }
    }
    if (byWork.size === 0) return;
    for (let at = from; at < newFacts.length; at += 1) {
      const fact = newFacts[at]!;
      if (fact.sourceActionId !== null) continue;
      const owner = fact.affectedEntities.map((entity) => byWork.get(entity.id)).find((ref) => ref !== undefined);
      if (owner !== undefined) newFacts[at] = { ...fact, sourceActionId: owner };
    }
  };
  const applyProposal = async (
    proposal: Proposal & { readonly worldDeltas?: readonly WorldDelta[]; readonly intent?: OrchestratorOutput["intent"] },
    actorRef: OrderPartyRef,
    causalDepth: number,
    actsForTheWorld = false,
    /** What the actor said his acts were for (`CognitionOutput.serves`). */
    serves: readonly { readonly ref: string; readonly acts: readonly number[] }[] = [],
    pass: ProposalPass = { calls: "own" },
  ): Promise<OrderActs> => {
    // The world's own business first, so the order is carried out in the world
    // as it now stands -- a chieftain the world has just given the Boii is
    // somebody the order may write to. Only the orchestrator has two lists; an
    // actor thinking for himself has only his own acts.
    const intentParts = proposal.intent?.parts ?? [];
    if (actsForTheWorld && input.orderText !== null) {
      proposal = { ...proposal, deltas: proposal.deltas.map((delta, index) => {
        const part = intentParts.find((candidate) => candidate.acts.includes(index));
        return part === undefined ? delta : preserveDestination(world, delta, part.said, input.orderText!, input.actorRef.id);
      }) };
    }
    // A fact only the engine can make true stands beside its act, or becomes it (`actsBehindFacts`).
    const behind = pass.later !== undefined ? { facts: proposal.facts, acts: [], claims: [], dropped: [] }
      : actsBehindFacts(proposal.facts, [...(proposal.worldDeltas ?? []), ...proposal.deltas], world, input.actorRef.kind === "character" ? input.actorRef.id : null);
    for (const reason of behind.dropped) skipped.push({ stage: "engine_facts", reason });
    const worldDeltas = [...(proposal.worldDeltas ?? []), ...(proposal.worldDeltas === undefined ? [] : behind.acts)];
    // The world's own business written into the order is the world's, whichever
    // list it arrived in (`misfiledWorldActs`). Left where it stands, so what
    // it makes is made before whatever in the order names it.
    const misfiled = actsForTheWorld && proposal.worldDeltas !== undefined ? misfiledWorldActs(proposal.deltas, world, actorRef) : new Set<WorldDelta>();
    const orderDeltas = actsForTheWorld && proposal.worldDeltas !== undefined ? new Set<WorldDelta>(proposal.deltas.filter((delta) => !misfiled.has(delta))) : undefined;
    for (const delta of misfiled) {
      audit.push({ actorRef, op: delta.op, kind: "refiled", ofTheOrder: false, attempt: "first", reason: "Written into the order, but it makes something for another power with the actor nowhere in it: judged as the world's.", delta });
    }
    const worldAtStart = world;
    const aliveBefore = new Set(world.characters.filter((character) => character.alive).map((character) => character.id));
    const stoodBefore = new Map(world.material.forces.map((force) => [force.id, force.locationId]));
    const applyContext = (assignedIds?: ReadonlyMap<string, string>, order: ReadonlySet<WorldDelta> | undefined = orderDeltas) => ({
      now: world.instant,
      actorRef,
      offices: input.offices,
      ...(input.successionRules === undefined ? {} : { successionRules: input.successionRules }),
      warfare: input.warfare,
      ...(input.terrains === undefined ? {} : { terrains: input.terrains }),
      ...(input.wealth === undefined ? {} : { wealth: input.wealth }),
      clock: input.clock,
      ids,
      gameId: input.gameId,
      actsForTheWorld,
      atomicGroups: intentParts.filter((part) => part.acts.some((at) => proposal.deltas[at]?.op === "service_contract_open")).map((part) => part.acts.map((at) => proposal.deltas[at]).filter((delta): delta is WorldDelta => delta !== undefined)),
      playerCharacterId: input.actorRef.kind === "character" ? input.actorRef.id : null,
      ...(order === undefined ? {} : { orderDeltas: order }),
      ...(assignedIds === undefined ? {} : { assignedIds }),
    });

    let result = applyDeltas(world, [...worldDeltas, ...proposal.deltas, ...(proposal.worldDeltas === undefined ? behind.acts : [])], applyContext(pass.seedIds));
    recordAudit(result, actorRef, pass.later === "repair" ? "repair" : "first");
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
    if (referenceRejections.length > 0 && repairable.length === 0 && pass.calls !== "none") {
      skipped.push({ stage: "repair", reason: `${referenceRejections.length} refusal(s) no correction can cure: ${referenceRejections.map((rejection) => rejection.reason.slice(0, 80)).join(" | ")}` });
    }
    if (repairable.length > 0 && pass.calls === "own" && modelCalls >= callCap) {
      skipped.push({ stage: "repair", reason: `the call budget is spent (${modelCalls} of ${callCap}); ${repairable.length} refusal(s) left uncorrected: ${repairable.map((rejection) => rejection.reason.slice(0, 80)).join(" | ")}` });
    }
    if (repairable.length > 0 && pass.calls === "own" && modelCalls < callCap) {
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
    // A battle that left the ruler surrounded ends the report on the question.
    if (playerDecision === null && input.actorRef.kind === "character") {
      const plight = playerPlight(world, input.actorRef.id);
      if (plight !== undefined) playerDecision = fieldDecision(world, plight);
      // Or a fight of his come to a moment his word could change (`engagement-decisions.ts`).
      else playerDecision = engagementDecision(world, input.actorRef.id, input.warfare) ?? siegeDecision(world, input.actorRef.id) ?? null;
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
    // Nor did a work begin, or end, that the work itself says has not: "Dentatus
    // began the Anio water works" was recorded while both Anio projects still
    // waited on "Begin construction" (R77). A project's stages are the
    // engine's; a fact claiming one is dropped unless the project agrees.
    const claimsWorkProgress = (fact: FactProposalDraft): boolean => {
      if (!/(^|_)(construction|works?|building|project)_?(started|begun|began|begins|completed|finished|done)$|_(started|begun|completed|finished)$/i.test(fact.kind)) return false;
      const words = wordStems(fact.summary);
      const finishing = /(completed|finished|done)$/i.test(fact.kind);
      return world.projects.some((project) => {
        if (project.status === "completed") return false;
        const named = (fact.affectedRefs ?? []).some((ref) => ref.kind === "project" && (resolveStrict(ref.id) ?? ref.id) === project.id);
        const label = wordStems(project.label);
        const alike = label.size > 0 && [...label].filter((stem) => words.has(stem)).length / label.size >= 0.5;
        if (!named && !alike) return false;
        // Begun is fine once its first stage is behind it, or the day it is
        // set going; finished never, while it is open.
        return finishing || (project.startedAtStep < world.elapsedStep && project.milestones[0]?.status === "pending");
      });
    };
    const suppressedOnly = result.applied.length > 0 && result.applied.every((entry) => entry.changed === false) && result.rejected.length === 0;
    const suppressedLetters = result.applied.filter((entry) => entry.changed === false && entry.delta.op === "diplomatic_message_send");
    const claimsSuppressedLetter = (fact: FactProposalDraft): boolean => /letter|diplomat|peace_offer|envoy/i.test(fact.kind)
      && suppressedLetters.some((entry) => {
        const delta = entry.delta;
        if (delta.op !== "diplomatic_message_send") return false;
        return (fact.affectedRefs ?? []).some((ref) => ref.id === `local:${delta.localId}` || ref.id === delta.fromCharacterRef)
          && !result.applied.some((other) => other.changed !== false && other.delta.op === "diplomatic_message_send" && other.delta.fromPolityId === delta.fromPolityId && other.delta.toPolityId === delta.toPolityId);
      });
    const aboutRealThings = (suppressedOnly ? [] : behind.facts).filter((fact) => !claimsSuppressedLetter(fact) &&
      fact.affectedRefs.every((ref) => madeReal(ref.id)) && (fact.storylineRef === null || madeReal(fact.storylineRef))
      && !claimsWorkProgress(fact));
    for (const fact of behind.facts.filter(claimsWorkProgress)) skipped.push({ stage: "engine_facts", reason: `"${fact.summary.slice(0, 80)}" claims a work's progress its project does not show; kept as a report.` });
    // Said with nothing behind it, and kept as said: somebody's report, never
    // the event (E04). Dropping it lost what the camp believed; keeping it as
    // the event made history of it.
    const claims = [...behind.claims, ...behind.facts.filter(claimsWorkProgress).map(asClaim)]
      .filter((fact) => fact.affectedRefs.every((ref) => madeReal(ref.id)) && (fact.storylineRef === null || madeReal(fact.storylineRef)));
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
    if (result.rejected.length > 0 && aboutRealThings.length > 0 && naming.length === 0 && pass.calls !== "none") {
      skipped.push({ stage: "reconcile", reason: `${result.rejected.length} refusal(s), and none of ${aboutRealThings.length} fact(s) names them` });
    }
    if (naming.length > 0 && pass.calls === "own" && modelCalls >= callCap) {
      skipped.push({ stage: "reconcile", reason: `the call budget is spent (${modelCalls} of ${callCap}); ${naming.length} fact(s) still name what was refused` });
    }
    // Left to the round, the facts naming what was refused wait for its one
    // reconciliation; with nobody paying, they are kept as what was said.
    const heldBack = new Set(pass.calls === "own" ? [] : naming.map((fact) => fact.localId));
    if (heldBack.size > 0) happened = aboutRealThings.filter((fact) => !heldBack.has(fact.localId));
    if (pass.calls === "none") claims.push(...naming.map(asClaim));
    if (naming.length > 0 && pass.calls === "own" && modelCalls < callCap) {
      const reconciled = await reconcileFacts({ port: input.port, facts: naming, refused: result.rejected });
      modelCalls += reconciled.calls;
      if (reconciled.failure !== null) parseFailures.push(`fact reconciliation: ${reconciled.failure}`);
      const kept = new Set(reconciled.facts.map((fact) => fact.localId));
      const rewritten = new Map(reconciled.facts.map((fact) => [fact.localId, fact]));
      const asked = new Set(naming.map((fact) => fact.localId));
      happened = aboutRealThings.flatMap((fact) => (!asked.has(fact.localId) ? [fact] : kept.has(fact.localId) ? [rewritten.get(fact.localId)!] : []));
    }
    happened = [...happened, ...claims];
    // An answer to a letter is on record already, in the answerer's own words
    // (`letter_answered`). The same refusal written again as the model's own
    // "diplomatic_reply" was told twice, a day apart, under two headlines.
    const answeredBy = new Set(result.applied.flatMap((entry) => {
      if (entry.delta.op !== "diplomatic_message_answer") return [];
      const messageRef = entry.delta.messageRef;
      const message = world.diplomacy.find((candidate) => candidate.id === (result.assignedIds.get(messageRef.replace(/^local:/, "")) ?? messageRef));
      return message === undefined ? [] : [message.toPolityId];
    }));
    const unrepeated = answeredBy.size === 0 ? happened : happened.filter((fact) =>
      !(/(reply|refus|answer|accept|counter|declin)/i.test(fact.kind)
        && fact.affectedRefs.some((ref) => answeredBy.has(ref.id) || answeredBy.has(world.characters.find((character) => character.id === ref.id)?.polityId ?? ""))));
    // Named as the model named them: "roman-republic" for Rome, the consul by
    // his name. Unresolved, a fact about Rome was invisible to Rome's own
    // consul, and its tag printed the slug.
    const resolvedRefs = unrepeated.map((fact) => ({ ...fact, affectedRefs: fact.affectedRefs.map((ref) => resolveFactRef(world, ref)) }))
      // An army is where it is. A fact naming the Carthaginian fleet and
      // Lilybaeum, with the fleet in Africa, put it in Sicily in the record; a
      // province named beside an army is the army's ground -- where it stands,
      // or stood before this answer moved it, or is marching, embarking,
      // fighting or besieging (`groundOfForce`) -- or it is dropped from the fact.
      .map((fact) => {
        const forces = fact.affectedRefs.filter((ref) => ref.kind === "force").map((ref) => world.material.forces.find((force) => force.id === ref.id)).filter((force) => force !== undefined);
        if (forces.length === 0) return fact;
        const ground = new Set(forces.flatMap((force) => [...groundOfForce(world, force.id), stoodBefore.get(force.id) ?? force.locationId]));
        const astray = fact.affectedRefs.filter((ref) => ref.kind === "province" && !ground.has(ref.id));
        if (astray.length === 0) return fact;
        // A few told, the rest counted: it was a line every turn (E29).
        placesDropped += 1;
        if (placesDropped <= FACT_PLACES_TOLD) skipped.push({ stage: "fact_places", reason: `"${fact.summary.slice(0, 80)}" named ${astray.map((ref) => ref.id).join(", ")}, where none of its armies stands or is bound; dropped from the fact.` });
        return { ...fact, affectedRefs: fact.affectedRefs.filter((ref) => !astray.includes(ref)) };
      });
    // What a man privately means, restated as a fact, is still private: the
    // model wrote Aristodemus's private wish for a match through private
    // negotiation as a public fact, and it went into Rome's answer (R75).
    const privateMinds = actorRef.kind !== "character" ? [] : world.characterIntents
      .filter((intent) => intent.actorCharacterId === actorRef.id && intent.visibility === "private")
      .map((intent) => wordStems(intent.rationale));
    const restatesAPrivateMind = (summary: string): boolean => {
      if (privateMinds.length === 0) return false;
      const mine = wordStems(summary);
      return privateMinds.some((stems) => {
        const shared = [...stems].filter((stem) => mine.has(stem)).length;
        return stems.size > 0 && shared / Math.min(stems.size, Math.max(1, mine.size)) >= PRIVATE_MIND_OVERLAP;
      });
    };
    // And so is anybody else's. Nobody can tell the world what another man
    // privately means, or what a plot still laid is, unless it came out: the
    // plot was found, or the man said it -- and a fact that says it is not
    // how it came out (E05). A public fact that restates the private mind or
    // the open plot of somebody it names is private to him, and to whoever
    // the fact says was there.
    const othersMinds = (fact: (typeof resolvedRefs)[number]): OrderPartyRef[] => {
      if (fact.visibility === "private") return [];
      const named = new Set(fact.affectedRefs.filter((ref) => ref.kind === "character" && ref.id !== actorRef.id).map((ref) => ref.id));
      if (named.size === 0) return [];
      const mine = wordStems(fact.summary);
      const restates = (text: string): boolean => {
        const stems = wordStems(text);
        const shared = [...stems].filter((stem) => mine.has(stem)).length;
        return stems.size > 0 && shared / Math.min(stems.size, Math.max(1, mine.size)) >= PRIVATE_MIND_OVERLAP;
      };
      const minds = world.characterIntents.filter((intent) => named.has(intent.actorCharacterId) && intent.visibility === "private" && restates(intent.rationale))
        .map((intent) => intent.actorCharacterId);
      const plots = world.covertPlots.filter((plot) => plot.outcome === null && (named.has(plot.sponsorCharacterId) || (plot.agentCharacterId !== null && named.has(plot.agentCharacterId))) && restates(plot.cover))
        .flatMap((plot) => [plot.sponsorCharacterId, ...(plot.agentCharacterId === null ? [] : [plot.agentCharacterId])]);
      return [...new Set([...minds, ...plots])].map((id) => ({ kind: "character" as const, id }));
    };
    const keptSecret = resolvedRefs.map((fact) => {
      if (fact.visibility !== "private" && !actsForTheWorld && (restatesAPrivateMind(fact.summary) || /\b(privately|in private|in secret|secretly|private(?:ly)? negotiat\w*)\b/i.test(fact.summary))) {
        return { ...fact, visibility: "private" as const, discoveryState: "private" as const, knownToRefs: [...fact.knownToRefs, actorRef] };
      }
      const owners = othersMinds(fact);
      if (owners.length > 0) {
        skipped.push({ stage: "private_minds", reason: `"${fact.summary.slice(0, 80)}" told another's private mind with no way of its having come out; kept private to ${owners.map((owner) => owner.id).join(", ")}.` });
        return { ...fact, visibility: "private" as const, discoveryState: "private" as const, knownToRefs: [...fact.knownToRefs, ...owners] };
      }
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
    // And what he will answer for when his office no longer covers him (`command-tenure.ts`).
    const actorPolity = world.characters.find((character) => character.id === actorRef.id)?.polityId ?? null;
    if (actorRef.kind === "character" && actorPolity !== null && result.breaches.length > 0) {
      world = { ...world, answerable: [...world.answerable, ...result.breaches.map((breach) => ({
        characterId: actorRef.id, polityId: actorPolity, kind: "breach" as const,
        label: describeBreach(breach.delta, world, actorName).slice(0, 240), atStep: world.elapsedStep, weight: 1,
      }))].slice(-400) };
    }
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
        // The act's own things beside the actor -- the chest spent from, the
        // army supplied -- so the breach is of something, not of nothing.
        affectedRefs: [actorRef, ...refsOfAct(breach.delta, (ref) => result.assignedIds.get(ref.replace(/^local:/, "")) ?? ref)],
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
    // Except the far powers' small business, which is nobody's news (L16).
    const worthWriting = (fact: FactProposalDraft): boolean => pass.factFloor === undefined || fact.significance >= pass.factFloor;
    const materialized = materializeFacts({
      proposals: [...keptSecret.filter(worthWriting), ...result.factProposals.filter(worthWriting), ...breachFacts],
      now: world.instant,
      forces: world.material.forces,
      atStep: world.elapsedStep,
      ids,
      causalDepth,
      assignedIds: result.assignedIds,
    });
    // A report is marked as one: somebody said it, and the record does not
    // stand behind it (`asClaim`).
    newFacts.push(...materialized.facts.map((fact) => isClaim(fact.kind) ? { ...fact, evidence: { provenance: "report" as const, reliability: 0.4, sourceFactId: null } } : fact));
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
    // A man's own account is bound to what he did in the open, never to what he
    // did in secret: bound to both, one public fact published the whole of it,
    // private half and all (C04).
    const visibleDescribed = materialized.facts.filter((fact) => fact.visibility !== "private").map((fact) => fact.id);
    const describes = visibleDescribed;
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

    // A person's own answer carries no account (the facts say it); a blank line would only cost the historian a line.
    if (proposal.narrativeSummary !== "") narrative.push({ actorRef: author, line: proposal.narrativeSummary, factIds: actsForTheWorld ? [] : describes });
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
    // What a man said in the house is quotable as what he said, tied to the
    // speech the engine recorded -- and only by the man who said it.
    if (!actsForTheWorld && actorRef.kind === "character") {
      for (const entry of result.applied) {
        const said = entry.delta;
        if (said.op !== "political_support_set" || said.words == null || said.supporterKind !== "character") continue;
        const words = said.words;
        const questionId = result.assignedIds.get(said.procedureRef.replace(/^local:/, "")) ?? said.procedureRef;
        const speech = materialized.facts.find((fact) => fact.kind === "senate_speech" && fact.affectedEntities.some((entity) => entity.id === actorRef.id));
        if (speech === undefined) continue;
        const question = world.material.politicalProcedures.find((procedure) => procedure.id === questionId);
        utterances.push({
          actorRef,
          speaker: world.characters.find((character) => character.id === actorRef.id)?.name ?? actorRef.id,
          line: words,
          occasion: question === undefined ? "in the Senate" : `speaking on "${question.label}"`.slice(0, 160),
          factIds: [speech.id],
        });
      }
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
    //
    // The engine catching a malformed payload is no fact at all: it is in the
    // audit (`recordAudit`) already, and made a private fact it was found by
    // what answers the order and told -- "No force ... exists" in the
    // Chronicle and the Council (E11).
    for (const rejection of result.rejected) {
      if (rejection.kind === "reference") continue;
      const ignored = rejection.kind === "ignored";
      const friction = materializeFacts({
        proposals: [{
          localId: `friction_${scheduled.length}_${newFacts.length}`,
          kind: ignored ? "order_ignored" : "execution_friction",
          summary: rejection.reason,
          affectedRefs: [actorRef],
          visibility: ignored ? "public" : "polity",
          discoveryState: ignored ? "public" : "polity",
          knowableInDays: 0,
          // A part of the ruler's own order the world would not have is his
          // business, and weighs what his business must to be told
          // (`OWN_BUSINESS_FLOOR`); the world's own frictions stay small.
          significance: ignored ? 30 : rejection.ofTheOrder === true ? OWN_BUSINESS_FLOOR : 5,
          knownToRefs: [actorRef],
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
      const subjectIds = event.subjectRefs.map(resolveStrict).filter((id): id is string => id !== null);
      const arrival = world.material.contracts.filter((contract) => contract.status === "active" && contract.journey != null && subjectIds.includes(contract.employeeCharacterId)).reduce((latest, contract) => Math.max(latest, contract.journey!.arrivesAtStep), world.elapsedStep);
      const dueInDays = /report|intelligence/i.test(event.kind) ? Math.max(event.dueInDays, arrival - world.elapsedStep + 2) : event.dueInDays;
      scheduled.push({
        id: ids.next("event"),
        dueInstantSortKey: (world.instant.day + dueInDays) * 1440 + world.instant.minute,
        kind: event.kind,
        summary: event.summary,
        // Everything resolved now, so the day it fires needs no memory of this
        // batch's handles.
        // A handle nothing in this batch created resolves to nothing: an event
        // stored with "local:plague" in it named a thread that never opened.
        // And by name, as facts are (`resolveFactRef`): a report scheduled
        // for "gaius-genucius-clepsina" was due to a player whose id is
        // "declared-…", and it could never have reached him.
        payload: {
          subjectIds: event.subjectRefs.map(resolveStrict).filter((id): id is string => id !== null)
            .map((id) => (world.characters.some((character) => character.id === id) ? id : resolveFactRef(world, { kind: "character" as const, id }).id)),
          visibility: event.visibility,
          significance: event.significance,
          knownTo: event.knownToRefs.flatMap((ref) => {
            const id = resolveStrict(ref.id);
            return id === null ? [] : [resolveFactRef(world, { kind: ref.kind, id })];
          }),
          storylineId: event.storylineRef === null ? null : resolveStrict(event.storylineRef),
        },
        causeFactId: event.causeFactLocalId === null ? null : materialized.factIds.get(event.causeFactLocalId) ?? null,
        causalDepth: causalDepth + 1,
      });
    }

    applyDiscoveries(proposal.discoveries, causalDepth);
    world = recordDelegations(world, proposal.delegations, ids, result.assignedIds, input.offices);
    // A man handed an order his temper will not let him carry out answers it
    // before he is ever asked (`insubordination.ts`).
    const tempered = answerByTemper(world, input.actorRef.kind === "character" ? [input.actorRef.id] : []);
    world = tempered.world;
    if (tempered.facts.length > 0) {
      const defied = materializeFacts({ proposals: tempered.facts, now: world.instant, atStep: world.elapsedStep, ids, causalDepth, assignedIds: result.assignedIds });
      newFacts.push(...defied.facts);
      for (const [factId, weight] of defied.significanceByFactId) significanceByFactId.set(factId, weight);
    }
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
      const actText = actsForTheWorld && input.orderText !== null ? input.orderText : proposal.narrativeSummary || materialized.facts[0]?.summary || "";
      await offerMechanics(candidates, actorRef, actText);
    }
    /** Where an act stood in the answer's own list, which is how the answer names it. */
    const indexIn = (entry: { readonly delta: WorldDelta; readonly written?: WorldDelta }): number | null => {
      const at = proposal.deltas.indexOf(entry.written ?? entry.delta);
      return at < 0 ? null : at;
    };
    const resolveRefs = refResolver(world, result.assignedIds);
    // A man who took on somebody's order and has now done something: what he
    // made is that order's work, and the order's part says so (`creditDelegatedWork`).
    if (!actsForTheWorld && actorRef.kind === "character") {
      checkpoint("crediting delegated work", () => creditDelegatedWork(actorRef.id, result.applied.filter((entry) => entry.changed !== false && !CHANGES_NOTHING.has(entry.delta.op)).map((entry) => {
        const work = workMadeBy(worldAtStart, world, entry.delta, result.assignedIds);
        return { said: wordsOfAct(entry.delta), delta: entry.delta, work, index: indexIn(entry), goals: goalsOfAct(worldAtStart, entry.delta, work, resolveRefs), money: entry.madeMoney };
      }), materialized.facts.map((fact) => fact.id), serves));
    }
    // A letter already on its way, written again, is still that letter: the
    // engine sends it once, and the part that wrote it has it as its work. As
    // nothing it was no part's work, and eight letters counted seven (E4).
    const letterAgain = (entry: (typeof result.applied)[number]): OrderWorkRef[] => {
      if (entry.delta.op !== "diplomatic_message_send") return [];
      const id = result.assignedIds.get(entry.delta.localId);
      return id !== undefined && world.diplomacy.some((message) => message.id === id) ? [{ kind: "message", id }] : [];
    };
    return {
      changed: result.applied.filter((entry) => entry.changed !== false && !CHANGES_NOTHING.has(entry.delta.op)).length,
      changedIndexes: new Set(result.applied.filter((entry) => entry.changed !== false && !CHANGES_NOTHING.has(entry.delta.op)).map(indexIn).filter((at): at is number => at !== null)),
      factLocalIds: new Set(keptSecret.map((fact) => fact.localId)),
      refusals: result.rejected.filter((rejection) => rejection.ofTheOrder === true && rejection.kind !== "reference").map((rejection) => rejection.reason),
      carriedOut: result.applied.filter((entry) => entry.changed !== false && entry.ofTheOrder === true).length,
      refusedByTheWorld: result.rejected.filter((rejection) => rejection.ofTheOrder === true && rejection.kind !== "reference").length,
      refused: result.rejected.filter((rejection) => rejection.ofTheOrder === true).length,
      ownActs: [
        ...result.applied.filter((entry) => entry.changed !== false && entry.ofTheOrder === true).map((entry) => {
          const work = workMadeBy(worldAtStart, world, entry.delta, result.assignedIds);
          return {
            said: wordsOfAct(entry.delta), carried: true, refusal: null, work, delta: entry.delta, index: indexIn(entry),
            goals: [...goalsOfAct(worldAtStart, entry.delta, work, resolveRefs), ...renamedOrRecommanded(entry.delta, resolveRefs)],
            breach: result.breaches.some((breach) => breach.delta.op === entry.delta.op && wordsOfAct(breach.delta) === wordsOfAct(entry.delta))
              ? describeBreach(entry.delta, world, actorName) : null,
            money: entry.madeMoney,
          };
        }),
        ...result.applied.filter((entry) => entry.changed === false && entry.ofTheOrder === true && letterAgain(entry).length > 0).map((entry) => {
          const work = letterAgain(entry);
          return { said: wordsOfAct(entry.delta), carried: true, refusal: null, work, delta: entry.delta, index: indexIn(entry), goals: goalsOfAct(world, entry.delta, work, resolveRefs) };
        }),
        ...result.rejected.filter((rejection) => rejection.ofTheOrder === true && rejection.kind !== "reference")
          .map((rejection) => ({ said: wordsOfAct(rejection.delta), carried: false, refusal: rejection.reason, delta: rejection.delta, index: indexIn(rejection), goals: goalsOfAct(world, rejection.delta, [], resolveRefs) })),
        ...result.rejected.filter((rejection) => rejection.ofTheOrder === true && rejection.kind === "reference")
          .map((rejection) => ({ said: wordsOfAct(rejection.delta), carried: false, refusal: null, unwritten: true, delta: rejection.delta, index: indexIn(rejection) })),
      ],
      factIdsByLocalId: materialized.factIds,
      assignedIds: result.assignedIds,
      misfiledIndexes: new Set(proposal.deltas.flatMap((delta, at) => misfiled.has(delta) ? [at] : [])),
      unwritten: result.rejected.filter((rejection) => rejection.ofTheOrder === true && rejection.kind === "reference").map((rejection) => rejection.reason),
      ...(pass.calls !== "round" ? {} : { correction: {
        actorRef, causalDepth, repairable, naming, refused: result.rejected, namedBeside: [...namedBeside], assignedIds: result.assignedIds,
      } }),
    };
  };

  /**
   * What a round's people left to correct, corrected in one repair and one
   * reconciliation for all of them (`round-corrections.ts`). Each man's
   * corrections are applied in his own name, as a later pass of his answer;
   * then his facts that still name what stands refused are reconciled with
   * everybody else's, and what survives is written down in his name too.
   * Returns how much it changed, for the round's tally.
   */
  const settleTheRound = async (owed: readonly { readonly correction: RoundCorrection; readonly idle: boolean }[]): Promise<number> => {
    let changed = 0;
    const later = async (entry: (typeof owed)[number], proposal: Proposal, how: ProposalPass): Promise<OrderActs> => {
      const before = newFacts.length;
      const acts = await applyProposal(proposal, entry.correction.actorRef, entry.correction.causalDepth, false, [], how);
      stampWorkFacts(before);
      const authorId = entry.correction.actorRef.kind === "character" ? entry.correction.actorRef.id : null;
      for (const fact of newFacts.slice(before)) {
        if (authorId !== null) authorOf.set(fact.id, authorId);
        if (entry.idle && acts.changed === 0) significanceByFactId.set(fact.id, Math.min(significanceByFactId.get(fact.id) ?? IDLE_FACT_WEIGHT, IDLE_FACT_WEIGHT));
      }
      changed += acts.changed + (newFacts.length - before);
      return acts;
    };
    const nothingSaid = CognitionProposalSchema.parse({});
    const refusals = owed.reduce((sum, entry) => sum + entry.correction.repairable.length, 0);
    let corrections: readonly (readonly WorldDelta[])[] = owed.map(() => []);
    if (refusals > 0 && modelCalls >= callCap) {
      skipped.push({ stage: "repair", reason: `the call budget is spent (${modelCalls} of ${callCap}); ${refusals} refusal(s) of the round left uncorrected` });
    } else if (refusals > 0) {
      const repaired = await repairTheRound({ port: input.port, worldText: sliceText, world, owed: owed.map((entry) => entry.correction) });
      modelCalls += repaired.calls;
      if (repaired.failure !== null) parseFailures.push(repaired.failure);
      corrections = repaired.corrections;
    }
    // What still stands refused, man by man, once his corrections have had their turn.
    const held: { facts: FactProposal[]; refused: RejectedDelta[]; ids: ReadonlyMap<string, string> }[] = [];
    for (const [at, entry] of owed.entries()) {
      const deltas = corrections[at] ?? [];
      let refused: RejectedDelta[] = [...entry.correction.refused];
      let ids = entry.correction.assignedIds;
      if (deltas.length > 0) {
        const pass = await later(entry, { ...nothingSaid, deltas: [...deltas] }, { calls: "round", seedIds: ids, later: "repair" });
        refused = unanswered(refused, deltas.map((delta) => delta.op), pass.correction?.refused ?? []);
        ids = pass.assignedIds ?? ids;
      }
      const naming = entry.correction.naming.length === 0 || refused.length === 0 ? [] : factsNamingRefusals(entry.correction.naming, refused, entry.correction.namedBeside);
      held.push({ facts: naming, refused, ids });
    }
    // Facts that no longer name anything refused stand as written.
    const standing = owed.map((entry, at) => entry.correction.naming.filter((fact) => !held[at]!.facts.includes(fact)));
    let reconciled: readonly (readonly FactProposal[])[] = held.map((entry) => entry.facts);
    const asked = held.reduce((sum, entry) => sum + entry.facts.length, 0);
    if (asked > 0 && modelCalls >= callCap) {
      skipped.push({ stage: "reconcile", reason: `the call budget is spent (${modelCalls} of ${callCap}); ${asked} fact(s) of the round that name what was refused are kept as reports` });
      reconciled = held.map((entry) => entry.facts.map(asClaim));
    } else if (asked > 0) {
      const settled = await reconcileTheRound({ port: input.port, held });
      modelCalls += settled.calls;
      if (settled.failure !== null) parseFailures.push(`fact reconciliation: ${settled.failure}`);
      reconciled = settled.facts;
    }
    for (const [at, entry] of owed.entries()) {
      const facts = [...standing[at]!, ...(reconciled[at] ?? [])];
      if (facts.length > 0) await later(entry, { ...nothingSaid, facts }, { calls: "none", seedIds: held[at]!.ids, later: "facts" });
    }
    return changed;
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
      world, toDay, ids, warfare: input.warfare, clock: input.clock,
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
    // The tick writes without the applier's per-act checks, so what it left
    // at odds with itself is written down (`invariants.ts`).
    const oddBefore = new Set(findInvariantViolations(world));
    for (const violation of findInvariantViolations(holds.data).filter((entry) => !oddBefore.has(entry))) {
      skipped.push({ stage: "invariant", reason: `the tick to day ${toDay} left ${violation}` });
    }
    const beforeTick = world;
    lastSound = holds.data;
    world = commandersFollowTheirArmies(holds.data);
    const handedOver = commandChanges(beforeTick, world);
    if (handedOver.length > 0) {
      const told = materializeFacts({ proposals: handedOver, now: world.instant, forces: world.material.forces, atStep: world.elapsedStep, ids, causalDepth: 0, assignedIds: new Map() });
      newFacts.push(...told.facts);
      for (const [factId, weight] of told.significanceByFactId) significanceByFactId.set(factId, weight);
    }
    const factsBeforeStages = newFacts.length;
    checkpoint("taking up held acts", advanceStages);
    ratifyWhatWasVoted();
    checkpoint("holding what orders allowed", holdEnvelopes);
    checkpoint("settling delegated orders", settleDelegations);
    checkpoint("lapsing stale orders", lapseStaleParts);
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
    // And so does an ambush that sprang on him while the days went by.
    if (playerDecision === null && input.actorRef.kind === "character") {
      const plight = playerPlight(world, input.actorRef.id);
      if (plight !== undefined) playerDecision = fieldDecision(world, plight);
      // Or a fight of his come to a moment his word could change (`engagement-decisions.ts`).
      else playerDecision = engagementDecision(world, input.actorRef.id, input.warfare) ?? siegeDecision(world, input.actorRef.id) ?? null;
    }
    if (ticked.factProposals.length > 0) {
      const materialized = materializeFacts({
        proposals: ticked.factProposals,
        now: world.instant,
        forces: world.material.forces,
        atStep: world.elapsedStep,
        ids,
        causalDepth: 0,
        assignedIds: new Map(),
      });
      newFacts.push(...materialized.facts);
      for (const [factId, weight] of materialized.significanceByFactId) significanceByFactId.set(factId, weight);
      significance += materialized.significance;
    }
    stampWorkFacts(factsBeforeStages);
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
      world, toDay, ids, recentFacts: newFacts.slice(factsSeenByMechanics), ledger: debitLedger, month: calendarDateOf({ day: toDay, minute: 0 }, input.clock).month,
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
    if (behind.missed > 0 || behind.slipped > 0) checkpoint("settling overdue plan steps", () => {
      world = behind.world;
      plans.missed += behind.missed;
      const materialized = materializeFacts({ proposals: behind.facts, now: world.instant, atStep: world.elapsedStep, ids, causalDepth: 0, assignedIds: new Map() });
      newFacts.push(...materialized.facts);
      for (const [factId, weight] of materialized.significanceByFactId) significanceByFactId.set(factId, weight);
      significance += materialized.significance;
    });
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
      if (mechanicCalls >= budget.maxMechanicCalls) {
        skipped.push({ stage: "mechanic", reason: `${entity.id}: ${mechanicCalls} call(s) for rules already made this burst (of ${budget.maxMechanicCalls}); it stands without one` });
        continue;
      }
      // The slice without its directives to the world: a rule for one man's
      // pursuit has no use for the countries to be peopled or the season's stirrings.
      const ownerText = ownerCharacterId !== null && ownerCharacterId === (input.actorRef.kind === "character" ? input.actorRef.id : null) && sliceText.length > 0
        ? withoutDirectives(sliceText)
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
  /**
   * A report falling due is the report, not the instruction to make one.
   * "Report transport or provisioning obstacles to the consul" fired as that
   * sentence, word for word: history recorded that somebody should report,
   * and nobody did. Addressed to the player, it says where each part of his
   * standing orders now stands, read from the work (`orderPartStatus`).
   */
  const reportOf = (kind: string, summary: string, knownTo: readonly { readonly kind: string; readonly id: string }[], subjectIds: readonly string[] = []): string => {
    if (!/report|account/i.test(`${kind} ${summary}`) || input.actorRef.kind !== "character") return summary;
    if (!knownTo.some((ref) => ref.id === input.actorRef.id)) return summary;
    // A report about the player's own orders says where each part stands. A
    // report about the wider world -- an envoy's intelligence from Sicily --
    // is not that: it used to be replaced by the same list of open orders, so
    // the consul's scout reported on his own ship-hiring. It tells what is
    // known of the places and people it was sent to look into instead.
    const aboutOrders = /transport|provision|supply|suppl|obstacle|muster|recruit|levy|raising|preparation|readiness|logistic/i.test(summary);
    if (!aboutOrders && subjectIds.length > 0) {
      const sought = new Set(subjectIds);
      const nowKey = world.instant.day * 1440 + world.instant.minute;
      const heard = [...input.knownFacts, ...newFacts]
        .filter((fact) => fact.visibility !== "private" && fact.discovery.state !== "private")
        .filter((fact) => fact.kind !== "scheduled_event" && fact.kind !== "engine_rejection" && fact.kind !== "authority_breach")
        .filter((fact) => nowKey - (fact.time.day * 1440 + fact.time.minute) <= 20 * 1440)
        .filter((fact) => fact.affectedEntities.some((entity) => sought.has(entity.id)))
        .slice(-4);
      if (heard.length > 0) return `A report came in. ${summary.replace(/\.?\s*$/, "")}: ${heard.map((fact) => fact.summary.replace(/\s*\[[^\]]+\]/g, "").replace(/\.\s*$/, "")).join("; ")}.`.slice(0, 700);
      return summary;
    }
    if (!aboutOrders) return summary;
    const open = world.orders
      .filter((order) => order.actorCharacterId === input.actorRef.id)
      .flatMap((order) => order.parts)
      .filter((part) => part.closedAtStep === null)
      .slice(-6);
    if (open.length === 0) return summary;
    const lines = open.map((part) => `${part.said}: ${ORDER_PART_STATUS_LABEL[orderPartStatus(world, part)]}${part.refusal === null ? "" : ` (${part.refusal.slice(0, 120)})`}`);
    return `A report came in. ${lines.join("; ")}.`.slice(0, 600);
  };

  const fireDueEvents = (): void => {
    // Including what this burst scheduled a moment ago. An order that sets a
    // march in motion and then walks the world to its arrival must see the
    // arrival happen; before, only events inherited from earlier bursts could
    // fire, so the burst arrived on the day and nothing occurred.
    const arrived = [...input.queue, ...scheduled].filter((event) => !firedEventIds.includes(event.id) && event.dueInstantSortKey <= nowKey());
    if (arrived.length === 0) return;
    for (const event of arrived) firedEventIds.push(event.id);
    // Retired without a word: an event whose matter has since been settled,
    // and an event that only restates a work's own stage. "The first stage of
    // the Senate's 150-ship fleet falls due" fired and was chronicled weeks
    // after the Senate had voted the fleet down and the work was cancelled;
    // and a stage that does fall due is the tick's to report, not a second
    // announcement of the same day.
    const due = arrived.filter((event) => stillStands(world, event));
    if (due.length === 0) return;

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
          summary: reportOf(event.kind, event.summary, details.knownTo, details.subjectIds),
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
      forces: world.material.forces,
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

  // ── Taking up the house ────────────────────────────────────────────────
  //
  // The answer to "whose eyes do you see through now?" changes who is asking,
  // and the world has to follow him rather than the man he was: the house's
  // friends and enemies become his, and so does the rival who was set against
  // it. The slice is built for the actor this burst was given, so everything
  // else -- purse, land, office, what he may do -- is already his.
  const answeredOption = input.answeredDecision?.optionId ?? null;
  const predecessorId = input.answeredDecision?.predecessorId ?? null;
  if (answeredOption !== null && answeredOption.startsWith("succeed-") && predecessorId !== null && input.actorRef.kind === "character" && predecessorId !== input.actorRef.id) {
    world = takeUpTheHouse(world, predecessorId, input.actorRef.id);
  }

  // ── Whoever was left surrounded when the last report closed ─────────────
  //
  // A man cut off on a lost field learns his fate at the start of the next
  // report, never in the one that left him there. The player's is decided by
  // the answer he just gave; everybody else's by his own nature.
  let diedAtOnce = false;
  if (world.fieldPerils.some((peril) => peril.resolvedAtStep === null)) {
    const ended = resolveFieldPerils({
      world,
      atStep: world.elapsedStep,
      playerCharacterId: input.actorRef.kind === "character" ? input.actorRef.id : null,
      answeredOptionId: answeredOption,
    });
    world = ended.world;
    const materialized = materializeFacts({
      proposals: ended.facts,
      now: world.instant,
      forces: world.material.forces,
      atStep: world.elapsedStep,
      ids,
      causalDepth: 0,
      assignedIds: new Map(),
    });
    newFacts.push(...materialized.facts);
    for (const [factId, weight] of materialized.significanceByFactId) significanceByFactId.set(factId, weight);
    significance += materialized.significance;
    world = linkFactsToStorylines(world, materialized.storylineByFactId);
    for (const said of ended.utterances) {
      const factId = materialized.factIds.get(said.factLocalId);
      if (factId === undefined) continue;
      utterances.push({ actorRef: { kind: "character", id: said.characterId }, speaker: said.speaker, line: said.line, occasion: said.occasion, factIds: [factId] });
    }
    for (const id of ended.died) deadThisBurst.add(id);
    diedAtOnce = input.actorRef.kind === "character" && ended.died.includes(input.actorRef.id);
    // The report is his death; nothing else is waited for.
    if (diedAtOnce && input.actorRef.kind === "character") playerDecision = successionDecision(world, input.actorRef.id, world.instant.day);
  }

  // ── A fight of his that stood waiting on his word ───────────────────────
  //
  // Taken before anything else moves, as the surrounded man's is: the answer
  // he just gave, or -- if he gave an order instead -- the course he was on.
  if (input.actorRef.kind === "character") {
    const fought = answerEngagement(world, input.actorRef.id, answeredOption, world.elapsedStep);
    const besieged = answerSiege(fought.world, input.actorRef.id, answeredOption, world.elapsedStep, input.warfare, ids);
    battleAccounts.push(...besieged.battles);
    const answered = { world: besieged.world, facts: [...fought.facts, ...besieged.facts] };
    world = answered.world;
    if (answered.facts.length > 0) {
      const materialized = materializeFacts({
        proposals: answered.facts, now: world.instant, forces: world.material.forces, atStep: world.elapsedStep, ids, causalDepth: 0, assignedIds: new Map(),
      });
      newFacts.push(...materialized.facts);
      for (const [factId, weight] of materialized.significanceByFactId) significanceByFactId.set(factId, weight);
      significance += materialized.significance;
    }
  }

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
    // What the world would not have, in its own words; what the engine could
    // not read, never in the engine's (E11).
    const obstacles = answer.filter((fact) => fact.kind === "execution_friction").map((fact) => fact.summary);
    const outcome = orchestrationUnreadable && answer.length === 0
      ? "Word of it went out, and nothing came back that anyone could make sense of."
      : obstacles.length > 0
        ? `It could not be done as given: ${obstacles.slice(0, 3).join(" ")}`
        : allRefused ? "It could not be done as written." : "Nothing came of it that anyone could see.";
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

  /**
   * Every part of the order answered, not only the order.
   *
   * `answerTheOrder` speaks when nothing of the order reached its giver. An
   * order of three sentences whose first two came to something and whose
   * third -- a governorship -- came to nothing was answered, and the third was
   * never mentioned again. Each part the orchestrator read and could show no
   * fact for is said, with its reason where it gave one, or the engine's.
   */
  const answerTheParts = (parts: readonly IntentPart[], acts: OrderActs): void => {
    if (input.orderText === null || orchestrationUnreadable) return;
    const who = world.characters.find((character) => character.id === input.actorRef.id)?.name ?? "The ruler";
    // Each act of the order to the part it answers: the one that named it,
    // then by its words. A refusal is the answer of the part it belongs to
    // and of no other: the Senate's vote once stood as the reason for every
    // part of an order whose contract and letter had both been done.
    const placed = assignActs(parts, acts.ownActs ?? []);
    const own = (acts.ownActs ?? []).map((act, at) => ({ ...act, part: placed[at]!.part }));
    // A part held for later -- "lay siege on arrival", "Legio II follows" --
    // is waiting, not answered with nothing: it was told "Nothing came of it"
    // on the day of the order and taken up again a fortnight later.
    const heldForLater = (part: IntentPart): boolean => (part.deferredActs ?? []).length > 0 || (part.afterParts ?? []).length > 0
      || part.whenForceExists != null || /^(once|after|when|on arrival)\b/i.test(part.said);
    const unanswered = parts.map((part, index) => ({ part, index })).filter(({ part, index }) =>
      !part.factLocalIds.some((localId) => acts.factLocalIds.has(localId))
      && !own.some((act) => act.part === index && act.carried)
      && !heldForLater(part));
    if (unanswered.length === 0) return;
    // What the order itself set going that a refused act can wait on: a vote,
    // or something being built (`recordOrder` holds the act on them).
    const waitsOnTheOrder = own.some((act) => act.carried && (act.work ?? []).some((ref) => ref.kind === "procedure"));
    const whyNot = (index: number): string => {
      const refused = own.find((act) => act.part === index && act.refusal !== null)?.refusal
        // A one-part order owns every refusal it met.
        ?? (parts.length === 1 ? acts.refusals[0] : undefined);
      if (refused === undefined) return "Nothing came of it.";
      return waitsOnTheOrder
        ? `It cannot be done yet, and waits on what the order asked for first: ${refused}`
        : `It could not be done: ${refused}`;
    };
    const told = materializeFacts({
      proposals: unanswered.slice(0, 6).map(({ part, index }) => ({
        localId: `order_part_${index}`,
        kind: "order_part_unanswered",
        summary: `${who} ordered: "${part.said}" ${part.whyNot ?? whyNot(index)}`.slice(0, 600),
        affectedRefs: [input.actorRef],
        visibility: "private" as const,
        discoveryState: "private" as const,
        knowableInDays: 0,
        knownToRefs: [input.actorRef],
        significance: 30,
      })),
      now: world.instant,
      atStep: world.elapsedStep,
      ids,
      causalDepth: 0,
      assignedIds: new Map(),
    });
    newFacts.push(...told.facts);
    for (const [factId, weight] of told.significanceByFactId) significanceByFactId.set(factId, weight);
  };
  /**
   * The order, part by part, with the work each part set going (`world/orders.ts`).
   *
   * Written after the parts are answered, so what the next order, a passed
   * vote or the Council reads is what the world did, not what the prose said.
   * An act is the part's its words share most with; one whose words match no
   * part goes to the first part that has nothing else, so a one-part order
   * owns everything it did. A part saying again what an earlier, still-open
   * part said replaces it: "carry Legio I to Messana" given four times is one
   * standing order, not four.
   */
  const recordOrder = (
    parts: readonly IntentPart[],
    summary: string,
    acts: OrderActs,
    attemptsBefore: ReadonlySet<string>,
    orderFacts: readonly Fact[],
    delegations: Proposal["delegations"],
  ): void => {
    if (input.orderText === null || input.orderText.trim() === "" || orchestrationUnreadable || input.actorRef.kind !== "character") return;
    const read: readonly IntentPart[] = parts.length > 0 ? parts : [{ said: summary.slice(0, 200) || input.orderText.trim().slice(0, 200), acts: [], goals: [], spend: null, factLocalIds: [], whyNot: null }];
    const saids = read.map((part) => part.said);
    const ownActs = acts.ownActs ?? [];
    const placed = assignActs(read, ownActs);
    const own = ownActs.map((act, at) => ({ ...act, part: placed[at]!.part, guessed: placed[at]!.guessed }));
    // A part that asks for a vote is answered by the vote only. A hire, a
    // march or a crossing tagged to it belongs to another part: "petition the
    // Senate for a navy" once owned the transport hires and the crossing, and
    // the crossing's failure was then told as the Senate refusing the navy.
    const otherParts = read.map((_, index) => index).filter((index) => !asksAVote(read[index]!.said));
    if (otherParts.length > 0) {
      for (const act of own.filter((candidate) => candidate.part !== null && asksAVote(read[candidate.part]!.said) && !isVoteAct(candidate))) {
        const byWords = partOfAct(otherParts.map((index) => saids[index]!), act.said);
        act.part = otherParts[byWords ?? 0]!;
        act.guessed = true;
      }
    }
    for (const act of own.filter((candidate) => candidate.part === null && candidate.delta?.op !== "order_attempt_decide")) {
      const empty = read.findIndex((_, index) => !own.some((other) => other.part === index) && !(asksAVote(read[index]!.said) && !isVoteAct(act)));
      act.part = empty < 0 ? null : empty;
    }
    for (const act of own.filter((candidate) => candidate.guessed && candidate.delta !== undefined)) {
      audit.push({ actorRef: input.actorRef, op: act.delta!.op, kind: "attribution_uncertain", ofTheOrder: true, attempt: "first", reason: `Placed in part ${act.part ?? "none"} of the order by its words; the answer named no part for it.`, delta: act.delta! });
    }
    // Handed on: to the part the delegation named, then by its words.
    const delegated = world.orderAttempts.filter((attempt) => !attemptsBefore.has(attempt.id) && attempt.issuerRef.id === input.actorRef.id);
    const partOfAttempt = (attempt: (typeof delegated)[number]): { part: number | null; guessed: boolean } => {
      const written = delegations.find((delegation) => delegation.instruction.slice(0, 400) === attempt.instruction);
      if (written?.part !== null && written?.part !== undefined && written.part < read.length) return { part: written.part, guessed: false };
      if (read.length === 1) return { part: 0, guessed: false };
      return { part: partOfAct(saids, attempt.instruction), guessed: true };
    };
    const actorPolityId = world.characters.find((character) => character.id === input.actorRef.id)?.polityId ?? null;
    const recordId = ids.next("order-record");
    const handedTo = new Map<string, number>();
    const orderWork = own.flatMap((act) => act.work ?? []);
    const recordParts: OrderPart[] = read.map((part, index) => {
      const mine = own.filter((act) => act.part === index);
      const handedOn = delegated.filter((attempt) => partOfAttempt(attempt).part === index);
      for (const attempt of handedOn) handedTo.set(attempt.id, index);
      const workRefs: OrderWorkRef[] = [
        ...mine.flatMap((act) => act.work ?? []),
        ...handedOn.map((attempt) => ({ kind: "order_attempt" as const, id: attempt.id })),
      ].slice(0, 12);
      const refused = mine.filter((act) => !act.carried && act.refusal !== null);
      const resolve = refResolver(world, acts.assignedIds ?? new Map());
      const named = (part.goals ?? []).map((goal) => resolveGoal(world, goal, actorPolityId, resolve)).filter((goal): goal is OrderGoal => goal !== null);
      const wanted = mine.flatMap((act) => act.delta === undefined ? [] : missionGoals(world, act.delta, part.said, input.orderText!, input.actorRef.id));
      // A held act is the part's too: a siege put off until the army arrives is
      // done when the town is Rome's, however that came about.
      // (Not a siege of "wherever the army stands": it does not stand there yet.)
      const heldFor = (part.deferredActs ?? []).filter((delta) => delta.op !== "siege_lay" || delta.settlementId !== null)
        .flatMap((delta) => goalsOfAct(world, delta, [], resolve));
      const merged = mergeGoals([...mine.flatMap((act) => act.goals ?? []), ...heldFor], [...named, ...wanted]);
      const conflicted = mine.find((act) => act.delta !== undefined)?.delta;
      if (conflicted !== undefined) for (const conflict of merged.conflicts) audit.push({ actorRef: input.actorRef, op: conflicted.op, kind: "goal_conflict", ofTheOrder: true, attempt: "first", reason: conflict, delta: conflicted });
      // A refused act beside a vote asked in the same breath is what the vote
      // is for: held, and done once the vote passes (`advanceStages`).
      // So is one refused beside a move the same part set going: the fleet
      // sent to the shore is what the crossing refused for want of ships
      // waits on. Only what this part itself is doing -- never a guess at
      // what else in the world might help.
      // A vote asked anywhere in the same order: "bring the legion over; seek
      // the money if needed" is two parts, and the crossing waits on the
      // funding all the same.
      const votes: StageCondition[] = orderWork.filter((ref) => ref.kind === "procedure")
        .filter((ref) => world.material.politicalProcedures.find((procedure) => procedure.id === ref.id)?.outcome !== "failed")
        .map((ref) => ({ kind: "procedure_passed" as const, procedureId: ref.id }));
      const moves: StageCondition[] = mine.filter((act) => act.carried).flatMap((act) => act.goals ?? [])
        .filter((goal): goal is Extract<OrderGoal, { kind: "force_at" }> => goal.kind === "force_at" && goalMet(world, goal) === "not_yet")
        .map((goal) => ({ kind: "force_at" as const, forceId: goal.forceId, provinceId: goal.provinceId }));
      // And on what the order is building: a fleet voted is a fleet still to
      // be launched, and a crossing tried the day of the vote is refused again.
      const builds: StageCondition[] = orderWork.filter((ref) => ref.kind === "project")
        .map((ref) => world.projects.find((project) => project.id === ref.id))
        .filter((project) => project !== undefined && project.completionOutcome?.kind === "force" && project.status !== "completed")
        .map((project) => ({ kind: "project_done" as const, projectId: project!.id }));
      const waitsOn = [...votes, ...moves, ...builds].slice(0, 4);
      // Held with the ids its own answer gave its handles: tried again later,
      // "local:fleet-question" named nothing (E9).
      const hold = (delta: WorldDelta, on: StageCondition[]): OrderStage => ({
        held: resolveHandles(delta, acts.assignedIds ?? new Map()),
        waitsOn: on, status: "waiting", reason: null, heldSinceStep: world.elapsedStep, failedAtStep: null,
      });
      const heldActs = new Map((waitsOn.length === 0 ? [] : refused.filter((act) => act.delta !== undefined).slice(0, 6)).map((act) => [act, hold(act.delta!, [...waitsOn])] as const));
      const stages: OrderStage[] = [...heldActs.values()];
      for (const act of refused) {
        const delta = act.delta;
        if (delta === undefined || !/ships|hulls|loads|carry.*men/i.test(act.refusal ?? "")) continue;
        const forceRef = delta.op === "force_modify" ? delta.forceRef : delta.op === "project_create" && delta.completionOutcome?.kind === "force_move" ? delta.completionOutcome.forceRef : null;
        const provinceId = delta.op === "force_modify" ? delta.locationId : delta.op === "project_create" ? delta.completionOutcome?.provinceId : null;
        const forceId = forceRef == null ? null : resolve(forceRef, "force");
        if (forceId !== null && provinceId != null) {
          const condition: StageCondition = { kind: "transport_capacity", forceId, provinceId };
          const held = heldActs.get(act);
          if (held !== undefined && held.waitsOn.length < 4) held.waitsOn.push(condition);
          else if (held === undefined) {
            const stage = hold(delta, [condition]);
            heldActs.set(act, stage);
            stages.push(stage);
          }
        }
      }
      const priorGoals = (part.afterParts ?? []).filter((at) => at !== index).flatMap((at) => own.filter((act) => act.part === at).flatMap((act) => act.goals ?? []));
      const dependencies: StageCondition[] = [
        ...priorGoals.filter((goal): goal is Extract<OrderGoal, { kind: "force_at" }> => goal.kind === "force_at"),
        ...priorGoals.filter((goal): goal is Extract<OrderGoal, { kind: "answer_from" }> => goal.kind === "answer_from")
          .map((goal) => ({ kind: "letter_answered" as const, messageId: goal.messageId, answer: part.whenAnswered ?? "any" })),
      ];
      if (/^(once|after)\b/i.test(part.said) && dependencies.length === 0) dependencies.push(...own.flatMap((act) => act.goals ?? []).filter((goal): goal is Extract<OrderGoal, { kind: "force_at" }> => goal.kind === "force_at" && goalMet(world, goal) === "not_yet").slice(0, 1));
      const futureName = part.whenForceExists ?? (/when.*punitive.*(raised|ready)/i.test(part.said) ? "punitive" : null);
      if (futureName !== null && actorPolityId !== null) dependencies.push({ kind: "force_named", name: futureName, polityId: actorPolityId });
      if (dependencies.length > 0) {
        const deferred = part.deferredActs ?? [];
        if (deferred.length > 0) stages.push(...deferred.map((delta) => hold(delta, dependencies.slice(0, 4))));
        else if (mine.every((act) => !act.carried)) stages.push({ held: { op: "resume_instruction", instruction: part.said }, waitsOn: dependencies.slice(0, 4), status: "waiting", reason: null, heldSinceStep: world.elapsedStep, failedAtStep: null });
      }
      const payer = part.spend === null || part.spend === undefined ? null : resolve(part.spend.payerAccountRef, "account");
      // A part some of whose acts were carried was not refused: the eight
      // letters went although one of them could not. What could not is said
      // beside it, never as its answer (E4).
      const carried = mine.filter((act) => act.carried);
      const refusal = stages.length > 0 || carried.length > 0 ? null : refused[0]?.refusal?.slice(0, 600) ?? null;
      const breaches = mine.map((act) => act.breach ?? null).filter((breach): breach is string => breach !== null);
      const shortBy = refused.find((act) => !heldActs.has(act))?.refusal ?? (mine.some((act) => act.unwritten === true) ? UNWRITTEN : null);
      const short = carried.length > 0 && shortBy !== null ? `Not all of it: ${shortBy}` : null;
      // An act the engine could not read is not the world refusing it, and
      // its reason is the engine's own: the part says only that it could not
      // be done as written (E5, E11).
      const unwritten = carried.length === 0 && refused.length === 0 && mine.some((act) => act.unwritten === true) ? UNWRITTEN : null;
      return {
        said: part.said,
        goals: merged.goals,
        workRefs,
        // A refusal that is waiting on a vote is not yet the part's answer.
        refusal,
        refusedAtStep: refusal === null ? null : world.elapsedStep,
        whyNot: stages.length > 0 ? null : part.whyNot,
        factIds: part.factLocalIds.map((localId) => acts.factIdsByLocalId?.get(localId)).filter((id): id is string => id !== undefined).slice(0, 12),
        note: [...breaches, ...(short === null ? [] : [short]), ...(unwritten === null ? [] : [unwritten])].join("; ").slice(0, 400) || null,
        stages: dedupeStages(stages).slice(0, 6),
        spend: payer === null || part.spend === null || part.spend === undefined ? null : { payerAccountId: payer, cap: part.spend.cap, reservationId: null },
        attribution: mine.some((act) => act.guessed) || handedOn.some((attempt) => partOfAttempt(attempt).guessed) ? "guessed" as const : "tagged" as const,
        closedAtStep: null,
        actsCarried: Math.min(99, carried.filter((act) => act.delta === undefined || !CHANGES_NOTHING.has(act.delta.op)).length),
        // Refused for good: what is held for later is not refused yet.
        actsRefused: Math.min(99, mine.filter((act) => !act.carried && !heldActs.has(act)).length),
      };
    });
    // A part that wants what an earlier open part of his wants replaces it:
    // "carry Legio I to Messana" given four times is one standing order, not
    // four. Judged by the goals, where both have them; by the words only where
    // neither does -- words alone once let the transport replace the ceasefire.
    const replaces = (old: OrderPart): boolean => {
      const oldKeys = new Set(old.goals.map((goal) => JSON.stringify(goal.kind === "paid" ? { ...goal, sinceStep: 0 } : goal)));
      const withGoals = recordParts.filter((part) => part.goals.length > 0);
      if (old.goals.length > 0 && withGoals.length > 0) return withGoals.some((part) => part.goals.some((goal) => oldKeys.has(JSON.stringify(goal.kind === "paid" ? { ...goal, sinceStep: 0 } : goal))));
      if (old.goals.length > 0 || withGoals.length > 0) return false;
      return partOfAct(saids, old.said) !== null;
    };
    // The part that replaces one takes over what it was still waiting to do:
    // "amend my standing order: hire ships for it" closed the order whose
    // crossing was held for want of ships, and the held crossing was lost
    // with it -- the hired ships came and nothing sent the legion over.
    const inherited = new Map<number, OrderStage[]>();
    const heirOf = (old: OrderPart): number => {
      const oldKeys = new Set(old.goals.map((goal) => JSON.stringify(goal)));
      const byGoal = recordParts.findIndex((part) => part.goals.some((goal) => oldKeys.has(JSON.stringify(goal))));
      return byGoal >= 0 ? byGoal : partOfAct(saids, old.said) ?? 0;
    };
    const superseded = world.orders.map((order) => order.actorCharacterId !== input.actorRef.id ? order : {
      ...order,
      parts: order.parts.map((part) => {
        if (part.closedAtStep !== null || !isOrderPartOpen(world, part) || !replaces(part)) return part;
        const waiting = part.stages.filter((stage) => stage.status === "waiting");
        if (waiting.length > 0) {
          const heir = heirOf(part);
          inherited.set(heir, [...(inherited.get(heir) ?? []), ...waiting]);
        }
        return { ...part, closedAtStep: world.elapsedStep, stages: part.stages.map((stage) => stage.status === "waiting" ? { ...stage, status: "failed" as const, reason: "Taken over by a later order.", failedAtStep: world.elapsedStep } : stage) };
      }),
    });
    for (const [heir, stages] of inherited) {
      const part = recordParts[heir];
      // Once: the crossing held by three orders is one crossing held (E10).
      if (part !== undefined) recordParts[heir] = { ...part, refusal: null, refusedAtStep: null, whyNot: null, stages: dedupeStages([...part.stages, ...stages]).slice(0, 6) };
    }
    // Held to its schema before it is written: a "paid" goal of nothing went
    // into the ledger unread and the saved world would not load (E2). A part
    // that will not hold is kept as what was said and what it set going.
    const keepable = (part: OrderPart): OrderPart => {
      const whole = OrderPartSchema.safeParse(part);
      if (whole.success) return part;
      skipped.push({ stage: "invariant", reason: `the order's part "${part.said.slice(0, 80)}" would not hold (${whole.error.issues[0]?.path.join(".") ?? "?"}: ${whole.error.issues[0]?.message ?? "?"}); kept without its goals and held acts` });
      return { ...part, goals: [], stages: [], note: part.note?.slice(0, 400) ?? null, refusal: part.refusal?.slice(0, 600) ?? null };
    };
    const record = { id: recordId, actorCharacterId: input.actorRef.id, text: input.orderText.trim().slice(0, 4_000), givenAtStep: world.elapsedStep, parts: recordParts.map(keepable) };
    if (!OrderRecordSchema.safeParse(record).success) {
      skipped.push({ stage: "invariant", reason: "the order would not hold to its schema and was not written to the ledger" });
      return;
    }
    // What each part's own acts spent is that part's spending (E3).
    for (const [index] of record.parts.entries()) {
      world = stampOrderMoney(world, own.filter((act) => act.part === index).map((act) => act.money), orderPartRef(recordId, index));
    }
    world = {
      ...world,
      orders: capOrders(world, [...superseded, record]),
      // Each order handed on knows the part it serves, so the work done for it
      // joins that part by the id (`creditDelegatedWork`).
      orderAttempts: world.orderAttempts.map((attempt) => {
        const index = handedTo.get(attempt.id);
        return index === undefined ? attempt : { ...attempt, servesRef: orderPartRef(recordId, index) };
      }),
    };
    const transactionParts = new Map<string, string>();
    for (const [index, part] of record.parts.entries()) for (const ref of part.workRefs) transactionParts.set(ref.id, orderPartRef(record.id, index));
    world = { ...world, material: { ...world.material, transactions: world.material.transactions.map((transaction) => {
      const owner = transactionParts.get(transaction.cause.id);
      return owner === undefined || transaction.sourceActionId != null ? transaction : { ...transaction, sourceActionId: owner };
    }) } };
    orderRecordId = record.id;
    holdEnvelopes();

    // Each of the order's facts is stamped with the part it answers, so the
    // Chronicle tells each part as its own matter (`matterKeys`) and never
    // folds the transport into the ceasefire because both name the consul.
    const partOfFact = (fact: Fact): number | null => {
      const byLocal = recordParts.findIndex((part) => part.factIds.includes(fact.id));
      if (byLocal >= 0) return byLocal;
      const named = new Set(fact.affectedEntities.map((entity) => entity.id));
      const byWork = recordParts.findIndex((part) => part.workRefs.some((ref) => named.has(ref.id)));
      if (byWork >= 0) return byWork;
      // A one-part order owns what it touched or speaks of, not everything the
      // answer wrote: the world's "his private loan has fallen due" was filed
      // under "sail Legio I to Messana" and told as the order's own report.
      const goalIds = new Set(recordParts.flatMap((part) => part.goals.flatMap((goal) => Object.values(goal).filter((value): value is string => typeof value === "string"))));
      if (recordParts.length === 1 && fact.affectedEntities.some((entity) => goalIds.has(entity.id))) return 0;
      return partOfAct(saids, fact.summary);
    };
    const stamped = new Map<string, Fact>();
    for (const fact of orderFacts) {
      const index = partOfFact(fact);
      if (index !== null) stamped.set(fact.id, { ...fact, sourceActionId: orderPartRef(record.id, index) });
    }
    newFacts.forEach((fact, at) => {
      const replaced = stamped.get(fact.id);
      if (replaced !== undefined) newFacts[at] = replaced;
    });
  };
  let orchestrationUnreadable = false;
  let orderRecordId: string | null = null;
  /** The order's own acts the engine could not read after every attempt (`BurstResult.unwritten`). */
  let unwrittenOfTheOrder: readonly string[] = [];
  /** Who became owed a turn in this burst: they have not waited a whole one yet. */
  const owedThisBurst = new Set<string>();
  /**
   * The people a round could not pay to ask, and who were wanted for
   * something of their own -- an order, a step, a letter, a vote -- kept owed
   * a turn (`WorldState.owed`). Before this they were logged as skipped and
   * forgotten, and the next thing that read the world held their silence
   * against them.
   */
  const oweTurns = (actors: readonly { readonly characterId: string }[], whyOf: (id: string) => string | undefined): void => {
    const fresh = actors.flatMap((actor) => {
      const why = whyOf(actor.characterId);
      if (why === undefined || world.owed.some((entry) => entry.characterId === actor.characterId)) return [];
      owedThisBurst.add(actor.characterId);
      return [{ characterId: actor.characterId, why: why.slice(0, 300), sinceStep: world.elapsedStep, bursts: 0 }];
    });
    if (fresh.length > 0) world = { ...world, owed: [...world.owed, ...fresh].slice(-40) };
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

  // While somebody is owed a turn from the last burst, the world's new
  // stirrings wait their place behind him: one at most (E06).
  const offered: readonly NarratorSeed[] = input.narratorSeeds !== undefined
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
  const seeds = world.owed.length > 0 && input.narratorSeeds === undefined ? offered.slice(0, 1) : offered;
  world = recordSeedsOffered(world, seeds, world.instant.day + Math.min(input.spanDays ?? budget.maxSimulatedDays, input.clock.maxSpanDays));

  // The stirrings that are arithmetic and a line of news are the engine's to
  // carry out (`engineWork`), before the orchestrator is asked anything; it
  // is shown only the ones that need somebody to decide something.
  const offeredSeeds: NarratorSeed[] = [];
  for (const seed of seeds) {
    // The months that shut passes and close roads (`isWinterMonth`).
    const month = calendarDateOf(world.instant, input.clock).month;
    const work = engineWork(seed, isWinterMonth(month));
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

  // A ruler who died at the opening of this report gives no order in it: the
  // report is his death, and the question of who follows.
  let orderFactIds: readonly string[] = [];
  let priorityCharacterIds: string[] = [];
  if (!diedAtOnce) {
    sliceText = renderWorldSlice(slice);
    report({ kind: "orchestrating" });
    const orchestration = holdForArrival(await orchestrate(input.port, slice, kindsIn(world)));
    modelCalls += orchestration.calls;
    iterations += 1;
    if (orchestration.parseFailure !== null) parseFailures.push(orchestration.parseFailure);
    orchestrationUnreadable = orchestration.parseFailure !== null;
    salvaged.push(...orchestration.salvaged);
    const factsBefore = newFacts.length;
    const attemptsBefore = new Set(world.orderAttempts.map((attempt) => attempt.id));
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
      // An order the engine tried and could not read is not a pursuit: it is a
      // part that came to nothing, and the ledger says so (`recordOrder`). A
      // pursuit is only what somebody said he was doing and wrote no act for.
      acts.carriedOut === 0 && acts.refused === 0
      // Nor is an order whose every part the answer said could not be done:
      // "storm the breach; nobody holds it" is told, not pursued.
      && !(orchestration.output.intent.parts.length > 0 && orchestration.output.intent.parts.every((part) => (part.whyNot ?? "").trim() !== ""))
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
    } else if (input.actorRef.kind === "character" && acts.carriedOut > 0) {
      // What he said he was doing lapses once he has gone on to real things:
      // "keep the siege of Syracuse tight" stood in his standing business for
      // thirty turns after the city opened its gates. His own, now that he
      // has given a new order that did something; his power's, once they are
      // two months old -- all of them, not one a burst (E6). One that a rule
      // the world wrote is running is business going on, and stands.
      const actorId = input.actorRef.id;
      const stale = world.genericEntities.filter((entity) => entity.kind === "pursuit" && entity.mechanic === undefined && !("retiredAtStep" in entity.attributes)
        && ((entity.ownerRef?.kind === "character" && entity.ownerRef.id === actorId)
          || (entity.ownerRef?.kind === "polity" && entity.ownerRef.id === input.actorPolityId && typeof entity.attributes.sinceDay === "number" && world.instant.day - entity.attributes.sinceDay > PURSUIT_LAPSES_DAYS)));
      if (stale.length > 0) {
        const lapsed: WorldDelta[] = stale.map((entity) => ({ op: "generic_entity_update", entityRef: entity.id, attributes: {}, retire: true, reason: "Overtaken by what he has since done." }));
        const retired = applyDeltas(world, lapsed, {
          now: world.instant, actorRef: input.actorRef, offices: input.offices, warfare: input.warfare, ids, gameId: input.gameId,
          // The world's housekeeping, not an act of his.
          actsForTheWorld: true, orderDeltas: new Set(),
        });
        if (retired.applied.length > 0) world = retired.world;
      }
    }
    answerTheOrder(newFacts.slice(factsBefore), acts);
    // Only the parts that are the order's: the world's business the
    // orchestrator wrote as parts of it -- "Give the Umbrians their own
    // ruler" -- is refiled, as its acts already were (E7).
    const sorted = theOrdersOwnParts(orchestration.output.intent.parts, {
      orderText: input.orderText ?? "",
      deltas: orchestration.output.deltas,
      misfiled: acts.misfiledIndexes ?? new Set(),
      worldBusiness: [...offeredSeeds.flatMap((seed) => [seed.brief, seed.why]), ...dueNow.map((event) => event.summary)],
      emptyPowers: slice.populationGaps.map((gap) => gap.name),
    });
    for (const { part, why } of sorted.refiled) {
      audit.push({ actorRef: input.actorRef, op: "order_part", kind: "refiled", ofTheOrder: false, attempt: "first", reason: `Refiled part "${part.said}": ${why}.`, delta: { op: "order_part", said: part.said, acts: part.acts } });
    }
    const delegations = orchestration.output.delegations.map((delegation) => delegation.part === null || delegation.part === undefined ? delegation : { ...delegation, part: sorted.index.get(delegation.part) ?? null });
    unwrittenOfTheOrder = acts.unwritten ?? [];
    answerTheParts(sorted.kept, acts);
    checkpoint("the order ledger", () => recordOrder(sorted.kept, orchestration.output.intent.summary, acts, attemptsBefore, newFacts.slice(factsBefore), delegations));
    if (orderRecordId !== null && !world.orders.some((order) => order.id === orderRecordId)) orderRecordId = null;
    orderFactIds = newFacts.slice(factsBefore).map((fact) => fact.id);
    windowOrderFactIds = orderFactIds;
    if (orchestration.output.playerDecision !== null) playerDecision = orchestration.output.playerDecision;

    // Who the stirrings landed on decides who is asked first what they do about
    // it. The ledger was written when they were offered: a batch is not
    // re-offered, so there is nothing further to record here.
    priorityCharacterIds = offeredSeeds
      .filter((seed) => seedWasTaken(world, newFacts.slice(factsBefore), seed))
      .flatMap((seed) => seedParticipants(world, seed))
      .filter((id) => input.actorRef.kind !== "character" || id !== input.actorRef.id);

    // An open-ended order says what would end it. The world then carries on until
    // that happens rather than until this burst runs out of things to do.
    watch = orchestration.output.watch;
  }
  // Left surrounded by the order's own battle: the report ends on it, whatever
  // else the world meant to ask.
  const plightNow = playerPlight(world, playerId);
  if (plightNow !== undefined) playerDecision = fieldDecision(world, plightNow);
  else if (playerDecision === null) playerDecision = engagementDecision(world, playerId, input.warfare) ?? siegeDecision(world, playerId) ?? null;

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

  // The powers' own business, by rule, once a month (`statecraft.ts`): wars,
  // risings, raids, alliances, levies, armies on campaign, and letters to
  // powers nobody is playing. Applied as the world's business, at the first
  // depth, so what it does is news its neighbours answer.
  // What the rules read, now: the cast is the model's, and so is whoever has
  // been asked this burst; the player's own power is never the rules' to move.
  const statecraftInput = (): StatecraftInput => {
    const playerPolityId = input.actorPolityId ?? null;
    const reader = readDepartments(world);
    return {
      world,
      gameId: input.gameId,
      excludedPolityIds: new Set<string>([
        ...(playerPolityId === null ? [] : [playerPolityId]),
        ...world.map.polities.filter((polity) => reader.rulers(polity.id).some((ruler) => ruler.id === playerId)).map((polity) => polity.id),
      ]),
      playedByModel: new Set([...answeredBy.keys(), ...world.cast.members.map((member) => member.characterId)]),
      playerCharacterId: playerId,
      nearPlayer: powersNearThePlayer(world, playerId),
      pressures: input.historicalPressures ?? [],
      warfare: input.warfare,
      appetiteAgainstPlayer: difficultyRules(world.difficulty).appetiteAgainstPlayer,
    };
  };

  // The standing cast, reviewed once a burst (`cast.ts`); each member is
  // asked once, with what the rules would weigh for him.
  world = reviewCast(world, playerId, budget.castSize ?? CAST_SIZE_DEFAULT);
  const castAsked = new Set<string>();
  const castToAsk = (): Map<string, { why: string; dossier?: string }> => new Map(world.cast.members
    .filter((member) => !castAsked.has(member.characterId))
    .map((member) => {
      const dossier = castDossier(world, member.characterId, rulerOptions(statecraftInput(), member.characterId));
      return [member.characterId, { why: member.why, ...(dossier === undefined ? {} : { dossier }) }] as const;
    }));

  const runStatecraft = async (): Promise<void> => {
    // The first pass a month in, not on the opening morning: the first weeks are the player's.
    const last = world.statecraft.lastRunDay ?? 0;
    if (world.instant.day - last < STATECRAFT_EVERY_DAYS) return;
    // The world's fear of whoever grows too fast, first: it is what the
    // month's choices are made in the light of (`pushback.ts`).
    const pushed = reviewPushback(world, input.actorPolityId ?? null, statecraftInput().excludedPolityIds);
    world = pushed.world;
    if (pushed.facts.length > 0) {
      // News of fear near us is news; fear among far powers is their own.
      const near = powersDealtWith(world, playerId);
      for (const draft of pushed.facts) {
        const ours = near === null || (draft.affectedRefs ?? []).some((ref) => ref.kind === "polity" && near.has(ref.id));
        const materialized = materializeFacts({ proposals: [draft], now: world.instant, atStep: world.elapsedStep, ids, causalDepth: ours ? 0 : budget.maxCausalDepth, assignedIds: new Map() });
        newFacts.push(...materialized.facts);
        for (const [factId, weight] of materialized.significanceByFactId) significanceByFactId.set(factId, weight);
      }
    }
    // Whoever killed his ruler last month sits on the throne now (`villainy.ts`).
    const usurped = usurpations(world, playerId);
    const seized = seizeThrones(usurped.world, playerId, statecraftInput().playedByModel);
    world = seized.world;
    const thrones = [...usurped.facts, ...seized.facts];
    if (thrones.length > 0) {
      const materialized = materializeFacts({ proposals: thrones, now: world.instant, atStep: world.elapsedStep, ids, causalDepth: 0, assignedIds: new Map() });
      newFacts.push(...materialized.facts);
      for (const [factId, weight] of materialized.significanceByFactId) significanceByFactId.set(factId, weight);
    }
    const villainy = decideVillainy({ world, gameId: input.gameId, playerCharacterId: playerId, playedByModel: statecraftInput().playedByModel });
    const decisions = [...pushed.decisions, ...villainy, ...decideStatecraft(statecraftInput())];
    const entries: StatecraftEntry[] = [];
    // Far powers are the rules' to answer, next month; only what touches a
    // power our government deals with is news anybody is asked about now.
    // Without this a war between Macedon and Epirus woke both kings for the
    // model, inside the order's own budget.
    const dealtWith = powersDealtWith(world, playerId);
    const relations = newsRelations(world, playerId);
    for (const decision of decisions) {
      const before = newFacts.length;
      const touchesUs = dealtWith === null || dealtWith.has(decision.polityId) || (decision.targetPolityId !== null && dealtWith.has(decision.targetPolityId));
      // The engine's own writing: nothing it refuses is worth a model call (L17).
      const acts = await applyProposal(
        { ...ProposalSchema.parse({ narrativeSummary: decision.why.slice(0, 240) || "The world moves.", facts: [...decision.facts] }), worldDeltas: decision.deltas },
        { kind: "character", id: decision.actorCharacterId },
        touchesUs ? 0 : budget.maxCausalDepth,
        true,
        [],
        { calls: "none", factFloor: farBusinessFloor(relations, [decision.polityId, decision.targetPolityId]) },
      );
      stampWorkFacts(before);
      if (acts.changed > 0) entries.push(ledgerEntry(decision, world.instant.day));
    }
    world = { ...world, statecraft: { lastRunDay: world.instant.day, log: [...world.statecraft.log, ...entries].slice(-STATECRAFT_LOG_MAX) } };
  };
  const authorOf = new Map<string, string>();
  let lastAskedDay: number | null = null;
  let factsSeenByLastRound = 0;
  let lastRoundKey = 0;
  let hops = 0;
  // Rounds in a row that were paid for and changed nothing in the world. Two of
  // them mean the reactions have run dry, however much depth and budget remain:
  // only whoever a plan or a letter still wants is asked until news starts a
  // new chain.
  let idleRounds = 0;

  while (playerDecision === null) {
    const elapsedDays = world.instant.day - startDay;
    if (elapsedDays >= maxDays) {
      stopReason = "max_span";
      break;
    }
    // Told from outside that the burst has run too long. Stopped between
    // hops, where the world is whole: everything so far is kept and
    // chronicled, and the rest of the span is the next order's.
    if (input.shouldStop?.() === true) {
      stopReason = "deadline";
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
    // Word reaches each of them on its own day (`newsArrivalsAt`): the day it
    // was fought is not the day Carthage hears of it.
    const seats = seatsOfThoseWhoAnswer(world, input.actorRef);
    const arrivals = [...input.knownFacts, ...newFacts.filter((fact) => fact.causalDepth < budget.maxCausalDepth)]
      .flatMap((fact) => (fact.discovery.knowableAtInstant === null || fact.time.day + MAX_NEWS_DAYS < world.instant.day ? [] : newsArrivalsAt(world, fact, seats)));
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
    // A reply date caps a jump but never lengthens the walk: it is the day the
    // tick decides silence, and a jump from 20 May to a project in mid-July
    // had every letter due in June refused by silence in one step.
    const replyDueKey = nextReplyDueKey(world, nowKey()) ?? Number.MAX_SAFE_INTEGER;
    // A letter its reader has still to be shown, or has read past its term,
    // is settled within days, not at the next thing on the calendar -- while
    // there is still a call to pay him with.
    const readerKey = modelCalls < callCap && aLetterWaitsOnItsReader(world, input.actorRef.kind === "character" ? [input.actorRef.id] : [], input.actorPolityId)
      ? reactionKey
      : Number.MAX_SAFE_INTEGER;
    const targetKey = Math.min(hops === 1 ? reactionKey : nextScheduled ?? idle, replyDueKey, readerKey, ceilingKey);

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
    await runStatecraft();

    const playerCharacterIds = input.actorRef.kind === "character" ? [input.actorRef.id] : [];
    if (lastAskedDay !== null && causalDepth > 1 && world.instant.day - lastAskedDay >= budget.newChainAfterDays) {
      chain += 1;
      causalDepth = 1;
      ambientOnlyRounds = 0;
      idleRounds = 0;
      chainStartIterations = iterations;
      chainNewsFrom = factsSeenByLastRound;
      chainNewsAfterKey = lastRoundKey;
    }
    // News to this chain if word of it reached any of those who answer since
    // the chain's last look -- by the road, not the day it happened.
    const answeringSeats = seatsOfThoseWhoAnswer(world, input.actorRef);
    const arrivedSince = (fact: Fact): boolean => {
      if (fact.discovery.knowableAtInstant === null) return false;
      return newsArrivalsAt(world, fact, answeringSeats).some((key) => key > chainNewsAfterKey && key <= nowKey());
    };
    // Old news arriving now is news to this chain, at its first depth; old
    // news long since answered is not news at all.
    // Two other powers writing plainly to each other, and answering, is the
    // world's background: it is on the record and in the Chronicle, but it does
    // not wake the reader for another letter (`isBackgroundLetter`). Only what
    // this burst wrote is weighed: older facts have no weight to read here.
    const backgroundChatter = (fact: Fact): boolean => {
      if (input.actorPolityId === null || (fact.kind !== "letter_sent" && fact.kind !== "letter_answered")) return false;
      const weight = significanceByFactId.get(fact.id);
      if (weight === undefined || weight > (fact.kind === "letter_sent" ? 8 : 15)) return false;
      return !fact.affectedEntities.some((entity) => entity.kind === "polity" && entity.id === input.actorPolityId);
    };
    const reactTo = [
      ...[...input.knownFacts, ...newFacts.slice(0, chainNewsFrom)].filter(arrivedSince).map((fact) => ({ ...fact, causalDepth: 0 })),
      ...newFacts.slice(chainNewsFrom),
    ].filter((fact) => !backgroundChatter(fact));
    // Whoever holds an order of the player's: asked first wherever the
    // player's people compete for a place (L17), and the only ones asked once
    // the last calls are kept for the order (`ORDER_RESERVE_CALLS`).
    const orderPeople = new Set(world.orderAttempts
      .filter((attempt) => attempt.issuerRef.id === input.actorRef.id && ["issued", "received", "delayed", "accepted"].includes(attempt.status))
      .map((attempt) => attempt.recipientRef.id));
    const attention = routeAttention({
      world,
      facts: reactTo,
      offices: input.offices,
      excludeCharacterIds: playerCharacterIds,
      maxFocused: budget.maxFocusedActors,
      maxCausalDepth: budget.maxCausalDepth,
      alreadyAnswered: answeredBy,
      authorOf,
      ownPolityId: input.actorPolityId,
      firstCharacterIds: orderPeople,
    });

    // Actors who care but do not warrant a model call still record what they
    // mean to do about it, so their intent is visible to the next burst.
    world = recordActiveIntents(world, attention.active, attention.focused, ids);

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
    // question about to be voted, or a letter he has not yet read. Each wakes
    // a man as pressing, once a round; a man owed two is told both.
    const wanted = new Map<string, string>([
      ...debatersOf(world, input.offices, world.instant.day, playerCharacterIds, input.successionRules ?? []),
      ...due.map((entry) => [entry.ownerId, entry.why] as const),
    ]);
    for (const [readerId, why] of lettersOwed(world, input.clock, playerCharacterIds, input.actorPolityId)) {
      const already = wanted.get(readerId);
      wanted.set(readerId, already === undefined ? why : `${already}; and ${why}`);
    }
    // Owed a turn from before: asked first, as pressing (E06).
    for (const entry of world.owed) {
      if (playerCharacterIds.includes(entry.characterId)) continue;
      const already = wanted.get(entry.characterId);
      wanted.set(entry.characterId, already === undefined ? entry.why : `${already}; and ${entry.why}`);
    }
    // A man holding an order that is now allowed, or waited on, and has done
    // nothing with it: the Senate voted Coruncanius the transport money and
    // nobody asked him again (E02).
    for (const attempt of world.orderAttempts) {
      if (attempt.status !== "accepted" || attempt.servesRef === null || playerCharacterIds.includes(attempt.recipientRef.id)) continue;
      const found = findOrderPart(world, attempt.servesRef);
      if (found === null || found.part.closedAtStep !== null) continue;
      const status = orderPartStatus(world, found.part, { without: { kind: "order_attempt", id: attempt.id } });
      if (status !== "authorized" && status !== "unanswered") continue;
      const why = `the order he took on -- "${attempt.instruction.slice(0, 120)}" -- ${status === "authorized" ? "is allowed now, and nothing is being done with it" : "has had nothing done for it"}`;
      const already = wanted.get(attempt.recipientRef.id);
      wanted.set(attempt.recipientRef.id, already === undefined ? why : `${already}; and ${why}`);
    }
    const castThisRound = castToAsk();
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
      castMembers: castThisRound,
      ownPolityId: input.actorPolityId,
    });

    // Where the antagonist stands is the world's to know and his to act on, so
    // it is said in his own section and nowhere else. Nothing tells him what he
    // is; he is told what his situation is, which is what anybody knows.
    const note = antagonistNote();
    // A man a plan wants who is also answering news is told both: the router
    // that woke him for the news knows nothing of his plan, and without this
    // the step came due while he was being asked about something else.
    const dueWhy = wanted;
    // A cast member woken by news is still a cast member: he is handed his
    // dossier the first time he is asked this burst, however he was woken.
    const cast = [...attention.focused, ...ambient].map((reached) => {
      const member = castThisRound.get(reached.characterId);
      const actor = member === undefined || reached.note !== undefined ? reached
        : { ...reached, why: `${reached.why}; and he is one of the people who matter now (${member.why})`, ...(member.dossier === undefined ? {} : { note: member.dossier }) };
      const planned = actor.impetus === "own_business" ? undefined : dueWhy.get(actor.characterId);
      const told = planned === undefined ? actor : { ...actor, why: `${actor.why}; and ${planned}` };
      return nemesis !== undefined && told.characterId === nemesis.characterId && note !== undefined ? { ...told, note: told.note === undefined ? note : `${note}\n${told.note}` } : told;
    });
    // Reactions to reactions stop at a depth; a man's own plan is not a
    // reaction. Past that depth the burst used to walk the rest of its span
    // asking nobody, so a month let pass spent its three rounds in the first
    // nine days, and four steps went by their day with their owners never
    // asked -- found by playing it by hand. Now whoever a plan wants is still
    // asked, alone with the others it wants: each step wakes him once, and the
    // call budget still bounds the whole.
    const reactionsSpent = causalDepth > budget.maxCausalDepth || idleRounds >= 2;
    const castNow = reactionsSpent ? cast.filter((actor) => dueWhy.has(actor.characterId)) : cast;
    // The last few calls are the order's: once the world's own business has
    // spent all but `ORDER_RESERVE_CALLS`, only the people the player's order
    // is waiting on are asked. A burst once ran out answering senators on the
    // Anio waterworks while the man handed the transport was never asked (R80).
    const reserved = modelCalls >= callCap - ORDER_RESERVE_CALLS && orderPeople.size > 0;
    // Nobody is asked again with nothing new to answer (`hasSomethingNew`):
    // the rotation, put before the model two days after its last look, said
    // nothing had changed, at a call a time (L17).
    const owesAnAnswer = new Set(world.orderAttempts.filter((attempt) => attempt.status === "issued" || attempt.status === "received").map((attempt) => attempt.recipientRef.id));
    const fresh = playersPeopleFirst(castNow.filter((actor) => hasSomethingNew(actor, answeredBy.get(actor.characterId), dueWhy, owesAnAnswer)), orderPeople);
    if (fresh.length < castNow.length) {
      skipped.push({ stage: "cognition", reason: `hop ${hops} on ${today()}: ${castNow.length - fresh.length} with nothing new since they last answered left unasked (${castNow.filter((actor) => !fresh.includes(actor)).map((actor) => actor.name).join(", ").slice(0, 160)})` });
    }
    const asking = reserved ? fresh.filter((actor) => orderPeople.has(actor.characterId)) : fresh;
    if (reserved && asking.length < fresh.length) {
      skipped.push({ stage: "cognition", reason: `hop ${hops} on ${today()}: the last calls are kept for the order; ${fresh.length - asking.length} others left unasked` });
      oweTurns(fresh.filter((actor) => !asking.includes(actor)), (id) => dueWhy.get(id));
    }
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
      const spent = modelCalls >= callCap || (!reactionsSpent && iterations - chainStartIterations >= budget.maxIterations);
      // The order's own consequences stop the burst when they cannot be paid
      // for, and so does anything in a burst the player gave no span: he gets
      // the wheel back rather than a world that went quiet. A span he asked
      // for is his to have, so there a later chain is skipped instead.
      if (spent && !reactionsSpent && (chain === 1 || input.spanDays === undefined)) {
        skipped.push({ stage: "cognition", reason: `hop ${hops} on ${today()}: chain ${chain}, the budget is spent and the burst stops; ${asking.length} left unasked` });
        oweTurns(asking, (id) => dueWhy.get(id) ?? (orderPeople.has(id) ? "an order of the ruler's he holds" : undefined));
        stopReason = "budget_exhausted";
        break;
      }
    }
    // The world's later business, and a plan's, are not the order's: a round
    // of them the budget cannot pay for is skipped, and the span carries on.
    // And a chain may not spend what the weeks still to come need: each later
    // chain the span has room for keeps a round's calls back, unless the
    // round is the player's own people (L17). The order's first chain once
    // spent a month's budget in its first three days.
    const keptForLater = input.spanDays === undefined || asking.some((actor) => orderPeople.has(actor.characterId)) ? 0
      : Math.min(Math.floor(callCap / 2), LATER_CHAIN_CALLS * Math.floor(Math.max(0, startDay + maxDays - world.instant.day) / budget.newChainAfterDays));
    const canPay = modelCalls < callCap - keptForLater && (reactionsSpent || iterations - chainStartIterations < budget.maxIterations);
    if (wantsAnswering && !canPay) {
      asked = false;
      skipped.push({ stage: "cognition", reason: modelCalls < callCap && modelCalls >= callCap - keptForLater
        ? `hop ${hops} on ${today()}: chain ${chain}, ${keptForLater} call(s) are kept for the weeks to come; ${asking.length} left unasked`
        : `hop ${hops} on ${today()}: chain ${chain}, the call budget is spent; ${asking.length} left unasked` });
      oweTurns(asking, (id) => dueWhy.get(id) ?? (orderPeople.has(id) ? "an order of the ruler's he holds" : undefined));
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
      for (const id of castIds) castAsked.add(id);
      // What each of them is being shown now is theirs to have answered.
      for (const actor of asking) {
        const seen = answeredBy.get(actor.characterId) ?? new Set<string>();
        for (const fact of actor.knownFacts) seen.add(fact.id);
        answeredBy.set(actor.characterId, seen);
      }
      if (world.owed.some((entry) => castIds.has(entry.characterId))) world = { ...world, owed: world.owed.filter((entry) => !castIds.has(entry.characterId)) };
      const woken = due.filter((entry) => castIds.has(entry.ownerId));
      world = markWoken(world, woken);
      world = markLettersPut(world, castIds);
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
      let roundChanged = 0;
      // What the round's people leave to correct is corrected once, for all of
      // them, after the last has answered; the world elsewhere riding along
      // is not worth a call (`round-corrections.ts`).
      const owedCorrection: { correction: RoundCorrection; idle: boolean }[] = [];
      const ridingAlong = new Set(asking.filter((actor) => actor.impetus === "own_business" && !orderPeople.has(actor.characterId)).map((actor) => actor.characterId));
      for (const actor of cognition.output.actors) {
        const factsBeforeActor = newFacts.length;
        const pays: CorrectionCalls = actor.actorRef.kind === "character" && castIds.has(actor.actorRef.id) && !ridingAlong.has(actor.actorRef.id) ? "round" : "none";
        const acts = await applyProposal(actor.proposal, actor.actorRef, causalDepth, false, actor.serves, { calls: pays });
        if (acts.correction !== undefined && (acts.correction.repairable.length > 0 || acts.correction.naming.length > 0)) owedCorrection.push({ correction: acts.correction, idle: acts.changed === 0 });
        stampWorkFacts(factsBeforeActor);
        roundChanged += acts.changed + (newFacts.length - factsBeforeActor);
        // Said and not done: kept, and weighed as what it was.
        if (acts.changed === 0) {
          for (const fact of newFacts.slice(factsBeforeActor)) {
            significanceByFactId.set(fact.id, Math.min(significanceByFactId.get(fact.id) ?? IDLE_FACT_WEIGHT, IDLE_FACT_WEIGHT));
          }
        }
        // A plan is laid, and a step taken, only by a person who was asked --
        // never by the player, who is in no cast, and never by somebody the
        // answer merely named. Steps first: they name the plan as it stood.
        if (actor.actorRef.kind !== "character" || !castIds.has(actor.actorRef.id)) continue;
        const ownerId = actor.actorRef.id;
        for (const fact of newFacts.slice(factsBeforeActor)) authorOf.set(fact.id, ownerId);
        // A step is done when an act written for it changed the world, not
        // when a sentence was written, nor when something else did: "reviewed
        // the legion's readiness" satisfied any step there was, and Decius
        // reviewed it for four months while Rome and Rhegium stood at war --
        // and an answer that changed anything at all used to take whichever
        // step it named (E11).
        const leftAMark = acts.changed > 0;
        const served = servedByChange(actor.serves, acts.changedIndexes);
        const stepped = takeSteps(world, ownerId, served);
        const took = { taken: checkpoint("taking plan steps", () => { world = claimPromisesKept(stepped.world, ownerId, served); }) ? stepped.taken : 0 };
        plans.taken += took.taken;
        let laid = false;
        if (actor.plan !== null) {
          const planned = layPlan(world, ownerId, actor.plan, ids, acts.assignedIds);
          laid = checkpoint("laying a plan", () => { world = planned.world; }) && planned.ambitionId !== null;
          if (laid) plans.laid += 1;
        }
        if (leftAMark) {
          plans.acted += 1;
          if (laid || took.taken > 0) plans.actedOnAPlan += 1;
        }
      }
      if (owedCorrection.length > 0) roundChanged += await settleTheRound(owedCorrection);
      idleRounds = roundChanged === 0 ? idleRounds + 1 : 0;
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
  // Whoever is still owed a turn at the end has waited one burst more; after
  // `MAX_OWED_BURSTS` the world stops waiting for him.
  world = {
    ...world,
    owed: world.owed
      .map((entry) => (owedThisBurst.has(entry.characterId) ? entry : { ...entry, bursts: entry.bursts + 1 }))
      .filter((entry) => entry.bursts < MAX_OWED_BURSTS),
  };
  // Never a world that will not load: the burst used to hand back whatever it
  // had, and the caller saved it (E1). What the guards above did not catch is
  // caught here, and the last world that held is what is kept.
  const unsound = whyItWillNotLoad(world);
  if (unsound !== null) {
    skipped.push({ stage: "invariant", reason: `the burst ended on a world that would not load (${unsound}); the last world that held, of day ${lastSound.instant.day}, was kept` });
    parseFailures.push(`the world this report ended on would not load (${unsound}), and the last one that held was kept`);
    world = lastSound;
    if (orderRecordId !== null && !world.orders.some((order) => order.id === orderRecordId)) orderRecordId = null;
  }
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
    orderRecordId,
    unwritten: unwrittenOfTheOrder,
    narrative,
    frictions,
    utterances,
    battleAccounts,
    breaches,
    playerDecision,
    parseFailures,
    salvaged,
    skipped: placesDropped <= FACT_PLACES_TOLD ? skipped : [...skipped, { stage: "fact_places", reason: `and ${placesDropped - FACT_PLACES_TOLD} more fact(s) named a place none of their armies stands at or is bound for` }],
    audit,
    plans,
    chainRounds,
    planRounds,
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
      // An order a man hands on for an order he holds serves what that one
      // serves: the legate who tells a shipmaster to find hulls is still
      // carrying the consul's transport.
      const held = world.orderAttempts.filter((attempt) => attempt.recipientRef.id === issuerRef.id && attempt.status === "accepted" && attempt.servesRef !== null);
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
        servesRef: held.length === 1 ? held[0]!.servesRef : null,
      };
    });
  return { ...world, orderAttempts: [...world.orderAttempts, ...attempts] };
}

/**
 * Where the people who answer events stand: every living man in an office or
 * at the head of an army, the player aside. The calendar stops when word
 * reaches one of these places, since that is when somebody can be asked.
 */
function seatsOfThoseWhoAnswer(world: WorldState, actorRef: OrderPartyRef): Set<string> {
  const player = actorRef.kind === "character" ? actorRef.id : null;
  const commanders = new Set(world.material.forces.map((force) => force.commanderCharacterId));
  const seats = new Set<string>();
  for (const character of world.characters) {
    if (!character.alive || character.id === player) continue;
    if (character.officeId !== null || commanders.has(character.id)) seats.add(character.locationProvinceId);
  }
  return seats;
}

/** What the tick says of a work on its own day; a scheduled copy of it is an echo. */
const TICK_REPORTS: ReadonlySet<string> = new Set(["project_milestone", "project_completed", "project_shortfall"]);
const SETTLED_PROJECTS: ReadonlySet<string> = new Set(["completed", "cancelled", "failed"]);
const SETTLED_STAGES: ReadonlySet<string> = new Set(["resolved", "withdrawn"]);

/** Whether a scheduled event is still news when its moment comes. */
export function stillStands(world: WorldState, event: { readonly kind: string; readonly payload?: unknown }): boolean {
  const payload = ScheduledEventPayloadSchema.safeParse(event.payload ?? {});
  const subjects = payload.success ? payload.data.subjectIds : [];
  // A work's stages and its end are the tick's to report, from the work itself
  // (`tick.ts`), so they happen when the work does and not when somebody once
  // guessed it would -- and never for a work that was cancelled.
  if (TICK_REPORTS.has(event.kind)) return false;
  const projects = subjects.flatMap((id) => world.projects.filter((project) => project.id === id));
  if (projects.some((project) => SETTLED_PROJECTS.has(project.status))) return false;
  const procedures = subjects.flatMap((id) => world.material.politicalProcedures.filter((procedure) => procedure.id === id));
  if (procedures.some((procedure) => SETTLED_STAGES.has(procedure.stage))) return false;
  return true;
}
