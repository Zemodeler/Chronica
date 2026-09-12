import { z } from "zod";
import { EntityIdSchema, MoneyAmountSchema } from "../material-state";
import { OrderPartyRefSchema, type OrderPartyRef } from "../actions/orders";
import { PositionTypeSchema, SettlementKindSchema } from "../world/map";
import {
  AuthorityDomainSchema, AuthorityGrantSchema, AuthorityScopeKindSchema, AuthorityPowerSchema, AuthoritySourceSchema, AuthorityStandingSchema,
  isActive as isGrantActive,
  type AuthorityCheckResult, type AuthorityDomain, type AuthorityGrant, type AuthorityPower, type AuthorityScope, type AuthorityScopeKind,
} from "../authority/authority-grant";
import { decideOrderAttempt, issueOrderAttempt, receiveOrderAttempt, type OrderAttemptDecision } from "../authority/order-attempt";
import { emitFacts, FactSchema, NO_INTERVENTION_SIGNALS, type FactDraft } from "../world/facts";
import { createCommitment, CommitmentActionKindSchema } from "../character-agency/commitments";
import { WORKFLOW_REGISTRY } from "../workflows/registry";
import type { WorldToolContext, WorldToolDefinition } from "./types";

// Maps a registered workflow's own `category` (`workflows/manager-types.ts`)
// onto the authority domain an order attempting that action falls under, and
// each domain onto the one power that actually matters for "may this holder
// order it" (not every power a domain's grants might carry -- e.g. a fiscal
// grant's `propose` power does not let its holder command spending). Small
// and explicit, same reasoning as `DEFAULT_AUTHORITY_REQUIREMENTS`: an
// action id with no entry here simply cannot be domain/power-verified, and
// falls back to identity-only checking rather than inventing a wrong answer.
const ORDER_DOMAIN_BY_WORKFLOW_CATEGORY: Readonly<Record<string, AuthorityDomain>> = {
  military: "military",
  political: "civil",
  economic: "fiscal",
  map: "civil",
  material: "fiscal",
  character: "social",
  narrative: "social",
};
const ORDER_POWER_BY_DOMAIN: Readonly<Record<AuthorityDomain, AuthorityPower>> = {
  military: "command",
  fiscal: "spend",
  civil: "propose",
  social: "propose",
  diplomatic: "negotiate",
  judicial: "punish",
  religious: "propose",
};
const ORDER_SCOPE_KINDS = new Set<string>(["force", "settlement", "province", "region", "polity", "institution", "account"]);

/**
 * The real authority evaluation `issue_order` snapshots into
 * `OrderAttempt.authorityCheck` (docs/32 corrective pass, requirement 2). A
 * grant merely existing is never enough: it must be held by the actual
 * issuer, active, and its domain/power/scope must cover the order actually
 * attempted -- and when a `claimedAuthorityGrantId` is supplied, that must be
 * the very grant relied on, not a different, domain-appropriate one swapped
 * in after the fact. Failure never erases the order -- the caller still
 * records the attempt, with `authorized: false` and a precise reason, so the
 * recipient may knowingly comply (`decideOrderAttempt` then reclassifies an
 * `accept` as `subverted`), delay, refuse, or ignore it.
 */
function evaluateOrderAuthority(
  ctx: WorldToolContext,
  params: { readonly actionId: string; readonly issuerRef: OrderPartyRef; readonly recipientRef: OrderPartyRef; readonly claimedAuthorityGrantId: string | null },
): AuthorityCheckResult {
  if (ctx.authorityIndex === undefined) {
    return { authorized: true, grant: null, standing: null, reason: "No authority index was supplied for this check; treated as unrestricted." };
  }
  const index = ctx.authorityIndex;
  // Identity, not authority: a character can only ever issue in their own
  // name (an institutional issuer is checked as authority below).
  const holder: OrderPartyRef = params.issuerRef.kind === "character" ? { kind: "character", id: ctx.actorId } : params.issuerRef;
  const category = WORKFLOW_REGISTRY.get(params.actionId)?.category;
  const domain = category !== undefined ? ORDER_DOMAIN_BY_WORKFLOW_CATEGORY[category] : undefined;
  const power = domain !== undefined ? ORDER_POWER_BY_DOMAIN[domain] : undefined;
  const scope: AuthorityScope | undefined = ORDER_SCOPE_KINDS.has(params.recipientRef.kind)
    ? { kind: params.recipientRef.kind as AuthorityScopeKind, id: params.recipientRef.id }
    : undefined;

  let grant: AuthorityGrant | undefined;
  if (params.claimedAuthorityGrantId !== null) {
    grant = index.grants.find((g) => g.id === params.claimedAuthorityGrantId);
    if (grant === undefined) {
      return { authorized: false, grant: null, standing: null, reason: `No active grant was found for the claimed authority "${params.claimedAuthorityGrantId}".` };
    }
  } else if (domain !== undefined && power !== undefined) {
    grant = index.grants.find((g) =>
      g.holder.kind === holder.kind && g.holder.id === holder.id && g.domain === domain && g.powers.includes(power)
      && (scope === undefined || (g.scope.kind === scope.kind && g.scope.id === scope.id)),
    );
    if (grant === undefined) {
      return { authorized: false, grant: null, standing: null, reason: `No active grant gives ${holder.kind} "${holder.id}" standing to issue this order.` };
    }
  } else {
    return { authorized: true, grant: null, standing: null, reason: "No registered authority requirement exists for this action; issuer identity was still verified." };
  }

  if (grant.holder.kind !== holder.kind || grant.holder.id !== holder.id) {
    return { authorized: false, grant, standing: grant.standing, reason: `Grant "${grant.id}" is held by ${grant.holder.kind} "${grant.holder.id}", not ${holder.kind} "${holder.id}".` };
  }
  if (!isGrantActive(grant, ctx.atStep)) {
    return { authorized: false, grant, standing: grant.standing, reason: `Grant "${grant.id}" is not currently active (expired or revoked).` };
  }
  if (domain !== undefined && grant.domain !== domain) {
    return { authorized: false, grant, standing: grant.standing, reason: `Grant "${grant.id}" covers the ${grant.domain} domain, not ${domain}.` };
  }
  if (power !== undefined && !grant.powers.includes(power)) {
    return { authorized: false, grant, standing: grant.standing, reason: `Grant "${grant.id}" does not include ${power} power.` };
  }
  if (scope !== undefined && (grant.scope.kind !== scope.kind || grant.scope.id !== scope.id)) {
    return { authorized: false, grant, standing: grant.standing, reason: `Grant "${grant.id}" covers ${grant.scope.kind} "${grant.scope.id}", not ${scope.kind} "${scope.id}".` };
  }
  return { authorized: true, grant, standing: grant.standing, reason: `Authorized by ${grant.source} grant ${grant.id}.` };
}

// docs/32, Part C.1's remaining verbs -- `issue_order`/`record_response`/
// `record_fact` are pass-throughs into Part B's order-attempt machinery and
// Part A's `emitFacts`; `create_or_update_authority_grant` is a pass-through
// into Part B's `AuthorityGrant` schema. Part C owns only their shapes and
// wiring, exactly as the plan specifies.

const CreateForceParams = z.object({
  polityId: EntityIdSchema,
  locationProvinceId: EntityIdSchema,
  name: z.string().trim().min(1).max(120),
  size: z.number().int().min(100).max(50_000),
  kind: z.enum(["infantry", "cavalry", "siege", "naval", "militia", "mercenary", "other"]),
  payerAccountId: EntityIdSchema.optional(),
  intent: z.string().trim().min(1).max(400).optional(),
}).strict();

export const createForceTool: WorldToolDefinition<z.infer<typeof CreateForceParams>> = {
  id: "create_force",
  description: "Raise a new military force for a polity. Dispatches to the existing create_force workflow verbatim.",
  parametersSchema: CreateForceParams,
  dispatch: (_world, params) => ({ workflowId: "create_force", workflowParams: params }),
};

const CreateMapPositionParams = z.object({
  provinceId: EntityIdSchema,
  positionId: EntityIdSchema,
  label: z.string().trim().min(1).max(120),
  type: PositionTypeSchema,
  combatModifierBps: z.number().int().min(-2_000).max(2_000).default(0),
  capacity: z.number().int().positive().nullable().default(null),
}).strict();

export const createMapPositionTool: WorldToolDefinition<z.infer<typeof CreateMapPositionParams>> = {
  id: "create_map_position",
  description: "Add a named operational position (a pass, a harbour, a siege line) inside a province. No registered workflow does this today -- it is a narrow, typed primitive over the existing Position schema.",
  parametersSchema: CreateMapPositionParams,
  dispatch: () => null,
  fallback: (world, params) => {
    const province = world.map.provinces.find((p) => p.id === params.provinceId);
    if (province === undefined) return { ok: false, reason: `No province exists with the id "${params.provinceId}".` };
    if ((province.positions ?? []).some((position) => position.id === params.positionId)) {
      return { ok: false, reason: `Province "${params.provinceId}" already has a position with the id "${params.positionId}".` };
    }
    const newPosition = { id: params.positionId, provinceId: params.provinceId, label: params.label, type: params.type, combatModifierBps: params.combatModifierBps, capacity: params.capacity };
    return {
      ok: true,
      world: { ...world, map: { ...world.map, provinces: world.map.provinces.map((p) => (p.id === params.provinceId ? { ...p, positions: [...(p.positions ?? []), newPosition] } : p)) } },
      summary: `${params.label} added to ${province.name}.`,
    };
  },
};

const CreateOrUpdateSettlementParams = z.object({
  provinceId: EntityIdSchema,
  settlementId: EntityIdSchema,
  name: z.string().trim().min(1).max(120),
  kind: SettlementKindSchema,
  size: z.number().int().nonnegative(),
  controllerPolityId: EntityIdSchema.nullable().default(null),
}).strict();

export const createOrUpdateSettlementTool: WorldToolDefinition<z.infer<typeof CreateOrUpdateSettlementParams>> = {
  id: "create_or_update_settlement",
  description: "Found a new settlement, or update the name/kind/size of an existing one. Dispatches to the existing found_settlement workflow when the settlement is new; falls back to a direct field update otherwise.",
  parametersSchema: CreateOrUpdateSettlementParams,
  dispatch: (world, params) => {
    const exists = world.map.provinces.some((p) => p.settlements.some((s) => s.id === params.settlementId));
    return exists ? null : { workflowId: "found_settlement", workflowParams: params };
  },
  fallback: (world, params) => {
    const province = world.map.provinces.find((p) => p.settlements.some((s) => s.id === params.settlementId));
    if (province === undefined) return { ok: false, reason: `No settlement exists with the id "${params.settlementId}".` };
    return {
      ok: true,
      world: {
        ...world,
        map: {
          ...world.map,
          provinces: world.map.provinces.map((p) =>
            p.id !== province.id ? p : { ...p, settlements: p.settlements.map((s) => (s.id === params.settlementId ? { ...s, name: params.name, kind: params.kind, size: params.size } : s)) },
          ),
        },
      },
      summary: `${params.name} updated.`,
    };
  },
};

const IssueOrderParams = z.object({
  orderId: EntityIdSchema,
  /** The `OngoingAction` (Part A) this order attempt refines -- must already exist. */
  actionId: EntityIdSchema,
  issuerRef: OrderPartyRefSchema,
  recipientRef: OrderPartyRefSchema,
  claimedAuthorityGrantId: EntityIdSchema.nullable().default(null),
}).strict();

export const issueOrderTool: WorldToolDefinition<z.infer<typeof IssueOrderParams>> = {
  id: "issue_order",
  description: "Record an attempted order from one party to another, snapshotting whether the issuer's claimed authority actually checks out. Recording an order never makes it succeed -- the recipient (record_response) or a deterministic fallback decides that.",
  parametersSchema: IssueOrderParams,
  dispatch: () => null,
  fallback: (world, params, ctx) => {
    // Identity, not authority: a character cannot issue in a different
    // character's personal name at all -- this is a hard refusal, not an
    // unauthorized-but-recorded attempt (docs/32 corrective pass,
    // requirement 1's "never impersonate another character").
    if (params.issuerRef.kind === "character" && params.issuerRef.id !== ctx.actorId) {
      return { ok: false, reason: `Refused: "${ctx.actorId}" cannot issue an order as a different character ("${params.issuerRef.id}"). A character may issue only in their own name, or through a role/office/institution they actually hold.` };
    }
    const authorityCheck = evaluateOrderAuthority(ctx, params);
    const attempt = issueOrderAttempt({
      id: params.orderId,
      actionId: params.actionId,
      issuerRef: params.issuerRef,
      recipientRef: params.recipientRef,
      claimedAuthorityGrantId: params.claimedAuthorityGrantId,
      authorityCheck,
      issuedAtStep: ctx.atStep,
    });
    return {
      ok: true,
      world: { ...world, orderAttempts: [...world.orderAttempts, attempt] },
      summary: `Order ${params.orderId} issued from ${params.issuerRef.kind}:${params.issuerRef.id} to ${params.recipientRef.kind}:${params.recipientRef.id}.`,
    };
  },
};

const RecordResponseParams = z.object({
  orderId: EntityIdSchema,
  decision: z.enum(["accept", "delay", "refuse", "ignore", "subvert"]),
  reason: z.string().trim().min(1).max(400).nullable().default(null),
}).strict();

export const recordResponseTool: WorldToolDefinition<z.infer<typeof RecordResponseParams>> = {
  id: "record_response",
  description: "Record a recipient's decision on an issued order (accept/delay/refuse/ignore/subvert). Complying despite an authority check that failed is recorded as subverted, never as accepted -- it never silently gains lawful power.",
  parametersSchema: RecordResponseParams,
  dispatch: () => null,
  fallback: (world, params, ctx) => {
    const existing = world.orderAttempts.find((a) => a.id === params.orderId);
    if (existing === undefined) return { ok: false, reason: `No order attempt exists with the id "${params.orderId}".` };
    // Only the order's own recipient (or, for a non-character recipient, a
    // caller holding a qualifying institutional grant over it) may decide it
    // -- an unrelated third party naming someone else's order is refused,
    // regardless of what `ctx.actorId` itself is otherwise allowed to do
    // (docs/32 corrective pass, requirement 2's third test case).
    const recipientAuthorized = existing.recipientRef.kind === "character"
      ? existing.recipientRef.id === ctx.actorId
      : ctx.authorityIndex !== undefined && ctx.authorityIndex.grants.some((g) =>
        g.holder.kind === "character" && g.holder.id === ctx.actorId && isGrantActive(g, ctx.atStep)
        && g.scope.kind === existing.recipientRef.kind && g.scope.id === existing.recipientRef.id,
      );
    if (!recipientAuthorized) {
      return { ok: false, reason: `Refused: only the order's recipient (${existing.recipientRef.kind} "${existing.recipientRef.id}") may record a response to it.` };
    }
    if (existing.status !== "received" && existing.status !== "delayed" && existing.status !== "issued") {
      return { ok: false, reason: `Order "${params.orderId}" was already decided (${existing.status}).` };
    }
    const received = existing.status === "issued" ? receiveOrderAttempt(existing) : existing;
    const decided = decideOrderAttempt(received, params.decision as OrderAttemptDecision, params.reason ?? "No reason given.", ctx.atStep);
    return {
      ok: true,
      world: { ...world, orderAttempts: world.orderAttempts.map((a) => (a.id === params.orderId ? decided : a)) },
      summary: `Order ${params.orderId} ${decided.status}.`,
    };
  },
};

const RecordFactParams = z.object({
  kind: z.string().min(1).max(80),
  summary: z.string().trim().min(1).max(600),
  affectedEntities: z.array(OrderPartyRefSchema).max(16).default([]),
  visibility: z.enum(["public", "polity", "private"]).default("public"),
  eligibleReactionScopes: z.array(z.enum(["person", "unit", "settlement", "province", "region", "theatre", "polity", "world"])).default([]),
}).strict();

export const recordFactTool: WorldToolDefinition<z.infer<typeof RecordFactParams>> = {
  id: "record_fact",
  description: "Record a fact in the fact ledger (Part A) -- for a consequence a typed workflow's own result summary does not already cover. Does not itself mutate any world-state collection; the caller persists the returned fact.",
  parametersSchema: RecordFactParams,
  dispatch: () => null,
  fallback: (world, params, ctx) => {
    const draft: FactDraft = {
      time: ctx.atInstant ?? { day: 0, minute: 0 },
      atStep: ctx.atStep,
      kind: params.kind,
      summary: params.summary,
      affectedEntities: params.affectedEntities,
      resourceChanges: [],
      authorityChange: undefined,
      visibility: params.visibility,
      discovery: { state: params.visibility, knowableAtInstant: null, discoveredBy: [] },
      evidence: null,
      eligibleReactionScopes: params.eligibleReactionScopes,
      interventionSignals: NO_INTERVENTION_SIGNALS,
      sourceEventId: null,
      sourceActionId: null,
      causalDepth: 0,
    };
    const parsed = FactSchema.omit({ id: true }).safeParse(draft);
    if (!parsed.success) return { ok: false, reason: parsed.error.issues.map((issue) => issue.message).join("; ") };
    // Deterministic, transaction-safe id when the caller supplies a
    // per-session sequence (`GameMasterSession` always does); falls back to
    // a random suffix only for a bare test fixture that omits it.
    const idSuffix = ctx.factSequence !== undefined ? String(ctx.factSequence) : Math.random().toString(36).slice(2);
    const [fact] = emitFacts([draft], () => `fact:${ctx.atStep}:${params.kind}:${idSuffix}`);
    return { ok: true, world, summary: `Fact recorded: ${params.summary}`, factsToPersist: fact ? [fact] : [] };
  },
};

const CreateOrUpdateAuthorityGrantParams = z.object({
  grantId: EntityIdSchema,
  holder: OrderPartyRefSchema,
  source: AuthoritySourceSchema,
  sourceRef: EntityIdSchema.nullable().default(null),
  domain: AuthorityDomainSchema,
  scope: z.object({ kind: AuthorityScopeKindSchema, id: EntityIdSchema }).strict(),
  powers: z.array(AuthorityPowerSchema).min(1),
  standing: AuthorityStandingSchema,
  legitimacyBps: z.number().int().min(0).max(10_000).default(10_000),
  expiresAtStep: z.number().int().nonnegative().nullable().default(null),
  /** When set, this call revokes the named grant instead of creating a new one -- every other field is ignored. */
  revokeExisting: z.boolean().default(false),
  revocationReason: z.string().trim().max(300).nullable().default(null),
}).strict();

export const createOrUpdateAuthorityGrantTool: WorldToolDefinition<z.infer<typeof CreateOrUpdateAuthorityGrantParams>> = {
  id: "create_or_update_authority_grant",
  description: "Create a delegated/custom/conquest/emergency authority grant, or revoke an existing one. Office- and command-derived grants are computed automatically and are never created or revoked through this tool.",
  parametersSchema: CreateOrUpdateAuthorityGrantParams,
  dispatch: () => null,
  fallback: (world, params, ctx) => {
    if (params.revokeExisting) {
      const existing = world.authorityGrants.find((g) => g.id === params.grantId);
      if (existing === undefined) return { ok: false, reason: `No persisted authority grant exists with the id "${params.grantId}".` };
      const revoked = { ...existing, revokedAtStep: ctx.atStep, revocationReason: params.revocationReason };
      return { ok: true, world: { ...world, authorityGrants: world.authorityGrants.map((g) => (g.id === params.grantId ? revoked : g)) }, summary: `Grant ${params.grantId} revoked.` };
    }
    const parsed = AuthorityGrantSchema.safeParse({
      id: params.grantId, holder: params.holder, source: params.source, sourceRef: params.sourceRef,
      domain: params.domain, scope: params.scope, powers: params.powers, standing: params.standing,
      legitimacyBps: params.legitimacyBps, visibility: "public", grantedAtStep: ctx.atStep,
      expiresAtStep: params.expiresAtStep, revokedAtStep: null, revocationReason: null, succeedsGrantId: null,
    });
    if (!parsed.success) return { ok: false, reason: parsed.error.issues.map((issue) => issue.message).join("; ") };
    return { ok: true, world: { ...world, authorityGrants: [...world.authorityGrants, parsed.data] }, summary: `Grant ${params.grantId} recorded for ${params.holder.kind}:${params.holder.id}.` };
  },
};

const CreateCommitmentParams = z.object({
  commitmentId: EntityIdSchema,
  promisorCharacterId: EntityIdSchema,
  beneficiaryCharacterId: EntityIdSchema,
  actionKind: CommitmentActionKindSchema,
  description: z.string().trim().min(1).max(400),
  conditions: z.string().trim().max(400).optional(),
  requiredOfficeId: EntityIdSchema.nullable().optional(),
  requiredResource: z.object({ accountId: EntityIdSchema, minAmount: MoneyAmountSchema }).strict().nullable().optional(),
  visibility: z.enum(["public", "polity", "private"]),
  reviewInSteps: z.number().int().positive().default(10),
}).strict();

export const createCommitmentTool: WorldToolDefinition<z.infer<typeof CreateCommitmentParams>> = {
  id: "create_commitment",
  description: "Create a canonical, authority/resource-checked commitment between two characters. Dispatches to the existing createCommitment resolver -- refuses rather than creating a promise the promisor cannot actually keep.",
  parametersSchema: CreateCommitmentParams,
  dispatch: () => null,
  fallback: (world, params, ctx) => {
    const outcome = createCommitment(world, {
      id: params.commitmentId,
      promisorCharacterId: params.promisorCharacterId,
      beneficiaryCharacterId: params.beneficiaryCharacterId,
      actionKind: params.actionKind,
      description: params.description,
      ...(params.conditions === undefined ? {} : { conditions: params.conditions }),
      requiredOfficeId: params.requiredOfficeId ?? null,
      requiredResource: params.requiredResource ?? null,
      visibility: params.visibility,
      sourceEventId: null,
      atStep: ctx.atStep,
      reviewInSteps: params.reviewInSteps,
    });
    if ("rejectionReason" in outcome) return { ok: false, reason: outcome.rejectionReason };
    return { ok: true, world: { ...world, commitments: [...world.commitments, outcome.commitment] }, summary: `Commitment recorded: ${params.description}` };
  },
};

export const DOMAIN_WORLD_TOOLS: readonly WorldToolDefinition<any>[] = [
  createForceTool,
  createMapPositionTool,
  createOrUpdateSettlementTool,
  issueOrderTool,
  recordResponseTool,
  recordFactTool,
  createOrUpdateAuthorityGrantTool,
  createCommitmentTool,
];
