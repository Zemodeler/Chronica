import { activeDepartments, computeOpinion, readDepartments, type Character, type WorldState } from "@chronica/shared";

/**
 * Grumbling (docs/plans/departments.md §8, "competence is read, not shown").
 *
 * An officer whose work goes badly -- his department's lever run well below
 * what a middling man would make of it, or his hand found in the chest -- is
 * a target. Anybody of his own power who already dislikes him, and has the
 * standing to be heard, comes to want him put out; which he then plans for,
 * or not, like anything else he wants. The want goes when the officer does.
 */

/** Below this a department is plainly badly run: a middling man manages fifty. */
const BADLY_RUN_SKILL = 38;
/** How long a proved theft is held against a man. */
const THEFT_REMEMBERED_DAYS = 180;
/** Who dislikes him enough to want him gone. */
const GRUDGE = -20;
/** Standing enough to be heard, where a man holds no office. */
const HEARD_AT_PRESTIGE_BPS = 4_000;
/** The most men who come to want one officer out. */
const MAX_GRUMBLERS = 3;

const wantId = (officerId: string): string => `replace-${officerId}`.slice(0, 120);

export function grumbleAtOfficers(world: WorldState, toDay: number): WorldState {
  const reader = readDepartments(world);
  const holding = new Set(world.material.officeSeats.filter((seat) => seat.status === "held" && seat.holderCharacterId !== null).map((seat) => seat.holderCharacterId!));
  const targets = new Map<string, { officer: Character; department: string; why: string }>();
  const serving = new Set<string>();
  for (const department of activeDepartments(world)) {
    if (department.scope.kind !== "polity" || department.formsAtStep > toDay) continue;
    const scope = department.scope;
    for (const lever of department.levers) {
      const held = reader.holding(scope, lever);
      if (held.department?.id !== department.id) continue;
      for (const officer of held.people) serving.add(officer.id);
      const skill = reader.skill(scope, lever);
      for (const officer of held.people) {
        const stole = world.diversions.some((row) => row.byCharacterId === officer.id && row.foundAtStep !== null && toDay - row.foundAtStep <= THEFT_REMEMBERED_DAYS);
        if (!stole && skill >= BADLY_RUN_SKILL) continue;
        if (!targets.has(officer.id)) targets.set(officer.id, { officer, department: department.name, why: stole ? "his hand was found in the chest" : "it is badly run" });
      }
    }
  }

  const wants = new Map<string, { id: string; label: string; targetId: string }[]>();
  for (const { officer, department, why } of targets.values()) {
    const grumblers = world.characters
      .filter((character) => character.alive && character.id !== officer.id && character.polityId === officer.polityId
        && (holding.has(character.id) || character.prestigeBps >= HEARD_AT_PRESTIGE_BPS)
        && computeOpinion(character, officer.id) <= GRUDGE)
      .sort((a, b) => computeOpinion(a, officer.id) - computeOpinion(b, officer.id) || b.prestigeBps - a.prestigeBps || a.id.localeCompare(b.id))
      .slice(0, MAX_GRUMBLERS);
    for (const grumbler of grumblers) {
      wants.set(grumbler.id, [...(wants.get(grumbler.id) ?? []), { id: wantId(officer.id), label: `See ${officer.name} put out of ${department}: ${why}`.slice(0, 200), targetId: officer.id }]);
    }
  }

  return {
    ...world,
    characters: world.characters.map((character) => {
      const fresh = (wants.get(character.id) ?? []).filter((want) => !character.ambitions.some((ambition) => ambition.id === want.id));
      // Out of it, whoever put him out: the want is met.
      const settled = character.ambitions.map((ambition) => (ambition.status === "active" && ambition.id === wantId(ambition.targetId ?? "") && !serving.has(ambition.targetId ?? "")
        ? { ...ambition, status: "fulfilled" as const }
        : ambition));
      const changed = fresh.length > 0 || settled.some((ambition, index) => ambition !== character.ambitions[index]);
      if (!changed) return character;
      return { ...character, ambitions: [...settled, ...fresh.map((want) => ({ id: want.id, label: want.label, kind: "office" as const, targetId: want.targetId, status: "active" as const, steps: [] }))] };
    }),
  };
}
