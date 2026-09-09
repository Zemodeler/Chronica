import { z } from "zod";
import { InterpretPlanSchema, ExecutePlanStageSchema, RespondToAssignmentSchema, DeferPlanStageSchema, preparePlayerPlans, interpretPlan, planSpending, type PlayerPlan } from "../actions/plans";
import type { OrderDirective } from "../actions/orders";
import type { WorldState } from "../world/world-state";
import type { ProposedInvocation } from "../actions/orders";
import { WORKFLOW_REGISTRY } from "../workflows/registry";
import { executeWorkflow } from "../workflows/executor";
import { validateCandidate, createInvocationDuplicateGuard, type PolicyViolation } from "../workflows/policy";
import { InventedWorkflowDefinitionSchema, applyInventedWorkflow, validateInventedWorkflowDefinition, type InventedWorkflowDefinition } from "../workflows/invented-workflow";
import type { WorkflowAuditEntry, WorkflowCandidate } from "../workflows/manager-types";
import { READ_TOOL_BY_NAME, type PrivateInformationPolicy, type ReadToolContext } from "./read-tools";
import type { ScenarioLifeRules } from "../characters/family";
import { deriveWorldInstant, type ScenarioClock } from "../world/clock";
import {
  CapabilityRequestSchema,
  recordCapabilityRequest,
  type CapabilityRequest,
  type RecordedCapabilityRequest,
} from "./capability-request";
import { GameMasterTurnReportSchema, type GameMasterTurnReport } from "./turn-report";
import { applySocialEvents } from "../characters/apply-social-events";
import type { CharacterSocialEvent } from "../characters/social-events";
import {
  FINISH_TURN_TOOL,
  REQUEST_CAPABILITY_TOOL,
  DEFINE_ACTION_TOOL,
  INVOKE_DEFINED_ACTION_TOOL,
  RECORD_REFUSAL_AFTERMATH_TOOL,
  RefusalAftermathToolArguments,
  RECORD_ENTITY_NOTE_TOOL,
  RecordEntityNoteToolArguments,
  FLAG_NPC_INITIATED_DIALOGUE_TOOL,
  FlagNpcInitiatedDialogueArguments,
  FLAG_AMBIENT_EVENT_TOOL,
  FlagAmbientEventArguments,
  buildGameMasterTools,
  type GameMasterToolDefinition,
} from "./tools";
import { appendEntityNote, type EntityNote } from "./campaign-memory";
import { diffWorldState, type EntityStateDelta } from "./world-diff";
import { executeWorldTool, executeWorldReadTool } from "../world-tools/executor";
import { ALL_WORLD_TOOLS, ALL_WORLD_READ_TOOLS, buildWorldToolCatalog } from "../world-tools/catalog";
import type { AuthorityIndex } from "../authority/authority-grant";
import { actorIdForPrincipal, canActAsPrincipal, type Principal } from "../authority/principal";
import type { Fact } from "../world/facts";

const WORLD_TOOL_BY_NAME = new Map(ALL_WORLD_TOOLS.map((tool) => [tool.id, tool]));
const WORLD_READ_TOOL_BY_NAME = new Map(ALL_WORLD_READ_TOOLS.map((tool) => [tool.id, tool]));

// The staged tool loop (GM refactor, requirements 3, 4, 9).
//
// Every tool the Game Master calls runs here, against a world held only in
// memory. Nothing in this module can touch a database, and nothing the model
// says outside a tool call has any effect. The committed snapshot is replaced
// only after `finish` succeeds and the caller chooses to commit the staged
// world -- so a turn that fails halfway leaves the committed world untouched
// and the staged one discarded.
//
// A failed tool call never corrupts the stage: the staged world is reassigned
// only on a successful, schema-validated execution, and an `apply` that throws
// is caught and reported as a failure like any other.

/** One factual thing that happened this turn. The only thing the Chronicle may narrate. */
export interface FactualEvent {
  /** Stable within a turn; the report's `factRefs` point at these. */
  readonly id: string;
  readonly atStep: number;
  readonly kind: "action" | "capability_gap";
  readonly actionId: string;
  readonly actorId: string;
  readonly parameters: Record<string, unknown>;
  /** The executor's own summary, or the exact limitation text for a capability gap. */
  readonly summary: string;
  /** True only for an applied mutation. A capability gap is always false. */
  readonly materialConsequence: boolean;
  /**
   * The call was valid and applied, but the world it produced is identical to
   * the one it received. Kept in the audit trail, never narrated: a Chronicle
   * that reports "X is renamed to X" is reporting an event that did not occur.
   */
  readonly noOp?: boolean;
  /**
   * Present only on a `resolve_battle` event. Computed here, between the
   * staged world before and after the deterministic resolver ran, because
   * this is the only point at which both are in hand.
   */
  readonly battleBrief?: BattleBrief;
  /**
   * Every tracked entity's change from this one call, found generically by
   * `diffWorldState` comparing the staged world immediately before and after
   * -- never by inspecting which action ran. A call that touches nothing the
   * registry tracks yields an empty array, not an error; those still narrate
   * from `summary` alone.
   */
  readonly stateDeltas?: readonly EntityStateDelta[];
}

/** Structured, deterministic facts about one resolved battle, for the Chronicle. */
export interface BattleBrief {
  readonly provinceName: string;
  readonly outcome: "attacker_victory" | "defender_victory" | "inconclusive";
  readonly attackerName: string;
  readonly defenderName: string;
  readonly attackerCommanderName: string | null;
  readonly defenderCommanderName: string | null;
  readonly attackerCasualties: number;
  readonly defenderCasualties: number;
  readonly retreated: readonly string[];
}

/**
 * Read one battle's outcome out of the difference the resolver made.
 *
 * Derived rather than reported: casualties are the fit personnel the forces
 * lost, and a retreat is a force that is no longer where it stood. Nothing
 * here is an interpretation a model could disagree with.
 */
function deriveBattleBrief(before: WorldState, after: WorldState, battleId: string): BattleBrief | null {
  const battle = before.conflicts.battles.find((candidate) => candidate.battleId === battleId);
  if (!battle) return null;
  const attackerIds = battle.attackerForceIds;
  const defenderIds = battle.participantForceIds.filter((id) => !attackerIds.includes(id));
  const leadAttacker = before.material.forces.find((force) => force.id === attackerIds[0]);
  const leadDefender = before.material.forces.find((force) => force.id === defenderIds[0]);
  if (!leadAttacker || !leadDefender) return null;

  const fitOf = (world: WorldState, forceId: string): number | null => {
    const force = world.material.forces.find((candidate) => candidate.id === forceId);
    return force ? force.personnel.reduce((sum, category) => sum + category.fit, 0) : null;
  };
  const sideCasualties = (forceIds: readonly string[]): number =>
    forceIds.reduce((sum, id) => {
      const start = fitOf(before, id);
      const end = fitOf(after, id);
      return sum + (start === null ? 0 : Math.max(0, start - (end ?? start)));
    }, 0);
  const sideRetreated = (forceIds: readonly string[]): boolean =>
    forceIds.some((id) => {
      const start = before.material.forces.find((force) => force.id === id);
      const end = after.material.forces.find((force) => force.id === id);
      return start !== undefined && end !== undefined && start.locationId !== end.locationId;
    });

  const attackerRetreated = sideRetreated(attackerIds);
  const defenderRetreated = sideRetreated(defenderIds);
  const nameOf = (id: string | null) => (id === null ? null : after.characters.find((character) => character.id === id)?.name ?? null);
  const attackerName = attackerIds.length > 1 ? `${leadAttacker.name} and allies` : leadAttacker.name;
  const defenderName = defenderIds.length > 1 ? `${leadDefender.name} and allies` : leadDefender.name;

  return {
    provinceName: after.map.provinces.find((province) => province.id === leadDefender.locationId)?.name ?? "the frontier",
    outcome:
      defenderRetreated && !attackerRetreated ? "attacker_victory"
      : attackerRetreated && !defenderRetreated ? "defender_victory"
      : "inconclusive",
    attackerName,
    defenderName,
    attackerCommanderName: nameOf(leadAttacker.commanderCharacterId),
    defenderCommanderName: nameOf(leadDefender.commanderCharacterId),
    attackerCasualties: sideCasualties(attackerIds),
    defenderCasualties: sideCasualties(defenderIds),
    retreated: [attackerRetreated ? attackerName : null, defenderRetreated ? defenderName : null].filter((name): name is string => name !== null),
  };
}

/**
 * A refusal or failure caused only by a bad/missing entity id or malformed
 * call arguments -- never by the world genuinely declining the attempt. Every
 * such message in the registry follows one of a small number of fixed
 * phrasings (`refuse()` calls across `workflows/definitions/*.ts`,
 * `diagnoseFailedInvocation`, and `validateCandidate`'s own "does not exist"
 * and "Invalid parameters" checks), so this is a closed, deterministic
 * classification rather than a guess at intent.
 *
 * The bug this exists to prevent: a siege attempted against "messana" was
 * refused because the authoritative id is "settlement-messana", and the Game
 * Master reported that lookup mistake straight to the player as history --
 * "the siege was refused" -- when nothing about the world had actually said
 * no. A genuine refusal (no authority, no eligible sponsor, insufficient
 * resource, already done) must never be swept into this: only the id/argument
 * shape of the message qualifies.
 */
function isRecoverableLookupOrArgumentFailure(message: string): boolean {
  return /\bwith the id\b/i.test(message)
    || /\banswers to\b/i.test(message)
    || /\bdoes not exist in world state\b/i.test(message)
    || /^invalid param/i.test(message);
}

/**
 * Only failures that reached a real actor can become a social scene. Unknown
 * actors, malformed arguments, and duplicate calls are facts about the call,
 * not a person in the world saying no.
 */
function canHaveNamedRefusalAftermath(
  invocation: ProposedInvocation,
  message: string,
  kind?: PolicyViolation["kind"],
): boolean {
  if (isRecoverableLookupOrArgumentFailure(message)) return false;
  if (kind === "unknown_action" || kind === "invalid_params" || kind === "unknown_actor" || kind === "dead_actor" || kind === "duplicate") return false;
  return invocation.actorId.trim().length > 0;
}

function actionPhrase(actionId: string): string {
  return actionId.replace(/[_-]+/g, " ").trim();
}

function relationLabel(text: string): string {
  return text.length <= 200 ? text : `${text.slice(0, 197).trimEnd()}...`;
}

/** A tool call the Game Master asked for. Ids come from the provider. */
export interface GameMasterToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

export interface GameMasterToolOutcome {
  /** Whether the call did what it asked. A refusal is `false` but is not an error. */
  readonly ok: boolean;
  /** Exactly what the model is told back. Deterministic, factual, no advice. */
  readonly factual: string;
  /** True once `finish_turn` has been accepted; no further calls are executed. */
  readonly finished: boolean;
  readonly factId?: string;
  /** Present only for a genuine engine refusal that may receive social aftermath. */
  readonly refusalId?: string;
}

interface EligibleRefusal {
  readonly id: string;
  readonly requesterCharacterId: string;
  readonly rejectedActionId: string;
  readonly engineReason: string;
  used: boolean;
}

/**
 * A capability request is not allowed to be the Game Master's last word on
 * an actor's situation. Before the turn can finish, that actor must make one
 * real, engine-validated attempt using an existing or newly defined action.
 */
interface PendingCapabilityRepair {
  readonly id: string;
  readonly actorId: string;
  readonly intent: string;
}

export interface GameMasterSessionOptions {
  readonly world: WorldState;
  readonly atStep: number;
  readonly actorCharacterId: string;
  /** Directive ids submitted this turn; the report must account for each. */
  readonly directiveIds: readonly string[];
  readonly directives?: readonly { id: string; directive: OrderDirective }[];
  readonly privateInformation?: PrivateInformationPolicy;
  readonly scenarioLife?: ScenarioLifeRules | undefined;
  readonly scenarioClock?: ScenarioClock | undefined;
  readonly maxToolCalls?: number;
  /**
   * Workflows this campaign defined in earlier turns.
   */
  readonly definedActions?: readonly InventedWorkflowDefinition[];
  /**
   * Whether campaign-defined workflows are available. They are enabled by
   * default; callers may turn them off for a deliberately constrained run.
   */
  readonly allowInventedActions?: boolean;
  /**
   * docs/32 Phase 7: the mechanical authority backstop. Undefined by
   * default -- today's single-GM path is completely unaffected unless a
   * caller explicitly wires one in. When present, every `act()` call is
   * checked before it reaches `applyInvocation`, so an under-authorized
   * caller (any of Part B's multiple agents, not just a misbehaving one)
   * cannot make an unauthorized action take effect merely by calling the
   * tool -- regardless of what a model attempts, the engine refuses it the
   * same way it already refuses a bad id or a failed precondition. Kept as
   * an injected interface (`authority/authority-grant.ts`'s
   * `buildWorkflowAuthorityGate`) rather than an import of the `authority`
   * module here, so this already-large file stays decoupled from it.
   */
  readonly authorityGate?: AuthorityGate;
  /**
   * docs/32, Part C.1/C.6 step 9. Off by default -- today's `WORKFLOW_REGISTRY`-
   * only tool surface is completely unaffected unless a caller explicitly
   * opts in. When true, `listTools()` also offers the typed world-tool
   * catalog (`world-tools/catalog.ts`), and a call naming one of those tools
   * is dispatched through `executeWorldTool`/`executeWorldReadTool` rather
   * than `WORKFLOW_REGISTRY` -- a genuinely separate mutation path from
   * `act()`, sharing only the staged world and actor/budget bookkeeping.
   */
  readonly enableWorldTools?: boolean;
  /** The authority index world tools check their own `authorityRequirement` against. Undefined -- the default even when `enableWorldTools` is true -- means world-tool authority checks are unrestricted, mirroring `authorityGate`'s own opt-in default. */
  readonly worldToolAuthorityIndex?: AuthorityIndex;
  /**
   * docs/32 corrective pass, requirement 3. Off by default -- every existing
   * caller (v1's single GM, the per-turn multi-agent orchestrator) is
   * completely unaffected. When true, a registered-workflow `act()` call
   * that validates successfully is NOT applied to the staged world: it is
   * rolled back and recorded in `scheduledActions` instead, for the caller
   * to convert into a scheduled `action_phase` event. Only the event
   * queue's per-event reaction runner sets this -- a reaction is decided
   * now, but takes effect on the queue's own timeline, not instantly.
   * World tools are unaffected (see `scheduledActions`'s own doc comment).
   */
  readonly deferMutations?: boolean;
}

/** See `GameMasterSessionOptions.authorityGate`. Returns null when `actionId` is not authority-sensitive (allow unconditionally, as before this existed); a refusal message otherwise. */
export interface AuthorityGate {
  check(actionId: string, actorId: string, parameters: Record<string, unknown>): string | null;
}

export interface GameMasterSessionResult {
  readonly world: WorldState;
  readonly report: GameMasterTurnReport | null;
  readonly events: readonly FactualEvent[];
  readonly auditEntries: readonly WorkflowAuditEntry[];
  readonly capabilityRequests: readonly RecordedCapabilityRequest[];
  readonly executedInvocations: readonly ProposedInvocation[];
  readonly readCallCount: number;
  readonly toolCallCount: number;
  /** Actions defined during this turn, for the caller to persist. */
  readonly definedActions: readonly InventedWorkflowDefinition[];
  /** Every use of a defined workflow this turn, for the audit trail. */
  readonly definedActionUses: readonly {
    readonly actionId: string;
    readonly actorId: string;
    readonly parameters: Record<string, unknown>;
    readonly resolvedPatch: readonly import("../workflows/invented-workflow").InventedPatchOperation[];
  }[];
  /** docs/32, Part C.1: every world-tool call this turn made, for the audit trail -- empty unless `enableWorldTools` was set. */
  readonly worldToolInvocations: readonly { readonly toolId: string; readonly actorId: string; readonly parameters: Record<string, unknown> }[];
  /** Facts world tools (e.g. `record_fact`) produced this turn. The caller persists these to the fact ledger (Part A) -- they are never folded into `world` here. */
  readonly worldToolFacts: readonly Fact[];
  /**
   * A registered-workflow action a reaction agent validated but did not
   * apply, because `deferMutations` was on (docs/32 corrective pass,
   * requirement 3) -- the caller (the event queue's reaction runner)
   * converts each of these into a scheduled `action_phase` `WorldEvent`
   * instead. World tools (`issue_order`/`record_response`/`record_fact`/
   * `create_commitment`) are never deferred -- they are already their own
   * scheduling primitive (an order attempt awaits its own later decision).
   */
  readonly scheduledActions: readonly { readonly actionId: string; readonly actorId: string; readonly parameters: Record<string, unknown> }[];
}

const DEFAULT_MAX_TOOL_CALLS = 60;
/**
 * How many actions one turn may bring into being. A turn that needs four new
 * capabilities is a turn that has stopped playing the world it is in, and the
 * cap keeps a single turn focused on the world already in play.
 */
const MAX_DEFINITIONS_PER_TURN = 3;

/**
 * A battle's outcome is the deterministic resolver's, never a model's. The
 * Game Master may start one; the instant it does, the engine fights it and
 * hands back what happened, so the agent reacts to a real result rather than
 * imagining one.
 */
const SYSTEM_ACTOR = "system";

export class GameMasterSession {
  private staged: WorldState;
  private readonly atStep: number;
  private readonly actorCharacterId: string;
  private readonly privateInformation: PrivateInformationPolicy;
  private readonly scenarioLife: ScenarioLifeRules | undefined;
  private readonly scenarioClock: ScenarioClock | undefined;
  private readonly maxToolCalls: number;
  private executingPlanId: string | null = null;
  private readonly managedPlans: boolean;

  private readonly events: FactualEvent[] = [];
  private readonly auditEntries: WorkflowAuditEntry[] = [];
  private readonly capabilityRequests: RecordedCapabilityRequest[] = [];
  private readonly pendingCapabilityRepairs = new Map<string, PendingCapabilityRepair>();
  private readonly executedInvocations: ProposedInvocation[] = [];
  private readonly invocationDuplicates = createInvocationDuplicateGuard();
  private readonly eligibleRefusals = new Map<string, EligibleRefusal>();

  private report: GameMasterTurnReport | null = null;
  /** A turn is pushed back for world agency at most once; see `finish`. */
  private pushedForWorldAgency = false;
  /** A turn is pushed back for ignoring due life reviews/political procedures at most once; see `finish`. */
  private pushedForDueOutcomes = false;
  /** Character ids `list_due_life_reviews` reported this turn, cleared once addressed by a life-event action. */
  private readonly unaddressedDueLifeReviews = new Set<string>();
  /** Procedure ids `list_due_political_procedures` reported this turn, cleared once addressed by resolve_procedure. */
  private readonly unaddressedDueProcedures = new Set<string>();
  /**
   * Keyed `${actionId}::${actorId}`. Set when a game-master-sourced call fails
   * only because of a bad/missing id or invalid arguments; cleared the moment
   * that same actor attempts that same action again (whatever the retry's own
   * outcome). `finish` refuses to accept a report while this is non-empty, so
   * a recoverable mistake can never be reported as history without at least
   * one corrected attempt.
   */
  private readonly pendingRecoverableRetries = new Set<string>();
  /** Actions this campaign has: the ones carried in from earlier turns, plus any defined now. */
  private readonly definedActions: Map<string, InventedWorkflowDefinition>;
  private readonly definedThisTurn: InventedWorkflowDefinition[] = [];
  private readonly definedActionUses: {
    actionId: string;
    actorId: string;
    parameters: Record<string, unknown>;
    resolvedPatch: readonly import("../workflows/invented-workflow").InventedPatchOperation[];
  }[] = [];
  private toolCallCount = 0;
  private readCallCount = 0;
  private factCounter = 0;
  private ambientEventUsed = false;
  private finished = false;
  private readonly allowInventedActions: boolean;
  private readonly authorityGate: AuthorityGate | undefined;
  private readonly enableWorldTools: boolean;
  private readonly worldToolAuthorityIndex: AuthorityIndex | undefined;
  private readonly worldToolInvocations: { toolId: string; actorId: string; parameters: Record<string, unknown> }[] = [];
  private readonly worldToolFacts: Fact[] = [];
  /** Monotonic, per-session counter for `record_fact`'s deterministic id (docs/32 corrective pass, requirement 4). */
  private worldToolCallSequence = 0;
  private readonly deferMutations: boolean;
  private readonly scheduledActions: { actionId: string; actorId: string; parameters: Record<string, unknown> }[] = [];
  /**
   * Who is actually calling, for the duration of the current `invoke()`.
   * Defaults to the player -- v1's single-agent path never supplies a
   * `principal` argument, so it always resolves to exactly today's behavior
   * (the one bound `actorCharacterId`, full surface). Safe as a single
   * mutable field because every agent in the multi-agent path
   * (`orchestrator.ts`) runs its own tool loop to completion, strictly
   * sequentially, against this one shared session -- never concurrently.
   */
  private currentPrincipal: Principal;

  readonly directiveIds: readonly string[];

  constructor(options: GameMasterSessionOptions) {
    this.managedPlans = options.directives !== undefined;
    this.staged = options.directives ? preparePlayerPlans(options.world, options.actorCharacterId, options.atStep, options.directives) : options.world;
    this.atStep = options.atStep;
    this.actorCharacterId = options.actorCharacterId;
    this.directiveIds = [...options.directiveIds];
    this.privateInformation = options.privateInformation ?? "omit";
    this.scenarioLife = options.scenarioLife;
    this.scenarioClock = options.scenarioClock;
    this.maxToolCalls = options.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
    this.definedActions = new Map((options.definedActions ?? []).map((definition) => [definition.actionId, definition]));
    this.allowInventedActions = options.allowInventedActions ?? true;
    this.authorityGate = options.authorityGate;
    this.enableWorldTools = options.enableWorldTools ?? false;
    this.worldToolAuthorityIndex = options.worldToolAuthorityIndex;
    this.deferMutations = options.deferMutations ?? false;
    // v1's single Game Master is omniscient by design -- it decides and
    // executes NPC actions itself (`pipeline.ts`), not only the player's own
    // -- so its default, unbound principal is "system", not "player". Only
    // the multi-agent path (`invoke(call, principal)`) ever narrows this.
    this.currentPrincipal = { kind: "system" };
    for (const { directive } of options.directives ?? []) {
      if (directive.kind === "new") continue;
      const plan = options.world.playerPlans?.find(p => p.id === directive.actionId && p.ownerId === options.actorCharacterId && p.status === "active");
      if (plan) this.planFact(`The player ${directive.kind === "cancel" ? "cancelled" : "revised"} a continuing plan. Completed work remains in its history.`);
    }
  }

  /** The tool surface this session accepts. Anything else is refused by name. */
  listTools(): GameMasterToolDefinition[] {
    const base = buildGameMasterTools({ allowInventedActions: this.allowInventedActions });
    if (!this.enableWorldTools) return base;
    return [...base, ...buildWorldToolCatalog()];
  }

  get stagedWorld(): WorldState {
    return this.staged;
  }

  get isFinished(): boolean {
    return this.finished;
  }

  get exhausted(): boolean {
    return this.toolCallCount >= this.maxToolCalls;
  }

  result(): GameMasterSessionResult {
    return {
      world: this.staged,
      report: this.report,
      events: [...this.events],
      auditEntries: [...this.auditEntries],
      capabilityRequests: [...this.capabilityRequests],
      executedInvocations: [...this.executedInvocations],
      readCallCount: this.readCallCount,
      toolCallCount: this.toolCallCount,
      definedActions: [...this.definedThisTurn],
      definedActionUses: [...this.definedActionUses],
      worldToolInvocations: [...this.worldToolInvocations],
      worldToolFacts: [...this.worldToolFacts],
      scheduledActions: [...this.scheduledActions],
    };
  }

  /**
   * Execute one tool call against the staged world. Never throws.
   *
   * `principal` is who is actually calling -- supplied by the orchestrator,
   * never trusted from the model's own `arguments.actorId`. Omitted, it
   * defaults to the unrestricted `system` principal, matching v1's single,
   * omniscient Game Master (and any call site that predates the multi-agent
   * split) exactly: that one agent already decides and executes actions for
   * the player's character and every NPC alike, so it is never bound to a
   * single claimable identity. Only the multi-agent orchestrator supplies a
   * narrower principal (`player`/`npc`/`star_context`/`closing`).
   */
  invoke(call: GameMasterToolCall, principal?: Principal): GameMasterToolOutcome {
    this.currentPrincipal = principal ?? { kind: "system" };
    if (this.finished) {
      return { ok: false, factual: "The turn is already finished; no further tool calls are accepted.", finished: true };
    }
    this.toolCallCount += 1;
    if (this.toolCallCount > this.maxToolCalls) {
      return { ok: false, factual: `Tool budget exhausted (${this.maxToolCalls} calls). Call ${FINISH_TURN_TOOL} now.`, finished: false };
    }

    const args = call.arguments ?? {};
    if (call.name === "interpret_plan") return this.planInterpretation(args);
    if (call.name === "execute_plan_stage") return this.executePlanStage(args);
    if (call.name === "respond_to_plan_assignment") return this.respondToAssignment(args);
    if (call.name === "defer_plan_stage") {
      const parsed = DeferPlanStageSchema.safeParse(args);
      if (!parsed.success) return { ok: false, finished: false, factual: parsed.error.message };
      const { planId, stageId, reason } = parsed.data;
      const plan = this.staged.playerPlans?.find(p => p.id === planId && p.ownerId === this.actorCharacterId && p.status === "active");
      if (!plan?.stages.some(s => s.id === stageId && s.status !== "completed")) return { ok: false, finished: false, factual: "Only an unfinished stage can be deferred." };
      this.staged = { ...this.staged, playerPlans: this.staged.playerPlans!.map(p => p.id !== planId ? p : { ...p, updatedAtStep: this.atStep, stages: p.stages.map(s => s.id !== stageId ? s : { ...s, status: "blocked", reason }) }) };
      return { ok: true, finished: false, factual: `The stage remains unfinished: ${reason}` };
    }
    if (call.name === FINISH_TURN_TOOL) return this.finish(args);
    if (call.name === DEFINE_ACTION_TOOL || call.name === INVOKE_DEFINED_ACTION_TOOL) {
      if (!this.allowInventedActions) {
        return {
          ok: false,
          finished: false,
          factual: `${call.name} is not available. If no registered action fits, call ${REQUEST_CAPABILITY_TOOL} to record the unmet need for developer review; nothing you attempt this way changes the world.`,
        };
      }
      return call.name === DEFINE_ACTION_TOOL ? this.defineAction(args) : this.invokeDefinedAction(args);
    }
    if (call.name === REQUEST_CAPABILITY_TOOL) return this.requestCapability(args);
    if (call.name === RECORD_REFUSAL_AFTERMATH_TOOL) return this.recordRefusalAftermath(args);
    if (call.name === RECORD_ENTITY_NOTE_TOOL) return this.recordEntityNote(args);
    if (call.name === FLAG_NPC_INITIATED_DIALOGUE_TOOL) return this.flagNpcInitiatedDialogue(args);
    if (call.name === FLAG_AMBIENT_EVENT_TOOL) return this.flagAmbientEvent(args);
    if (READ_TOOL_BY_NAME.has(call.name)) return this.read(call.name, args);
    if (WORKFLOW_REGISTRY.has(call.name)) return this.act(call.name, args);
    if (this.enableWorldTools && (WORLD_TOOL_BY_NAME.has(call.name) || WORLD_READ_TOOL_BY_NAME.has(call.name))) {
      return this.actWorldTool(call.name, args);
    }

    return {
      ok: false,
      factual: `There is no tool named "${call.name}". Use only the tools you were given. If nothing fits, call ${REQUEST_CAPABILITY_TOOL}.`,
      finished: false,
    };
  }

  // -- reads -----------------------------------------------------------------

  private read(name: string, args: Record<string, unknown>): GameMasterToolOutcome {
    const tool = READ_TOOL_BY_NAME.get(name)!;
    const parsed = (tool.parametersSchema as z.ZodType<unknown>).safeParse(args);
    if (!parsed.success) {
      return {
        ok: false,
        finished: false,
        factual: `Invalid arguments for ${name}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
      };
    }
    this.readCallCount += 1;
    const context: ReadToolContext = {
      world: this.staged,
      atStep: this.atStep,
      actorCharacterId: this.actorCharacterId,
      privateInformation: this.privateInformation,
      scenarioLife: this.scenarioLife,
      scenarioClock: this.scenarioClock,
    };
    const result = tool.read(context, parsed.data);
    if (result.ok && name === "list_due_life_reviews") {
      const due = (result.data as { dueLifeReviews?: readonly { characterId: string }[] }).dueLifeReviews ?? [];
      for (const entry of due) this.unaddressedDueLifeReviews.add(entry.characterId);
    }
    if (result.ok && name === "list_due_political_procedures") {
      const due = (result.data as { dueProcedures?: readonly { procedureId: string }[] }).dueProcedures ?? [];
      for (const entry of due) this.unaddressedDueProcedures.add(entry.procedureId);
    }
    return { ok: result.ok, factual: result.factual, finished: false };
  }

  // -- actions ---------------------------------------------------------------

  /**
   * The only remaining deterministic gate on an action: player orders must
   * flow through their own plan so progress and revisions stay attached to
   * it. Whether an actor has the time, standing, or relevance to act at all
   * is judgement now, left entirely to the Game Master.
   */
  private actionLimitRefusal(actorId: string, actionId?: string): string | null {
    if (actionId && this.managedPlans && actorId === this.actorCharacterId && this.executingPlanId === null) {
      return "Use execute_plan_stage for player orders so progress and limits stay attached to their plan.";
    }
    return null;
  }

  /**
   * A successful state change, or a genuine rules refusal, closes one repair
   * debt for the same actor. Lookup and argument mistakes do not: they still
   * need correction before they can be called a repair attempt.
   */
  private recordCapabilityRepairAttempt(
    actorId: string,
    outcome: { ok: boolean; factId?: string; recoverable?: boolean },
  ): void {
    if (!outcome.ok && outcome.recoverable) return;
    if (outcome.ok) {
      const event = outcome.factId === undefined ? undefined : this.events.find((candidate) => candidate.id === outcome.factId);
      if (event?.materialConsequence !== true) return;
    }
    const pending = [...this.pendingCapabilityRepairs.values()].find((entry) => entry.actorId === actorId);
    if (pending !== undefined) this.pendingCapabilityRepairs.delete(pending.id);
  }

  private planFact(summary: string): GameMasterToolOutcome {
    const id = `fact-${this.atStep}-${++this.factCounter}`;
    this.events.push({ id, atStep: this.atStep, kind: "action", actionId: "plan_update", actorId: this.actorCharacterId, parameters: {}, summary, materialConsequence: false });
    return { ok: true, finished: false, factId: id, factual: `[${id}] ${summary}` };
  }

  private planInterpretation(args: Record<string, unknown>): GameMasterToolOutcome {
    const principalRefusal = this.principalRefusal(this.actorCharacterId);
    if (principalRefusal !== null) return { ok: false, finished: false, factual: "Refused: only the player's own agent may interpret the player's plan." };
    const parsed = InterpretPlanSchema.safeParse(args);
    if (!parsed.success) return { ok: false, finished: false, factual: parsed.error.message };
    const result = interpretPlan(this.staged, this.actorCharacterId, parsed.data, this.atStep);
    if (typeof result === "string") return { ok: false, finished: false, factual: result };
    this.staged = result;
    if (parsed.data.clarificationQuestions.length > 0) {
      return this.planFact(`The plan needs the player's answer before any stage commits: ${parsed.data.clarificationQuestions.join(" ")}`);
    }
    return this.planFact(`A continuing plan was prepared: ${parsed.data.interpretation}. Its stages are attempts, not completed outcomes.`);
  }

  private respondToAssignment(args: Record<string, unknown>): GameMasterToolOutcome {
    const parsed = RespondToAssignmentSchema.safeParse(args);
    if (!parsed.success) return { ok: false, finished: false, factual: parsed.error.message };
    const input = parsed.data;
    const principalRefusal = this.principalRefusal(input.actorId);
    if (principalRefusal !== null) return { ok: false, finished: false, factual: `Refused: only ${input.actorId} may answer an assignment addressed to them.` };
    const plan = this.staged.playerPlans?.find(p => p.id === input.planId && p.ownerId === this.actorCharacterId && p.status === "active");
    const actor = this.staged.characters.find(c => c.id === input.actorId && c.alive);
    if (!plan || !actor || input.actorId === this.actorCharacterId || !plan.options.delegateIds.includes(input.actorId)) return { ok: false, finished: false, factual: "Only a living NPC named as a delegate may answer this assignment." };
    this.staged = { ...this.staged, playerPlans: this.staged.playerPlans!.map(p => p.id !== plan.id ? p : { ...p, updatedAtStep: this.atStep,
      assignments: [...p.assignments.filter(a => a.actorId !== input.actorId), { actorId: input.actorId, accepted: input.accepted, reason: input.reason }] }) };
    return this.planFact(`${actor.name} ${input.accepted ? "accepted" : "declined"} an assignment: ${input.reason}`);
  }

  private executePlanStage(args: Record<string, unknown>): GameMasterToolOutcome {
    const parsed = ExecutePlanStageSchema.safeParse(args);
    if (!parsed.success) return { ok: false, finished: false, factual: parsed.error.message };
    const input = parsed.data;
    const plan = this.staged.playerPlans?.find(p => p.id === input.planId && p.ownerId === this.actorCharacterId && p.status === "active");
    const stage = plan?.stages.find(s => s.id === input.stageId);
    if (!plan || !stage || !plan.interpretation) return { ok: false, finished: false, factual: "Interpret an active plan before attempting its stages." };
    if (stage.status === "completed") return { ok: false, finished: false, factual: "This stage already completed; its effects must not be repeated." };
    const actor = this.staged.characters.find(c => c.id === stage.actorId && c.alive);
    const obstacle = !actor ? "The assigned character is no longer available. Revise the plan."
      : stage.dependsOn.some(id => plan.stages.find(s => s.id === id)?.status !== "completed") ? "An earlier stage has not completed."
      : stage.notBeforeStep !== null && stage.notBeforeStep > this.atStep ? "The scheduled time has not arrived."
      : stage.actorId !== plan.ownerId && !plan.assignments.some(a => a.actorId === stage.actorId && a.accepted) ? "The delegate has not accepted this assignment." : null;
    let result: GameMasterToolOutcome;
    const before = this.staged;
    if (obstacle) result = { ok: false, finished: false, factual: obstacle };
    else {
      this.executingPlanId = plan.id;
      try {
        result = WORKFLOW_REGISTRY.has(input.actionId) ? this.act(input.actionId, { ...input.parameters, actorId: stage.actorId })
          : this.allowInventedActions && this.definedActions.has(input.actionId) ? this.invokeDefinedAction({ actionId: input.actionId, actorId: stage.actorId, parameters: input.parameters })
          : { ok: false, finished: false, factual: "Use a registered action for this stage." };
      } finally { this.executingPlanId = null; }
    }
    const debit = planSpending(before, this.staged, plan);
    this.staged = { ...this.staged, playerPlans: this.staged.playerPlans!.map(p => {
      if (p.id !== plan.id) return p;
      const stages: PlayerPlan["stages"] = p.stages.map(s => s.id !== stage.id ? s : { ...s, status: result.ok ? "completed" : "blocked", reason: result.ok ? null : result.factual.slice(0, 600), factRefs: result.factId ? [result.factId] : [], lastCompletedStep: result.ok ? this.atStep : s.lastCompletedStep });
      return { ...p, stages, spent: p.spent + (typeof debit === "number" ? debit : 0), updatedAtStep: this.atStep, status: stages.every(s => s.status === "completed" && s.repeatEverySteps === null) ? "completed" : "active" };
    }) };
    return result;
  }

  /**
   * The principal enforcement gate (docs/32 corrective pass): a claimed
   * `actorId` is only ever a claim a model makes in tool arguments.
   * `this.currentPrincipal` is the fact, bound by the orchestrator and set at
   * the top of `invoke()` -- never something a tool call itself can alter.
   * Checked before any lookup, authority, or liveness logic so an
   * impersonation attempt is refused identically whether the claimed actor
   * exists, is dead, or is a perfectly valid character who simply isn't the
   * one actually calling.
   */
  private principalRefusal(actorId: string): string | null {
    if (!canActAsPrincipal(this.currentPrincipal)) {
      return "Refused: this pass may not take state-changing actions.";
    }
    const boundActorId = actorIdForPrincipal(this.currentPrincipal);
    if (boundActorId !== null && actorId !== boundActorId) {
      return `Refused: you may only act as "${boundActorId}", not "${actorId}".`;
    }
    return null;
  }

  private act(actionId: string, args: Record<string, unknown>): GameMasterToolOutcome {
    const { actorId, ...parameters } = args as { actorId?: unknown } & Record<string, unknown>;
    if (typeof actorId !== "string" || actorId.trim().length === 0) {
      return { ok: false, finished: false, factual: `${actionId} requires "actorId": the living character who takes this action.` };
    }
    const principalRefusal = this.principalRefusal(actorId);
    if (principalRefusal !== null) return { ok: false, finished: false, factual: principalRefusal };
    // Check identity first. A guessed actor id is a recoverable lookup error,
    // not a claim that someone was outside this turn's active cast.
    const actor = this.staged.characters.find((character) => character.id === actorId);
    if (actionId === "move_character" && parameters["characterId"] !== actorId) return { ok: false, finished: false, factual: "The traveler must execute their own movement; another actor cannot supply their personal travel time." };
    if (!actor || !actor.alive) {
      const outcome = this.applyInvocation({ actionId, actorId, parameters }, "game_master");
      if (outcome.recoverable) this.pendingRecoverableRetries.add(`${actionId}::${actorId}`);
      return {
        ok: outcome.ok,
        finished: false,
        factual: outcome.factual,
        ...(outcome.refusalId === undefined ? {} : { refusalId: outcome.refusalId }),
      };
    }
    const limitRefusal = this.actionLimitRefusal(actorId, actionId);
    if (limitRefusal !== null) return { ok: false, finished: false, factual: limitRefusal };

    if (this.authorityGate) {
      const authorityRefusal = this.authorityGate.check(actionId, actorId, parameters);
      if (authorityRefusal !== null) return { ok: false, finished: false, factual: authorityRefusal };
    }

    // A diplomatic message answered in the player's own name is the
    // player's own decision, not the agent's to make. Nothing about the
    // generic actor/authority checks above catches this -- the player's
    // character is alive, belongs to the recipient polity, and is a
    // perfectly legal `answeredByCharacterId` by every other rule -- so it
    // is refused here, by identity, unconditionally.
    if (actionId === "answer_diplomatic_message" && parameters["answeredByCharacterId"] === this.actorCharacterId) {
      return {
        ok: false,
        finished: false,
        factual:
          `Refused: "answer_diplomatic_message" cannot be called with the player's own character (${this.actorCharacterId}) as the answerer. `
          + "A message addressed to the player is the player's decision, never the Game Master's: report it in your turn report as an unresolved thread awaiting the player's own reply, and do not choose, accept, refuse, counter, or otherwise resolve it on their behalf.",
      };
    }

    // Whatever this call's own outcome, it IS the retry: clear any debt this
    // exact actor/action owed from an earlier lookup or argument mistake
    // before recording a fresh one below.
    const retryKey = `${actionId}::${actorId}`;
    this.pendingRecoverableRetries.delete(retryKey);

    const invocation: ProposedInvocation = { actionId, actorId, parameters };
    // docs/32 corrective pass, requirement 3: a reaction agent's action is
    // validated for real (the exact same policy/executor path any other
    // caller goes through), but never committed here -- a successful,
    // otherwise-final mutation is rolled back and recorded in
    // `scheduledActions` instead, for the event queue's reaction runner to
    // convert into a scheduled `action_phase` event on its own timeline.
    if (this.deferMutations) {
      const stagedBefore = this.staged;
      const eventsBefore = this.events.length;
      const executedBefore = this.executedInvocations.length;
      const auditBefore = this.auditEntries.length;
      const outcome = this.applyInvocation(invocation, "game_master");
      if (!outcome.ok) {
        if (outcome.recoverable) this.pendingRecoverableRetries.add(retryKey);
        return {
          ok: false,
          finished: false,
          factual: outcome.factual,
          ...(outcome.refusalId === undefined ? {} : { refusalId: outcome.refusalId }),
        };
      }
      this.staged = stagedBefore;
      this.events.length = eventsBefore;
      this.executedInvocations.length = executedBefore;
      this.auditEntries.length = auditBefore;
      this.pendingRecoverableRetries.delete(retryKey);
      this.scheduledActions.push({ actionId, actorId, parameters });
      return { ok: true, finished: false, factual: `Scheduled: "${actionId}" by ${actorId} will take effect on the world's own timeline, not instantly.` };
    }
    const outcome = this.applyInvocation(invocation, "game_master");
    if (!outcome.ok) {
      if (outcome.recoverable) this.pendingRecoverableRetries.add(retryKey);
      this.recordCapabilityRepairAttempt(actorId, outcome);
      return {
        ok: false,
        finished: false,
        factual: outcome.factual,
        ...(outcome.refusalId === undefined ? {} : { refusalId: outcome.refusalId }),
      };
    }

    this.recordCapabilityRepairAttempt(actorId, outcome);

    // A due life review or political procedure is addressed the instant the
    // matching action succeeds for the same character/procedure it was
    // reported for -- never merely by being read.
    if (actionId === "kill_character" || actionId === "incapacitate_character" || actionId === "recover_from_incapacity") {
      const characterId = parameters["characterId"];
      if (typeof characterId === "string") this.unaddressedDueLifeReviews.delete(characterId);
    }
    if (actionId === "resolve_procedure") {
      const procedureId = parameters["procedureId"];
      if (typeof procedureId === "string") this.unaddressedDueProcedures.delete(procedureId);
    }

    // Deterministic follow-ups the engine owns. A started battle is fought by
    // the resolver immediately, in the same call, so the Game Master's next
    // decision is made against the real casualties and the real retreat.
    let factual = outcome.factual;
    if (actionId === "start_battle") {
      const battleId = parameters["battleId"];
      if (typeof battleId === "string") {
        const resolved = this.applyInvocation(
          {
            actionId: "resolve_battle",
            actorId: SYSTEM_ACTOR,
            parameters: {
              battleId,
              ...(parameters["attackerPosture"] !== undefined ? { attackerPosture: parameters["attackerPosture"] } : {}),
              ...(parameters["defenderPosture"] !== undefined ? { defenderPosture: parameters["defenderPosture"] } : {}),
            },
          },
          "system",
        );
        factual = `${factual}\n${resolved.factual}`;
      }
    }

    return { ok: true, factual, finished: false, ...(outcome.factId === undefined ? {} : { factId: outcome.factId }) };
  }

  /**
   * The world-tool dispatch path (docs/32, Part C.1/C.6 step 9) -- a
   * genuinely separate mutation route from `act()`, sharing only the staged
   * world and the actor/budget bookkeeping every tool call already goes
   * through. A read tool (`inspect_entity`/`inspect_context`) needs no actor
   * or authority check at all; an action tool gets the same living-actor
   * check `act()` applies, then `executeWorldTool`'s own
   * `authorityRequirement` (checked against `worldToolAuthorityIndex`, not
   * `this.authorityGate` -- a world tool's requirement is keyed by tool id,
   * not by the workflow action ids `authorityGate` was built from).
   */
  private actWorldTool(toolId: string, args: Record<string, unknown>): GameMasterToolOutcome {
    const { actorId, ...parameters } = args as { actorId?: unknown } & Record<string, unknown>;
    this.worldToolCallSequence += 1;
    const ctxBase = {
      atStep: this.atStep,
      // Prefer the staged world's own precise instant (set by the event
      // queue once it has run this turn) over the day-boundary derived from
      // `atStep` alone -- the latter is only ever a fallback for a session
      // that never went through the queue.
      atInstant: this.staged.instant ?? deriveWorldInstant(this.atStep, this.scenarioClock),
      factSequence: this.worldToolCallSequence,
      ...(this.worldToolAuthorityIndex === undefined ? {} : { authorityIndex: this.worldToolAuthorityIndex }),
    };

    const readTool = WORLD_READ_TOOL_BY_NAME.get(toolId);
    if (readTool !== undefined) {
      const outcome = executeWorldReadTool(readTool, this.staged, parameters, { actorId: typeof actorId === "string" ? actorId : "", ...ctxBase });
      return outcome.ok
        ? { ok: true, finished: false, factual: JSON.stringify(outcome.data) }
        : { ok: false, finished: false, factual: outcome.reason };
    }

    const tool = WORLD_TOOL_BY_NAME.get(toolId)!;
    if (typeof actorId !== "string" || actorId.trim().length === 0) {
      return { ok: false, finished: false, factual: `${toolId} requires "actorId": the living character who takes this action.` };
    }
    const principalRefusal = this.principalRefusal(actorId);
    if (principalRefusal !== null) return { ok: false, finished: false, factual: principalRefusal };
    const actor = this.staged.characters.find((character) => character.id === actorId);
    if (!actor || !actor.alive) {
      return { ok: false, finished: false, factual: `"${actorId}" is not a living character in this world.` };
    }
    const limitRefusal = this.actionLimitRefusal(actorId, toolId);
    if (limitRefusal !== null) return { ok: false, finished: false, factual: limitRefusal };

    const outcome = executeWorldTool(tool, this.staged, parameters, { actorId, ...ctxBase });
    if (!outcome.ok) return { ok: false, finished: false, factual: outcome.reason };

    this.staged = outcome.world;
    this.worldToolInvocations.push({ toolId, actorId, parameters });
    if (outcome.factsToPersist !== undefined && outcome.factsToPersist.length > 0) {
      this.worldToolFacts.push(...outcome.factsToPersist);
    }
    return { ok: true, finished: false, factual: outcome.summary };
  }

  /**
   * The one path from an invocation to staged state.
   *
   * Policy first (registered action, valid parameters, actor exists and is
   * alive, authority, scope, treasury access), then the workflow's own
   * deterministic `apply`, then a full re-validation of the resulting world.
   * Any failure returns the exact reason and leaves the stage exactly as it
   * was.
   */
  private applyInvocation(
    invocation: ProposedInvocation,
    source: "game_master" | "system",
  ): { ok: boolean; factual: string; factId?: string; refusalId?: string; recoverable?: boolean } {
    const auditBase: WorkflowAuditEntry = {
      correlationId: `gm-${this.atStep}-${this.auditEntries.length}`,
      source: "game_master",
      sourceRef: source === "system" ? "engine" : this.executingPlanId ?? "game_master",
      requestedActionId: invocation.actionId,
      requestedInvocation: invocation,
    };

    // The engine's own splices (battle resolution) bypass invoker-authority
    // checks because they are not proposals: the pipeline, not a model,
    // decided they must run. They still go through parameter validation and
    // the executor.
    let violation: PolicyViolation | null = null;
    if (source === "game_master") {
      const candidate: WorkflowCandidate = {
        correlationId: auditBase.correlationId,
        source: "game_master",
        sourceRef: "game_master",
        sourceRationale: "",
        requestedInvocation: invocation,
      };
      violation = validateCandidate(candidate, this.staged);
    }
    if (violation !== null) {
      this.auditEntries.push({ ...auditBase, policyViolation: violation, dryRunOk: false, executionOk: false, executionReason: violation.message });
      const refusalId = canHaveNamedRefusalAftermath(invocation, violation.message, violation.kind)
        ? this.registerEligibleRefusal(invocation, violation.message)
        : undefined;
      const factual = `Refused: ${violation.message}`;
      return {
        ok: false,
        factual: refusalId === undefined ? factual : `${factual} A named aftermath may be recorded with ${RECORD_REFUSAL_AFTERMATH_TOOL} using ${refusalId}.`,
        recoverable: isRecoverableLookupOrArgumentFailure(violation.message),
        ...(refusalId === undefined ? {} : { refusalId }),
      };
    }

    if (this.invocationDuplicates.isDuplicate(invocation)) {
      const message = `Refused: ${invocation.actionId} with these exact parameters has already been carried out this turn by ${invocation.actorId}.`;
      this.auditEntries.push({
        ...auditBase,
        policyViolation: { kind: "duplicate", message },
        dryRunOk: false,
        executionOk: false,
        executionReason: message,
      });
      // Already carried out is a genuine, real-world refusal -- not a lookup
      // or argument mistake -- so it is never treated as recoverable.
      return { ok: false, factual: message };
    }

    const before = this.staged;
    let executed;
    try {
      executed = executeWorkflow(invocation, this.staged, this.atStep);
    } catch (error) {
      const message = `Workflow "${invocation.actionId}" failed: ${error instanceof Error ? error.message : String(error)}`;
      this.auditEntries.push({ ...auditBase, finalInvocation: invocation, dryRunOk: false, executionOk: false, executionReason: message });
      return { ok: false, factual: `Failed: ${message}` };
    }

    if (!executed.ok) {
      this.auditEntries.push({ ...auditBase, finalInvocation: invocation, dryRunOk: false, executionOk: false, executionReason: executed.message });
      // A bare "cannot be applied" tells the model nothing it can act on, so
      // it reports the failure and moves on rather than fixing it. The nudge
      // invents no reason -- it only says what is worth checking, which is
      // almost always a guessed id or a step that has to come first.
      // A workflow that named its own reason has already said what to do; the
      // generic nudge would only bury it.
      const alreadyDiagnosed = /\b(inspect|instead|rather than|give this one|use one of)\b/i.test(executed.message);
      const hint = executed.reason === "not_applicable"
        ? alreadyDiagnosed
          ? " Nothing changed."
          : " Nothing changed. This is usually a guessed id, or a step that must come first (a vote needs a procedure you already sponsored; a command needs a force that exists). Inspect the entity, then try again or use a different tool."
        : executed.reason === "invalid_params"
          // This is a complaint about the call, not a decision about the
          // world. Reported as an outcome it becomes "your order failed
          // because an array was empty", which is the engine talking to the
          // player through the Game Master's mouth.
          ? " Nothing was decided here — these are your own arguments being rejected, not the world refusing. Correct them and call the tool again. If no correction can satisfy it, the action is the wrong one for what is being attempted; choose another."
          : "";
      // "invalid_params" is always a call-shape mistake. A "not_applicable"
      // failure is recoverable only when its own message is one of the
      // registry's id-lookup phrasings -- never for a genuine refusal (no
      // authority, ineligible sponsor, insufficient resource, already done).
      const recoverable = executed.reason === "invalid_params" || isRecoverableLookupOrArgumentFailure(executed.message);
      const refusalId = !recoverable && executed.reason !== "invalid_params" && canHaveNamedRefusalAftermath(invocation, executed.message)
        ? this.registerEligibleRefusal(invocation, executed.message)
        : undefined;
      const factual = `Failed: ${executed.message}${hint}`;
      return {
        ok: false,
        factual: refusalId === undefined ? factual : `${factual} A named aftermath may be recorded with ${RECORD_REFUSAL_AFTERMATH_TOOL} using ${refusalId}.`,
        recoverable,
        ...(refusalId === undefined ? {} : { refusalId }),
      };
    }

    // Committed to the stage only now, after the executor has re-validated
    // the whole world document.
    this.staged = executed.world;
    this.invocationDuplicates.record(invocation);
    this.executedInvocations.push(invocation);
    this.auditEntries.push({ ...auditBase, finalInvocation: invocation, dryRunOk: true, executionOk: true });

    this.factCounter += 1;
    const factId = `fact-${this.atStep}-${this.factCounter}`;
    const battleId = invocation.actionId === "resolve_battle" ? invocation.parameters["battleId"] : undefined;
    const battleBrief = typeof battleId === "string" ? deriveBattleBrief(before, executed.world, battleId) : null;
    // Generic and action-agnostic: whatever this call actually changed on any
    // tracked entity, found by structural diff -- never by knowing which
    // workflow ran. Covers every built-in workflow and every invented one
    // the same way, with nothing to update here when a new one is added.
    const stateDeltas = executed.result.noOp === true ? [] : diffWorldState(before, executed.world);
    this.events.push({
      id: factId,
      atStep: this.atStep,
      kind: "action",
      actionId: invocation.actionId,
      actorId: invocation.actorId,
      parameters: invocation.parameters,
      summary: executed.result.summary,
      // A call that applied but changed nothing is not a material consequence
      // and is not history; it is recorded so the audit trail is complete and
      // then skipped by the Chronicle.
      materialConsequence: executed.result.noOp !== true,
      ...(executed.result.noOp === true ? { noOp: true } : {}),
      ...(battleBrief === null ? {} : { battleBrief }),
      ...(stateDeltas.length === 0 ? {} : { stateDeltas }),
    });
    return { ok: true, factual: `Done [${factId}]: ${executed.result.summary}`, factId };
  }

  // -- named refusal aftermath ---------------------------------------------

  private registerEligibleRefusal(invocation: ProposedInvocation, engineReason: string): string {
    const id = `refusal-${this.atStep}-${this.eligibleRefusals.size + 1}`;
    this.eligibleRefusals.set(id, {
      id,
      requesterCharacterId: invocation.actorId,
      rejectedActionId: invocation.actionId,
      engineReason,
      used: false,
    });
    return id;
  }

  /** A speaker must plausibly be able to say no for the requester's own power. */
  private isEligibleRefuser(requesterId: string, refuserId: string): boolean {
    const requester = this.staged.characters.find((character) => character.id === requesterId);
    const refuser = this.staged.characters.find((character) => character.id === refuserId);
    if (!requester || !refuser || !requester.alive || !refuser.alive || requester.id === refuser.id) return false;
    if (requester.polityId === null || refuser.polityId !== requester.polityId) return false;
    return refuser.officeId !== null
      || this.staged.material.forces.some(
        (force) => force.polityId === refuser.polityId
          && (force.commanderCharacterId === refuser.id || force.controllerCharacterId === refuser.id),
      )
      || this.staged.material.politicalGroups.some(
        (group) => group.polityId === refuser.polityId && group.leaderCharacterId === refuser.id && group.active,
      );
  }

  private recordEntityNote(args: Record<string, unknown>): GameMasterToolOutcome {
    const parsed = RecordEntityNoteToolArguments.safeParse(args);
    if (!parsed.success) {
      return { ok: false, finished: false, factual: `The note was rejected: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}.` };
    }
    const { entityId, entityType, text } = parsed.data;
    this.factCounter += 1;
    const note: EntityNote = { id: `note-${this.atStep}-${this.factCounter}`, entityId, entityType, text, createdAtStep: this.atStep };
    this.staged = { ...this.staged, campaignMemory: appendEntityNote(this.staged.campaignMemory, note) };
    const factId = `fact-${this.atStep}-${this.factCounter}`;
    // Memory-only: this is deliberately not narrated as a world event on its
    // own (materialConsequence: false) -- nothing in the world changed, only
    // what will be remembered about it next time.
    this.events.push({
      id: factId,
      atStep: this.atStep,
      kind: "action",
      actionId: RECORD_ENTITY_NOTE_TOOL,
      actorId: this.actorCharacterId,
      parameters: { entityId, entityType, text },
      summary: `Noted of ${entityId}: ${text}`,
      materialConsequence: false,
    });
    return { ok: true, finished: false, factual: `Noted [${factId}].`, factId };
  }

  private flagNpcInitiatedDialogue(args: Record<string, unknown>): GameMasterToolOutcome {
    const parsed = FlagNpcInitiatedDialogueArguments.safeParse(args);
    if (!parsed.success) {
      return { ok: false, finished: false, factual: `The flag was rejected: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}.` };
    }
    const { characterId, topic, openingLine } = parsed.data;
    if (characterId === this.actorCharacterId) {
      return { ok: false, finished: false, factual: "The player's own character cannot initiate a conversation with themselves." };
    }
    const character = this.staged.characters.find((candidate) => candidate.id === characterId);
    if (!character) return { ok: false, finished: false, factual: `No character with the id "${characterId}" exists.` };
    if (!character.alive) return { ok: false, finished: false, factual: `${character.name} is dead and cannot open a conversation.` };

    this.factCounter += 1;
    const factId = `fact-${this.atStep}-${this.factCounter}`;
    // Deliberately not a world mutation: this only surfaces an affordance.
    // The Chronicle layer reads this action id specifically and attaches the
    // topic/opening line to the event it belongs to.
    this.events.push({
      id: factId,
      atStep: this.atStep,
      kind: "action",
      actionId: FLAG_NPC_INITIATED_DIALOGUE_TOOL,
      actorId: characterId,
      parameters: { characterId, topic, openingLine },
      summary: `${character.name} wants to speak with you: ${topic}`,
      materialConsequence: false,
    });
    return { ok: true, finished: false, factual: `Flagged [${factId}]: ${character.name} will show as wanting to talk.`, factId };
  }

  private flagAmbientEvent(args: Record<string, unknown>): GameMasterToolOutcome {
    if (this.ambientEventUsed) {
      return { ok: false, finished: false, factual: "An ambient event was already recorded this turn. At most one per turn." };
    }
    const parsed = FlagAmbientEventArguments.safeParse(args);
    if (!parsed.success) {
      return { ok: false, finished: false, factual: `The ambient event was rejected: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}.` };
    }
    this.ambientEventUsed = true;
    this.factCounter += 1;
    const factId = `fact-${this.atStep}-${this.factCounter}`;
    // Not a world mutation of any kind: pure flavor, cited by the report like
    // any other fact so the Chronicle can narrate it, but with nothing behind
    // it for a directConsequences card to ever show.
    this.events.push({
      id: factId,
      atStep: this.atStep,
      kind: "action",
      actionId: FLAG_AMBIENT_EVENT_TOOL,
      actorId: this.actorCharacterId,
      parameters: { narrative: parsed.data.narrative },
      summary: parsed.data.narrative,
      materialConsequence: false,
    });
    return { ok: true, finished: false, factual: `Recorded [${factId}].`, factId };
  }

  private recordRefusalAftermath(args: Record<string, unknown>): GameMasterToolOutcome {
    const parsed = RefusalAftermathToolArguments.safeParse(args);
    if (!parsed.success) {
      return {
        ok: false,
        finished: false,
        factual: `The refusal aftermath was rejected: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}.`,
      };
    }
    const input = parsed.data;
    const refusal = this.eligibleRefusals.get(input.refusalId);
    if (!refusal) {
      return { ok: false, finished: false, factual: `No eligible refusal exists with id "${input.refusalId}". Only a refusal id returned by this turn's tool call may receive an aftermath.` };
    }
    if (refusal.used) {
      return { ok: false, finished: false, factual: `The refusal "${input.refusalId}" already has a recorded aftermath.` };
    }
    if (!this.isEligibleRefuser(refusal.requesterCharacterId, input.refuserCharacterId)) {
      return {
        ok: false,
        finished: false,
        factual: "The named refuser is not an eligible authority for this request. Choose a different living office-holder, force commander, or political-group leader from the requester's own polity.",
      };
    }

    const requester = this.staged.characters.find((character) => character.id === refusal.requesterCharacterId)!;
    const refuser = this.staged.characters.find((character) => character.id === input.refuserCharacterId)!;
    const action = actionPhrase(refusal.rejectedActionId);
    const socialEvent: CharacterSocialEvent = {
      id: `refusal-social-${refusal.id}`,
      gameId: `gm-turn-${this.atStep}`,
      sourceTurnId: null,
      sourceSessionId: null,
      sourceMessageId: null,
      participantCharacterIds: [requester.id, refuser.id],
      kind: "conversation",
      visibility: "public",
      knownByCharacterIds: [],
      relationCauses: [
        {
          subjectCharacterId: requester.id,
          targetCharacterId: refuser.id,
          label: relationLabel(`${refuser.name} refused ${requester.name}'s ${action}: ${input.reason}`),
          score: -12,
          decayPerYearBps: 1_000,
          dimensions: { trust: -8, respect: -12 },
        },
        {
          subjectCharacterId: refuser.id,
          targetCharacterId: requester.id,
          label: relationLabel(`${refuser.name} refused ${requester.name}'s ${action}: ${input.reason}`),
          score: -6,
          decayPerYearBps: 1_000,
          dimensions: { trust: -6, respect: -4 },
        },
      ],
      knowledgeClaims: [],
      proposedBeliefs: [],
      pressureChanges: [],
      commitmentProposal: null,
      introducedCharacter: null,
      introducedProfile: null,
      createdAtStep: this.atStep,
      appliedAtStep: null,
      appliedInTurnId: null,
      status: "proposed",
      rejectionReason: null,
    };
    const socialOutcome = applySocialEvents(this.staged, [socialEvent], this.atStep, `gm-turn-${this.atStep}`);
    if (!socialOutcome.appliedIds.includes(socialEvent.id)) {
      return {
        ok: false,
        finished: false,
        factual: `The refusal aftermath could not be applied: ${socialOutcome.rejectedIds.find((entry) => entry.id === socialEvent.id)?.reason ?? "unknown reason"}`,
      };
    }

    this.staged = socialOutcome.world;
    refusal.used = true;
    this.factCounter += 1;
    const factId = `fact-${this.atStep}-${this.factCounter}`;
    const summary = `${refuser.name} refused ${requester.name}'s attempt to ${action}. “${input.quote}” ${input.reason}`;
    this.events.push({
      id: factId,
      atStep: this.atStep,
      kind: "action",
      actionId: RECORD_REFUSAL_AFTERMATH_TOOL,
      actorId: refuser.id,
      parameters: {
        refusalId: refusal.id,
        requesterCharacterId: requester.id,
        refuserCharacterId: refuser.id,
        rejectedActionId: refusal.rejectedActionId,
        engineReason: refusal.engineReason,
        reason: input.reason,
        quote: input.quote,
      },
      summary,
      // The social result is real and persistent, but it does not turn the
      // rejected material action into a success.
      materialConsequence: false,
    });
    return { ok: true, finished: false, factId, factual: `Recorded [${factId}]: ${summary}` };
  }

  // -- defining what the engine does not have --------------------------------
  //
  // Campaign-defined workflows are named, parameterised data interactions.
  // Every use goes through `applyInventedWorkflow`, which re-parses the entire
  // world document, refuses dangling references, and protects the clock,
  // pins, and schema version. A caller can still disable this surface for a
  // constrained run, but ordinary play keeps it available.

  private defineAction(args: Record<string, unknown>): GameMasterToolOutcome {
    if (this.definedThisTurn.length >= MAX_DEFINITIONS_PER_TURN) {
      return {
        ok: false,
        finished: false,
        factual: `You have already defined ${MAX_DEFINITIONS_PER_TURN} new actions this turn, which is the limit. Use what you have defined, or record the rest with ${REQUEST_CAPABILITY_TOOL}.`,
      };
    }
    const parsed = InventedWorkflowDefinitionSchema.safeParse(args);
    if (!parsed.success) {
      return {
        ok: false,
        finished: false,
        factual: `That action definition was rejected: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}. Correct it and define it again.`,
      };
    }
    const definition = parsed.data;
    const definitionError = validateInventedWorkflowDefinition(definition);
    if (definitionError !== null) {
      return { ok: false, finished: false, factual: `That workflow definition was rejected: ${definitionError}` };
    }
    if (WORKFLOW_REGISTRY.has(definition.actionId)) {
      return {
        ok: false,
        finished: false,
        factual: `"${definition.actionId}" is already a built-in action with its own tool. Call that tool directly rather than defining over it.`,
      };
    }
    if (this.definedActions.has(definition.actionId)) {
      return {
        ok: false,
        finished: false,
        factual: `"${definition.actionId}" is already defined in this campaign. Use it with ${INVOKE_DEFINED_ACTION_TOOL}; there is no need to define it twice.`,
      };
    }

    this.definedActions.set(definition.actionId, definition);
    this.definedThisTurn.push(definition);
    const required = definition.parameters.map((parameter) => `${parameter.name} (${parameter.type}${parameter.required ? "" : ", optional"})`).join(", ");
    return {
      ok: true,
      finished: false,
      factual: `Defined "${definition.actionId}". It takes: ${required || "no parameters"}. Carry it out with ${INVOKE_DEFINED_ACTION_TOOL}. It is now part of this campaign and will still exist next turn.`,
    };
  }

  private invokeDefinedAction(args: Record<string, unknown>): GameMasterToolOutcome {
    const actionId = typeof args["actionId"] === "string" ? args["actionId"] : "";
    const actorId = typeof args["actorId"] === "string" ? args["actorId"] : "";
    const parameters = (args["parameters"] ?? {}) as Record<string, unknown>;
    const definition = this.definedActions.get(actionId);
    if (definition === undefined) {
      const known = [...this.definedActions.keys()];
      return {
        ok: false,
        finished: false,
        factual: known.length === 0
          ? `No action "${actionId}" has been defined in this campaign. Define it first with ${DEFINE_ACTION_TOOL}.`
          : `No action "${actionId}" has been defined. Defined actions are: ${known.join(", ")}.`,
      };
    }
    const actor = this.staged.characters.find((character) => character.id === actorId);
    if (!actor || !actor.alive) {
      return { ok: false, finished: false, factual: `No living character with the id "${actorId}" can take this action.` };
    }
    const limitRefusal = this.actionLimitRefusal(actorId, actionId);
    if (limitRefusal !== null) return { ok: false, finished: false, factual: limitRefusal };

    const executed = applyInventedWorkflow(definition, this.staged, parameters);
    if ("error" in executed) {
      return {
        ok: false,
        finished: false,
        factual: `"${actionId}" changed nothing: ${executed.error}. The world is exactly as it was. Correct the parameters, or the definition itself, and try again.`,
      };
    }

    this.staged = executed.world;
    this.definedActionUses.push({ actionId, actorId, parameters, resolvedPatch: executed.resolvedOperations });

    this.factCounter += 1;
    const factId = `fact-${this.atStep}-${this.factCounter}`;
    this.events.push({
      id: factId,
      atStep: this.atStep,
      kind: "action",
      actionId,
      actorId,
      parameters,
      // A defined action has no hand-written summary, so the Chronicle is told
      // what the definition itself says the act is, in the actor's name.
      summary: `${actor.name}: ${definition.intent}`,
      materialConsequence: true,
    });
    this.recordCapabilityRepairAttempt(actorId, { ok: true, factId });
    return { ok: true, factId, finished: false, factual: `Done [${factId}]: ${actor.name} — ${definition.intent}` };
  }

  // -- capability gap --------------------------------------------------------

  private requestCapability(args: Record<string, unknown>): GameMasterToolOutcome {
    const parsed = CapabilityRequestSchema.safeParse(args);
    if (!parsed.success) {
      return {
        ok: false,
        finished: false,
        factual: `That capability request was rejected: ${parsed.error.issues.map((issue) => issue.message).join("; ")}. A capability request describes an unmet need in plain words; it can never specify a state change.`,
      };
    }
    const request: CapabilityRequest = parsed.data;
    const actor = this.staged.characters.find((character) => character.id === request.actorId);
    if (!actor) {
      return { ok: false, finished: false, factual: `Refused: actor "${request.actorId}" does not exist, so no attempt can be recorded for them.` };
    }
    const limitRefusal = this.actionLimitRefusal(request.actorId);
    if (limitRefusal !== null) {
      return {
        ok: false,
        finished: false,
        factual: `A capability request cannot be used after the actor's action allowance is exhausted. ${limitRefusal}`,
      };
    }
    const existingRepair = [...this.pendingCapabilityRepairs.values()].find((entry) => entry.actorId === request.actorId);
    if (existingRepair !== undefined) {
      return {
        ok: false,
        finished: false,
        factual: `${actor.name} already has an unsupported attempt awaiting repair: ${existingRepair.intent}. Inspect the world and make that repair attempt before raising another capability request.`,
      };
    }

    const id = `capability-${this.atStep}-${this.capabilityRequests.length + 1}`;
    this.capabilityRequests.push(recordCapabilityRequest(request, this.atStep, id));
    this.pendingCapabilityRepairs.set(id, {
      id,
      actorId: request.actorId,
      intent: request.requestedIntent,
    });

    this.factCounter += 1;
    const factId = `fact-${this.atStep}-${this.factCounter}`;
    this.events.push({
      id: factId,
      atStep: this.atStep,
      kind: "capability_gap",
      actionId: request.proposedToolName,
      actorId: request.actorId,
      parameters: {},
      // Capability gaps are internal audit records, not player-facing
      // history. The Chronicle conversion deliberately excludes them.
      summary: `${actor.name} requested an unsupported capability: ${request.requestedIntent.replace(/\s*$/, "").replace(/\.$/, "")}. No world change was applied.`,
      materialConsequence: false,
    });

    return {
      ok: true,
      factId,
      finished: false,
      factual: `Recorded [${factId}] as an unsupported capability request. Nothing changed in the world. Before finishing, inspect the world and make one engine-validated repair attempt for ${actor.name}: use an existing action when one fits, or define and invoke a state-backed action when it truly does not.`,
    };
  }

  // -- termination -----------------------------------------------------------

  private finish(args: Record<string, unknown>): GameMasterToolOutcome {
    const payload = "report" in args ? (args as { report: unknown }).report : args;
    const parsed = GameMasterTurnReportSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        ok: false,
        finished: false,
        factual: `The turn report was rejected: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}. Correct it and call ${FINISH_TURN_TOOL} again.`,
      };
    }

    const knownFactIds = new Set(this.events.map((event) => event.id));
    const unknownRefs = [
      ...parsed.data.events.flatMap((event) => event.factRefs),
      ...parsed.data.directiveOutcomes.flatMap((outcome) => outcome.factRefs),
    ].filter((ref) => !knownFactIds.has(ref));
    if (unknownRefs.length > 0) {
      return {
        ok: false,
        finished: false,
        factual: `The report references facts that never happened: ${[...new Set(unknownRefs)].join(", ")}. Only ids returned by your own tool results exist. Correct the report and call ${FINISH_TURN_TOOL} again.`,
      };
    }

    if (this.pendingCapabilityRepairs.size > 0) {
      const repairs = [...this.pendingCapabilityRepairs.values()]
        .map((entry) => {
          const actorName = this.staged.characters.find((character) => character.id === entry.actorId)?.name ?? entry.actorId;
          return `${actorName}: ${entry.intent}`;
        })
        .join("; ");
      return {
        ok: false,
        finished: false,
        factual:
          `Before finishing, repair these unsupported attempts with one state-backed action attempt by the named actor: ${repairs}. Inspect the relevant world state and use an existing action when possible; otherwise define and invoke a validated action. A genuine rules refusal may stand, but a bad id or invalid arguments must be corrected and retried.`,
      };
    }

    const missingDirectives = this.directiveIds.filter(
      (id) => !parsed.data.directiveOutcomes.some((outcome) => outcome.directiveId === id),
    );
    const prematurelyCompleted = parsed.data.directiveOutcomes.find(outcome => {
      const plan = this.staged.playerPlans?.find(p => p.ownerId === this.actorCharacterId && p.createdAtStep === this.atStep && p.sourceDirectiveId === outcome.directiveId);
      return plan && outcome.outcome === "carried_out" && (plan.stages.length === 0 || plan.stages.some(s => s.status !== "completed"));
    });
    if (prematurelyCompleted) return { ok: false, finished: false, factual: `Directive ${prematurelyCompleted.directiveId} still has unfinished plan stages. Report its actual partial progress or obstacle; do not declare the whole plan completed.` };
    if (missingDirectives.length > 0) {
      return {
        ok: false,
        finished: false,
        factual: `The report leaves these player directives unaccounted for: ${missingDirectives.join(", ")}. Every submitted directive needs an outcome. Correct the report and call ${FINISH_TURN_TOOL} again.`,
      };
    }

    // A recoverable mistake -- a bad/missing id, or arguments the call itself
    // rejected -- must never be reported as the world's own refusal. This is
    // checked on every attempt, not pushed back only once like the world-
    // agency reminder below: an unretried lookup error must never ride
    // through on that single reminder and leave an otherwise-empty turn
    // reported as a real refusal.
    if (this.pendingRecoverableRetries.size > 0) {
      const owed = [...this.pendingRecoverableRetries]
        .map((key) => { const [actionId, actorId] = key.split("::"); return `${actionId} by ${actorId}`; })
        .join("; ");
      return {
        ok: false,
        finished: false,
        factual:
          `Before finishing, correct and retry: ${owed}. That attempt failed only because of a bad or missing id, or arguments the call itself rejected -- not because the world refused it. Inspect the entity to get its real id (or fix the arguments) and call the tool again. Only report a directive as refused or failed once the corrected retry itself does not succeed.`,
      };
    }

    // The world has to have moved on its own. A report whose every event
    // answers a player directive describes a world that did nothing but wait,
    // which is not what any of these characters are doing. Pushed back exactly
    // once: if the Game Master has looked again and there is genuinely nothing,
    // a quiet turn is a legitimate turn and the second report is accepted.
    const worldActedAlone = parsed.data.events.some(
      (event) => event.directiveRef === null && event.factRefs.length > 0,
    );
    if (!worldActedAlone && !this.pushedForWorldAgency) {
      this.pushedForWorldAgency = true;
      return {
        ok: false,
        finished: false,
        factual:
          "This report contains nothing but the player's own orders. The other named characters have goals, pressures, and commitments of their own, and the open threads are still open — none of them were waiting on the player. Let at least one of them act now through the tools, then call "
          + `${FINISH_TURN_TOOL} again. If you look and there is genuinely nothing for anyone to do, say so in the report and call ${FINISH_TURN_TOOL} again as it stands.`,
      };
    }

    // A due life review or political procedure read this turn but never
    // acted on is not a decision -- it is silence. Pushed back exactly once,
    // the same as the world-agency reminder above: if the Game Master looks
    // again and still judges no action warranted, it says so in the report
    // and the second call is accepted.
    if ((this.unaddressedDueLifeReviews.size > 0 || this.unaddressedDueProcedures.size > 0) && !this.pushedForDueOutcomes) {
      this.pushedForDueOutcomes = true;
      const owed = [
        ...[...this.unaddressedDueLifeReviews].map((characterId) => `life review for ${this.staged.characters.find((c) => c.id === characterId)?.name ?? characterId}`),
        ...[...this.unaddressedDueProcedures].map((procedureId) => `political procedure ${procedureId}`),
      ].join("; ");
      return {
        ok: false,
        finished: false,
        factual:
          `You read that these are due but the report does not act on them: ${owed}. Decide each one now -- kill_character/incapacitate_character/recover_from_incapacity (then settle_estate for a death), or resolve_procedure -- or, if you judge none of them warrant a decision yet, say so explicitly in the report and call ${FINISH_TURN_TOOL} again as it stands.`,
      };
    }

    this.report = parsed.data;
    this.finished = true;
    return { ok: true, finished: true, factual: "Turn report accepted." };
  }
}

export function createGameMasterSession(options: GameMasterSessionOptions): GameMasterSession {
  return new GameMasterSession(options);
}
