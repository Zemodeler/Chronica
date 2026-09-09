import type { OrderPartyRef } from "../actions/orders";
import type { WorldState } from "../world/world-state";
import { buildAuthorityIndex, type AuthorityIndex } from "../authority/authority-grant";
import { StarContextSchema, type Region, type StarContext, type StarContextLevel, type Theatre } from "./schema";

/**
 * Maps an event's own smallest owning entity kind onto the star-context
 * hierarchy's level. `person -> unit -> settlement -> province -> region ->
 * theatre -> polity -> world`: a context is never manufactured finer than
 * what the event's own data supports (e.g. a polity-wide fiscal event never
 * gets a `unit`-level context), so this is a straight, non-configurable map.
 */
function levelForRefKind(kind: OrderPartyRef["kind"]): StarContextLevel {
  switch (kind) {
    case "character":
      return "person";
    case "force":
      return "unit";
    case "settlement":
      return "settlement";
    case "province":
      return "province";
    case "region":
      return "region";
    case "theatre":
      return "theatre";
    case "polity":
    case "institution":
    case "office":
    case "account":
    case "procedure":
    case "faction":
      return "polity";
    case "world":
      return "world";
    default:
      return "world";
  }
}

function scopeKindForLevel(level: StarContextLevel): string {
  switch (level) {
    case "person":
      return "character"; // no AuthorityScopeKind for a bare person; representative resolution for "person" level is the person themself
    case "unit":
      return "force";
    case "settlement":
      return "settlement";
    case "province":
      return "province";
    case "region":
      return "region";
    case "theatre":
      return "region"; // theatres have no first-class AuthorityScopeKind; nearest is region
    case "polity":
      return "polity";
    case "world":
      return "polity";
  }
}

/**
 * Who currently "speaks for" this context, computed from the same
 * `AuthorityIndex` `checkAuthority` reads (Part B.5) -- never authored
 * separately, so a star context's representative is always someone who
 * genuinely holds a grant over its scope, not a guess. Prefers a `lawful`
 * standing over `disputed`/`de_facto`; returns null (no living
 * representative) rather than inventing one -- an empty settlement-context
 * still resolves through its own institutional records with no person
 * attached.
 */
export function resolveRepresentative(index: AuthorityIndex, scopeRef: OrderPartyRef): string | null {
  const scopeKind = scopeKindForLevel(levelForRefKind(scopeRef.kind));
  const candidates = index.grants.filter((grant) => grant.holder.kind === "character" && grant.scope.kind === scopeKind && grant.scope.id === scopeRef.id);
  if (candidates.length === 0) return null;
  const lawful = candidates.find((grant) => grant.standing === "lawful");
  return (lawful ?? candidates[0])?.holder.id ?? null;
}

function labelFor(world: WorldState, ref: OrderPartyRef, level: StarContextLevel): string {
  switch (ref.kind) {
    case "character":
      return world.characters.find((c) => c.id === ref.id)?.name ?? ref.id;
    case "force":
      return world.material.forces.find((f) => f.id === ref.id)?.name ?? ref.id;
    case "settlement":
      return world.map.provinces.flatMap((p) => p.settlements).find((s) => s.id === ref.id)?.name ?? ref.id;
    case "province":
      return world.map.provinces.find((p) => p.id === ref.id)?.name ?? ref.id;
    case "polity":
      return world.map.polities.find((p) => p.id === ref.id)?.name ?? ref.id;
    default:
      return `${level} ${ref.id}`;
  }
}

/**
 * Given the event's own smallest owning entity (`nativeRef`), builds the
 * star context for it directly -- selection of "the smallest context that
 * can reasonably address the event" is, by construction, just using the
 * native ref's own level: this function never widens on its own. A caller
 * (the multi-agent dispatcher, Part B.1) walks to a broader context only
 * when the native level has neither a living representative nor sufficient
 * institutional records, by calling this again with a broader `nativeRef`
 * (e.g. the settlement's province) -- kept as the caller's decision rather
 * than baked in here, since "sufficient institutional records" depends on
 * what the caller is prepared to read.
 */
export function selectStarContext(world: WorldState, nativeRef: OrderPartyRef, authorityIndex: AuthorityIndex, atStep: number): StarContext {
  const level = levelForRefKind(nativeRef.kind);
  return StarContextSchema.parse({
    id: `star:${nativeRef.kind}:${nativeRef.id}`,
    level,
    scopeRef: nativeRef,
    label: labelFor(world, nativeRef, level),
    representativeCharacterId: resolveRepresentative(authorityIndex, nativeRef),
    parentContextId: null,
    activatedAtStep: atStep,
    lastAddressedAtStep: null,
  });
}

/** The next-broader ref to retry `selectStarContext` with, or null once already at `world` (the walk-up stops there). */
export function widerRef(world: WorldState, ref: OrderPartyRef): OrderPartyRef | null {
  switch (ref.kind) {
    case "force": {
      const force = world.material.forces.find((f) => f.id === ref.id);
      const province = force ? world.map.provinces.find((p) => p.settlements.some((s) => s.id === force.locationId) || p.id === force.locationId) : undefined;
      return province ? { kind: "province", id: province.id } : null;
    }
    case "settlement": {
      const settlement = world.map.provinces.flatMap((p) => p.settlements.map((s) => ({ s, p }))).find((entry) => entry.s.id === ref.id);
      return settlement ? { kind: "province", id: settlement.p.id } : null;
    }
    case "province": {
      const province = world.map.provinces.find((p) => p.id === ref.id);
      return province?.controllerPolityId !== null && province?.controllerPolityId !== undefined ? { kind: "polity", id: province.controllerPolityId } : null;
    }
    case "region": {
      // A region has no single owning polity by construction (it may span controllers); the walk-up from a region goes straight to world.
      return { kind: "world", id: "world" };
    }
    case "theatre":
      return { kind: "world", id: "world" };
    case "polity":
      return { kind: "world", id: "world" };
    default:
      return null;
  }
}

/**
 * A war's belligerents and the provinces currently contested between them.
 * Derived on demand, never persisted -- a theatre's membership changes as
 * fronts move, so it should not need migration/backfill. `War` has no
 * separate id field (`world/map-presentation.ts`'s `MapWarSchema`); the
 * ordered polity pair is the identity.
 */
export function deriveTheatre(world: WorldState, polityAId: string, polityBId: string): Theatre {
  const provinceIds = world.map.provinces
    .filter((p) => p.controllerPolityId === polityAId || p.controllerPolityId === polityBId)
    .map((p) => p.id);
  return { id: `theatre:${polityAId}:${polityBId}`, polityAId, polityBId, provinceIds };
}

/**
 * Fallback region grouping when a scenario defines none: connected
 * components of the province adjacency graph, grouped by shared
 * `controllerPolityId` -- one region per polity's contiguous holdings (a
 * polity split across two fronts gets two regions, not one).
 */
export function deriveRegions(world: WorldState): Region[] {
  const adjacency = new Map<string, string[]>();
  for (const edge of world.map.edges) {
    (adjacency.get(edge.from) ?? adjacency.set(edge.from, []).get(edge.from)!).push(edge.to);
    (adjacency.get(edge.to) ?? adjacency.set(edge.to, []).get(edge.to)!).push(edge.from);
  }
  const visited = new Set<string>();
  const regions: Region[] = [];
  for (const province of world.map.provinces) {
    if (visited.has(province.id)) continue;
    const controller = province.controllerPolityId;
    const component: string[] = [];
    const stack = [province.id];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;
      const currentProvince = world.map.provinces.find((p) => p.id === current);
      if (currentProvince === undefined || currentProvince.controllerPolityId !== controller) continue;
      visited.add(current);
      component.push(current);
      for (const neighbor of adjacency.get(current) ?? []) if (!visited.has(neighbor)) stack.push(neighbor);
    }
    if (component.length > 0) {
      const polityName = controller !== null ? world.map.polities.find((p) => p.id === controller)?.name ?? controller : "Unclaimed ground";
      regions.push({ id: `region:${component.slice().sort().join("-")}`, label: polityName, provinceIds: component });
    }
  }
  return regions;
}

/**
 * Deterministic relevance score for a candidate star context, so it can be
 * ranked alongside `selectRelevantCharacters`'s NPC scores in one merged
 * budget (Part B.1.1) -- same spirit as that selector (pure, no AI, same
 * input -> same output), scaled to a comparable range. A context that
 * already has a living representative scores lower (that representative is
 * better handled as an ordinary NPC agent, freeing the star-context budget
 * for contexts with no one to embody them); one covering an active war or
 * siege, or addressed less recently, scores higher.
 */
export function scoreStarContext(world: WorldState, context: StarContext, atStep: number): number {
  let score = 0;
  const inActiveWar = world.conflicts.wars.some(
    (war) =>
      (context.scopeRef.kind === "polity" && (war.polityAId === context.scopeRef.id || war.polityBId === context.scopeRef.id)) ||
      (context.scopeRef.kind === "province" &&
        world.map.provinces.some((p) => p.id === context.scopeRef.id && (p.controllerPolityId === war.polityAId || p.controllerPolityId === war.polityBId))),
  );
  if (inActiveWar) score += 100;
  const inSiege = world.conflicts.sieges.some((siege) => context.scopeRef.kind === "settlement" && siege.settlementId === context.scopeRef.id);
  if (inSiege) score += 120;
  if (context.representativeCharacterId === null) score += 40; // no one already speaks for it -- a star context adds real coverage here
  if (context.lastAddressedAtStep === null) score += 20;
  else score += Math.min(20, atStep - context.lastAddressedAtStep);
  return score;
}
