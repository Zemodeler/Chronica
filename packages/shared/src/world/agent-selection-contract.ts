import type { Fact, StarContextLevel } from "./facts";
import type { WorldEventRecord } from "./event-queue";
import type { WorldState } from "./world-state";

/**
 * The seam between the event loop (docs/32, Phase 7, Part A) and the
 * multi-agent selector (Part B). Part A calls this after resolving an event
 * and converting its output to Facts; Part B implements it with the real
 * 8-agent-budget, star-context-aware selector. Kept as an injected
 * dependency (never imported directly) so the event loop is buildable and
 * testable standalone -- see `NO_OP_AGENT_SELECTOR` below, the default used
 * until Part B lands.
 */
export interface AffectedAgentSelection {
  readonly npcCharacterIds: readonly string[];
  readonly starContextRefs: readonly { readonly level: StarContextLevel; readonly id: string }[];
  /** Whether this selection fit inside the 8-agent/≤2-star-context cap without truncation. */
  readonly withinBudget: boolean;
}

export interface AffectedAgentSelector {
  selectAffectedAgents(world: WorldState, facts: readonly Fact[], event: WorldEventRecord): AffectedAgentSelection;
}

export const NO_OP_AGENT_SELECTOR: AffectedAgentSelector = {
  selectAffectedAgents: () => ({ npcCharacterIds: [], starContextRefs: [], withinBudget: true }),
};
