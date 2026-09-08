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
export const RECORD_ENTITY_NOTE_TOOL = "record_entity_note";
export const FLAG_NPC_INITIATED_DIALOGUE_TOOL = "flag_npc_initiated_dialogue";
export const FLAG_AMBIENT_EVENT_TOOL = "flag_ambient_event";

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
const RecordEntityNoteToolArgsSchema = z.object({
  /** Any world entity's id -- a force, a building, a settlement, a character. */
  entityId: EntityIdSchema,
  entityType: z.enum(["force", "building", "settlement", "character", "institution", "other"]),
  /** What was said or decided about it. Kept close to the actual words -- no interpretation at write time. */
  text: z.string().trim().min(1).max(400),
}).strict();

const FlagNpcInitiatedDialogueArgsSchema = z.object({
  /** A living, named character -- never the player's own. */
  characterId: EntityIdSchema,
  /** One line on what they want to discuss; shown to the player before they open the conversation. */
  topic: z.string().trim().min(1).max(160),
  /** Exactly what this character says first, in their own voice, once the player opens the thread. */
  openingLine: z.string().trim().min(1).max(600),
}).strict();

const FlagAmbientEventArgsSchema = z.object({
  /** A short, self-contained paragraph of world-flavor narration, entirely outside the player's own tracked theater. */
  narrative: z.string().trim().min(1).max(600),
}).strict();

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
 * Records a freeform note against any entity -- what a player said when they
 * created something ("a Legio trained specifically against Carthaginian war
 * elephants"), or what the Game Master itself observed as it developed
 * ("the academy graduated its first cohort of siege engineers"). This is
 * memory, not a mechanical modifier: nothing reads it to compute a bonus.
 * It exists so a later turn's Game Master sees the same words again and can
 * decide, in its own judgment, what -- if anything -- they are worth this
 * time, the same way it already reads a character's goals or beliefs rather
 * than a formula.
 */
export function buildRecordEntityNoteTool(): GameMasterToolDefinition {
  return {
    name: RECORD_ENTITY_NOTE_TOOL,
    kind: "aftermath",
    description:
      "Record a freeform note against any entity you can name an id for -- a force, a building, a settlement, a character, an institution. Use it to capture what a player stated when creating or ordering something (a unit's declared purpose, a building's stated function), or to add a later development worth remembering. This changes nothing else about the entity and grants no mechanical bonus by itself; the note is memory you (or a later turn's Game Master) may draw on at your own discretion when it becomes narratively relevant, never a guaranteed effect.",
    parameters: toJsonSchema(RecordEntityNoteToolArgsSchema),
  };
}

/**
 * Lets a named character be the one who opens a conversation, instead of the
 * player always being the one to start it. This changes nothing in the
 * world by itself -- it only marks that this character wants to talk, and
 * gives their opening line, so the player sees an affordance to open the
 * thread on their own initiative. Use sparingly: reserve it for a character
 * with a real, current reason to reach out (an unresolved demand, urgent
 * news, a decision that affects the player directly), never as a routine
 * check-in.
 */
export function buildFlagNpcInitiatedDialogueTool(): GameMasterToolDefinition {
  return {
    name: FLAG_NPC_INITIATED_DIALOGUE_TOOL,
    kind: "aftermath",
    description:
      "Mark that a named, living character wants to open a conversation with the player, with a short topic and their exact opening line. This does not open the conversation itself or put words in the player's mouth -- it surfaces an affordance the player may choose to act on. Use only when the character has a real, current reason (an unresolved demand, urgent news, a choice bearing on the player) -- never as routine flavour, and never for the player's own character.",
    parameters: toJsonSchema(FlagNpcInitiatedDialogueArgsSchema),
  };
}

/**
 * Records one line of world-flavor narration entirely outside the player's
 * tracked theater -- a rival civilization's rise, a distant famine, a court
 * intrigue nobody here will ever hear about. Purely immersion: no tool call
 * of consequence backs it, and the session refuses a second call in the same
 * turn (docs: at most one ambient event per turn), so it can never crowd out
 * the turn's real work or read as though it mattered mechanically.
 */
export function buildFlagAmbientEventTool(): GameMasterToolDefinition {
  return {
    name: FLAG_AMBIENT_EVENT_TOOL,
    kind: "aftermath",
    description:
      "Record one short paragraph of world-flavor narration entirely disconnected from the player's own tracked theater and forces -- a distant power's rise, a famine, a court intrigue elsewhere in the world. At most one per turn; the session refuses a second call. Never use this for anything involving a tracked polity, character, or force -- use the ordinary action tools for that.",
    parameters: toJsonSchema(FlagAmbientEventArgsSchema),
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
      buildRecordEntityNoteTool(),
      buildFlagNpcInitiatedDialogueTool(),
      buildFlagAmbientEventTool(),
      buildFinishTool(),
      { name: "interpret_plan", kind: "plan", description: "Interpret a saved player plan as up to twelve concrete stages, OR ask clarification questions -- never both in the same call. First classify every factual assertion the plan's own text makes as a claim (world_premise, actor_belief, deliberate_message, preference, or condition) and check it against known facts; a world_premise you know to be contradicted must never become the basis for a stage. Ask clarification only when several interpretations would diverge materially, an actor or target cannot be inferred safely, the order could start a war, spend beyond an unstated amount, surrender territory, kill someone, or abandon a major commitment, or no interpretation preserves every stated constraint -- never for a harmless implementation detail. Infer method, conditions, secrecy, named delegates and any spending cap from the plan's own words -- never invent a delegate or a sum the player did not name. Preserve original intent, completed stages and, once spending has occurred, the same budget account. One stage corresponds to one action; use dependencies and time/location conditions. This records a plan, not an outcome.", parameters: toJsonSchema(InterpretPlanSchema) },
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
export const RecordEntityNoteToolArguments = RecordEntityNoteToolArgsSchema;
export const FlagNpcInitiatedDialogueArguments = FlagNpcInitiatedDialogueArgsSchema;
export const FlagAmbientEventArguments = FlagAmbientEventArgsSchema;

/** Shape every action tool's arguments share before the workflow schema sees them. */
export const ActionToolEnvelopeSchema = z.object({ actorId: EntityIdSchema }).loose();
