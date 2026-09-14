import { compareWorldInstant, worldInstantToSortKey, type WorldInstant } from "../world/instant";
import { deriveWorldInstant } from "../world/clock";
import type { WorldState } from "../world/world-state";
import type { FactualEvent } from "../gm/session";
import { MATTER_DETECTORS } from "./detectors";
import type { WorldMatter, WorldMatterKind } from "./schema";

/**
 * Cheap scheduled reviews run before AI, including in regions the player
 * never visits (docs/plans/ai-world-matters-runtime.md, "1. Detection").
 * Ported from `world-development-scheduler.ts`'s `advanceWorldDevelopments`
 * -- same review cap, same escalation and pruning behavior -- generalized
 * onto `WorldMatter`/`WorldInstant` semantics. Mirrors the old file's own
 * `MAX_REVIEWS` constant and behavior exactly.
 */
export const MAX_MATTER_REVIEWS_PER_INSTANT = 12;

const TERMINAL_STATUSES: ReadonlySet<WorldMatter["status"]> = new Set(["addressed", "cancelled"]);
function isTerminal(status: WorldMatter["status"]): boolean {
  return TERMINAL_STATUSES.has(status);
}

// Household needs stay in personal state rather than the public Chronicle
// -- same rule the old scheduler applied to its `household` pressures/events.
function isPublic(kind: WorldMatterKind): boolean {
  return kind !== "household";
}

export interface AdvanceWorldMattersResult {
  readonly world: WorldState;
  readonly events: readonly Omit<FactualEvent, "id">[];
}

export function advanceWorldMatters(world: WorldState, atInstant: WorldInstant, atStep: number): AdvanceWorldMattersResult {
  const records = new Map<string, WorldMatter>((world.worldMatters ?? []).map((m) => [m.id, m]));
  const candidates = MATTER_DETECTORS.flatMap((detector) => detector.detect({ world, atInstant, atStep }));
  const candidateIds = new Set(candidates.map((c) => c.id));
  const events: Omit<FactualEvent, "id">[] = [];

  const emit = (matter: WorldMatter, summary: string) =>
    events.push({
      atStep,
      kind: "action",
      actionId: "world_matter",
      // Phase 1 does not resolve a responsible actor (that is Phase 2's
      // job); the source stands in as this internal fact's actor.
      actorId: matter.sourceRef.id,
      parameters: { matterId: matter.id, kind: matter.kind, sourceRef: matter.sourceRef, status: matter.status, urgency: matter.urgency },
      summary,
      materialConsequence: false,
    });

  // Removing the cause resolves the matter immediately, even if its next
  // review is distant -- same rule as the old scheduler's pressure clearing.
  for (const matter of records.values()) {
    if (isTerminal(matter.status) || candidateIds.has(matter.id)) continue;
    const cancelled: WorldMatter = {
      ...matter,
      status: "cancelled",
      urgency: 0,
      intensity: 0,
      lastReviewedAt: atInstant,
      nextReviewAt: atInstant,
      lastReviewedStep: atStep,
      nextReviewStep: atStep,
      dispositions: [
        ...matter.dispositions,
        { kind: "cancelled", atInstant, byActorRef: null, evidenceFactIds: [], note: "The underlying source is no longer present." },
      ],
    };
    records.set(matter.id, cancelled);
    if (isPublic(matter.kind)) emit(cancelled, `This concern is no longer active in its previous form: ${matter.summary}`);
  }

  // Due: not yet reviewed at this instant, and either newly created,
  // reopening from a terminal state, or its own next-review instant has
  // arrived. Capped at MAX_MATTER_REVIEWS_PER_INSTANT and ordered by
  // nearest review first, same as the old scheduler.
  const due = candidates
    .filter((c) => {
      const old = records.get(c.id);
      if (!old) return true;
      const reviewedAtOrAfter = old.lastReviewedAt !== null && compareWorldInstant(old.lastReviewedAt, atInstant) >= 0;
      if (reviewedAtOrAfter) return false;
      return isTerminal(old.status) || compareWorldInstant(old.nextReviewAt, atInstant) <= 0;
    })
    .sort((a, b) => {
      const keyA = worldInstantToSortKey(records.get(a.id)?.nextReviewAt ?? atInstant);
      const keyB = worldInstantToSortKey(records.get(b.id)?.nextReviewAt ?? atInstant);
      return keyA - keyB || a.id.localeCompare(b.id);
    })
    .slice(0, MAX_MATTER_REVIEWS_PER_INSTANT);

  for (const c of due) {
    const old = records.get(c.id);
    const continuing = old !== undefined && !isTerminal(old.status);
    const reviews = continuing ? old.reviews + 1 : 1;
    // Recovered from the detector's own fresh candidate rather than carried
    // as a separate field -- see `DetectedMatter`'s doc comment.
    const cadenceSteps = Math.max(1, c.nextReviewStep - c.createdAtStep);
    const intensity = Math.min(95, c.intensity + (c.kind === "civic" ? 0 : Math.min(20, (reviews - 1) * 5)));
    const createdAt = continuing ? old.createdAt : atInstant;
    const createdAtStep = continuing ? old.createdAtStep : atStep;
    const nextReviewStep = atStep + cadenceSteps;
    // Derived from the step axis -- see `detectors/shared.ts`'s matching comment.
    const nextReviewAt = deriveWorldInstant(nextReviewStep);

    const matter: WorldMatter = {
      id: c.id,
      kind: c.kind,
      sourceRef: c.sourceRef,
      status: c.status,
      visibility: c.visibility,
      summary: c.summary,
      urgency: intensity,
      createdAt,
      dueAt: c.dueAt,
      nextReviewAt,
      lastReviewedAt: atInstant,
      requiredAuthority: c.requiredAuthority,
      responsibleScopeRefs: c.responsibleScopeRefs,
      stakeholderRefs: c.stakeholderRefs,
      relevantFactIds: c.relevantFactIds,
      standingPlanId: continuing ? old.standingPlanId : c.standingPlanId,
      supersedesMatterId: continuing ? old.supersedesMatterId : c.supersedesMatterId,
      parentMatterId: continuing ? old.parentMatterId : c.parentMatterId,
      offers: continuing ? old.offers : [],
      dispositions: continuing ? old.dispositions : [],
      resolutionFactIds: continuing ? old.resolutionFactIds : c.resolutionFactIds,
      provinceId: c.provinceId,
      intensity,
      reviews,
      pressureId: continuing ? old.pressureId : c.pressureId,
      createdAtStep,
      lastReviewedStep: atStep,
      nextReviewStep,
    };
    records.set(c.id, matter);

    const escalated = !continuing || Math.floor((old?.intensity ?? 0) / 20) !== Math.floor(intensity / 20);
    if (isPublic(matter.kind) && escalated) {
      emit(matter, `${continuing ? "The concern persists. " : ""}${matter.summary}`);
    }
  }

  // Keep active matters and a bounded recent terminal history (addressed/cancelled).
  const all = [...records.values()];
  const worldMatters = [
    ...all.filter((m) => !isTerminal(m.status)),
    ...all
      .filter((m) => isTerminal(m.status))
      .sort((a, b) => b.lastReviewedStep - a.lastReviewedStep || a.id.localeCompare(b.id))
      .slice(0, 64),
  ];

  return { world: { ...world, worldMatters }, events };
}
