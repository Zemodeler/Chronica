import { z } from "zod";
import type { WorldState } from "../world/world-state";
import type { ProposedInvocation } from "../actions/orders";
import { WORKFLOW_REGISTRY } from "../workflows/registry";
import { executeWorkflow } from "../workflows/executor";
import { validateCandidate, workflowInvocationKey, type PolicyViolation } from "../workflows/policy";
import { InventedWorkflowDefinitionSchema, applyInventedWorkflow, type InventedWorkflowDefinition } from "../workflows/invented-workflow";
import type { WorkflowAuditEntry, WorkflowCandidate } from "../workflows/manager-types";
import { READ_TOOL_BY_NAME, type PrivateInformationPolicy, type ReadToolContext } from "./read-tools";
import {
  CapabilityRequestSchema,
  recordCapabilityRequest,
  type CapabilityRequest,
  type RecordedCapabilityRequest,
} from "./capability-request";
import { GameMasterTurnReportSchema, type GameMasterTurnReport } from "./turn-report";
import {
  FINISH_TURN_TOOL,
  REQUEST_CAPABILITY_TOOL,
  DEFINE_ACTION_TOOL,
  INVOKE_DEFINED_ACTION_TOOL,
  buildGameMasterTools,
  type GameMasterToolDefinition,
} from "./tools";

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
}

export interface GameMasterSessionOptions {
  readonly world: WorldState;
  readonly atStep: number;
  readonly actorCharacterId: string;
  /** Directive ids submitted this turn; the report must account for each. */
  readonly directiveIds: readonly string[];
  readonly privateInformation?: PrivateInformationPolicy;
  /** Hard ceiling on world-changing calls, so a loop cannot run away. */
  readonly maxActions?: number;
  readonly maxToolCalls?: number;
  /**
   * Actions this campaign defined in earlier turns. They are usable
   * immediately, without being defined again: a capability the world once
   * gained does not have to be re-invented every time it is needed.
   */
  readonly definedActions?: readonly InventedWorkflowDefinition[];
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
  /** Every use of a defined action this turn, for the audit trail. */
  readonly definedActionUses: readonly { readonly actionId: string; readonly actorId: string; readonly parameters: Record<string, unknown> }[];
}

const DEFAULT_MAX_ACTIONS = 24;
const DEFAULT_MAX_TOOL_CALLS = 60;
/**
 * How many actions one turn may bring into being. A turn that needs four new
 * capabilities is a turn that has stopped playing the world it is in, and the
 * cap keeps the escape hatch an escape hatch.
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
  private readonly maxActions: number;
  private readonly maxToolCalls: number;

  private readonly events: FactualEvent[] = [];
  private readonly auditEntries: WorkflowAuditEntry[] = [];
  private readonly capabilityRequests: RecordedCapabilityRequest[] = [];
  private readonly executedInvocations: ProposedInvocation[] = [];
  private readonly seenInvocationKeys = new Set<string>();

  private report: GameMasterTurnReport | null = null;
  private actionCount = 0;
  /** A turn is pushed back for world agency at most once; see `finish`. */
  private pushedForWorldAgency = false;
  /** Actions this campaign has: the ones carried in from earlier turns, plus any defined now. */
  private readonly definedActions: Map<string, InventedWorkflowDefinition>;
  private readonly definedThisTurn: InventedWorkflowDefinition[] = [];
  private readonly definedActionUses: { actionId: string; actorId: string; parameters: Record<string, unknown> }[] = [];
  private toolCallCount = 0;
  private readCallCount = 0;
  private factCounter = 0;
  private finished = false;

  readonly directiveIds: readonly string[];

  constructor(options: GameMasterSessionOptions) {
    this.staged = options.world;
    this.atStep = options.atStep;
    this.actorCharacterId = options.actorCharacterId;
    this.directiveIds = [...options.directiveIds];
    this.privateInformation = options.privateInformation ?? "omit";
    this.maxActions = options.maxActions ?? DEFAULT_MAX_ACTIONS;
    this.maxToolCalls = options.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
    this.definedActions = new Map((options.definedActions ?? []).map((definition) => [definition.actionId, definition]));
  }

  /** The tool surface this session accepts. Anything else is refused by name. */
  listTools(): GameMasterToolDefinition[] {
    return buildGameMasterTools();
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
    };
  }

  /** Execute one tool call against the staged world. Never throws. */
  invoke(call: GameMasterToolCall): GameMasterToolOutcome {
    if (this.finished) {
      return { ok: false, factual: "The turn is already finished; no further tool calls are accepted.", finished: true };
    }
    this.toolCallCount += 1;
    if (this.toolCallCount > this.maxToolCalls) {
      return { ok: false, factual: `Tool budget exhausted (${this.maxToolCalls} calls). Call ${FINISH_TURN_TOOL} now.`, finished: false };
    }

    const args = call.arguments ?? {};
    if (call.name === FINISH_TURN_TOOL) return this.finish(args);
    if (call.name === DEFINE_ACTION_TOOL) return this.defineAction(args);
    if (call.name === INVOKE_DEFINED_ACTION_TOOL) return this.invokeDefinedAction(args);
    if (call.name === REQUEST_CAPABILITY_TOOL) return this.requestCapability(args);
    if (READ_TOOL_BY_NAME.has(call.name)) return this.read(call.name, args);
    if (WORKFLOW_REGISTRY.has(call.name)) return this.act(call.name, args);

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
    };
    const result = tool.read(context, parsed.data);
    return { ok: result.ok, factual: result.factual, finished: false };
  }

  // -- actions ---------------------------------------------------------------

  private act(actionId: string, args: Record<string, unknown>): GameMasterToolOutcome {
    if (this.actionCount >= this.maxActions) {
      return {
        ok: false,
        finished: false,
        factual: `This turn's action budget (${this.maxActions}) is spent. Call ${FINISH_TURN_TOOL} and report what happened.`,
      };
    }

    const { actorId, ...parameters } = args as { actorId?: unknown } & Record<string, unknown>;
    if (typeof actorId !== "string" || actorId.trim().length === 0) {
      return { ok: false, finished: false, factual: `${actionId} requires "actorId": the living character who takes this action.` };
    }

    const invocation: ProposedInvocation = { actionId, actorId, parameters };
    const outcome = this.applyInvocation(invocation, "game_master");
    if (!outcome.ok) return { ok: false, finished: false, factual: outcome.factual };

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
  ): { ok: boolean; factual: string; factId?: string } {
    const auditBase: WorkflowAuditEntry = {
      correlationId: `gm-${this.atStep}-${this.auditEntries.length}`,
      source: "game_master",
      sourceRef: source === "system" ? "engine" : "game_master",
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
      return { ok: false, factual: `Refused: ${violation.message}` };
    }

    const duplicateKey = workflowInvocationKey(invocation);
    if (source === "game_master" && this.seenInvocationKeys.has(duplicateKey)) {
      const message = `Refused: ${invocation.actionId} with these exact parameters has already been carried out this turn by ${invocation.actorId}.`;
      this.auditEntries.push({
        ...auditBase,
        policyViolation: { kind: "duplicate", message },
        dryRunOk: false,
        executionOk: false,
        executionReason: message,
      });
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
      const recoverable = executed.reason === "not_applicable"
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
      return { ok: false, factual: `Failed: ${executed.message}${recoverable}` };
    }

    // Committed to the stage only now, after the executor has re-validated
    // the whole world document.
    this.staged = executed.world;
    this.seenInvocationKeys.add(duplicateKey);
    if (source === "game_master") this.actionCount += 1;
    this.executedInvocations.push(invocation);
    this.auditEntries.push({ ...auditBase, finalInvocation: invocation, dryRunOk: true, executionOk: true });

    this.factCounter += 1;
    const factId = `fact-${this.atStep}-${this.factCounter}`;
    const battleId = invocation.actionId === "resolve_battle" ? invocation.parameters["battleId"] : undefined;
    const battleBrief = typeof battleId === "string" ? deriveBattleBrief(before, executed.world, battleId) : null;
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
    });
    return { ok: true, factual: `Done [${factId}]: ${executed.result.summary}`, factId };
  }

  // -- defining what the engine does not have --------------------------------
  //
  // The escape hatch, and the reason it is safe enough to have: a definition
  // is a named, parameterised list of patch operations, and every use of it
  // goes through `applyInventedWorkflow`, which re-parses the entire world
  // document, refuses any dangling reference it would introduce, and refuses
  // the clock, the pins, and the schema version outright. What it cannot do
  // is anything a built-in workflow could not also do.

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
    if (this.actionCount >= this.maxActions) {
      return { ok: false, finished: false, factual: `This turn's action budget (${this.maxActions}) is spent. Call ${FINISH_TURN_TOOL} and report what happened.` };
    }
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

    const executed = applyInventedWorkflow(definition, this.staged, parameters);
    if ("error" in executed) {
      return {
        ok: false,
        finished: false,
        factual: `"${actionId}" changed nothing: ${executed.error}. The world is exactly as it was. Correct the parameters, or the definition itself, and try again.`,
      };
    }

    this.staged = executed.world;
    this.actionCount += 1;
    this.definedActionUses.push({ actionId, actorId, parameters });

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

    const id = `capability-${this.atStep}-${this.capabilityRequests.length + 1}`;
    this.capabilityRequests.push(recordCapabilityRequest(request, this.atStep, id));

    this.factCounter += 1;
    const factId = `fact-${this.atStep}-${this.factCounter}`;
    this.events.push({
      id: factId,
      atStep: this.atStep,
      kind: "capability_gap",
      actionId: request.proposedToolName,
      actorId: request.actorId,
      parameters: {},
      // Written as history, not as an engine notice. The reader is told the
      // attempt was made and that nothing came of it -- which is true and is
      // the whole of what is known -- without being told about the machine
      // that failed to model it.
      summary: `${actor.name} set the matter in motion: ${request.requestedIntent.replace(/\s*$/, "").replace(/\.$/, "")}. It went no further, and the matter stood unresolved.`,
      materialConsequence: false,
    });

    return {
      ok: true,
      factId,
      finished: false,
      factual: `Recorded [${factId}] as an unsupported capability request. Nothing changed in the world. Continue with the tools that do exist, or finish the turn reporting that this attempt had no effect.`,
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

    const missingDirectives = this.directiveIds.filter(
      (id) => !parsed.data.directiveOutcomes.some((outcome) => outcome.directiveId === id),
    );
    if (missingDirectives.length > 0) {
      return {
        ok: false,
        finished: false,
        factual: `The report leaves these player directives unaccounted for: ${missingDirectives.join(", ")}. Every submitted directive needs an outcome. Correct the report and call ${FINISH_TURN_TOOL} again.`,
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

    this.report = parsed.data;
    this.finished = true;
    return { ok: true, finished: true, factual: "Turn report accepted." };
  }
}

export function createGameMasterSession(options: GameMasterSessionOptions): GameMasterSession {
  return new GameMasterSession(options);
}
