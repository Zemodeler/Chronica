import { WORKFLOW_REGISTRY } from "../workflows/registry";
import { commandKindOf, type AnyWorkflowDefinition } from "../workflows/types";
import { DEFAULT_AUTHORITY_REQUIREMENTS } from "../authority/authority-grant";
import type { WorldToolAuthorityRequirement, WorldToolDefinition } from "./types";

// docs/32, Part C.6 step 9 (rework): every `WORKFLOW_REGISTRY` entry gets a
// typed-verb counterpart, not only the dozen hand-curated ones. This is a
// pure metadata wrapper -- `dispatch` always names the same workflow id and
// forwards params verbatim, so `executeWorldTool` still runs the real,
// unchanged `executeWorkflow` underneath. Nothing about a workflow's own
// `apply()`, category, or registration changes; this only gives the agent-
// facing catalog one consistent shape (`world-tools/catalog.ts`) to bind
// against instead of two (the raw workflow catalog and the curated verbs).
//
// `system_effect` workflows (invoker authority is `"system"` only -- e.g.
// `resolve_battle`, run only by deterministic engine code) are excluded, the
// same exclusion `gm/tools.ts`'s `buildActionTools` already applies: they
// were never agent-callable, and wrapping them would offer a tool nothing
// should ever be allowed to call directly.

function authorityRequirementFor(definition: AnyWorkflowDefinition): ((params: Record<string, unknown>) => WorldToolAuthorityRequirement | null) | undefined {
  const requirement = DEFAULT_AUTHORITY_REQUIREMENTS[definition.id];
  if (requirement === undefined) return undefined;
  return (params) => {
    const scopeId = params[requirement.scopeParam];
    if (typeof scopeId !== "string") return null;
    return { domain: requirement.domain, power: requirement.power, scope: { kind: requirement.scopeKind, id: scopeId } };
  };
}

/** Wraps one workflow definition as a dispatch-only world tool. */
export function buildWorldToolFromWorkflow(definition: AnyWorkflowDefinition): WorldToolDefinition<Record<string, unknown>> {
  const authorityRequirement = authorityRequirementFor(definition);
  return {
    id: definition.id,
    description: definition.description,
    parametersSchema: definition.parametersSchema,
    ...(authorityRequirement === undefined ? {} : { authorityRequirement }),
    dispatch: (_world, params) => ({ workflowId: definition.id, workflowParams: params }),
  };
}

/**
 * Every agent-callable `WORKFLOW_REGISTRY` entry, auto-wrapped, excluding
 * `excludeIds` -- ids a hand-curated tool already claims (typically because
 * it shares the workflow's own id, e.g. `create_force`), so the catalog
 * never lists two tools under the same name.
 */
export function buildAutoWrappedWorldTools(excludeIds: ReadonlySet<string>): WorldToolDefinition<Record<string, unknown>>[] {
  const tools: WorldToolDefinition<Record<string, unknown>>[] = [];
  for (const definition of WORKFLOW_REGISTRY.values()) {
    if (commandKindOf(definition) === "system_effect") continue;
    if (excludeIds.has(definition.id)) continue;
    tools.push(buildWorldToolFromWorkflow(definition));
  }
  return tools.sort((left, right) => left.id.localeCompare(right.id));
}
