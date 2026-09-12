import type { OrderPartyRef } from "../actions/orders";
import { buildAuthorityIndex } from "../authority/authority-grant";
import { MAX_RICH_AGENTS_PER_DECISION_POINT, MAX_STAR_CONTEXTS_PER_DECISION_POINT } from "../character-agency/selector";
import { resolveRepresentative } from "../star-context/selector";
import type { AffectedAgentSelection, AffectedAgentSelector } from "./agent-selection-contract";
import type { Fact, StarContextLevel } from "./facts";
import type { WorldEventRecord } from "./event-queue";
import type { WorldState } from "./world-state";

// The real affected-agent selector (docs/32 corrective pass, requirement
// 3): replaces `NO_OP_AGENT_SELECTOR` in the live event-queue path, and
// (unified action runtime, Stage 4) also selects reactions to a turn's own
// interpreted facts. Deliberately narrower than `character-agency/
// selector.ts`'s `selectRelevantActors` (whole-world relevance, used once
// per turn to decide who gets to declare an intent at all) -- this
// selector only ever looks at who a specific batch of Facts actually named
// or touched, so a minor local event (a personal dispute, a small
// skirmish) selects only the handful of characters and institutions it
// actually concerns, never a whole polity's office-holders just because
// they exist.

const SCOPE_KIND_TO_STAR_LEVEL: Readonly<Partial<Record<string, StarContextLevel>>> = {
  force: "unit",
  settlement: "settlement",
  province: "province",
  region: "region",
  theatre: "theatre",
  polity: "polity",
  world: "world",
};

function dedupeStarRefs(refs: readonly { readonly level: StarContextLevel; readonly id: string }[]): { readonly level: StarContextLevel; readonly id: string }[] {
  const seen = new Set<string>();
  const result: { readonly level: StarContextLevel; readonly id: string }[] = [];
  for (const ref of refs) {
    const key = `${ref.level}:${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }
  return result;
}

/**
 * Selects the NPC characters and star contexts a batch of Facts actually
 * concern: living characters directly named in `affectedEntities`, plus
 * living office/command holders over a named institution/force/polity/
 * province/settlement -- but only for Facts that declared
 * `eligibleReactionScopes` (a Fact with none is not eligible to trigger any
 * reaction at all, by its own producer's declaration). A named
 * institutional scope with no living representative becomes a star-context
 * candidate instead of being silently dropped.
 *
 * The caller has already narrowed `facts` to whichever batch it means --
 * one resolved event's own output (`selectAffectedAgentsForEvent` below) or
 * a turn's own interpreted facts (`agents/orchestrator.ts`'s fresh-context
 * reaction pass, unified action runtime Stage 4). Either way this is the
 * one real selector: narrower than `character-agency/selector.ts`'s
 * `selectRelevantActors` (whole-world relevance, used once to decide who
 * gets to declare an intent at all), because this only ever looks at who a
 * *specific* batch of facts actually named or touched.
 */
export function selectAffectedAgentsForFacts(world: WorldState, facts: readonly Fact[]): AffectedAgentSelection {
  const characterIds = new Set<string>();
  const institutionalRefs: OrderPartyRef[] = [];

  for (const fact of facts) {
    for (const ref of fact.affectedEntities) {
      if (ref.kind === "character") {
        if (world.characters.some((character) => character.id === ref.id && character.alive)) characterIds.add(ref.id);
      } else if (fact.eligibleReactionScopes.length > 0) {
        institutionalRefs.push(ref);
      }
    }
  }

  if (characterIds.size === 0 && institutionalRefs.length === 0) {
    return { npcCharacterIds: [], starContextRefs: [], withinBudget: true };
  }

  // Office/command authority is the only live-state projection available at
  // this seam (no scenario `Office[]` reaches `WorldState` itself) -- command
  // grants (derived from `Force.commanderCharacterId`) still resolve fully;
  // office grants need a live `Office` catalog and so are only as complete
  // as `world.authorityGrants`'s own persisted entries.
  const authorityIndex = buildAuthorityIndex(world.material, world.authorityGrants, [], world.elapsedStep);
  for (const ref of institutionalRefs) {
    for (const grant of authorityIndex.grants) {
      if (grant.holder.kind !== "character" || grant.scope.kind !== ref.kind || grant.scope.id !== ref.id) continue;
      if (world.characters.some((character) => character.id === grant.holder.id && character.alive)) characterIds.add(grant.holder.id);
    }
  }

  const starContextRefs = dedupeStarRefs(
    institutionalRefs
      .map((ref) => ({ ref, level: SCOPE_KIND_TO_STAR_LEVEL[ref.kind] }))
      .filter((candidate): candidate is { ref: OrderPartyRef; level: StarContextLevel } => candidate.level !== undefined)
      .filter((candidate) => resolveRepresentative(authorityIndex, candidate.ref) === null)
      .map((candidate) => ({ level: candidate.level, id: candidate.ref.id })),
  );

  const npcCharacterIds = [...characterIds].sort();
  const boundedStarRefs = starContextRefs.slice(0, MAX_STAR_CONTEXTS_PER_DECISION_POINT);
  const npcBudget = Math.max(0, MAX_RICH_AGENTS_PER_DECISION_POINT - boundedStarRefs.length);
  const boundedNpcIds = npcCharacterIds.slice(0, npcBudget);
  const withinBudget = boundedNpcIds.length === npcCharacterIds.length && boundedStarRefs.length === starContextRefs.length;

  return { npcCharacterIds: boundedNpcIds, starContextRefs: boundedStarRefs, withinBudget };
}

/** `selectAffectedAgentsForFacts`, narrowed to one resolved event's own output first. */
export function selectAffectedAgentsForEvent(world: WorldState, facts: readonly Fact[], event: WorldEventRecord): AffectedAgentSelection {
  return selectAffectedAgentsForFacts(world, facts.filter((fact) => fact.sourceEventId === event.id));
}

export const REAL_AGENT_SELECTOR: AffectedAgentSelector = { selectAffectedAgents: selectAffectedAgentsForEvent };
