import {
  applySocialEvents,
  boundedId,
  CharacterSocialEventSchema,
  familyLinksOf,
  readDepartments,
  withLesson,
  type LessonKind,
  type RelationDimension,
  type WorldState,
} from "@chronica/shared";

/**
 * What the engine does to people, remembered by the people it was done to
 * (character-sim, opinion from events).
 *
 * Opinion moved only when two people spoke or one answered the other's order.
 * Everything the engine itself decided -- a battle lost under a man, a trial,
 * a sentence of death, a plot traced to its sponsor -- changed nobody's mind
 * about anybody: a man could have your brother condemned and you would greet
 * him as warmly the next morning. These are the few words that close that:
 * who thinks what of whom, and why, written through the one applier every
 * relation cause already goes through.
 */

export interface Grievance {
  /** Whose view it is. */
  readonly subjectCharacterId: string;
  /** Whom it is about. */
  readonly targetCharacterId: string;
  readonly label: string;
  /** -20 to 20. */
  readonly score: number;
  readonly dimensions: Partial<Record<RelationDimension, number>>;
  /** How fast it fades. A killed kinsman does not. */
  readonly decayPerYearBps?: number;
}

/** A slow fade: most of what the engine does to a man he remembers for years. */
const SLOW_FADE_BPS = 800;

/**
 * Writes what people now think, once, keyed on what caused it: the same cause
 * handed in twice on one day is the same memory, not two.
 */
export function remember(world: WorldState, grievances: readonly Grievance[], atStep: number, seed: string): WorldState {
  const living = new Set(world.characters.filter((character) => character.alive).map((character) => character.id));
  const seen = new Set<string>();
  const kept = grievances.filter((grievance) => {
    if (grievance.subjectCharacterId === grievance.targetCharacterId) return false;
    // The dead remember nothing; the dead can still be thought of.
    if (!living.has(grievance.subjectCharacterId) || !world.characters.some((character) => character.id === grievance.targetCharacterId)) return false;
    const key = `${grievance.subjectCharacterId}>${grievance.targetCharacterId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  let next = world;
  // An event carries at most sixteen causes; a great trial moves more people than that.
  for (let start = 0; start < kept.length; start += 16) {
    const chunk = kept.slice(start, start + 16);
    const inEvent = chunk;
    const people = [...new Set(inEvent.flatMap((grievance) => [grievance.subjectCharacterId, grievance.targetCharacterId]))].slice(0, 16);
    const id = boundedId("social", seed, start);
    next = applySocialEvents(
      next,
      [CharacterSocialEventSchema.parse({
        id,
        gameId: "engine",
        sourceTurnId: null, sourceSessionId: null, sourceMessageId: null,
        participantCharacterIds: people,
        kind: inEvent.every((grievance) => grievance.score >= 0) ? "favour" : "insult",
        visibility: "polity",
        knownByCharacterIds: people,
        relationCauses: inEvent.map((grievance) => ({
          subjectCharacterId: grievance.subjectCharacterId,
          targetCharacterId: grievance.targetCharacterId,
          label: grievance.label.slice(0, 200),
          score: Math.max(-20, Math.min(20, Math.round(grievance.score))),
          decayPerYearBps: grievance.decayPerYearBps ?? SLOW_FADE_BPS,
          dimensions: Object.fromEntries(Object.entries(grievance.dimensions).map(([dimension, value]) => [dimension, Math.max(-100, Math.min(100, Math.round(value ?? 0)))])),
        })),
        observedTraits: [],
        knowledgeClaims: [], proposedBeliefs: [], pressureChanges: [],
        commitmentProposal: null, introducedCharacter: null, introducedProfile: null,
        createdAtStep: atStep, appliedAtStep: null, appliedInTurnId: null,
        status: "proposed", rejectionReason: null,
      })],
      atStep,
      boundedId("social-batch", seed, start),
    ).world;
  }
  return next;
}

/** A lesson written on a man, for his next life review to move him by. */
export function teach(world: WorldState, characterId: string, kind: LessonKind, atStep: number): WorldState {
  if (!world.characters.some((character) => character.id === characterId && character.alive)) return world;
  return { ...world, characters: world.characters.map((character) => (character.id === characterId ? withLesson(character, kind, atStep) : character)) };
}

/** His living blood and marriage: who takes what is done to him personally. */
export function kinOf(world: WorldState, characterId: string): string[] {
  const living = new Set(world.characters.filter((character) => character.alive).map((character) => character.id));
  return [...new Set(familyLinksOf(world, characterId, world.elapsedStep).map((link) => link.counterpartCharacterId))]
    .filter((id) => id !== characterId && living.has(id))
    .sort()
    .slice(0, 6);
}

/**
 * Those whose business a man's service is: his power's rulers, and whoever
 * else sits in its offices, most eminent first. Bounded, because a Senate of
 * three hundred is represented by the few the world names.
 */
export function hisMasters(world: WorldState, polityId: string | null, limit = 6): string[] {
  if (polityId === null) return [];
  const rulers = readDepartments(world).rulers(polityId).map((ruler) => ruler.id);
  const officeholders = world.characters
    .filter((character) => character.alive && character.polityId === polityId
      && world.material.officeSeats.some((seat) => seat.holderCharacterId === character.id && seat.status === "held"))
    .sort((a, b) => b.prestigeBps - a.prestigeBps || a.id.localeCompare(b.id))
    .map((character) => character.id);
  return [...new Set([...rulers, ...officeholders])].slice(0, limit);
}
