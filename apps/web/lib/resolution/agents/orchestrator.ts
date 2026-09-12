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
  factualEventToFact,
  MAX_RICH_AGENTS_PER_DECISION_POINT,
  MAX_STAR_CONTEXTS_PER_DECISION_POINT,
  selectAffectedAgentsForFacts,
  selectRelevantActors,
} from "@chronica/shared";
import type { InventedWorkflowDefinition } from "@chronica/shared";
import type { ChronicaDatabase } from "@chronica/db";
import { listFactsForGame } from "@chronica/db";
import { runNpcAgent } from "./npc-agent";
import { runStarContextAgent } from "./star-context-agent";
import { runIntentInterpreter } from "./interpreter-agent";
import { runClosingAgent } from "./closing-agent";
import { runAffectedAgents } from "./run-affected-agents";

/**
 * Bounds for the fresh-context reaction pass below (unified action runtime,
 * Stage 4) -- matches `reaction-runner.ts`'s own bounds for the same
 * conceptual reason: reacting to what just happened is a smaller job than
 * an actor's own full turn.
 */
const TURN_REACTION_ACTION_ALLOWANCE = 2;
const TURN_REACTION_STAR_CONTEXT_MAX_STEPS = 3;

// The multi-agent dispatcher: one canonical mutator, several sequential LLM
// conversations, and the only turn-resolution architecture (unified action
// runtime cutover -- the deprecated single-GM `game-master.ts` is gone).
//
// The player's own directive stands as their declared intent directly, the
// same way an NPC's `declare_intent` call does (`GameMasterSession`'s
// constructor registers it, so no model call paraphrases the player's exact
// wording). From there: up to 8 selected NPC/star-context agents (at most 2
// of them star contexts) each decide and declare, then the intent
// interpreter carries out every declared intent -- the player's and every
// selected actor's alike -- in one shared pass, then a closing pass reads
// the stage back and submits the turn report. Every agent shares one
// `GameMasterSession`, so `session.invoke()`'s own re-validation against
// current staged state is what keeps this race-free -- there is no separate
// "merge N diffs" step.
//
// The actor agents decide; the interpreter acts. Those agents hold no
// mutating tool at all (`npcToolSurface`), so the staged world does not move
// on any actor's account until the interpreter's single pass -- which is
// exactly why it runs once, at the end, rather than after each actor: it is
// the only pass that can see the turn's intentions together.

export interface RunGameMasterResult extends GameMasterSessionResult {
  /** Why the loop stopped. Only "reported" means the model finished on its own. */
  readonly termination: "reported" | "step_budget" | "tool_budget" | "model_stopped" | "provider_error";
  readonly modelSteps: number;
  readonly providerError: string | null;
}

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
    directives: input.directives,
    definedActions: input.definedActions ?? [],
    allowInventedActions: input.allowInventedActions ?? true,
    scenarioLife: input.scenarioLife,
    scenarioClock: input.scenarioClock,
    maxToolCalls: 120,
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

  const selected = selectRelevantActors(session.stagedWorld, input.actorCharacterId, authorityIndex, input.atStep, MAX_RICH_AGENTS_PER_DECISION_POINT, MAX_STAR_CONTEXTS_PER_DECISION_POINT);

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

  // Everything the actors -- the player included -- decided, carried out in
  // one pass. Skipped entirely when nobody declared anything (a quiet turn
  // with no player directives and no NPC intents costs no model call here).
  if (!session.isFinished && !session.exhausted) {
    const interpreterResult = await runIntentInterpreter({ adapter, session, atStep: input.atStep, playerCharacterId: input.actorCharacterId });
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

  // Fresh-context reactions to this turn's own facts (unified action
  // runtime, Stage 4): the event queue's own advance already selects
  // reactions by exactly which facts an event produced
  // (`REAL_AGENT_SELECTOR`); this applies that same fact-scoped selection
  // to what THIS turn's own interpreted actions just produced, rather than
  // relying solely on the upfront whole-turn relevance ranking above. A
  // single bounded round -- reactions to a reaction are the event queue's
  // own causal-depth-capped job (`event-loop.ts`), not a same-turn loop.
  if (!session.isFinished && !session.exhausted) {
    const turnFacts = session.result().events
      .filter((event) => event.materialConsequence)
      .map((event) => factualEventToFact(event, input.atInstant));
    const reactionSelection = selectAffectedAgentsForFacts(session.stagedWorld, turnFacts);
    if (reactionSelection.npcCharacterIds.length > 0 || reactionSelection.starContextRefs.length > 0) {
      const reactionAgentsResult = await runAffectedAgents({
        adapter, session, atStep: input.atStep, atInstant: input.atInstant, authorityIndex, facts, selection: reactionSelection,
        npcActionAllowance: TURN_REACTION_ACTION_ALLOWANCE, starContextMaxSteps: TURN_REACTION_STAR_CONTEXT_MAX_STEPS,
      });
      modelSteps += reactionAgentsResult.modelSteps;
      if (reactionAgentsResult.providerError !== null) providerError = reactionAgentsResult.providerError;
      if (!session.isFinished && !session.exhausted) {
        const reactionInterpreterResult = await runIntentInterpreter({
          adapter, session, atStep: input.atStep, playerCharacterId: input.actorCharacterId,
          logTag: `[reaction-interpreter:step-${input.atStep}]`,
        });
        if (reactionInterpreterResult !== undefined) {
          modelSteps += reactionInterpreterResult.modelSteps;
          if (reactionInterpreterResult.providerError !== null) providerError = reactionInterpreterResult.providerError;
        }
      }
      console.log(`${tag(input.atStep)} fresh-context reactions: npcs=${reactionSelection.npcCharacterIds.length} starContexts=${reactionSelection.starContextRefs.length}`);
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
