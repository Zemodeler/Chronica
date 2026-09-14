import type { WorldInstant } from "../world/instant";
import type { WorldState } from "../world/world-state";
import type { WorldMatter, WorldMatterKind } from "./schema";

/**
 * What a detector reads. Deliberately minimal for Phase 1 (docs/plans/
 * ai-world-matters-runtime.md, "1. Detection"): detectors inspect canonical
 * state only, at one instant. No `ScenarioClock` yet -- nothing in Phase 1
 * needs one; a later phase adds it here if a detector genuinely needs
 * calendar-aware cadence.
 */
export interface MatterDetectorContext {
  readonly world: WorldState;
  readonly atInstant: WorldInstant;
  readonly atStep: number;
}

/**
 * What a detector proposes for one source, as if it were being created
 * fresh at `ctx.atInstant`/`ctx.atStep`. `advance.ts` merges this against
 * any stored `WorldMatter` of the same id to decide whether to continue an
 * existing record (preserving its `createdAt`/`reviews`/`pressureId`/
 * `offers`/`dispositions`) or start a new one -- which is why `offers`,
 * `dispositions`, and `reviews` are not part of a detector's own output.
 */
export type DetectedMatter = Omit<WorldMatter, "offers" | "dispositions" | "reviews">;

/** One domain's detection logic, aggregated into `MATTER_DETECTORS` (`detectors.ts`) -- imitates `workflows/registry.ts`'s registry pattern. */
export interface MatterDetector {
  readonly id: string;
  readonly kinds: readonly WorldMatterKind[];
  detect(ctx: MatterDetectorContext): readonly DetectedMatter[];
}
