import type { WorldState } from "@chronica/shared";

/**
 * The ground a fact may put an army on (E29): where it stands, where it is
 * marching to, the shore it takes ship from, the field it is fighting on, the
 * town it is besieging.
 *
 * A fact naming an army and a province is checked against the army's ground,
 * so the record never puts the Carthaginian fleet at Lilybaeum while it lies
 * off Africa. But the ground was only where the army stood, and where it
 * stood before the answer moved it -- so "the legion marches on Messana",
 * written the day it set out, lost Messana every turn of the play-test, and
 * the march was told as a march to nowhere.
 */
export function groundOfForce(world: Pick<WorldState, "material" | "projects" | "engagements" | "sieges" | "elapsedStep">, forceId: string): string[] {
  const ground = new Set<string>();
  const force = world.material.forces.find((candidate) => candidate.id === forceId);
  if (force !== undefined) ground.add(force.locationId);
  for (const project of world.projects) {
    const outcome = project.completionOutcome;
    if (outcome?.kind !== "force_move" || outcome.forceId !== forceId) continue;
    if (project.status === "completed" || project.status === "cancelled" || project.status === "failed") continue;
    if (outcome.provinceId !== null) ground.add(outcome.provinceId);
    if (outcome.embarkProvinceId !== undefined) ground.add(outcome.embarkProvinceId);
  }
  for (const engagement of world.engagements) {
    if (engagement.status === "ended" && engagement.endedAtStep !== world.elapsedStep) continue;
    if (engagement.attackerForceIds.includes(forceId) || engagement.defenderForceIds.includes(forceId) || engagement.seenForceIds.includes(forceId)) ground.add(engagement.provinceId);
  }
  for (const siege of world.sieges) {
    if (siege.forceId === forceId && siege.status === "active") ground.add(siege.provinceId);
  }
  return [...ground];
}
