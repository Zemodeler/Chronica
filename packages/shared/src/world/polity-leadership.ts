import type { WorldState } from "./world-state";
import { deriveDefaultMind } from "../characters/mind";
import { openCharacterAccount } from "../material/character-accounts";
import { unansweredMessages } from "./diplomacy";

// Giving a power somebody to be.
//
// Every tool in the engine needs an actor: a polity with no living named
// character cannot raise a levy, answer a letter, or refuse a demand, because
// there is nobody to do it in its name. Scenarios name people only for the
// powers their author cared about, so the moment a player marched into the
// Boii and wrote to them, he was dealing with a power that was mechanically
// incapable of noticing either.
//
// This seeds one, deterministically, at the moment a power is drawn into
// events -- an army on its soil, a message it owes an answer to, a war it is
// party to. It is bookkeeping, not narration: the leader it makes is a plain
// adult of that polity, and the Game Master is free to give them a proper
// name (rename_character), a temperament, and a policy of their own.
//
// Deliberately narrow. A quiet power that nothing is happening to gets
// nobody, because a world that invents a named leader for every polity on the
// map has done nothing but make its own cast unreadable.

/** Why a power was given a leader. Recorded on the character as its creation reason. */
export type LeadershipTrigger = "invaded" | "addressed" | "at_war";

export interface SeededLeader {
  readonly polityId: string;
  readonly polityName: string;
  readonly characterId: string;
  readonly characterName: string;
  readonly trigger: LeadershipTrigger;
}

export interface EnsuredPolityLeadership {
  readonly world: WorldState;
  readonly seeded: readonly SeededLeader[];
}

/** Stable across a replay: the same polity always seeds the same id. */
function leaderIdFor(polityId: string): string {
  return `leader-${polityId}`;
}

/**
 * A name in the same register the scenarios themselves use for an unnamed
 * representative ("Mamertine spokesman"). It reads as a person in prose while
 * being honest that the record does not know who they were.
 */
function leaderNameFor(polityName: string): string {
  return `${polityName} leader`;
}

/** Which powers are currently party to something they cannot answer without somebody to answer it. */
function engagedPolityIds(world: WorldState): Map<string, LeadershipTrigger> {
  const engaged = new Map<string, LeadershipTrigger>();

  for (const force of world.material.forces) {
    const province = world.map.provinces.find((candidate) => candidate.id === force.locationId);
    const host = province?.controllerPolityId ?? null;
    if (host !== null && host !== force.polityId && !engaged.has(host)) engaged.set(host, "invaded");
  }
  for (const message of unansweredMessages(world.diplomacy)) {
    if (!engaged.has(message.toPolityId)) engaged.set(message.toPolityId, "addressed");
  }
  for (const war of world.conflicts.wars) {
    for (const polityId of [war.polityAId, war.polityBId]) {
      if (!engaged.has(polityId)) engaged.set(polityId, "at_war");
    }
  }
  return engaged;
}

const TRIGGER_REASON: Record<LeadershipTrigger, string> = {
  invaded: "A foreign force stood on this power's ground and it had nobody to answer for it.",
  addressed: "Another power addressed this one directly and it had nobody to receive the message.",
  at_war: "This power is at war and had nobody to conduct it.",
};

/**
 * Give a leader to every power that is party to events and has none.
 *
 * Idempotent: a polity with any living character is left exactly as it is, and
 * running this twice on the same world seeds nothing the second time.
 */
export function ensurePolityLeadership(world: WorldState, atStep: number): EnsuredPolityLeadership {
  const engaged = engagedPolityIds(world);
  if (engaged.size === 0) return { world, seeded: [] };

  let next = world;
  const seeded: SeededLeader[] = [];

  for (const [polityId, trigger] of engaged) {
    const polity = next.map.polities.find((candidate) => candidate.id === polityId);
    if (polity === undefined) continue;
    if (next.characters.some((character) => character.alive && character.polityId === polityId)) continue;

    const characterId = leaderIdFor(polityId);
    // A dead leader of the same derived id means this power has been here
    // before and lost the one it was given; seeding a second under the same id
    // would collide, so it waits for the world to name a successor.
    if (next.characters.some((character) => character.id === characterId)) continue;

    // Somewhere this power actually holds, so the leader does not stand on a
    // rival's ground the moment they exist.
    const seat = next.map.provinces.find((province) => province.controllerPolityId === polityId);
    if (seat === undefined) continue;

    const purse = openCharacterAccount(next.material, characterId);
    if (purse === null) continue;

    const skills = { martial: 45, intrigue: 40, learning: 40, piety: 45, stewardship: 45, diplomacy: 45, body: 50, subSkills: {} };
    const name = leaderNameFor(polity.name);
    const character = {
      id: characterId,
      name,
      cultureId: "culture-local",
      faithId: null,
      dynastyId: null,
      polityId,
      locationProvinceId: seat.id,
      ageYearsAtStart: 40,
      birthStep: null,
      nextLifeReviewAtStep: null,
      officeId: null,
      personalAccountId: purse.accountId,
      skills,
      traits: [],
      mind: deriveDefaultMind({ officeId: null, skills, ageYears: 40, cultureId: "culture-local" }),
      alive: true,
      healthBps: 10_000,
      prestigeBps: 4_000,
      relations: [],
      ambitions: [],
      heirCharacterId: null,
      diedAtStep: null,
      createdByDirector: true,
      createdAtStep: atStep,
      creationReason: TRIGGER_REASON[trigger],
      disqualifyingStatuses: [],
    };

    next = { ...next, characters: [...next.characters, character], material: purse.material };
    seeded.push({ polityId, polityName: polity.name, characterId, characterName: name, trigger });
  }

  return { world: next, seeded };
}
