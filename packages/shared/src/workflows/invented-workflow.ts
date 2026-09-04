import { z } from "zod";
import { WorldStateSchema, type WorldState } from "../world/world-state";
import type { WorkflowInvokerAuthority, WorkflowScopeLimit } from "./types";
import { findWorldReferenceViolations } from "../world/references";

// RETIRED FOR ORDINARY PLAY (Game Master refactor, docs/24).
//
// Nothing here is reachable from turn resolution any more: the executor has
// no invented-workflow path, and migration 0029 disables every persisted
// template. It is kept so existing rows stay readable for migration review,
// and so a developer converting one into a registered typed workflow can see
// exactly what it did. The safeguard that replaced it is
// `gm/capability-request.ts`, which records an unmet need and mutates nothing.

/** A deliberately small, serialisable parameter language for runtime workflows. */
export const InventedWorkflowParameterSchema = z.object({
  name: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,63}$/),
  type: z.enum(["string", "number", "boolean", "entity_id", "json"]),
  required: z.boolean().default(true),
  enum: z.array(z.string()).max(32).optional(),
}).strict();
export type InventedWorkflowParameter = z.infer<typeof InventedWorkflowParameterSchema>;

/** RFC-6902-inspired operations. Paths additionally support `[id=value]` array selectors. */
export const InventedPatchOperationSchema = z.object({
  op: z.enum(["add", "replace", "remove"]),
  path: z.string().startsWith("/").max(500),
  value: z.unknown().optional(),
}).strict().superRefine((value, context) => {
  if (value.op !== "remove" && value.value === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "add and replace operations require a value." });
  }
  if (value.op === "remove" && value.value !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "remove operations must not contain a value." });
  }
});
export type InventedPatchOperation = z.infer<typeof InventedPatchOperationSchema>;

export const InventedWorkflowDefinitionSchema = z.object({
  actionId: z.string().regex(/^[a-z][a-z0-9_]{2,79}$/),
  intent: z.string().trim().min(1).max(600),
  description: z.string().trim().min(1).max(600),
  parameters: z.array(InventedWorkflowParameterSchema).max(12),
  operations: z.array(InventedPatchOperationSchema).min(1).max(24),
  invokerAuthority: z.array(z.enum(["player", "world_director", "character_director", "system"])).min(1).default(["player", "world_director"]),
  scopeLimit: z.enum(["near", "far", "coarse"]).optional(),
}).strict().superRefine((value, context) => {
  const names = new Set<string>();
  for (const parameter of value.parameters) {
    if (names.has(parameter.name)) context.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate parameter ${parameter.name}.` });
    names.add(parameter.name);
  }
});
export type InventedWorkflowDefinition = z.infer<typeof InventedWorkflowDefinitionSchema>;

export interface RuntimeInventedWorkflow {
  readonly id: string;
  readonly gameId: string;
  readonly definition: InventedWorkflowDefinition;
  readonly status: "active" | "disabled";
}

export interface InventedWorkflowExecution {
  readonly world: WorldState;
  readonly resolvedOperations: InventedPatchOperation[];
}

const PROTECTED_ROOTS = new Set(["schemaVersion", "pins", "elapsedStep", "lastTurnSummary"]);
const PLACEHOLDER = /{{([a-z][a-zA-Z0-9_]*)}}/g;

export function validateInventedWorkflowParameters(
  definition: InventedWorkflowDefinition,
  parameters: Record<string, unknown>,
): string | null {
  const expected = new Set(definition.parameters.map((parameter) => parameter.name));
  for (const key of Object.keys(parameters)) if (!expected.has(key)) return `Unexpected parameter "${key}".`;
  for (const parameter of definition.parameters) {
    const value = parameters[parameter.name];
    if (value === undefined) {
      if (parameter.required) return `Missing parameter "${parameter.name}".`;
      continue;
    }
    if (parameter.type === "string" || parameter.type === "entity_id") {
      if (typeof value !== "string" || value.trim().length === 0) return `Parameter "${parameter.name}" must be a non-empty string.`;
      if (parameter.enum && !parameter.enum.includes(value)) return `Parameter "${parameter.name}" must be one of its allowed values.`;
    } else if (parameter.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
      return `Parameter "${parameter.name}" must be a finite number.`;
    } else if (parameter.type === "boolean" && typeof value !== "boolean") {
      return `Parameter "${parameter.name}" must be a boolean.`;
    }
  }
  return null;
}

function interpolateString(value: string, parameters: Record<string, unknown>): string {
  return value.replace(PLACEHOLDER, (_all, name: string) => {
    const replacement = parameters[name];
    if (replacement === undefined || typeof replacement === "object") throw new Error(`Path placeholder "${name}" is not a scalar parameter.`);
    if (typeof replacement === "string" || typeof replacement === "number" || typeof replacement === "boolean") return String(replacement);
    throw new Error(`Path placeholder "${name}" is not a scalar parameter.`);
  });
}

function interpolate(value: unknown, parameters: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    const exact = value.match(/^{{([a-z][a-zA-Z0-9_]*)}}$/);
    if (exact) {
      const name = exact[1]!;
      if (!(name in parameters)) throw new Error(`Unknown parameter "${name}".`);
      return parameters[name];
    }
    return interpolateString(value, parameters);
  }
  if (Array.isArray(value)) return value.map((item) => interpolate(item, parameters));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolate(item, parameters)]));
  return value;
}

function decodeSegment(segment: string): string { return segment.replace(/~1/g, "/").replace(/~0/g, "~"); }

/** Resolve a pointer with collection selectors such as /characters[id={{characterId}}]/healthBps. */
function resolveParent(root: unknown, rawPath: string, parameters: Record<string, unknown>): { parent: Record<string, unknown> | unknown[]; key: string } {
  const segments = rawPath.split("/").slice(1).map((part) => decodeSegment(interpolateString(part, parameters)));
  if (segments.length === 0) throw new Error("Patch path may not target the document root.");
  if (PROTECTED_ROOTS.has(segments[0]!)) throw new Error(`Patch path "${rawPath}" targets protected world state.`);
  let current: unknown = root;
  for (const rawSegment of segments.slice(0, -1)) {
    const selector = rawSegment.match(/^(.+)\[id=(.+)\]$/);
    if (selector) {
      if (!current || typeof current !== "object" || Array.isArray(current)) throw new Error(`Selector "${rawSegment}" has no object parent.`);
      const collection = (current as Record<string, unknown>)[selector[1]!];
      if (!Array.isArray(collection)) throw new Error(`Selector "${rawSegment}" does not name an array.`);
      current = collection.find((item) => item && typeof item === "object" && (item as Record<string, unknown>).id === selector[2]);
      if (!current) throw new Error(`Selector "${rawSegment}" found no entity.`);
      continue;
    }
    if (Array.isArray(current)) {
      const index = Number(rawSegment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) throw new Error(`Array index "${rawSegment}" is invalid.`);
      current = current[index];
    } else if (current && typeof current === "object") {
      if (!(rawSegment in current)) throw new Error(`Patch path segment "${rawSegment}" does not exist.`);
      current = (current as Record<string, unknown>)[rawSegment];
    } else throw new Error(`Patch path segment "${rawSegment}" has no parent.`);
  }
  if (!current || typeof current !== "object") throw new Error(`Patch parent for "${rawPath}" is not an object or array.`);
  const key = segments.at(-1)!;
  const finalSelector = key.match(/^(.+)\[id=(.+)\]$/);
  if (finalSelector) {
    if (Array.isArray(current)) throw new Error(`Selector "${key}" has no object parent.`);
    const collection = (current as Record<string, unknown>)[finalSelector[1]!];
    if (!Array.isArray(collection)) throw new Error(`Selector "${key}" does not name an array.`);
    const index = collection.findIndex((item) => item && typeof item === "object" && (item as Record<string, unknown>).id === finalSelector[2]);
    if (index === -1) throw new Error(`Selector "${key}" found no entity.`);
    return { parent: collection, key: String(index) };
  }
  return { parent: current as Record<string, unknown> | unknown[], key };
}

/** Atomically apply an invented template; callers receive an error rather than partial state. */
export function applyInventedWorkflow(
  definition: InventedWorkflowDefinition,
  world: WorldState,
  parameters: Record<string, unknown>,
): InventedWorkflowExecution | { error: string } {
  const parameterError = validateInventedWorkflowParameters(definition, parameters);
  if (parameterError) return { error: parameterError };
  const next = structuredClone(world) as unknown as Record<string, unknown>;
  const resolvedOperations: InventedPatchOperation[] = [];
  try {
    for (const operation of definition.operations) {
      const path = interpolateString(operation.path, parameters);
      const value = operation.value === undefined ? undefined : interpolate(operation.value, parameters);
      const { parent, key } = resolveParent(next, path, parameters);
      if (Array.isArray(parent)) {
        if (operation.op === "add" && key === "-") parent.push(value);
        else {
          const index = Number(key);
          if (!Number.isInteger(index) || index < 0 || index >= parent.length) throw new Error(`Array target "${key}" is invalid.`);
          if (operation.op === "remove") parent.splice(index, 1);
          else parent[index] = value;
        }
      } else if (operation.op === "remove") {
        if (!(key in parent)) throw new Error(`Cannot remove missing property "${key}".`);
        delete parent[key];
      } else {
        if (operation.op === "replace" && !(key in parent)) throw new Error(`Cannot replace missing property "${key}".`);
        parent[key] = value;
      }
      resolvedOperations.push(operation.op === "remove" ? { op: operation.op, path } : { op: operation.op, path, value });
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Patch could not be resolved." };
  }
  const parsed = WorldStateSchema.safeParse(next);
  if (!parsed.success) return { error: `Patch produced an invalid world: ${parsed.error.issues.map((issue) => issue.message).join("; ")}` };
  const referenceErrors = findWorldReferenceViolations(parsed.data);
  if (referenceErrors.length > 0) return { error: `Patch produced invalid references: ${referenceErrors.join("; ")}` };
  return { world: parsed.data, resolvedOperations };
}

export function inventedWorkflowAuthority(definition: InventedWorkflowDefinition): readonly WorkflowInvokerAuthority[] { return definition.invokerAuthority; }
export function inventedWorkflowScope(definition: InventedWorkflowDefinition): WorkflowScopeLimit | undefined { return definition.scopeLimit; }
