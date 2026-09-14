import { deriveWorldInstant } from "../world/clock";
import type { WorldState } from "../world/world-state";
import type { WorldDevelopment } from "../world/developments";
import { WorldMatterSchema, type MatterEntityRef, type WorldMatter } from "./schema";
import { matterPressureId } from "./identity";

/** Same kind -> source-ref-kind mapping `migration.ts`'s detectors use, applied to a legacy `WorldDevelopment`'s `sourceId`. */
function sourceRefFor(development: WorldDevelopment): MatterEntityRef {
  switch (development.kind) {
    case "scarcity":
    case "reconstruction":
      return { kind: "province", id: development.sourceId };
    case "civic":
      return { kind: "institution", id: development.sourceId };
    case "war_burden":
      return { kind: "polity", id: development.sourceId };
    case "household":
      return { kind: "household", id: development.sourceId };
  }
}

/**
 * Upgrades every legacy `WorldDevelopment` (`world/developments.ts`) into an
 * equivalent `WorldMatter`, appended to `world.worldMatters`
 * (docs/plans/ai-world-matters-runtime.md, Phase 1). `world.worldDevelopments`
 * itself is left untouched -- read-only legacy data, not deleted.
 *
 * Idempotent: a no-op when `world.worldDevelopments` is absent/empty, or
 * when a matter with a given migrated id already exists in
 * `world.worldMatters` (so calling this on an already-migrated snapshot,
 * or one where some developments were migrated earlier, adds nothing new).
 */
export function upgradeWorldDevelopmentsToMatters(world: WorldState): WorldState {
  const legacy = world.worldDevelopments ?? [];
  if (legacy.length === 0) return world;

  const existingIds = new Set((world.worldMatters ?? []).map((m) => m.id));
  const migrated: WorldMatter[] = [];

  for (const development of legacy) {
    if (existingIds.has(development.id)) continue;

    const reviewedStep = development.lastReviewedStep ?? development.createdAtStep;
    const offeredAt = deriveWorldInstant(reviewedStep);
    const status = development.status === "active" ? "due" : "addressed";

    const matter = WorldMatterSchema.parse({
      id: development.id,
      kind: development.kind,
      sourceRef: sourceRefFor(development),
      status,
      visibility: development.kind === "household" ? "private" : "public",
      summary: development.summary,
      urgency: development.intensity,
      createdAt: deriveWorldInstant(development.createdAtStep),
      dueAt: null,
      nextReviewAt: deriveWorldInstant(development.nextReviewStep),
      lastReviewedAt: offeredAt,
      requiredAuthority: [],
      responsibleScopeRefs: [],
      stakeholderRefs: [],
      relevantFactIds: [],
      standingPlanId: null,
      supersedesMatterId: null,
      parentMatterId: null,
      offers: [
        {
          actorRef: { kind: "character", id: development.actorId },
          offeredAt,
          role: "responsible",
          knowledgeFactIds: [],
          outcome: "no_action",
          intentIds: [],
        },
      ],
      dispositions: [],
      // Legacy data has no real resolution fact to cite. This placeholder
      // only satisfies the schema's addressed/resolutionFactIds invariant
      // and must never be treated as a genuine fact reference.
      resolutionFactIds: status === "addressed" ? [`migrated:${development.id}`] : [],
      provinceId: development.provinceId,
      intensity: development.intensity,
      reviews: development.reviews,
      // Preserves the exact id the legacy scheduler already derived for
      // this development's `CharacterPressure` (`matterPressureId` uses the
      // same `development:` scheme), so migration neither duplicates nor
      // orphans that pressure row.
      pressureId: matterPressureId(development.id),
      createdAtStep: development.createdAtStep,
      lastReviewedStep: development.lastReviewedStep,
      nextReviewStep: development.nextReviewStep,
    });
    migrated.push(matter);
  }

  if (migrated.length === 0) return world;
  return { ...world, worldMatters: [...(world.worldMatters ?? []), ...migrated] };
}
