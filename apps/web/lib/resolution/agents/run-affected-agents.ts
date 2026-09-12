import "server-only";

import type { AiAdapter } from "@chronica/ai";
import {
  selectStarContext,
  type AffectedAgentSelection,
  type AuthorityIndex,
  type Fact,
  type GameMasterSession,
  type OrderPartyRef,
  type StarContextLevel,
  type WorldInstant,
} from "@chronica/shared";
import { runNpcAgent } from "./npc-agent";
import { runStarContextAgent } from "./star-context-agent";

// Runs every NPC/star-context agent an `AffectedAgentSelection` chose,
// sequentially, against one shared session -- the common step both
// `reaction-runner.ts` (queue-sourced events) and `orchestrator.ts`'s
// fresh-context reaction pass (unified action runtime, Stage 4: a turn's
// own interpreted facts) need identically. Each agent runs against
// `session.stagedWorld` as it stands at that point in the sequence, never a
// frozen snapshot from before this call started.

const LEVEL_TO_SCOPE_KIND: Readonly<Record<StarContextLevel, OrderPartyRef["kind"]>> = {
  person: "character",
  unit: "force",
  settlement: "settlement",
  province: "province",
  region: "region",
  theatre: "theatre",
  polity: "polity",
  world: "world",
};

export interface RunAffectedAgentsInput {
  readonly adapter: AiAdapter;
  readonly session: GameMasterSession;
  readonly atStep: number;
  readonly atInstant: WorldInstant;
  readonly authorityIndex: AuthorityIndex;
  readonly facts: readonly Fact[];
  readonly selection: AffectedAgentSelection;
  readonly npcActionAllowance: number;
  readonly starContextMaxSteps?: number;
}

export interface RunAffectedAgentsResult {
  readonly modelSteps: number;
  /** The last provider error encountered, if any -- reactions do not stop the caller's own turn, but a real failure should not vanish silently. */
  readonly providerError: string | null;
}

export async function runAffectedAgents(input: RunAffectedAgentsInput): Promise<RunAffectedAgentsResult> {
  const { adapter, session, atStep, atInstant, authorityIndex, facts, selection } = input;
  let modelSteps = 0;
  let providerError: string | null = null;

  for (const characterId of selection.npcCharacterIds) {
    if (session.isFinished || session.exhausted) break;
    const result = await runNpcAgent({
      adapter, session, world: session.stagedWorld, atStep, characterId, authorityIndex, facts,
      atInstant, actionAllowance: input.npcActionAllowance,
    });
    if (result === undefined) continue;
    modelSteps += result.modelSteps;
    if (result.providerError !== null) providerError = result.providerError;
  }

  for (const ref of selection.starContextRefs) {
    if (session.isFinished || session.exhausted) break;
    const nativeRef: OrderPartyRef = { kind: LEVEL_TO_SCOPE_KIND[ref.level], id: ref.id };
    const context = selectStarContext(session.stagedWorld, nativeRef, authorityIndex, atStep);
    const result = await runStarContextAgent({
      adapter, session, world: session.stagedWorld, atStep, context, authorityIndex, facts,
      atInstant, ...(input.starContextMaxSteps === undefined ? {} : { maxSteps: input.starContextMaxSteps }),
    });
    if (result === undefined) continue;
    modelSteps += result.modelSteps;
    if (result.providerError !== null) providerError = result.providerError;
  }

  return { modelSteps, providerError };
}
