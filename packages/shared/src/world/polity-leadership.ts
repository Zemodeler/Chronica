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
// This seeds one at the moment a power is drawn into events -- an army on its
// soil, a message it owes an answer to, a war it is party to. It is a real
// character, not a placeholder: a named adult with a distinct temperament,
// skills, ambition, and an urgent first goal. The profile is replay-stable so
// that the same world state produces the same person on every replay.
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

/** A tiny, fixed-seed hash: state-derived variation without nondeterminism. */
function stableHash(text: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function pick<T>(values: readonly T[], seed: number, offset = 0): T {
  return values[(seed >>> offset) % values.length]!;
}

type LeaderProfile = {
  readonly name: string;
  readonly cultureId: string;
  readonly ageYears: number;
  readonly skills: { martial: number; intrigue: number; learning: number; piety: number; stewardship: number; diplomacy: number; body: number; subSkills: Record<string, never> };
  readonly traits: readonly string[];
  readonly values: readonly string[];
  readonly taboos: readonly string[];
};

function leaderProfileFor(polityId: string, polityName: string, capitalName: string, inheritedCultureId: string | undefined): LeaderProfile {
  const seed = stableHash(polityId);
  const cultureId = inheritedCultureId ?? "culture-local";
  const culture = cultureId.toLowerCase();
  const style = culture.includes("roman") ? "roman"
    : culture.includes("carthagin") || culture.includes("punic") ? "carthaginian"
      : culture.includes("greek") || culture.includes("hellen") ? "greek"
        : culture.includes("celt") || culture.includes("gaul") ? "celtic"
          : "local";

  const name = style === "roman"
    ? `${pick(["Aulus", "Decimus", "Lucius", "Publius", "Titus", "Gnaeus"], seed)} ${pick(["Aemilius", "Claudius", "Cornelius", "Fabius", "Fulvius", "Valerius"], seed, 5)}`
    : style === "carthaginian"
      ? `${pick(["Adherbal", "Bomilcar", "Hamilcar", "Hasdrubal", "Mago"], seed)} son of ${pick(["Hanno", "Himilco", "Maharbal", "Gisgo"], seed, 7)}`
      : style === "greek"
        ? `${pick(["Dionysios", "Eupolemos", "Kleon", "Nikias", "Philistos"], seed)} of ${capitalName}`
        : style === "celtic"
          ? `${pick(["Ambiorix", "Brennos", "Cavarinos", "Diviciacus", "Orgetorix"], seed)} of ${capitalName}`
          : `${pick(["Ariston", "Cassander", "Leontios", "Taranis", "Vardanes"], seed)} of ${capitalName}`;

  const profiles = [
    { traits: ["cautious", "disciplined"], values: ["disciplined"], taboos: ["bold"], skills: { martial: 45, intrigue: 45, learning: 50, piety: 50, stewardship: 60, diplomacy: 55, body: 45 } },
    { traits: ["bold", "dutiful"], values: ["dutiful"], taboos: ["deceitful"], skills: { martial: 65, intrigue: 40, learning: 40, piety: 45, stewardship: 45, diplomacy: 50, body: 60 } },
    { traits: ["sociable", "ambitious"], values: ["ambitious"], taboos: [], skills: { martial: 40, intrigue: 50, learning: 45, piety: 40, stewardship: 50, diplomacy: 65, body: 45 } },
    { traits: ["deceitful", "ambitious"], values: ["ambitious"], taboos: ["dutiful"], skills: { martial: 40, intrigue: 65, learning: 50, piety: 35, stewardship: 55, diplomacy: 55, body: 45 } },
    { traits: ["vengeful", "bold"], values: ["vengeful"], taboos: ["compassionate"], skills: { martial: 60, intrigue: 45, learning: 35, piety: 40, stewardship: 45, diplomacy: 45, body: 60 } },
    { traits: ["compassionate", "dutiful"], values: ["compassionate", "dutiful"], taboos: ["cruel"], skills: { martial: 45, intrigue: 40, learning: 55, piety: 60, stewardship: 55, diplomacy: 55, body: 45 } },
  ] as const;
  const profile = pick(profiles, seed, 11);

  return {
    name,
    cultureId,
    ageYears: 36 + ((seed >>> 17) % 23),
    skills: { ...profile.skills, subSkills: {} },
    traits: profile.traits,
    values: profile.values,
    taboos: profile.taboos,
  };
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

function firstGoalFor(trigger: LeadershipTrigger, polityName: string, seatName: string): string {
  if (trigger === "invaded") return `Drive the foreign force from ${seatName}.`;
  if (trigger === "addressed") return `Answer the message to ${polityName} on terms that preserve its independence.`;
  return `Protect ${polityName}'s position in the war.`;
}

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

    const capital = seat.settlements.find((settlement) => settlement.id === polity.capitalSettlementId)
      ?? next.map.provinces.flatMap((province) => province.settlements).find((settlement) => settlement.id === polity.capitalSettlementId)
      ?? seat.settlements[0];
    const inheritedCultureId = next.characters.find((character) => character.polityId === polityId)?.cultureId;
    const profile = leaderProfileFor(polityId, polity.name, capital?.name ?? seat.name, inheritedCultureId);
    const mind = deriveDefaultMind({ officeId: null, skills: profile.skills, ageYears: profile.ageYears, cultureId: profile.cultureId });
    const firstGoal = firstGoalFor(trigger, polity.name, seat.name);
    const character = {
      id: characterId,
      name: profile.name,
      cultureId: profile.cultureId,
      faithId: null,
      dynastyId: null,
      polityId,
      locationProvinceId: seat.id,
      ageYearsAtStart: profile.ageYears,
      birthStep: null,
      nextLifeReviewAtStep: null,
      officeId: null,
      personalAccountId: purse.accountId,
      skills: profile.skills,
      traits: [...profile.traits],
      mind: { ...mind, values: [...profile.values], taboos: [...profile.taboos] },
      alive: true,
      healthBps: 10_000,
      prestigeBps: 4_000,
      relations: [],
      ambitions: [{ id: `ambition-${characterId}`, label: firstGoal, kind: "restoration" as const, targetId: polityId, status: "active" as const }],
      heirCharacterId: null,
      diedAtStep: null,
      createdByDirector: true,
      createdAtStep: atStep,
      creationReason: TRIGGER_REASON[trigger],
      disqualifyingStatuses: [],
    };

    const goal = {
      id: `goal-${characterId}`,
      characterId,
      objective: firstGoal,
      category: "preserve_power" as const,
      targetEntityIds: [polityId],
      priority: 5,
      status: "active" as const,
      visibility: "private" as const,
      causalFactIds: [],
      createdAtStep: atStep,
      updatedAtStep: atStep,
      history: [{ atStep, note: TRIGGER_REASON[trigger] }],
    };

    next = {
      ...next,
      characters: [...next.characters, character],
      characterGoals: [...(next.characterGoals ?? []), goal],
      material: purse.material,
    };
    seeded.push({ polityId, polityName: polity.name, characterId, characterName: profile.name, trigger });
  }

  return { world: next, seeded };
}
