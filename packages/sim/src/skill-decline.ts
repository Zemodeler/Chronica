import {
  currentAgeYears,
  leverDefinition,
  readDepartments,
  spreadSubSkills,
  STANDARD_LEVERS,
  SUBSKILL_OF,
  type Character,
  type SubSkill,
  type WorldState,
} from "@chronica/shared";

/**
 * Skills that go (docs/plans/departments.md §12).
 *
 * Skills only ever rose: practice raised them and nothing lowered them, so a
 * general of seventy fought as he had at forty, and a man who had not spoken
 * in the Senate for twenty years spoke as well as the day he stopped. Once a
 * year each man's finer skills are reckoned with:
 *
 * - Disuse. A skill above sixty that went a year unused loses a point a year,
 *   down to sixty: the old skill stays, the edge goes.
 * - Age. From fifty-five the body goes, two points a year of prowess and of
 *   endurance, and a point of feeding and moving armies; from sixty-five a
 *   point a year of everything else -- except the gods' law, letters, the
 *   rites and the settling of quarrels, which old priests and judges keep.
 * - Nothing falls below half the best it has ever been.
 *
 * A skill is in use while he holds work that reads it, while he commands an
 * army, and whenever practice has raised it since it was last reckoned.
 */

const YEAR = 360;
const EDGE = 60;
const BODY_FROM_AGE = 55;
const MIND_FROM_AGE = 65;
const BODY: ReadonlySet<SubSkill> = new Set(["prowess", "endurance"]);
const KEPT_IN_AGE: ReadonlySet<SubSkill> = new Set(["theology", "scholarship", "rites", "arbitration"]);
const COMMAND: readonly SubSkill[] = ["strategist", "authority", "devotion", "logistics"];
const FINER = Object.keys(SUBSKILL_OF) as SubSkill[];

/** How close a deputy comes to his head's gift by working under him, and never past what practice allows. */
const DEPUTY_GAP = 5;
const PRACTICE_CEILING = 90;

/** For each deputy, the head he works under and the skills of their department's work. */
function mentorsOf(world: WorldState): Map<string, { readonly head: Character; readonly skills: readonly SubSkill[] }[]> {
  const holder = new Map<string, string>();
  for (const seat of world.material.officeSeats) if (seat.status === "held" && seat.holderCharacterId !== null && !holder.has(seat.officeId)) holder.set(seat.officeId, seat.holderCharacterId);
  const found = new Map<string, { head: Character; skills: SubSkill[] }[]>();
  for (const department of world.departments) {
    if (department.abolishedAtStep !== null || department.headOfficeId === null || department.deputyOfficeIds.length === 0) continue;
    const head = world.characters.find((character) => character.id === holder.get(department.headOfficeId!) && character.alive);
    if (head === undefined) continue;
    const skills = [...new Set(department.levers.flatMap((lever) => leverDefinition(lever).skills).filter((skill): skill is SubSkill => skill !== "stewardship"))];
    for (const officeId of department.deputyOfficeIds) {
      const deputy = holder.get(officeId);
      if (deputy === undefined || deputy === head.id) continue;
      found.set(deputy, [...(found.get(deputy) ?? []), { head, skills }]);
    }
  }
  return found;
}

export function reviewSkills(world: WorldState, toDay: number): WorldState {
  const reader = readDepartments(world);
  const mentors = mentorsOf(world);
  const commanding = new Set(world.material.forces.map((force) => force.commanderCharacterId));
  let changed = false;

  const characters = world.characters.map((character) => {
    if (!character.alive) return character;
    const record = character.skillRecord ?? { peaks: {}, usedAtStep: {}, reviewedAtStep: null };
    const full = spreadSubSkills(character.id, character.skills, character.skills.subSkills) as Record<SubSkill, number>;

    // What he is using now.
    const used = new Set<SubSkill>(commanding.has(character.id) ? COMMAND : []);
    if (character.polityId !== null) {
      for (const lever of STANDARD_LEVERS) {
        if (!reader.holding({ kind: "polity", id: character.polityId }, lever).people.some((person) => person.id === character.id)) continue;
        for (const skill of leverDefinition(lever).skills) if (skill !== "stewardship") used.add(skill);
      }
    }
    for (const skill of FINER) if (full[skill] > (record.peaks[skill] ?? full[skill])) used.add(skill);

    const usedAtStep = { ...record.usedAtStep };
    for (const skill of used) usedAtStep[skill] = toDay;
    const peaks = { ...record.peaks };
    for (const skill of FINER) peaks[skill] = Math.max(peaks[skill] ?? 0, full[skill]);

    const first = record.reviewedAtStep === null;
    const years = first ? 0 : Math.floor((toDay - record.reviewedAtStep!) / YEAR);
    const sameUse = used.size === 0 && FINER.every((skill) => (record.peaks[skill] ?? -1) === peaks[skill]);
    if (!first && years < 1 && sameUse) return character;
    changed = true;
    if (years < 1) return { ...character, skillRecord: { peaks, usedAtStep, reviewedAtStep: record.reviewedAtStep ?? toDay } };

    const age = currentAgeYears(character, toDay);
    const subSkills = { ...character.skills.subSkills };
    let declined = false;
    for (const skill of FINER) {
      let value = full[skill];
      const idle = toDay - (usedAtStep[skill] ?? record.reviewedAtStep!) >= YEAR;
      if (idle && value > EDGE) value = Math.max(EDGE, value - years);
      if (age >= BODY_FROM_AGE && BODY.has(skill)) value -= 2 * years;
      else if (age >= BODY_FROM_AGE && skill === "logistics") value -= years;
      else if (age >= MIND_FROM_AGE && !KEPT_IN_AGE.has(skill)) value -= years;
      value = Math.max(Math.floor((peaks[skill] ?? full[skill]) / 2), value);
      // A deputy grows toward the man he works under.
      for (const mentor of mentors.get(character.id) ?? []) {
        if (!mentor.skills.includes(skill)) continue;
        const theirs = spreadSubSkills(mentor.head.id, mentor.head.skills, mentor.head.skills.subSkills)[skill] ?? 0;
        const reach = Math.min(PRACTICE_CEILING, theirs - DEPUTY_GAP);
        if (value < reach) value = Math.min(reach, value + years);
      }
      if (value !== full[skill]) {
        subSkills[skill] = value;
        declined = true;
      }
    }
    const next: Character = {
      ...character,
      skillRecord: { peaks, usedAtStep, reviewedAtStep: record.reviewedAtStep! + years * YEAR },
    };
    return declined ? { ...next, skills: { ...character.skills, subSkills: { ...full, ...subSkills } } } : next;
  });
  return changed ? { ...world, characters } : world;
}

/** A serious illness, once passed, takes a little of a man's endurance for good. */
export const LASTING_ILLNESS = /(plague|pox|malaria|dysentery|fever|flux)/i;

export function scarredBy(character: Character, status: string, toDay: number): Character {
  if (!LASTING_ILLNESS.test(status)) return character;
  const full = spreadSubSkills(character.id, character.skills, character.skills.subSkills) as Record<SubSkill, number>;
  let hash = 2166136261;
  for (const char of `${character.id}:${status}:${toDay}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  const loss = 1 + (hash % 3);
  const peak = character.skillRecord?.peaks.endurance ?? full.endurance;
  const endurance = Math.max(Math.floor(peak / 2), full.endurance - loss);
  return { ...character, skills: { ...character.skills, subSkills: { ...character.skills.subSkills, endurance } } };
}
