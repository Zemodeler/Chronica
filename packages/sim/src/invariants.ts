import { normalizeName, type WorldState } from "@chronica/shared";

/**
 * What must hold across the world's records, whatever each record says on
 * its own (E10).
 *
 * Every record can be valid and the world still impossible: two crossings
 * each counting on the one fleet, a man serving in two armies at once, a
 * second Aristodemus of Messana made beside the first. The schema checks each
 * row; these check the rows against each other. Each is a sentence, so a
 * refusal can say what it would have broken, and each names the things it is
 * about, so an act is refused only for what it introduced.
 */
export function findInvariantViolations(world: WorldState): string[] {
  const violations: string[] = [];

  // One fleet, one voyage: a fleet already carrying an army somewhere cannot
  // be counted on to carry another at the same time.
  const carrying = new Map<string, string>();
  for (const project of world.projects) {
    if (project.status !== "in_progress" && project.status !== "funded") continue;
    const outcome = project.completionOutcome;
    if (outcome?.kind !== "force_move") continue;
    for (const fleetId of outcome.fleetIds ?? []) {
      const other = carrying.get(fleetId);
      // Said by name: "force-hand-0-46 is counted on by both project-..." told
      // the player nothing he could act on.
      const fleet = world.material.forces.find((force) => force.id === fleetId)?.name ?? fleetId;
      const first = world.projects.find((candidate) => candidate.id === other)?.label ?? other;
      if (other !== undefined && other !== project.id) violations.push(`${fleet} is already carrying "${first}" and cannot also carry "${project.label}" at the same time`);
      else carrying.set(fleetId, project.id);
    }
  }

  // A man stands in one army's ranks at a time.
  const serving = new Map<string, string>();
  for (const force of world.material.forces) {
    for (const memberId of force.memberCharacterIds) {
      const other = serving.get(memberId);
      if (other !== undefined && other !== force.id) violations.push(`${memberId} serves in both ${other} and ${force.id}`);
      else serving.set(memberId, force.id);
    }
  }

  // Two living people of one power with one name are one person made twice,
  // unless the world already had them both.
  const named = new Map<string, string>();
  for (const character of world.characters) {
    // A single name is shared by many: Hanno is a dozen men of Carthage.
    if (!character.alive || character.name.trim().split(/\s+/).length < 2) continue;
    const key = `${character.polityId}:${normalizeName(character.name)}`;
    const other = named.get(key);
    if (other !== undefined) violations.push(`${other} and ${character.id} are the same person of ${character.polityId}, "${character.name}", made twice`);
    else named.set(key, character.id);
  }

  return violations;
}
