import { z } from "zod";
import { EntityIdSchema } from "../material-state";
import { OrderPartyRefSchema } from "../actions/orders";
import { GenericEntitySchema } from "../world/generic-entity";
import { StructureSchema } from "../world/structure";
import { emitFacts, NO_INTERVENTION_SIGNALS, type FactDraft } from "../world/facts";
import type { WorldToolDefinition } from "./types";

// `create_entity`/`update_entity`/`link_entities` (docs/32, Part C.1): the
// true generic fallback. `create_institution`/`create_structure` are typed
// (they already have real schemas -- `GovernmentInstitutionSchema`,
// `StructureSchema`) so they are narrow primitives, not generic ones, even
// though (like the generic fallback) no existing workflow creates either
// kind today. `create_training_program`/`create_policy` have no schema of
// their own yet, so they go through `create_entity` with a `kind` tag --
// exactly the "genuinely novel composition" case the generic fallback
// exists for.

const CreateEntityParams = z.object({
  kind: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(160),
  ownerRef: OrderPartyRefSchema.nullable().default(null),
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  linkedEntityIds: z.array(EntityIdSchema).max(20).default([]),
}).strict();

export const createEntityTool: WorldToolDefinition<z.infer<typeof CreateEntityParams>> = {
  id: "create_entity",
  description: "Create a generic entity for a composition no typed schema fits -- a training program, a policy, anything genuinely novel. Prefer a narrower tool (create_force, create_institution, create_structure, create_project, ...) whenever one matches.",
  parametersSchema: CreateEntityParams,
  dispatch: () => null,
  fallback: (world, params, ctx) => {
    const id = `entity:${params.kind}:${ctx.atStep}:${world.genericEntities.length}`;
    const parsed = GenericEntitySchema.safeParse({
      id, kind: params.kind, label: params.label, ownerRef: params.ownerRef,
      attributes: params.attributes, linkedEntityIds: params.linkedEntityIds,
      createdAtStep: ctx.atStep, provenanceEventIds: [],
    });
    if (!parsed.success) return { ok: false, reason: parsed.error.issues.map((issue) => issue.message).join("; ") };
    // docs/32 corrective pass, requirement 5: a generic entity has no typed
    // mechanical effect by design (see `world/generic-entity.ts`) -- so its
    // creation always leaves a durable developer-review fact recording its
    // composition, the same canonical ledger every other fact this turn
    // produces lands in (never a Chronicle-only note nobody can query back).
    // A missing reusable primitive is exactly what this is for: if a "kind"
    // recurs often enough across these facts, that is the signal a typed
    // tool (like `create_structure`/`create_institution` before it) is due.
    const reviewDraft: FactDraft = {
      time: ctx.atInstant ?? { day: 0, minute: 0 },
      atStep: ctx.atStep,
      kind: "developer_review_generic_entity",
      summary: `Generic entity "${params.label}" (kind: "${params.kind}") was recorded with no typed mechanical effect. Composition: ${JSON.stringify(params.attributes)}. If this composition recurs, it is a candidate for a typed primitive.`,
      affectedEntities: params.ownerRef === null ? [] : [params.ownerRef],
      resourceChanges: [],
      authorityChange: undefined,
      visibility: "private",
      discovery: { state: "private", knowableAtInstant: null, discoveredBy: [] },
      evidence: null,
      eligibleReactionScopes: [],
      interventionSignals: NO_INTERVENTION_SIGNALS,
      sourceEventId: null,
      sourceActionId: null,
      causalDepth: 0,
    };
    const [reviewFact] = emitFacts([reviewDraft], () => `fact:dev-review:${ctx.atStep}:${id}`);
    return {
      ok: true,
      world: { ...world, genericEntities: [...world.genericEntities, parsed.data] },
      summary: `${params.label} (${params.kind}) recorded.`,
      factsToPersist: reviewFact ? [reviewFact] : [],
    };
  },
};

const UpdateEntityParams = z.object({
  entityId: EntityIdSchema,
  label: z.string().trim().min(1).max(160).optional(),
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  reason: z.string().trim().min(1).max(240),
}).strict();

export const updateEntityTool: WorldToolDefinition<z.infer<typeof UpdateEntityParams>> = {
  id: "update_entity",
  description: "Update a generic entity's label or attributes. Only applies to entities created with create_entity -- a typed entity (a Force, a Settlement) has its own workflow for changes.",
  parametersSchema: UpdateEntityParams,
  dispatch: () => null,
  fallback: (world, params) => {
    const existing = world.genericEntities.find((e) => e.id === params.entityId);
    if (existing === undefined) return { ok: false, reason: `No generic entity exists with the id "${params.entityId}".` };
    const updated = { ...existing, label: params.label ?? existing.label, attributes: { ...existing.attributes, ...(params.attributes ?? {}) } };
    return {
      ok: true,
      world: { ...world, genericEntities: world.genericEntities.map((e) => (e.id === params.entityId ? updated : e)) },
      summary: `${updated.label} updated. ${params.reason}`,
    };
  },
};

const LinkEntitiesParams = z.object({
  entityId: EntityIdSchema,
  linkedEntityId: EntityIdSchema,
  reason: z.string().trim().min(1).max(240),
}).strict();

export const linkEntitiesTool: WorldToolDefinition<z.infer<typeof LinkEntitiesParams>> = {
  id: "link_entities",
  description: "Record that one generic entity is linked to another (a training program linked to the academy that runs it). Purely a cross-reference -- neither entity's own behavior changes.",
  parametersSchema: LinkEntitiesParams,
  dispatch: () => null,
  fallback: (world, params) => {
    const existing = world.genericEntities.find((e) => e.id === params.entityId);
    if (existing === undefined) return { ok: false, reason: `No generic entity exists with the id "${params.entityId}".` };
    if (existing.linkedEntityIds.includes(params.linkedEntityId)) {
      return { ok: true, world, summary: `${existing.label} was already linked to "${params.linkedEntityId}".` };
    }
    const updated = { ...existing, linkedEntityIds: [...existing.linkedEntityIds, params.linkedEntityId] };
    return {
      ok: true,
      world: { ...world, genericEntities: world.genericEntities.map((e) => (e.id === params.entityId ? updated : e)) },
      summary: `${existing.label} linked to "${params.linkedEntityId}". ${params.reason}`,
    };
  },
};

const CreateInstitutionParams = z.object({
  polityId: EntityIdSchema,
  name: z.string().trim().min(1).max(120),
  votingBlocs: z.array(z.object({
    id: EntityIdSchema,
    name: z.string().trim().min(1).max(100),
    representedInterest: z.string().trim().min(1).max(100),
    weight: z.number().int().positive(),
    baseSupport: z.number().int().min(-100).max(100).default(0),
    yesThreshold: z.number().int().min(-100).max(100).default(0),
    noThreshold: z.number().int().min(-100).max(100).default(-1),
  }).strict()).min(1),
  quorumBps: z.number().int().min(0).max(10_000),
  passageThresholdBps: z.number().int().min(0).max(10_000),
  denominator: z.enum(["total", "present", "cast"]).default("present"),
}).strict();

export const createInstitutionTool: WorldToolDefinition<z.infer<typeof CreateInstitutionParams>> = {
  id: "create_institution",
  description: "Found a new government institution (a council, an academy's own governing board) with its voting blocs. No registered workflow does this today -- it is a narrow, typed primitive over the existing GovernmentInstitution schema.",
  parametersSchema: CreateInstitutionParams,
  dispatch: () => null,
  fallback: (world, params) => {
    if (!world.map.polities.some((p) => p.id === params.polityId)) {
      return { ok: false, reason: `No polity exists with the id "${params.polityId}".` };
    }
    const totalVotingWeight = params.votingBlocs.reduce((sum, bloc) => sum + bloc.weight, 0);
    const id = `institution:${params.polityId}:${world.material.institutions.length}`;
    const votingBlocs = params.votingBlocs.map((bloc) => ({ ...bloc, causes: [] }));
    const institution = { id, polityId: params.polityId, name: params.name, votingBlocs, totalVotingWeight, quorumBps: params.quorumBps, passageThresholdBps: params.passageThresholdBps, denominator: params.denominator };
    return {
      ok: true,
      world: { ...world, material: { ...world.material, institutions: [...world.material.institutions, institution] } },
      summary: `${params.name} founded in ${params.polityId}.`,
    };
  },
};

const CreateStructureParams = z.object({
  kind: z.enum(["fortress", "wall", "watchtower", "depot", "academy_building", "other"]),
  name: z.string().trim().min(1).max(120),
  provinceId: EntityIdSchema,
  settlementId: EntityIdSchema.nullable().default(null),
  ownerPolityId: EntityIdSchema.nullable().default(null),
  garrisonCapacity: z.number().int().nonnegative().default(0),
  defensiveEffectsBps: z.number().int().min(0).max(10_000).default(0),
  supplyRadius: z.number().int().nonnegative().default(0),
  provenanceProjectId: EntityIdSchema.nullable().default(null),
}).strict();

export const createStructureTool: WorldToolDefinition<z.infer<typeof CreateStructureParams>> = {
  id: "create_structure",
  description: "Raise a standing structure (a fortress, a wall) at a province or settlement. No registered workflow does this today -- it is a narrow, typed primitive over the Structure schema, consumed by the existing siege/battle workflows.",
  parametersSchema: CreateStructureParams,
  dispatch: () => null,
  fallback: (world, params, ctx) => {
    if (!world.map.provinces.some((p) => p.id === params.provinceId)) {
      return { ok: false, reason: `No province exists with the id "${params.provinceId}".` };
    }
    const id = `structure:${params.provinceId}:${world.structures.length}`;
    const parsed = StructureSchema.safeParse({ ...params, id, builtAtStep: ctx.atStep });
    if (!parsed.success) return { ok: false, reason: parsed.error.issues.map((issue) => issue.message).join("; ") };
    return { ok: true, world: { ...world, structures: [...world.structures, parsed.data] }, summary: `${params.name} raised in ${params.provinceId}.` };
  },
};
