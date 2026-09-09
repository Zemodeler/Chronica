import type { WorldState } from "../world/world-state";
import type { Force, GovernmentInstitution, MoneyAccount, PoliticalProcedure } from "../material-state";
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

export function buildStarContextPayload(world: WorldState, context: StarContext): StarContextPayload {
  const provinceIds = new Set(provinceIdsInScope(world, context));
  const polityIds = new Set(polityIdsInScope(world, context));

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
  };
}
