import { z } from "zod";
import { EntityIdSchema } from "../material-state";
import { WORKFLOW_REGISTRY } from "../workflows/registry";
import { commandKindOf, type AnyWorkflowDefinition } from "../workflows/types";
import { CapabilityRequestSchema } from "./capability-request";
import { InventedWorkflowDefinitionSchema } from "../workflows/invented-workflow";
import { GameMasterTurnReportSchema } from "./turn-report";
import { GAME_MASTER_READ_TOOLS, type AnyReadToolDefinition } from "./read-tools";
import { InterpretPlanSchema, ExecutePlanStageSchema, RespondToAssignmentSchema, DeferPlanStageSchema } from "../actions/plans";

// The Game Master's tool surface (GM refactor, requirements 1, 4, 5, 7).
//
// Everything the agent may do is here, and nothing else is possible:
//
//   read tools      -- bounded, factual queries against the staged world
//   action tools    -- the registered workflows, one tool each, unchanged
//   request_capability -- say that no tool fits; changes nothing
//   finish_turn     -- terminate with the structured report
//
// Action tools are generated from the workflow registry rather than written
// out here, so a workflow added to the registry is available to the Game
// Master with the same parameter validation and the same deterministic
// `apply` the rest of the engine uses.
//
// There is still no free-form "apply patch" or "set state" tool: prose has no
// path to world state. `define_action`/`invoke_defined_action` are a narrower
// exception than that -- an action must be *defined* first, as a named,
// parameterised, reviewable thing, and every use of it is re-validated against
// the whole world document exactly like a built-in -- but they are also off
// by default (see `buildGameMasterTools`'s `allowInventedActions`, docs/27).
// The supported path for a player doing something the designers never
// anticipated is `request_capability`: it changes nothing and waits for a
// developer to decide whether the capability is warranted.

export type GameMasterToolKind = "read" | "action" | "capability" | "finish" | "define" | "aftermath" | "plan";

export interface GameMasterToolDefinition {
  readonly name: string;
  readonly kind: GameMasterToolKind;
  readonly description: string;
  /** JSON Schema (draft-07) for the tool's arguments, as sent to the provider. */
  readonly parameters: Record<string, unknown>;
}

export const REQUEST_CAPABILITY_TOOL = "request_capability";
export const FINISH_TURN_TOOL = "finish_turn";
export const DEFINE_ACTION_TOOL = "define_action";
export const INVOKE_DEFINED_ACTION_TOOL = "invoke_defined_action";
export const RECORD_REFUSAL_AFTERMATH_TOOL = "record_refusal_aftermath";

/**
 * JSON Schema keywords a provider's function-calling validator has no use for
 * and may reject outright. `$schema` is meaningless inside a tool definition,
 * and `propertyNames` (which Zod emits for a `record`) says nothing
 * `additionalProperties` has not already said.
 *
 * Only stripped where they are keywords. A `properties` map's own keys are
 * parameter names and are left alone.
 */
const PROVIDER_UNSUPPORTED_KEYWORDS = new Set(["$schema", "propertyNames"]);

function sanitizeSchemaNode(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeSchemaNode);
  if (node === null || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (PROVIDER_UNSUPPORTED_KEYWORDS.has(key)) continue;
    if (key === "properties" && value !== null && typeof value === "object" && !Array.isArray(value)) {
      out[key] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([name, propertySchema]) => [name, sanitizeSchemaNode(propertySchema)]),
      );
      continue;
    }
    out[key] = sanitizeSchemaNode(value);
  }
  return out;
}

function toJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const generated = z.toJSONSchema(schema, { target: "draft-7", io: "input", unrepresentable: "any" });
  return sanitizeSchemaNode(generated) as Record<string, unknown>;
}

/**
 * An action tool's arguments are the workflow's own parameters plus `actorId`:
 * every mutation is somebody's act, and the actor is validated for existence,
 * life, and authority before the workflow runs.
 */
function actionToolSchema(definition: AnyWorkflowDefinition): Record<string, unknown> {
  const parameters = toJsonSchema(definition.parametersSchema as z.ZodTypeAny);
  const properties = { ...((parameters["properties"] as Record<string, unknown> | undefined) ?? {}) };
  const required = [...((parameters["required"] as string[] | undefined) ?? [])];
  return {
    type: "object",
    properties: {
      actorId: {
        type: "string",
        description: "Id of the living character who takes this action. Their existence, life, and authority are checked before anything happens.",
      },
      ...properties,
    },
    required: ["actorId", ...required],
    additionalProperties: false,
  };
}

/** Every registered workflow the Game Master may invoke, as an action tool. */
export function buildActionTools(): GameMasterToolDefinition[] {
  const tools: GameMasterToolDefinition[] = [];
  for (const definition of WORKFLOW_REGISTRY.values()) {
    if (commandKindOf(definition) === "system_effect") continue;
    tools.push({
      name: definition.id,
      kind: "action",
      description: `[${definition.category}] ${definition.description}`,
      parameters: actionToolSchema(definition),
    });
  }
  return tools.sort((left, right) => left.name.localeCompare(right.name));
}

export function buildReadTools(readTools: readonly AnyReadToolDefinition[] = GAME_MASTER_READ_TOOLS): GameMasterToolDefinition[] {
  return readTools.map((tool) => ({
    name: tool.name,
    kind: "read" as const,
    description: tool.description,
    parameters: toJsonSchema(tool.parametersSchema as z.ZodTypeAny),
  }));
}

const CapabilityToolArgsSchema = CapabilityRequestSchema;
const FinishToolArgsSchema = z.object({ report: GameMasterTurnReportSchema }).strict();
const RefusalAftermathToolArgsSchema = z.object({
  /** Returned only for a genuine, non-recoverable refusal earlier this turn. */
  refusalId: z.string().trim().min(1).max(120),
  /** A living office-holder, commander, or political-group leader in the requester's polity. */
  refuserCharacterId: EntityIdSchema,
  /** The public, in-world rationale; it explains the refusal but cannot alter it. */
  reason: z.string().trim().min(3).max(240),
  /** A short quotation attributed to the refuser. */
  quote: z.string().trim().min(3).max(280),
}).strict();

export function buildCapabilityTool(): GameMasterToolDefinition {
  return {
    name: REQUEST_CAPABILITY_TOOL,
    kind: "capability",
    description:
      "Record that an actor attempted something no registered action tool can perform. This changes NOTHING in the world: the attempt is filed as an unsupported internal audit record for developer review. It is never player-facing Chronicle history. Never use it to describe a change you want applied, and never put state paths or values in it.",
    parameters: toJsonSchema(CapabilityToolArgsSchema),
  };
}

export function buildFinishTool(): GameMasterToolDefinition {
  return {
    name: FINISH_TURN_TOOL,
    kind: "finish",
    description:
      "End the turn. Supply the structured report of what the tools you called actually did. Every event you report must reference a factRef returned by an earlier tool result; the report cannot create anything.",
    parameters: toJsonSchema(FinishToolArgsSchema),
  };
}

/**
 * Turns an already-real refusal into an accountable social scene.  This is
 * deliberately not a generic narration tool: the session accepts it only
 * after a non-recoverable engine refusal, names a plausible authority, and
 * records a directed relationship consequence for both people.
 */
export function buildRefusalAftermathTool(): GameMasterToolDefinition {
  return {
    name: RECORD_REFUSAL_AFTERMATH_TOOL,
    kind: "aftermath",
    description:
      "After a tool returns a refusal id for a genuine world refusal, record who publicly refused it, why, and one short quote. This never changes the rejected action or invents resources, authority, or an outcome. The refuser must be a living office-holder, force commander, or active political-group leader in the requester's polity, and the exchange leaves a lasting relationship consequence. Never use it for a bad id, malformed arguments, or an unsupported action.",
    parameters: toJsonSchema(RefusalAftermathToolArgsSchema),
  };
}

/**
 * The complete tool surface for a Game Master turn.
 *
 * Cached, because the registry is immutable for the life of the process and
 * converting ~90 Zod schemas to JSON Schema on every turn is pure waste.
 *
 * Providers cap how many tools one call may carry (OpenAI's is 128). The
 * surface is currently well inside that, but a registry that keeps growing
 * will eventually need the action tools scoped to the turn — by category, or
 * by what the world actually contains — rather than sent whole.
 */
/**
 * Defining an action the engine does not have, and then using it.
 *
 * A registered workflow is a typed thing a developer wrote. These two tools
 * are the escape hatch for everything else: the Game Master describes the
 * state change an unanticipated act would make, the engine validates that
 * description as strictly as it validates any other mutation -- the same
 * whole-world re-parse, the same dangling-reference check, the same protected
 * roots -- and if it holds, the action becomes real and stays real for the
 * rest of the campaign.
 *
 * This is narrower than it looks. A definition is a list of patch operations
 * over world state; it cannot call code, cannot reach outside the document,
 * and cannot touch the clock, the pins, or the schema version. What it buys
 * is that a player who does something the designers never modelled gets a
 * world that answers, instead of a note that the attempt was unsupported.
 */
export function buildDefineActionTool(): GameMasterToolDefinition {
  return {
    name: DEFINE_ACTION_TOOL,
    kind: "define",
    description:
      "Define a new action the engine does not yet have, as a named set of changes to world state, then use it with invoke_defined_action. Use this when a player or character attempts something real that no existing tool covers — sending a gift, swearing an oath, founding a colony, proclaiming a law. Describe only the state change; the engine validates it exactly as strictly as a built-in action, and refuses anything that would leave the world inconsistent. Prefer an existing tool whenever one fits, and never use this to fake an outcome you could not otherwise obtain.",
    parameters: toJsonSchema(InventedWorkflowDefinitionSchema),
  };
}

export function buildInvokeDefinedActionTool(): GameMasterToolDefinition {
  return {
    name: INVOKE_DEFINED_ACTION_TOOL,
    kind: "action",
    description:
      "Carry out an action defined with define_action, or one defined in an earlier turn of this campaign. Names the action, the living character who takes it, and its parameters.",
    parameters: toJsonSchema(
      z
        .object({
          actionId: z.string().trim().min(3).max(80),
          actorId: EntityIdSchema,
          parameters: z.record(z.string(), z.unknown()).default({}),
        })
        .strict(),
    ),
  };
}

const cachedTools = new Map<boolean, GameMasterToolDefinition[]>();

/**
 * The complete tool surface for a Game Master turn.
 *
 * `allowInventedActions` (default `false`, docs/27) gates `define_action`/
 * `invoke_defined_action` out of normal play: the reviewed, supported escape
 * valve for an unanticipated player intent is `request_capability`, which
 * changes nothing and waits for a developer. The invented-action tools stay
 * in code as a developer-controlled rollout/testing exception, not a fourth
 * always-available class of command.
 */
export function buildGameMasterTools(options: { readonly allowInventedActions?: boolean } = {}): GameMasterToolDefinition[] {
  const allowInventedActions = options.allowInventedActions ?? false;
  let built = cachedTools.get(allowInventedActions);
  if (built === undefined) {
    built = [
      ...buildReadTools(),
      ...buildActionTools(),
      ...(allowInventedActions ? [buildDefineActionTool(), buildInvokeDefinedActionTool()] : []),
      buildCapabilityTool(),
      buildRefusalAftermathTool(),
      buildFinishTool(),
      { name: "interpret_plan", kind: "plan", description: "Interpret a saved player plan as up to twelve concrete stages. Preserve original intent, constraints, completed stages and player-named delegates. One stage corresponds to one action; use dependencies and time/location conditions. This records a plan, not an outcome.", parameters: toJsonSchema(InterpretPlanSchema) },
      { name: "execute_plan_stage", kind: "plan", description: "Attempt one ready plan stage through a registered or defined action. Dependencies, delegate acceptance, personal time, authority and actual spending are checked. Completed stages are never repeated; blocked stages persist for retry.", parameters: toJsonSchema(ExecutePlanStageSchema) },
      { name: "respond_to_plan_assignment", kind: "plan", description: "A player-named NPC accepts or declines an assignment based on their own interests, relationship, risk and knowledge. State their reason. Acceptance grants no resources or authority. Never automatically accept just because the player asked.", parameters: toJsonSchema(RespondToAssignmentSchema) },
      { name: "defer_plan_stage", kind: "plan", description: "Keep an uncompleted stage pending with a specific obstacle or an unmet player condition. Use when circumstances cannot yet be established, not to invent a refusal. This changes no material state and preserves the plan for next turn.", parameters: toJsonSchema(DeferPlanStageSchema) },
    ];
    cachedTools.set(allowInventedActions, built);
  }
  // A copy, so a caller that sorts or filters in place cannot corrupt the cache.
  return [...built];
}

export const CapabilityToolArguments = CapabilityToolArgsSchema;
export const FinishToolArguments = FinishToolArgsSchema;
export const RefusalAftermathToolArguments = RefusalAftermathToolArgsSchema;

/** Shape every action tool's arguments share before the workflow schema sees them. */
export const ActionToolEnvelopeSchema = z.object({ actorId: EntityIdSchema }).loose();
