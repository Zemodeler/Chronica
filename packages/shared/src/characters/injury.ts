import type { Character } from "./character";

/**
 * What a man carries out of it when something meant to kill him does not.
 *
 * The engine could kill a person and it could scratch one -- `healthBps` moves,
 * and heals -- and it had no word at all for the thing in between, which is
 * most of what actually happened to people: an eye at a siege, an arm to a
 * sword, a leg that never set right. So every attempt on a life had two
 * endings, dead or untouched, and the second one left the target exactly as he
 * had been that morning.
 *
 * A maiming is permanent and it costs something real. Health that does not come
 * back, a skill that does not recover, and a tag the rest of the engine can
 * read -- `disqualifyingStatuses` is already consulted for who may hold office
 * and who may inherit, and a commander's health already multiplies what he is
 * worth in the field (`commanderModifierBps`). Nothing here is a flavour
 * string.
 *
 * The table is deliberately small and deliberately period-blind: these are
 * things that happen to a body, not to a Roman.
 */
export interface Injury {
  readonly id: string;
  /** What the record says happened to him. */
  readonly label: string;
  /** Health lost for good, in basis points. */
  readonly healthCostBps: number;
  /** Skills this takes from him, permanently. */
  readonly skillCosts: Partial<Record<"martial" | "intrigue" | "learning" | "piety" | "stewardship" | "diplomacy" | "body", number>>;
  /** Whether it keeps him from holding office and from inheriting. */
  readonly disqualifying: boolean;
}

/**
 * Ordered, and read by index off a deterministic roll. Never reordered without
 * accepting that every saved world resolves its old plots differently.
 */
export const INJURIES: readonly Injury[] = [
  {
    id: "blinded-one-eye",
    label: "blinded in one eye",
    healthCostBps: 800,
    skillCosts: { martial: -6, body: -8 },
    disqualifying: false,
  },
  {
    id: "lost-arm",
    label: "lost an arm",
    healthCostBps: 1_500,
    skillCosts: { martial: -18, body: -20 },
    disqualifying: false,
  },
  {
    id: "lamed",
    label: "lamed in the leg",
    healthCostBps: 1_200,
    skillCosts: { martial: -10, body: -15 },
    disqualifying: false,
  },
  {
    id: "disfigured",
    label: "disfigured about the face",
    healthCostBps: 500,
    // A man people cannot look at is a man who persuades fewer of them.
    skillCosts: { diplomacy: -12, body: -4 },
    disqualifying: false,
  },
  {
    id: "broken-in-health",
    label: "broken in health, and never sound again",
    healthCostBps: 2_500,
    skillCosts: { martial: -8, body: -18, stewardship: -5 },
    // The one that takes him out of public life: this is what "incapacitated"
    // has always meant to the eligibility rules, now with a way to arrive.
    disqualifying: true,
  },
];

export const INJURY_STATUS_PREFIX = "injured:";

/** The tag a given injury writes onto the man, e.g. `injured:lost-arm`. */
export const injuryStatusId = (injury: Injury): string => `${INJURY_STATUS_PREFIX}${injury.id}`;

/** Which maimings a person is already carrying, in the order they were taken. */
export function injuriesOf(character: Pick<Character, "disqualifyingStatuses">): readonly Injury[] {
  return INJURIES.filter((injury) => character.disqualifyingStatuses.includes(injuryStatusId(injury)));
}

/**
 * Marks a person with an injury they did not have before.
 *
 * Idempotent: a man already blind in one eye is not blinded in it again, which
 * matters because the roll that chooses one is deterministic and a second
 * attempt on the same life in the same circumstances would otherwise land on
 * the same wound twice and charge him for it both times.
 */
export function applyInjury(character: Character, injury: Injury): Character {
  const tag = injuryStatusId(injury);
  if (character.disqualifyingStatuses.includes(tag)) return character;

  const skills = { ...character.skills };
  for (const [skill, cost] of Object.entries(injury.skillCosts)) {
    const key = skill as keyof typeof injury.skillCosts;
    // Never below one. A maimed man is worse at soldiering; he is not absent.
    skills[key] = Math.max(1, skills[key] + cost);
  }

  return {
    ...character,
    skills,
    // Floored above nothing: this is a wound, not a death. Death has one door
    // and it is not this one.
    healthBps: Math.max(500, character.healthBps - injury.healthCostBps),
    disqualifyingStatuses: [
      ...character.disqualifyingStatuses,
      tag,
      ...(injury.disqualifying && !character.disqualifyingStatuses.includes("incapacitated") ? ["incapacitated"] : []),
    ],
  };
}
