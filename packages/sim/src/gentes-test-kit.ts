import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, ensureProvinceMaterial, type Character, type WorldState } from "@chronica/shared";

/** The Punic opening, with its gentes, for the tests of the noble families. */
export const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);

export const named = (world: WorldState, name: string): Character => {
  const found = world.characters.find((character) => character.name === name);
  if (found === undefined) throw new Error(`No ${name} in the world.`);
  return found;
};

export const withDay = (world: WorldState, day: number): WorldState => ({ ...world, instant: { ...world.instant, day }, elapsedStep: day });

/** What a man thinks of another, set outright, so a grudge can be made in one line. */
export function thinks(world: WorldState, of: string, about: string, score: number): WorldState {
  return {
    ...world,
    characters: world.characters.map((character) => (character.id !== of ? character : {
      ...character,
      relations: [...character.relations.filter((relation) => relation.subjectCharacterId !== about), { subjectCharacterId: about, causes: [{ id: `seeded-${score}`, label: "An old wrong.", score, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null }] }],
    })),
  };
}
