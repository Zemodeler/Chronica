import type { WorldState } from "../world/world-state";
import type { Force, GovernmentInstitution, MoneyAccount, PoliticalProcedure } from "../material-state";
import type { AuthorityIndex } from "../authority/authority-grant";
import { checkAuthority } from "../authority/authority-grant";
import type { Fact } from "../world/facts";
import { factsVisibleTo } from "../world/facts";
import { deriveWorldInstant } from "../world/clock";
import type { WorldInstant } from "../world/instant";
import type { WorldMatter } from "../matters/schema";
import type { ProjectedMatter } from "../matters/projection";
import type { StarContext } from "./schema";
import { deriveTheatre } from "./selector";

/**
 * A star context's bounded institutional view: what it knows without a
 * living representative attached, and all a representative-backed context
 * adds beyond its own private state. Deliberately never reads
 * `characterGoals`/`characterPlots`/private `characterBeliefs` at all --
 * the only route private information reaches a star context is through
 * Part A's `factsVisibleTo` (the caller composes that separately, once it
 * knows which observer ref this context speaks through) -- so "star
 * contexts know institutional and discovered information only" holds by
 * construction, not by a filter that could be forgotten on a new field.
 *
 * Deliberately a standalone reader rather than a refactor of
 * `gm/read-tools.ts`'s existing `inspect_force`/`inspect_province`/
 * `inspect_polity` handlers (the original design note): that file carries
 * unrelated in-flight changes this pass avoids touching. A later pass can
 * still fold the two together once that settles.
 */
export interface StarContextPayload {
  readonly context: StarContext;
  readonly forces: readonly Pick<Force, "id" | "name" | "polityId" | "commanderCharacterId" | "controllerCharacterId" | "locationId" | "moraleBps" | "provisionStatus">[];
  readonly openProcedures: readonly Pick<PoliticalProcedure, "id" | "type" | "stage" | "sponsorCharacterId">[];
  readonly institutions: readonly Pick<GovernmentInstitution, "id" | "name" | "polityId">[];
  readonly publicAccounts: readonly Pick<MoneyAccount, "id" | "owner" | "balance" | "currencyId">[];
  readonly activeSiegeSettlementIds: readonly string[];
  readonly activeWarPolityPairs: readonly { readonly polityAId: string; readonly polityBId: string }[];
  /**
   * World matters (docs/plans/ai-world-matters-runtime.md, Phase 2) whose
   * source, province, or named entities fall within this context's own
   * scope -- a simpler, scope-based filter than `projectMattersForCharacter`'s
   * per-character ladder, since a star context has no single observing
   * character to route through. Bounded and urgency-ordered, same as the
   * per-character projection.
   */
  readonly matters: readonly ProjectedMatter[];
}

function provinceIdsInScope(world: WorldState, context: StarContext): readonly string[] {
  const ref = context.scopeRef;
  switch (ref.kind) {
    case "province":
      return [ref.id];
    case "settlement": {
      const owner = world.map.provinces.find((p) => p.settlements.some((s) => s.id === ref.id));
      return owner ? [owner.id] : [];
    }
    case "force": {
      const force = world.material.forces.find((f) => f.id === ref.id);
      return force ? [force.locationId] : [];
    }
    case "region": {
      // Region ids are synthesized as `region:<sorted-province-ids-joined-by-dash>` by deriveRegions; fall back to
      // treating the ref id as a single province if it wasn't built that way (e.g. a scenario-authored region id).
      return ref.id.startsWith("region:") ? ref.id.slice("region:".length).split("-") : [ref.id];
    }
    case "theatre": {
      const [, polityAId, polityBId] = ref.id.split(":");
      if (polityAId === undefined || polityBId === undefined) return [];
      return deriveTheatre(world, polityAId, polityBId).provinceIds;
    }
    case "polity":
      return world.map.provinces.filter((p) => p.controllerPolityId === ref.id).map((p) => p.id);
    default:
      return world.map.provinces.map((p) => p.id); // "world" level -- everything is in scope, kept minimal by the caller only reading aggregates
  }
}

/** Which polity id(s) this context's scope belongs to, for institution/account/procedure filtering. Empty for a cross-polity or world-level context. */
function polityIdsInScope(world: WorldState, context: StarContext): readonly string[] {
  const ref = context.scopeRef;
  if (ref.kind === "polity") return [ref.id];
  if (ref.kind === "theatre") {
    const [, polityAId, polityBId] = ref.id.split(":");
    return [polityAId, polityBId].filter((id): id is string => id !== undefined);
  }
  const provinceIds = new Set(provinceIdsInScope(world, context));
  const controllers = new Set(world.map.provinces.filter((p) => provinceIds.has(p.id) && p.controllerPolityId !== null).map((p) => p.controllerPolityId as string));
  return [...controllers];
}

const MAX_STAR_CONTEXT_MATTERS = 5;
const TERMINAL_MATTER_STATUSES: ReadonlySet<WorldMatter["status"]> = new Set(["addressed", "cancelled"]);

function mattersInScope(world: WorldState, context: StarContext, provinceIds: ReadonlySet<string>, polityIds: ReadonlySet<string>): WorldMatter[] {
  return (world.worldMatters ?? []).filter((matter) => {
    if (TERMINAL_MATTER_STATUSES.has(matter.status)) return false;
    if (matter.provinceId !== null && provinceIds.has(matter.provinceId)) return true;
    const refs = [matter.sourceRef, ...matter.stakeholderRefs, ...matter.responsibleScopeRefs];
    return refs.some(
      (ref) =>
        (ref.kind === context.scopeRef.kind && ref.id === context.scopeRef.id) ||
        (ref.kind === "polity" && polityIds.has(ref.id)) ||
        (ref.kind === "province" && provinceIds.has(ref.id)),
    );
  });
}

/**
 * A simplified, scope-based projection for a matter this star context's own
 * institutional records cover -- see `projectMattersForCharacter` for the
 * richer per-character ladder this deliberately does not reproduce. The
 * representative character (when this context has one) supplies fact
 * visibility and any authority check; a context with no living
 * representative sees only its own scope's public facts.
 */
function projectMatterForStarContext(world: WorldState, context: StarContext, matter: WorldMatter, authorityIndex: AuthorityIndex, facts: readonly Fact[], atInstant: WorldInstant): ProjectedMatter {
  const observer = context.representativeCharacterId !== null ? { kind: "character" as const, id: context.representativeCharacterId } : context.scopeRef;
  const visible = factsVisibleTo(facts, observer, atInstant);
  const visibleIds = new Set(visible.map((f) => f.id));
  const relevantAuthority = context.representativeCharacterId === null
    ? []
    : matter.requiredAuthority.map((requirement) => ({
        requirement,
        held: checkAuthority(authorityIndex, { holder: { kind: "character", id: context.representativeCharacterId! }, domain: requirement.domain, power: requirement.power, scope: requirement.scope }).authorized,
      }));

  return {
    matterId: matter.id,
    kind: matter.kind,
    summary: matter.summary,
    role: "representative",
    whyRelevant: `Within ${context.label}'s institutional scope.`,
    timing: matter.status,
    urgency: matter.urgency,
    dueAt: matter.dueAt,
    knownEntities: [matter.sourceRef, ...matter.responsibleScopeRefs, ...matter.stakeholderRefs],
    knownFactSummaries: matter.relevantFactIds.filter((id) => visibleIds.has(id)).map((id) => visible.find((f) => f.id === id)!.summary),
    relevantAuthority,
    existingPlanId: matter.standingPlanId,
    lastDisposition: matter.dispositions.length > 0 ? matter.dispositions[matter.dispositions.length - 1]! : null,
  };
}

export function buildStarContextPayload(
  world: WorldState,
  context: StarContext,
  authorityIndex: AuthorityIndex = { grants: [] },
  facts: readonly Fact[] = [],
  atInstant: WorldInstant = deriveWorldInstant(world.elapsedStep),
): StarContextPayload {
  const provinceIds = new Set(provinceIdsInScope(world, context));
  const polityIds = new Set(polityIdsInScope(world, context));

  const matters = mattersInScope(world, context, provinceIds, polityIds)
    .sort((a, b) => b.urgency - a.urgency || a.id.localeCompare(b.id))
    .slice(0, MAX_STAR_CONTEXT_MATTERS)
    .map((matter) => projectMatterForStarContext(world, context, matter, authorityIndex, facts, atInstant));

  const forces = world.material.forces.filter((force) => provinceIds.has(force.locationId) || polityIds.has(force.polityId));
  const institutions = world.material.institutions.filter((institution) => polityIds.has(institution.polityId));
  const openProcedures = world.material.politicalProcedures.filter(
    (procedure) => procedure.resolvedAtStep === null && (procedure.institutionId === null || institutions.some((i) => i.id === procedure.institutionId)),
  );
  const publicAccounts = world.material.accounts.filter((account) => account.visibility === "public" && account.owner.kind === "polity" && polityIds.has(account.owner.id));
  const activeSiegeSettlementIds = world.conflicts.sieges
    .map((siege) => siege.settlementId)
    .filter((settlementId) => world.map.provinces.some((p) => provinceIds.has(p.id) && p.settlements.some((s) => s.id === settlementId)));
  const activeWarPolityPairs = world.conflicts.wars.filter((war) => polityIds.has(war.polityAId) || polityIds.has(war.polityBId));

  return {
    context,
    forces: forces.map(({ id, name, polityId, commanderCharacterId, controllerCharacterId, locationId, moraleBps, provisionStatus }) => ({
      id, name, polityId, commanderCharacterId, controllerCharacterId, locationId, moraleBps, provisionStatus,
    })),
    openProcedures: openProcedures.map(({ id, type, stage, sponsorCharacterId }) => ({ id, type, stage, sponsorCharacterId })),
    institutions: institutions.map(({ id, name, polityId }) => ({ id, name, polityId })),
    publicAccounts: publicAccounts.map(({ id, owner, balance, currencyId }) => ({ id, owner, balance, currencyId })),
    activeSiegeSettlementIds,
    activeWarPolityPairs: activeWarPolityPairs.map(({ polityAId, polityBId }) => ({ polityAId, polityBId })),
    matters,
  };
}
