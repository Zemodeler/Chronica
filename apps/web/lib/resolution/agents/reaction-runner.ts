import "server-only";

import type { AiAdapter } from "@chronica/ai";
import { buildAuthorityIndex, createGameMasterSession } from "@chronica/shared";
import type { NewWorldEvent } from "@chronica/db";
import type { AffectedAgentRunner, AffectedAgentRunnerInput, AffectedAgentRunnerResult } from "../event-loop";
import { runAffectedAgents } from "./run-affected-agents";
import { runIntentInterpreter } from "./interpreter-agent";

// The real `AffectedAgentRunner` (docs/32 corrective pass, requirement 3):
// runs every NPC/star-context agent `selectAffectedAgentsForEvent` chose for
// one resolved event, sequentially, against ONE shared session bound to the
// event loop's own current world (never a frozen pre-turn snapshot -- this
// call happens once per due event, with whatever `currentWorld` the loop
// has reached by then).
//
// A reaction is decided the same way a turn is: the reacting agents declare
// intent and nothing else, then one interpretation pass turns what they
// decided into real calls. Without that pass a reaction would decide
// something and schedule nothing, because the agents themselves hold no
// mutating tool.
//
// Every mutating call the session then accepts is validated for real but
// never applied here (`deferMutations: true`); what comes back
// (`GameMasterSessionResult.scheduledActions`) is converted into
// `action_phase` events at the triggering event's own instant, which the
// loop's existing causal-depth-capped follow-up scheduling then owns --
// exactly the "convert reactions into scheduled events, not a whole world
// of reactions from one frozen snapshot" requirement.
//
// Bounded reasoning only: a reaction gets a small, fixed step budget (this
// is a reaction to one event, not a full turn) and never touches
// `finish_turn`. No player directive is in scope here (`actorCharacterId`
// below is a synthetic id, and no `directives` are given this session), so
// no plan exists for the interpreter's plan tools to act on either.

const REACTION_ACTION_ALLOWANCE = 2;
const REACTION_MAX_STEPS = 3;
/**
 * A reaction's interpretation is deliberately tighter than a turn's. These
 * agents are answering one event with at most two intents each, so the pass
 * needs room to check an id and act, not to deliberate.
 */
const REACTION_INTERPRETER_MAX_STEPS = 6;

export function createReactionRunner(adapter: AiAdapter): AffectedAgentRunner {
  return {
    async runReactions(input: AffectedAgentRunnerInput): Promise<AffectedAgentRunnerResult> {
      const { world, selection, event, facts, atStep } = input;
      if (selection.npcCharacterIds.length === 0 && selection.starContextRefs.length === 0) {
        return { scheduledEvents: [] };
      }

      // No scenario `Office[]` catalog reaches this seam (same limitation as
      // `selectAffectedAgentsForEvent`) -- command grants (from
      // `Force.commanderCharacterId`) still resolve fully; office grants
      // need a live `Office` catalog this call does not have.
      const authorityIndex = buildAuthorityIndex(world.material, world.authorityGrants, [], atStep);

      // One shared, deferred-mutation session for every reaction agent this
      // event triggers -- each agent runs to completion before the next
      // starts, so a second reaction already sees whatever the first
      // validated-but-not-yet-applied action implies is about to happen is
      // NOT visible (deferred actions are, deliberately, not applied here),
      // but each agent's own reads still see the one, current, live world.
      const session = createGameMasterSession({
        world,
        atStep,
        // No real player is acting in this call; nothing offered to a
        // reaction agent's scoped tool surface (`npcToolSurface`) reads or
        // compares against this id.
        actorCharacterId: "__reaction_runner__",
        directiveIds: [],
        enableWorldTools: true,
        worldToolAuthorityIndex: authorityIndex,
        deferMutations: true,
      });

      await runAffectedAgents({
        adapter, session, atStep, atInstant: event.instant, authorityIndex, facts, selection,
        npcActionAllowance: REACTION_ACTION_ALLOWANCE, starContextMaxSteps: REACTION_MAX_STEPS,
      });

      // The reacting agents only declared intent; this is the pass that turns
      // any of it into real (deferred) actions. Without it a reaction would
      // decide something and schedule nothing.
      await runIntentInterpreter({
        adapter,
        session,
        atStep,
        maxSteps: REACTION_INTERPRETER_MAX_STEPS,
        logTag: `[reaction-interpreter:${event.id}:step-${atStep}]`,
      });

      const scheduledEvents: Omit<NewWorldEvent, "gameId">[] = session.result().scheduledActions.map((scheduled) => ({
        kind: "action_phase",
        instant: event.instant,
        subjectRef: { kind: "character", id: scheduled.actorId },
        payload: { kind: "action_phase", actionId: scheduled.actionId, actorId: scheduled.actorId, parameters: scheduled.parameters },
        createdAtStep: atStep,
      }));

      return { scheduledEvents };
    },
  };
}
