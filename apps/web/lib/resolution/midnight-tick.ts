import "server-only";

import type { FactualEvent, WorldState } from "@chronica/shared";
import { advanceWorldDynamics } from "./world-dynamics";

/**
 * The daily background-resolution pass (docs/32, Phase 7): income, debt,
 * pay, supply, construction, travel, upkeep, and the deterministic
 * world-pressure/political-scrutiny checks -- everything that used to run
 * unconditionally once per pipeline call now runs once per simulated day,
 * driven by a `midnight_tick` event in the event queue (`event-loop.ts`).
 *
 * This is a thin wrapper, not a rewrite: `advanceWorldDynamics` already is
 * the existing daily/turn-granularity background resolution (world-pressure
 * checks, then `advanceWorldDevelopments`'s obligation/income/development
 * settlement) -- see that module's own doc comment. Wrapping it here is the
 * concrete seam migration step 4 calls for: the event queue's `midnight_tick`
 * handler delegates to the same, unchanged logic, filtered by "is this day
 * actually due" instead of running once per turn regardless of elapsed time.
 */
export interface MidnightTickResult {
  readonly world: WorldState;
  readonly events: readonly Omit<FactualEvent, "id">[];
}

export function runMidnightTick(world: WorldState, atStep: number): MidnightTickResult {
  return advanceWorldDynamics(world, atStep);
}
