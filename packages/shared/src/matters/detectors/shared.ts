import { deriveWorldInstant } from "../../world/clock";
import type { MatterEntityRef, WorldMatterKind } from "../schema";
import type { DetectedMatter, MatterDetectorContext } from "../detector-types";

export interface FreshMatterInput {
  readonly id: string;
  readonly kind: WorldMatterKind;
  readonly sourceRef: MatterEntityRef;
  readonly summary: string;
  /** 0-100 baseline urgency/intensity before any review-escalation `advance.ts` applies. */
  readonly intensity: number;
  readonly provinceId: string | null;
  readonly visibility: "public" | "polity" | "private";
  /**
   * Review cadence in steps, matching `WorldDevelopment`'s old `interval`.
   * `advance.ts` recovers this same cadence on later reviews from
   * `nextReviewStep - createdAtStep`, so it is not a field on `WorldMatter`
   * itself.
   */
  readonly cadenceSteps: number;
}

/**
 * Builds a detector's "as if freshly created right now" candidate --
 * shared by every per-domain detector so each one only states its own
 * condition and thresholds. See `DetectedMatter`'s own doc comment for how
 * `advance.ts` uses this.
 */
export function freshDetectedMatter(ctx: MatterDetectorContext, input: FreshMatterInput): DetectedMatter {
  const cadenceSteps = Math.max(1, Math.floor(input.cadenceSteps));
  const nextReviewStep = ctx.atStep + cadenceSteps;
  return {
    id: input.id,
    kind: input.kind,
    sourceRef: input.sourceRef,
    status: "due",
    visibility: input.visibility,
    summary: input.summary,
    urgency: Math.max(0, Math.min(100, input.intensity)),
    createdAt: ctx.atInstant,
    dueAt: null,
    // Derived from the step axis (not `ctx.atInstant + a day-denominated
    // offset`) so the instant and step axes always agree on when a matter
    // is due, regardless of a scenario's real days-per-step ratio -- see
    // `world/clock.ts`'s `deriveWorldInstant`.
    nextReviewAt: deriveWorldInstant(nextReviewStep),
    lastReviewedAt: null,
    requiredAuthority: [],
    responsibleScopeRefs: [],
    stakeholderRefs: [],
    relevantFactIds: [],
    standingPlanId: null,
    supersedesMatterId: null,
    parentMatterId: null,
    resolutionFactIds: [],
    provinceId: input.provinceId,
    intensity: Math.max(0, Math.min(100, input.intensity)),
    pressureId: null,
    createdAtStep: ctx.atStep,
    lastReviewedStep: ctx.atStep,
    nextReviewStep,
  };
}
