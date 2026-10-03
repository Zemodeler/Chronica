import type { WorldState } from "@chronica/shared";

const MIN_MEN = 1_000;

/**
 * A man who commands an army in the field is where his army is.
 *
 * The consul who led Legio I to Messana and on to Syracuse was still recorded
 * at Rome: the mercenaries he hired "beside himself" mustered in Latium and
 * served out their term there. A land army's commander goes with it; a fleet's
 * admiral is not moved, since a fleet is in many harbours in a season.
 */
export function commandersFollowTheirArmies(world: WorldState): WorldState {
  const best = new Map<string, { men: number; at: string }>();
  for (const force of world.material.forces) {
    if (force.commanderCharacterId === null || force.commanderCharacterId === undefined) continue;
    const men = force.personnel.reduce((sum, group) => sum + group.fit, 0);
    const ships = force.personnel.filter((group) => group.categoryId === "warship").reduce((sum, group) => sum + group.fit, 0);
    if (men < MIN_MEN || ships * 2 > men) continue;
    const known = best.get(force.commanderCharacterId);
    if (known === undefined || men > known.men) best.set(force.commanderCharacterId, { men, at: force.locationId });
  }
  let changed = false;
  const characters = world.characters.map((character) => {
    const there = best.get(character.id);
    if (there === undefined || !character.alive || character.locationProvinceId === there.at) return character;
    changed = true;
    return { ...character, locationProvinceId: there.at };
  });
  return changed ? { ...world, characters } : world;
}
