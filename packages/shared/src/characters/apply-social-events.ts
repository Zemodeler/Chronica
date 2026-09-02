import type { WorldState } from "../world/world-state";
import type { Character, DirectedRelation, RelationCause } from "./character";
import type { CharacterProfile } from "./character-profile";
import type { CharacterSocialEvent } from "./social-events";

// The single point where a proposed social event becomes canonical world
// state (character-sim phase 1). Pure and deterministic: given the same
// world, the same unapplied events, and the same `atStep`, it always produces
// the same result -- safe to call from inside turn resolution and safe to
// replay.

export interface ApplySocialEventsOutcome {
  readonly world: WorldState;
  readonly appliedIds: readonly string[];
  readonly rejectedIds: readonly { id: string; reason: string }[];
  /** Profiles paired with a newly-introduced character, for the caller to persist (DB-side, not part of `WorldState`). */
  readonly introducedProfiles: readonly CharacterProfile[];
}

function findRelation(character: Character, targetCharacterId: string): DirectedRelation | undefined {
  return character.relations.find((relation) => relation.subjectCharacterId === targetCharacterId);
}

function withAppendedCause(character: Character, targetCharacterId: string, cause: RelationCause): Character {
  const existing = findRelation(character, targetCharacterId);
  if (existing === undefined) {
    return {
      ...character,
      relations: [...character.relations, { subjectCharacterId: targetCharacterId, causes: [cause] }],
    };
  }
  return {
    ...character,
    relations: character.relations.map((relation) =>
      relation.subjectCharacterId === targetCharacterId
        ? { ...relation, causes: [...relation.causes, cause] }
        : relation,
    ),
  };
}

/**
 * Validates and applies a batch of unapplied `CharacterSocialEvent`s against
 * `world`. Never touches `material`, `officeId`, territories, or any field
 * outside `characters`/`continuity`/`encounters` -- the event schema itself
 * has no field to carry such an effect, so this is structural, not just a
 * runtime check.
 */
export function applySocialEvents(
  world: WorldState,
  events: readonly CharacterSocialEvent[],
  atStep: number,
  turnId: string,
): ApplySocialEventsOutcome {
  let characters = world.characters;
  let encounters = world.encounters;
  const appliedIds: string[] = [];
  const rejectedIds: { id: string; reason: string }[] = [];
  const introducedProfiles: CharacterProfile[] = [];

  for (const event of events) {
    if (event.status !== "proposed") continue;

    const knownCharacterIds = new Set(characters.map((c) => c.id));
    const introducing = event.kind === "discovery" && event.introducedCharacter !== null
      ? event.introducedCharacter
      : null;

    const unknownParticipant = event.participantCharacterIds.find(
      (id) => !knownCharacterIds.has(id) && id !== introducing?.id,
    );
    if (unknownParticipant !== undefined) {
      rejectedIds.push({ id: event.id, reason: `Unknown participant "${unknownParticipant}".` });
      continue;
    }

    const invalidCause = event.relationCauses.find(
      (cause) =>
        (!knownCharacterIds.has(cause.subjectCharacterId) && cause.subjectCharacterId !== introducing?.id)
        || (!knownCharacterIds.has(cause.targetCharacterId) && cause.targetCharacterId !== introducing?.id),
    );
    if (invalidCause !== undefined) {
      rejectedIds.push({ id: event.id, reason: "Relation cause references an unknown character." });
      continue;
    }

    // Discovery: append the introduced character (idempotent by id).
    if (introducing !== null && !knownCharacterIds.has(introducing.id)) {
      characters = [...characters, introducing];
      knownCharacterIds.add(introducing.id);
      if (event.introducedProfile !== null) introducedProfiles.push(event.introducedProfile);
    }

    const consequenceRefs = event.relationCauses.map((cause, index) => ({
      id: `${event.id}:cause:${index}`,
      kind: "relationship_cause" as const,
      explanation: cause.label,
    }));

    for (const cause of event.relationCauses) {
      const subject = characters.find((c) => c.id === cause.subjectCharacterId);
      if (subject === undefined) continue;
      const relationCause: RelationCause = {
        id: `${event.id}:cause:${cause.subjectCharacterId}:${cause.targetCharacterId}`,
        label: cause.label,
        score: cause.score,
        occurredAtStep: atStep,
        decayPerYearBps: cause.decayPerYearBps,
        encounterMemoryId: event.id,
      };
      characters = characters.map((c) =>
        c.id === subject.id ? withAppendedCause(c, cause.targetCharacterId, relationCause) : c,
      );
    }

    encounters = [
      ...encounters,
      {
        id: event.id,
        participantIds: event.participantCharacterIds,
        occurredAtStep: event.createdAtStep,
        turnId,
        kind: event.kind === "discovery" ? "meeting" : "conversation",
        outcome: event.commitmentProposal !== null
          ? `${event.kind}: ${event.commitmentProposal.promisedResult}`
          : `${event.kind} between ${event.participantCharacterIds.join(", ")}.`,
        visibility: event.visibility,
        witnessIds: event.knownByCharacterIds,
        salience: event.relationCauses.length > 0 ? 500 : 100,
        consequences: consequenceRefs,
        chronicleFactId: null,
      },
    ];

    appliedIds.push(event.id);
  }

  return {
    world: { ...world, characters, encounters },
    appliedIds,
    rejectedIds,
    introducedProfiles,
  };
}
