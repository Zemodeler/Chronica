import { z } from "zod";
import { OrderPartyRefSchema, type OrderPartyRef } from "../actions/orders";
import { EntityIdSchema, ElapsedStepSchema, VisibilitySchema, type MaterialWorldState } from "../material-state";
import type { Office } from "../characters/character";
import { WORKFLOW_REGISTRY } from "../workflows/registry";

/**
 * `AuthorityGrant` (docs/32, Phase 7): a persistent, first-class "who may do
 * what, over what, until when" record, unifying rather than replacing the
 * existing office/eligibility/procedure substrate:
 *
 * - `AccountAccess` (`material-state.ts`) stays the actual mechanical
 *   spend-permission gate money workflows already consult -- unchanged.
 * - `EligibilityRequirement`/`resolveEligibility` (`political-authority.ts`)
 *   stay the procedural-participation gate (may this character vote/sponsor/
 *   nominate) -- a different question from "does this character currently
 *   hold standing authority over X" -- unchanged.
 * - `canParticipate`'s `"command"` authority action (procedure type
 *   `command_assignment`) already computes command authority at runtime by
 *   re-reading the procedure log; this module gives that same fact (who
 *   currently commands a force) a first-class, directly queryable form by
 *   reading `Force.commanderCharacterId` -- the field `assign_command`
 *   itself already writes -- rather than re-deriving it from procedure
 *   history a second way.
 *
 * Most grants are *derived*, computed fresh from canonical state on every
 * call (`deriveOfficeGrants`, `deriveCommandGrants`) rather than written by
 * every office/command-mutating workflow -- this is deliberate: a written-at
 * projection would need every present and future workflow that changes an
 * office seat or a force's commander to also remember to write a matching
 * `AuthorityGrant` row, which is exactly the kind of two-places-to-update
 * bug this module exists to avoid. `WorldState.authorityGrants` is reserved
 * for the sources that have no other live-state projection: `delegation`,
 * `custom`, `conquest`, and `emergency` standings, plus `law` grants a
 * scenario or a workflow explicitly records.
 */

export const AuthoritySourceSchema = z.enum(["office", "law", "command", "delegation", "custom", "conquest", "emergency"]);
export type AuthoritySource = z.infer<typeof AuthoritySourceSchema>;

export const AuthorityDomainSchema = z.enum(["military", "civil", "fiscal", "judicial", "diplomatic", "religious", "social"]);
export type AuthorityDomain = z.infer<typeof AuthorityDomainSchema>;

export const AuthorityScopeKindSchema = z.enum(["force", "settlement", "province", "region", "polity", "institution", "account"]);
export type AuthorityScopeKind = z.infer<typeof AuthorityScopeKindSchema>;

export const AuthorityScopeSchema = z.object({ kind: AuthorityScopeKindSchema, id: EntityIdSchema }).strict();
export type AuthorityScope = z.infer<typeof AuthorityScopeSchema>;

export const AuthorityPowerSchema = z.enum(["command", "spend", "propose", "appoint", "negotiate", "punish", "override"]);
export type AuthorityPower = z.infer<typeof AuthorityPowerSchema>;

export const AuthorityStandingSchema = z.enum(["lawful", "delegated", "de_facto", "disputed", "usurped", "emergency"]);
export type AuthorityStanding = z.infer<typeof AuthorityStandingSchema>;

export const AuthorityGrantSchema = z
  .object({
    id: EntityIdSchema,
    holder: OrderPartyRefSchema,
    source: AuthoritySourceSchema,
    /** The office seat / procedure / other record this grant traces to, when it has one. Null for conquest/emergency. */
    sourceRef: EntityIdSchema.nullable().default(null),
    domain: AuthorityDomainSchema,
    scope: AuthorityScopeSchema,
    powers: z.array(AuthorityPowerSchema).min(1),
    standing: AuthorityStandingSchema,
    legitimacyBps: z.number().int().min(0).max(10_000).default(10_000),
    visibility: VisibilitySchema.default("public"),
    grantedAtStep: ElapsedStepSchema,
    expiresAtStep: ElapsedStepSchema.nullable().default(null),
    revokedAtStep: ElapsedStepSchema.nullable().default(null),
    revocationReason: z.string().trim().max(300).nullable().default(null),
    succeedsGrantId: EntityIdSchema.nullable().default(null),
  })
  .strict();
export type AuthorityGrant = z.infer<typeof AuthorityGrantSchema>;

function officeIdToDomainPowers(office: Office): { readonly domain: AuthorityDomain; readonly powers: readonly AuthorityPower[] }[] {
  const seenCategories = new Set<string>();
  const results: { domain: AuthorityDomain; powers: readonly AuthorityPower[] }[] = [];
  for (const actionId of office.authorisedActionIds) {
    const category = WORKFLOW_REGISTRY.get(actionId)?.category;
    if (category === undefined || seenCategories.has(category)) continue;
    seenCategories.add(category);
    switch (category) {
      case "military":
        results.push({ domain: "military", powers: ["command"] });
        break;
      case "political":
        results.push({ domain: "civil", powers: ["propose", "appoint"] });
        break;
      case "economic":
        results.push({ domain: "fiscal", powers: ["propose"] });
        break;
      case "map":
        results.push({ domain: "civil", powers: ["propose"] });
        break;
      case "material":
        results.push({ domain: "fiscal", powers: ["propose"] });
        break;
      case "character":
      case "narrative":
        results.push({ domain: "social", powers: ["propose"] });
        break;
      default:
        break;
    }
  }
  return results;
}

/**
 * Projects `Office`/`OfficeSeat` state into `AuthorityGrant`s, computed
 * fresh -- never persisted. `offices` is scenario data (not part of
 * `WorldState`), so it is a parameter, the same way `officeGrantsDirectAccess`
 * already takes an `Office` directly rather than looking one up from world
 * state. Fiscal power is scoped to the office's own named treasury account
 * (`Office.treasuryAccountId`/`treasuryPermissions`) rather than the whole
 * polity -- this is what makes "a governor with no treasury access holds no
 * fiscal authority over the national treasury, while a king whose office
 * names it does" fall out of existing data with no new field.
 */
export function deriveOfficeGrants(
  officeSeats: MaterialWorldState["officeSeats"],
  offices: readonly Office[],
  atStep: number,
): AuthorityGrant[] {
  const grants: AuthorityGrant[] = [];
  for (const seat of officeSeats) {
    if (seat.status !== "held" || seat.holderCharacterId === null) continue;
    const office = offices.find((o) => o.id === seat.officeId);
    if (office === undefined) continue;
    const holder: OrderPartyRef = { kind: "character", id: seat.holderCharacterId };
    for (const { domain, powers } of officeIdToDomainPowers(office)) {
      grants.push(
        AuthorityGrantSchema.parse({
          id: `office:${seat.id}:${domain}`,
          holder,
          source: "office",
          sourceRef: seat.id,
          domain,
          scope: { kind: "polity", id: office.polityId },
          powers,
          standing: "lawful",
          grantedAtStep: seat.termStartedAtStep ?? atStep,
          expiresAtStep: seat.termExpiresAtStep,
        }),
      );
    }
    if (office.treasuryAccountId !== null && office.treasuryPermissions.length > 0) {
      const powers: AuthorityPower[] = [];
      if (office.treasuryPermissions.includes("spend_without_vote")) powers.push("spend");
      if (office.treasuryPermissions.includes("propose_spending")) powers.push("propose");
      if (powers.length > 0) {
        grants.push(
          AuthorityGrantSchema.parse({
            id: `office:${seat.id}:fiscal`,
            holder,
            source: "office",
            sourceRef: seat.id,
            domain: "fiscal",
            scope: { kind: "account", id: office.treasuryAccountId },
            powers,
            standing: "lawful",
            grantedAtStep: seat.termStartedAtStep ?? atStep,
            expiresAtStep: seat.termExpiresAtStep,
          }),
        );
      }
    }
  }
  return grants;
}

/**
 * Projects live command authority from `Force.commanderCharacterId` --
 * exactly what `assign_command` (resolved from a `command_assignment`
 * procedure) already writes -- into `AuthorityGrant`s. Computed fresh, never
 * persisted, for the same reason as `deriveOfficeGrants`.
 */
export function deriveCommandGrants(forces: MaterialWorldState["forces"], atStep: number): AuthorityGrant[] {
  const grants: AuthorityGrant[] = [];
  for (const force of forces) {
    grants.push(
      AuthorityGrantSchema.parse({
        id: `command:${force.id}`,
        holder: { kind: "character", id: force.commanderCharacterId },
        source: "command",
        sourceRef: force.id,
        domain: "military",
        scope: { kind: "force", id: force.id },
        powers: ["command"],
        standing: "lawful",
        grantedAtStep: atStep,
      }),
    );
  }
  return grants;
}

/** A prebuilt, per-turn lookup over every currently-active grant (office/command derived, plus persisted `WorldState.authorityGrants`). */
export interface AuthorityIndex {
  readonly grants: readonly AuthorityGrant[];
}

export function isActive(grant: AuthorityGrant, atStep: number): boolean {
  if (grant.revokedAtStep !== null && grant.revokedAtStep <= atStep) return false;
  if (grant.expiresAtStep !== null && grant.expiresAtStep <= atStep) return false;
  return true;
}

export function buildAuthorityIndex(
  material: Pick<MaterialWorldState, "officeSeats" | "forces">,
  persistedGrants: readonly AuthorityGrant[] | undefined,
  offices: readonly Office[],
  atStep: number,
): AuthorityIndex {
  const derived = [...deriveOfficeGrants(material.officeSeats, offices, atStep), ...deriveCommandGrants(material.forces, atStep)];
  const persisted = (persistedGrants ?? []).filter((grant) => isActive(grant, atStep));
  return { grants: [...derived, ...persisted] };
}

export interface AuthorityCheckInput {
  readonly holder: OrderPartyRef;
  readonly domain: AuthorityDomain;
  readonly scope: AuthorityScope;
  readonly power: AuthorityPower;
}

export interface AuthorityCheckResult {
  readonly authorized: boolean;
  readonly grant: AuthorityGrant | null;
  readonly standing: AuthorityStanding | null;
  readonly reason: string;
}

/** Zod counterpart of `AuthorityCheckResult`, for embedding a snapshot of one (e.g. `OrderAttempt.authorityCheck`) in validated state. */
export const AuthorityCheckResultSchema = z
  .object({
    authorized: z.boolean(),
    grant: AuthorityGrantSchema.nullable(),
    standing: AuthorityStandingSchema.nullable(),
    reason: z.string().max(400),
  })
  .strict();

/**
 * A polity-scope grant satisfies a check against a narrower scope belonging
 * to that polity (a province, settlement, force, or institution the polity
 * controls) -- the hierarchy walk `checkAuthority` needs so a king's
 * polity-wide grant covers a specific province without a separate grant per
 * province. `containsFn`, supplied by the caller, answers "is `narrower`
 * part of `broader`" using live map/material state `checkAuthority` itself
 * does not have -- kept as an injected predicate rather than a `WorldState`
 * parameter so this module's core logic stays testable against fixtures
 * with no real map graph.
 */
export type ScopeContainsFn = (broader: AuthorityScope, narrower: AuthorityScope) => boolean;

export const scopeExactlyMatches: ScopeContainsFn = (broader, narrower) => broader.kind === narrower.kind && broader.id === narrower.id;

export function checkAuthority(index: AuthorityIndex, input: AuthorityCheckInput, scopeContains: ScopeContainsFn = scopeExactlyMatches): AuthorityCheckResult {
  const candidates = index.grants.filter(
    (grant) =>
      grant.holder.kind === input.holder.kind &&
      grant.holder.id === input.holder.id &&
      grant.domain === input.domain &&
      grant.powers.includes(input.power),
  );
  const matching = candidates.find((grant) => scopeExactlyMatches(grant.scope, input.scope) || scopeContains(grant.scope, input.scope));
  if (matching !== undefined) {
    return { authorized: true, grant: matching, standing: matching.standing, reason: `Authorized by ${matching.source} grant ${matching.id}.` };
  }
  return {
    authorized: false,
    grant: null,
    standing: null,
    reason: `No active grant gives ${input.holder.kind} "${input.holder.id}" ${input.power} power in the ${input.domain} domain over ${input.scope.kind} "${input.scope.id}".`,
  };
}

// -- session.invoke() gate ----------------------------------------------------

export interface WorkflowAuthorityRequirement {
  readonly domain: AuthorityDomain;
  readonly power: AuthorityPower;
  readonly scopeKind: AuthorityScopeKind;
  /** Which call parameter names the scope id (e.g. "forceId", "sourceAccountId"). */
  readonly scopeParam: string;
}

/**
 * A deliberately small, explicit starting set -- not an attempt to tag all
 * ~90 `WORKFLOW_REGISTRY` entries in one pass. Matches the spec's own
 * test-plan examples exactly: "authority and order-response resolution
 * before broader agents mutate forces, treasuries, or institutions." More
 * workflows are tagged incrementally as rollout needs them; an untagged
 * workflow is simply not authority-gated yet, exactly like today.
 */
export const DEFAULT_AUTHORITY_REQUIREMENTS: Readonly<Record<string, WorkflowAuthorityRequirement>> = {
  assign_command: { domain: "military", power: "command", scopeKind: "force", scopeParam: "forceId" },
  transfer_gold: { domain: "fiscal", power: "spend", scopeKind: "account", scopeParam: "sourceAccountId" },
  remove_gold: { domain: "fiscal", power: "spend", scopeKind: "account", scopeParam: "accountId" },
};

/**
 * Builds the `GameMasterSession.authorityGate` hook (`gm/session.ts`) from
 * an `AuthorityIndex` and a requirement map -- kept out of `session.ts`
 * itself so that already-large file stays decoupled from this module. A
 * call whose `actionId` has no entry in `requirements` is allowed
 * unconditionally, same as before the gate existed; only tagged, missing-
 * grant calls are refused. `holderOf` resolves a call's `actorId` into the
 * `OrderPartyRef` `checkAuthority` needs (normally `{kind:"character", id:
 * actorId}` -- overridable for a caller acting through an institution).
 */
export function buildWorkflowAuthorityGate(
  index: AuthorityIndex,
  requirements: Readonly<Record<string, WorkflowAuthorityRequirement>> = DEFAULT_AUTHORITY_REQUIREMENTS,
  holderOf: (actorId: string) => OrderPartyRef = (actorId) => ({ kind: "character", id: actorId }),
): { check(actionId: string, actorId: string, parameters: Record<string, unknown>): string | null } {
  return {
    check(actionId, actorId, parameters) {
      const requirement = requirements[actionId];
      if (requirement === undefined) return null;
      const scopeId = parameters[requirement.scopeParam];
      if (typeof scopeId !== "string" || scopeId.trim().length === 0) return null; // a missing/malformed id is the workflow's own lookup-error to report, not an authority refusal
      const result = checkAuthority(index, { holder: holderOf(actorId), domain: requirement.domain, scope: { kind: requirement.scopeKind, id: scopeId }, power: requirement.power });
      return result.authorized ? null : `Refused: ${result.reason}`;
    },
  };
}
