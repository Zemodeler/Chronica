import "server-only";

import type { AiAdapter } from "@chronica/ai";
import type {
  Fact,
  GameMasterSessionResult,
  OrderDirective,
  ScenarioChronicleRules,
  ScenarioClock,
  ScenarioGovernmentRules,
  ScenarioLifeRules,
  WorldInstant,
  WorldState,
} from "@chronica/shared";
import {
  buildAuthorityIndex,
  createGameMasterSession,
  MAX_RICH_AGENTS_PER_DECISION_POINT,
  MAX_STAR_CONTEXTS_PER_DECISION_POINT,
  selectRelevantActors,
} from "@chronica/shared";
import type { InventedWorkflowDefinition } from "@chronica/shared";
import type { ChronicaDatabase } from "@chronica/db";
import { listFactsForGame } from "@chronica/db";
import type { RunGameMasterResult } from "../game-master";
import { runPlayerAgent } from "./player-agent";
import { runNpcAgent } from "./npc-agent";
import { runStarContextAgent } from "./star-context-agent";
import { runIntentInterpreter } from "./interpreter-agent";
import { runClosingAgent } from "./closing-agent";

// The multi-agent dispatcher (docs/32, Part B.1/B.7 -- `agentArchitectureVersion: 2`).
//
// One canonical mutator, several sequential LLM conversations: player-
// reasoning always first and uncounted against budget, then up to 8 selected
// NPC/star-context agents (at most 2 of them star contexts), then the intent
// interpreter, then one closing pass that reads the stage back and submits
// the turn report. Every agent shares one `GameMasterSession`, so
// `session.invoke()`'s own re-validation against current staged state is what
// keeps this race-free -- there is no separate "merge N diffs" step.
//
// The actor agents decide; the interpreter acts. Those agents hold no
// mutating tool at all (`npcToolSurface`), so between the player pass and the
// interpreter the staged world does not move on any NPC's account -- which is
// also why the interpreter runs once, at the end, rather than after each
// actor: it is the only pass that can see the turn's intentions together.
//
// Returns the same shape `runGameMaster` does (`RunGameMasterResult`) so
// `pipeline.ts`'s existing post-processing (Chronicle, commit) needs no
// changes regardless of which path produced it.

export interface RunMultiAgentTurnInput {
  readonly db: ChronicaDatabase;
  readonly gameId: string;
  readonly world: WorldState;
  readonly atStep: number;
  readonly atInstant: WorldInstant;
  readonly actorCharacterId: string;
  readonly directives: readonly { readonly id: string; readonly directive: OrderDirective }[];
  readonly scenarioGovernment: ScenarioGovernmentRules | undefined;
  readonly scenarioChronicle: ScenarioChronicleRules | undefined;
  readonly scenarioLife?: ScenarioLifeRules | undefined;
  readonly scenarioClock?: ScenarioClock | undefined;
  readonly definedActions?: readonly InventedWorkflowDefinition[];
  readonly allowInventedActions?: boolean;
  readonly persistentPlans?: boolean;
}

function tag(atStep: number): string {
  return `[multi-agent:step-${atStep}]`;
}

export async function runMultiAgentTurn(adapter: AiAdapter, input: RunMultiAgentTurnInput): Promise<RunGameMasterResult> {
  const authorityIndex = buildAuthorityIndex(
    { officeSeats: input.world.material.officeSeats, forces: input.world.material.forces },
    input.world.authorityGrants,
    input.scenarioGovernment?.offices ?? [],
    input.atStep,
  );

  const session = createGameMasterSession({
    world: input.world,
    atStep: input.atStep,
    actorCharacterId: input.actorCharacterId,
    directiveIds: input.directives.map((entry) => entry.id),
    ...(input.persistentPlans ? { directives: input.directives } : {}),
    definedActions: input.definedActions ?? [],
    allowInventedActions: input.allowInventedActions ?? true,
    scenarioLife: input.scenarioLife,
    scenarioClock: input.scenarioClock,
    maxToolCalls: 120,
    // docs/32, Part C.6 step 9: the multi-agent path is exactly where the
    // typed world-tool catalog belongs -- version 1 (today's single-GM path,
    // `game-master.ts`) is untouched and never sets this.
    enableWorldTools: true,
    worldToolAuthorityIndex: authorityIndex,
  });

  let facts: readonly Fact[] = [];
  try {
    facts = await listFactsForGame(input.db, input.gameId);
  } catch (error) {
    console.warn(`${tag(input.atStep)} could not load the fact ledger; agents proceed with none visible:`, error);
  }

  let providerError: string | null = null;
  let modelSteps = 0;

  const playerResult = await runPlayerAgent({
    adapter,
    session,
    atStep: input.atStep,
    actorCharacterId: input.actorCharacterId,
    directives: input.directives,
  });
  modelSteps += playerResult.modelSteps;
  if (playerResult.providerError !== null) providerError = playerResult.providerError;
  console.log(`${tag(input.atStep)} player agent finished: termination=${playerResult.termination} toolCalls=${playerResult.toolCallsMade}`);

  const selected = providerError === null
    ? selectRelevantActors(session.stagedWorld, input.actorCharacterId, authorityIndex, input.atStep, MAX_RICH_AGENTS_PER_DECISION_POINT, MAX_STAR_CONTEXTS_PER_DECISION_POINT)
    : [];

  for (const actor of selected) {
    if (session.isFinished || session.exhausted) break;
    const result = actor.kind === "npc"
      ? await runNpcAgent({
        adapter,
        session,
        world: session.stagedWorld,
        atStep: input.atStep,
        characterId: actor.characterId,
        authorityIndex,
        facts,
        atInstant: input.atInstant,
        actionAllowance: actor.actionAllowance,
      })
      : await runStarContextAgent({
        adapter,
        session,
        world: session.stagedWorld,
        atStep: input.atStep,
        context: actor.context,
        authorityIndex,
        facts,
        atInstant: input.atInstant,
      });
    if (result === undefined) continue;
    modelSteps += result.modelSteps;
    if (result.providerError !== null) providerError = result.providerError;
    console.log(`${tag(input.atStep)} ${actor.kind} agent (${actor.kind === "npc" ? actor.characterId : actor.context.id}) finished: termination=${result.termination} toolCalls=${result.toolCallsMade}`);
  }

  // Everything the actors decided, carried out in one pass. Skipped entirely
  // when nobody declared anything, so a quiet turn costs no model call here.
  if (!session.isFinished && !session.exhausted) {
    const interpreterResult = await runIntentInterpreter({ adapter, session, atStep: input.atStep });
    if (interpreterResult !== undefined) {
      modelSteps += interpreterResult.modelSteps;
      if (interpreterResult.providerError !== null) providerError = interpreterResult.providerError;
      const intents = session.result().declaredIntents;
      const uncarried = intents.filter((intent) => !intent.carried);
      console.log(
        `${tag(input.atStep)} interpreter finished: termination=${interpreterResult.termination} `
        + `toolCalls=${interpreterResult.toolCallsMade} intents=${intents.length} uncarried=${uncarried.length}`
        + (uncarried.length === 0 ? "" : ` [${uncarried.map((intent) => `${intent.actorId}:${intent.id}`).join(", ")}]`),
      );
    }
  }

  const closingResult = await runClosingAgent({ adapter, session, atStep: input.atStep });
  modelSteps += closingResult.modelSteps;
  if (closingResult.providerError !== null) providerError = closingResult.providerError;

  let termination: RunGameMasterResult["termination"];
  if (providerError !== null) termination = "provider_error";
  else if (session.isFinished) termination = "reported";
  else if (session.exhausted) termination = "tool_budget";
  else termination = "model_stopped";

  const result: GameMasterSessionResult = session.result();
  console.log(
    `${tag(input.atStep)} finished: termination=${termination} modelSteps=${modelSteps} actions=${result.executedInvocations.length} reads=${result.readCallCount}`,
  );
  return { ...result, termination, modelSteps, providerError };
}
