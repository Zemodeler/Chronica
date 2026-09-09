import { z } from "zod";
import { REPRESENTATIVE_WORLD_TOOLS } from "./definitions";
import { createEntityTool, createInstitutionTool, createStructureTool, linkEntitiesTool, updateEntityTool } from "./definitions-entities";
import { DOMAIN_WORLD_TOOLS } from "./definitions-domain";
import { WORLD_READ_TOOLS } from "./read";
import { buildAutoWrappedWorldTools } from "./auto-wrap";
import type { AnyWorldReadToolDefinition, AnyWorldToolDefinition } from "./types";

// docs/32, Part C.6 step 9: the agent-facing tool catalog, now covering
// every agent-callable `WORKFLOW_REGISTRY` entry, not only the curated
// verbs -- a hand-curated tool (its own richer description, or a fallback
// for when no workflow fits, e.g. `create_force`, `transfer_resource`)
// takes precedence by id; every other registered workflow gets an
// automatic dispatch-only wrapper (`auto-wrap.ts`) so the catalog is a
// complete, uniform replacement for the raw workflow list, never a subset
// of it. `GameMasterSession.enableWorldTools` (opt-in, `agents/orchestrator.ts`
// turns it on) is what actually offers this catalog to a live agent loop.

export interface WorldToolCatalogEntry {
  readonly name: string;
  readonly kind: "action" | "read";
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

function toJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: "draft-7", io: "input", unrepresentable: "any" }) as Record<string, unknown>;
}

const CURATED_WORLD_TOOLS: readonly AnyWorldToolDefinition[] = [
  ...REPRESENTATIVE_WORLD_TOOLS,
  createEntityTool,
  updateEntityTool,
  linkEntitiesTool,
  createInstitutionTool,
  createStructureTool,
  ...DOMAIN_WORLD_TOOLS,
];

export const ALL_WORLD_TOOLS: readonly AnyWorldToolDefinition[] = [
  ...CURATED_WORLD_TOOLS,
  ...buildAutoWrappedWorldTools(new Set(CURATED_WORLD_TOOLS.map((tool) => tool.id))),
];

export const ALL_WORLD_READ_TOOLS: readonly AnyWorldReadToolDefinition[] = WORLD_READ_TOOLS;

export function buildWorldToolCatalog(): WorldToolCatalogEntry[] {
  const actions: WorldToolCatalogEntry[] = ALL_WORLD_TOOLS.map((tool) => ({
    name: tool.id, kind: "action", description: tool.description, parameters: toJsonSchema(tool.parametersSchema as z.ZodTypeAny),
  }));
  const reads: WorldToolCatalogEntry[] = ALL_WORLD_READ_TOOLS.map((tool) => ({
    name: tool.id, kind: "read", description: tool.description, parameters: toJsonSchema(tool.parametersSchema as z.ZodTypeAny),
  }));
  return [...reads, ...actions].sort((left, right) => left.name.localeCompare(right.name));
}
