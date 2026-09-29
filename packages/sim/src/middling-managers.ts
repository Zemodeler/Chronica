import type { WorldState } from "@chronica/shared";

/**
 * Every man exactly middling with money: stewardship, taxation and logistics
 * at 50, where the engine's skill effect on income is exactly one. For tests of
 * how taxes, trade and estates are counted, which should not move when the
 * scenario's people are given better or worse hands for them.
 */
export function withMiddlingManagers(world: WorldState): WorldState {
  return {
    ...world,
    characters: world.characters.map((character) => ({
      ...character,
      skills: { ...character.skills, stewardship: 50, subSkills: { ...character.skills.subSkills, taxation: 50, logistics: 50 } },
    })),
  };
}
