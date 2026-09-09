import { z } from "zod";
import { EntityIdSchema } from "../material-state";
import type { WorldState } from "../world/world-state";
import { buildStarContextPayload } from "../star-context/context";
import type { StarContext } from "../star-context/schema";
import type { WorldReadToolDefinition } from "./types";

// `inspect_entity`/`inspect_context` (docs/32, Part C.1): thin dispatchers
// over data already in `WorldState`, not a full-world dump. Deliberately a
// standalone reader (same reasoning as `star-context/context.ts`) rather
// than a refactor of `gm/read-tools.ts`'s existing bounded handlers, which
// this pass leaves untouched.

type EntityLookupKind = "character" | "force" | "province" | "settlement" | "institution" | "account" | "project" | "structure" | "generic_entity";

function findEntity(world: WorldState, entityId: string): { kind: EntityLookupKind; data: unknown } | undefined {
  const character = world.characters.find((c) => c.id === entityId);
  if (character !== undefined) return { kind: "character", data: character };
  const force = world.material.forces.find((f) => f.id === entityId);
  if (force !== undefined) return { kind: "force", data: force };
  const province = world.map.provinces.find((p) => p.id === entityId);
  if (province !== undefined) return { kind: "province", data: province };
  for (const p of world.map.provinces) {
    const settlement = p.settlements.find((s) => s.id === entityId);
    if (settlement !== undefined) return { kind: "settlement", data: settlement };
  }
  const institution = world.material.institutions.find((i) => i.id === entityId);
  if (institution !== undefined) return { kind: "institution", data: institution };
  const account = world.material.accounts.find((a) => a.id === entityId);
  if (account !== undefined) return { kind: "account", data: account };
  const project = world.projects.find((p) => p.id === entityId);
  if (project !== undefined) return { kind: "project", data: project };
  const structure = world.structures.find((s) => s.id === entityId);
  if (structure !== undefined) return { kind: "structure", data: structure };
  const genericEntity = world.genericEntities.find((e) => e.id === entityId);
  if (genericEntity !== undefined) return { kind: "generic_entity", data: genericEntity };
  return undefined;
}

const InspectEntityParams = z.object({ entityId: EntityIdSchema }).strict();

export const inspectEntityTool: WorldReadToolDefinition<z.infer<typeof InspectEntityParams>> = {
  id: "inspect_entity",
  description: "Look up any entity by id -- a character, force, province, settlement, institution, account, project, structure, or generic entity -- without needing to know in advance which kind it is.",
  parametersSchema: InspectEntityParams,
  read: (world, params) => {
    const found = findEntity(world, params.entityId);
    if (found === undefined) return { ok: false, reason: `No entity exists with the id "${params.entityId}".` };
    return { ok: true, data: found };
  },
};

const InspectContextParams = z.object({
  level: z.enum(["person", "unit", "settlement", "province", "region", "theatre", "polity", "world"]),
  scopeRefId: EntityIdSchema,
}).strict();

export const inspectContextTool: WorldReadToolDefinition<z.infer<typeof InspectContextParams>> = {
  id: "inspect_context",
  description: "Read a star context's bounded institutional view (forces, open procedures, institutions, public accounts, active wars/sieges in scope) -- never private character goals, plots, or beliefs.",
  parametersSchema: InspectContextParams,
  read: (world, params) => {
    // A minimal context is synthesized from the ref alone -- the caller is
    // expected to already know the level/scope it wants inspected, unlike
    // `selectStarContext`'s own turn-relevance scoring.
    const scopeKindByLevel: Record<typeof params.level, string> = {
      person: "character", unit: "force", settlement: "settlement", province: "province",
      region: "region", theatre: "theatre", polity: "polity", world: "world",
    };
    const context: StarContext = {
      id: `inspect:${params.level}:${params.scopeRefId}`,
      level: params.level,
      scopeRef: { kind: scopeKindByLevel[params.level] as StarContext["scopeRef"]["kind"], id: params.scopeRefId },
      label: params.scopeRefId,
      representativeCharacterId: null,
      parentContextId: null,
      activatedAtStep: 0,
      lastAddressedAtStep: 0,
    };
    return { ok: true, data: buildStarContextPayload(world, context) };
  },
};

export const WORLD_READ_TOOLS: readonly WorldReadToolDefinition<any>[] = [inspectEntityTool, inspectContextTool];
