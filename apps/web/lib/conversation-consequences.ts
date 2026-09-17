import "server-only";

import {
  getWorldView,
  insertWorldFacts,
  markCharacterSocialEventsApplied,
  markCharacterSocialEventsRejected,
  persistOpeningWorld,
  upsertCharacterProfile,
  type ChronicaDatabase,
} from "@chronica/db";
import { applySocialEvents, type CharacterSocialEvent } from "@chronica/shared";
import { createIdFactory, factsFromConversation } from "@chronica/sim";

/**
 * Makes a conversation consequential, immediately.
 *
 * Until now a proposed `CharacterSocialEvent` sat in the ledger until a turn
 * resolved and applied it. Turns are gone, so nothing did: relationships,
 * beliefs, pressures and promises from every conversation since the wipe simply
 * never reached canonical state.
 *
 * This closes that. It also does something the old path never did -- it records
 * the conversation in the fact ledger, so what was said is part of the world's
 * history rather than only a private mutation. That is what lets the attention
 * router wake someone because of a promise, and the Chronicle report a
 * conversation the player actually had.
 *
 * Deliberately not a burst: a conversation is not an order, costs no model call
 * here, and must not advance the clock or wake the world on its own. It records
 * what happened and stops.
 */
export async function applyConversationConsequences(
  db: ChronicaDatabase,
  gameId: string,
  events: readonly CharacterSocialEvent[],
): Promise<{ applied: number; rejected: number }> {
  const proposed = events.filter((event) => event.status === "proposed");
  if (proposed.length === 0) return { applied: 0, rejected: 0 };

  const view = await getWorldView(db, gameId);
  if (view === undefined) return { applied: 0, rejected: 0 };

  const sourceId = `conversation-${Date.now().toString(36)}`;
  const outcome = applySocialEvents(view.world, proposed, view.world.elapsedStep, sourceId);

  const appliedEvents = proposed.filter((event) => outcome.appliedIds.includes(event.id));
  const { facts, significanceByFactId } = factsFromConversation({
    events: appliedEvents,
    world: outcome.world,
    now: outcome.world.instant,
    ids: createIdFactory(sourceId),
  });

  // World first: a fact describing a relationship change that was never saved
  // is worse than a change with no fact.
  await persistOpeningWorld(db, gameId, outcome.world);

  if (facts.length > 0) {
    await insertWorldFacts(db, gameId, facts.map((fact) => ({
      id: fact.id,
      instantSortKey: fact.time.day * 1440 + fact.time.minute,
      kind: fact.kind,
      summary: fact.summary,
      visibility: fact.visibility,
      discoveryState: fact.discovery.state,
      knowableAtSortKey: null,
      significance: significanceByFactId.get(fact.id) ?? 0,
      causalDepth: fact.causalDepth,
      fact,
    })));
  }

  // A discovery event introduces a person; their chat profile lives beside the
  // world rather than inside it, and is lost if the caller forgets it.
  for (const profile of outcome.introducedProfiles) {
    await upsertCharacterProfile(db, profile);
  }

  await markCharacterSocialEventsApplied(db, outcome.appliedIds, view.world.elapsedStep, sourceId);
  if (outcome.rejectedIds.length > 0) {
    await markCharacterSocialEventsRejected(db, outcome.rejectedIds);
  }

  return { applied: outcome.appliedIds.length, rejected: outcome.rejectedIds.length };
}
