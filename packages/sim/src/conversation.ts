import {
  emitFacts,
  type CharacterSocialEvent,
  type Fact,
  type FactDraft,
  type OrderPartyRef,
  type WorldInstant,
  type WorldState,
} from "@chronica/shared";
import type { IdFactory } from "./ports";

/**
 * Conversations as a source of history (VISION §14, §20).
 *
 * A conversation is not a side channel. What an NPC tells you becomes something
 * you know; what you promise becomes something you owe; and either can be the
 * reason someone else acts later. So a conversation's consequences enter the
 * same fact ledger as everything else, and the attention router reads them the
 * same way it reads a mobilization.
 *
 * The important part is the discovery ledger. A private conversation is exactly
 * that -- private -- so its fact is marked visible only to the people in the
 * room. `factsVisibleTo` then does the rest: the participants can act on it,
 * the Chronicle may report it to the player who was there, and nobody else in
 * the world can see it at all until someone tells them.
 */

const SIGNIFICANCE_BY_KIND: Readonly<Record<CharacterSocialEvent["kind"], number>> = {
  // A promise creates an obligation the world will hold someone to; an insult
  // between principals can end an alliance. Ordinary talk is near-noise.
  promise: 35,
  deception: 30,
  insult: 20,
  favour: 20,
  discovery: 15,
  rumour: 12,
  conversation: 5,
};

/** What the record should say happened, in one line, from the event's own content. */
function summarize(event: CharacterSocialEvent, nameOf: (id: string) => string): string {
  const participants = event.participantCharacterIds.map(nameOf);
  const who = participants.length === 2 ? `${participants[0]} and ${participants[1]}` : participants.join(", ");

  if (event.commitmentProposal !== null) {
    const promisor = nameOf(event.commitmentProposal.promisorCharacterId);
    const beneficiary = nameOf(event.commitmentProposal.beneficiaryCharacterId);
    return `${promisor} promised ${beneficiary}: ${event.commitmentProposal.promisedResult}`;
  }
  const belief = event.proposedBeliefs[0];
  if (belief !== undefined) return `${who} spoke, and it was said that ${belief.claim}`;
  const cause = event.relationCauses[0];
  if (cause !== undefined) return `${who} spoke: ${cause.label}`;
  return `${who} spoke.`;
}

export interface ConversationFactsInput {
  readonly events: readonly CharacterSocialEvent[];
  readonly world: WorldState;
  readonly now: WorldInstant;
  readonly ids: IdFactory;
}

export interface ConversationFacts {
  readonly facts: readonly Fact[];
  readonly significanceByFactId: ReadonlyMap<string, number>;
}

export function factsFromConversation(input: ConversationFactsInput): ConversationFacts {
  const nameOf = (id: string): string => input.world.characters.find((character) => character.id === id)?.name ?? id;

  const drafts: FactDraft[] = input.events.map((event) => {
    // Everyone the event itself says was present or told. These are the people
    // who may act on it; nobody else has heard anything.
    const knowers = [...new Set([...event.participantCharacterIds, ...event.knownByCharacterIds])];
    const observers: OrderPartyRef[] = knowers.map((id) => ({ kind: "character", id }));

    return {
      time: input.now,
      atStep: input.world.elapsedStep,
      kind: `conversation_${event.kind}`,
      summary: summarize(event, nameOf),
      affectedEntities: observers.slice(0, 16),
      resourceChanges: [],
      authorityChange: undefined,
      visibility: event.visibility,
      discovery: {
        // Said aloud between these people, and known to them from this moment.
        state: event.visibility === "public" ? "public" : "private",
        knowableAtInstant: null,
        discoveredBy: observers.slice(0, 64).map((observerRef) => ({ observerRef, atInstant: input.now, via: "witnessed" as const })),
      },
      evidence: { provenance: "direct_witness", reliability: 1, sourceFactId: null },
      eligibleReactionScopes: ["person"],
      sourceEventId: event.id,
      sourceActionId: null,
      causalDepth: 0,
    };
  });

  const facts = emitFacts(drafts, () => input.ids.next("fact"));
  const significanceByFactId = new Map<string, number>();
  facts.forEach((fact, index) => {
    const event = input.events[index];
    if (event !== undefined) significanceByFactId.set(fact.id, SIGNIFICANCE_BY_KIND[event.kind]);
  });

  return { facts, significanceByFactId };
}
