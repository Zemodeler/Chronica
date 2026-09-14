import "server-only";
import type { SelectedCharacter, WorldState } from "@chronica/shared";

// `advanceWorldDevelopments` and its `candidates()` helper moved to
// `packages/shared/src/matters/advance.ts` (pure detection/lifecycle) and
// `apps/web/lib/resolution/matters/matter-scheduler.ts` (the server-side
// wrapper that layers `CharacterPressure` bookkeeping on top) -- see
// docs/plans/ai-world-matters-runtime.md, Phase 1. `world.worldDevelopments`
// itself is now read-only legacy state, migrated via
// `upgradeWorldDevelopmentsToMatters`.
//
// `selectDevelopmentActors` below is untouched for this phase: it still
// reads `world.worldDevelopments` directly. Phase 2 ("NPC routing") is what
// replaces it with matter-priority selection merged into
// `selectRelevantActors`.

/** Reserved background slots supplement the ordinary relevance selection. */
export function selectDevelopmentActors(world: WorldState, atStep: number, playerId: string): SelectedCharacter[] {
  const ids = new Set<string>();
  const eligible = (world.worldDevelopments ?? []).filter(d => d.status === "active" && d.lastReviewedStep === atStep && d.actorId !== playerId)
    .filter(d => world.characters.some(c => c.id === d.actorId && c.alive))
    .sort((a, b) => a.nextReviewStep - b.nextReviewStep || a.id.localeCompare(b.id))
    .filter(d => { if (ids.has(d.actorId)) return false; ids.add(d.actorId); return true; });
  const offset = eligible.length === 0 ? 0 : (atStep * 3) % eligible.length;
  return [...eligible.slice(offset), ...eligible.slice(0, offset)].slice(0, 3)
    .map(d => ({ characterId: d.actorId, tier: "important", relevanceScore: 600, actionAllowance: 2, reasons: [`Scheduled world concern: ${d.summary}`] }));
}
