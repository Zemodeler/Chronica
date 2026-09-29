import { type MapConflictsOverlay, type WorldState } from "@chronica/shared";

/**
 * Keeping the map's picture of the fighting true (VISION §6).
 *
 * `WorldState.conflicts` is what the map draws: battles, sieges, and who is at
 * war with whom. The web layer has read it since the map existed and nothing
 * ever wrote it, so a player read about a battle in the Chronicle and saw
 * nothing on the ground where it was fought.
 *
 * Derived rather than maintained. Wars come from the agreements that define
 * them and sieges from the projects that are prosecuting them, so there is one
 * source of truth for each and no second bookkeeping to drift out of step.
 */

/** The wars the map should show, from the agreements that are the wars. */
export function warsFromAgreements(world: WorldState): MapConflictsOverlay["wars"] {
  const seen = new Set<string>();
  const wars: MapConflictsOverlay["wars"] = [];
  for (const agreement of world.polityAgreements) {
    if (agreement.status !== "active" || agreement.kind !== "war") continue;
    // The overlay orders the pair, so one war is one entry however it was
    // written down.
    const [polityAId, polityBId] = [agreement.polityId, agreement.otherPolityId].sort();
    const key = `${polityAId}:${polityBId}`;
    if (seen.has(key) || polityAId === undefined || polityBId === undefined) continue;
    seen.add(key);
    wars.push({ polityAId, polityBId });
  }
  return wars;
}

/**
 * The sieges the map should show, from the projects prosecuting them.
 *
 * A siege is a project against a place -- that is how the orchestrator has
 * always expressed one -- so this reads the projects rather than asking anybody
 * to maintain a parallel list. It ends when the project does.
 */
export function siegesFromProjects(world: WorldState): MapConflictsOverlay["sieges"] {
  const settlements = new Set(world.map.provinces.flatMap((province) => province.settlements.map((settlement) => settlement.id)));
  const sieges: MapConflictsOverlay["sieges"] = [];
  for (const project of world.projects) {
    if (project.status === "completed" || project.status === "failed" || project.status === "cancelled") continue;
    if (!project.kind.toLowerCase().includes("siege")) continue;
    const settlementId = project.linkedEntityIds.find((id) => settlements.has(id));
    if (settlementId === undefined) continue;
    const sponsor = project.sponsorEntityRef;
    const besiegingPolityId = sponsor.kind === "polity" ? sponsor.id : world.characters.find((character) => character.id === sponsor.id)?.polityId ?? null;
    const province = world.map.provinces.find((candidate) => candidate.settlements.some((settlement) => settlement.id === settlementId));
    // Only forces actually standing over the place are besieging it.
    const invading = world.material.forces
      .filter((force) => force.polityId === besiegingPolityId && force.locationId === province?.id)
      .map((force) => force.id);
    if (invading.length === 0) continue;
    sieges.push({ settlementId, invadingForceIds: invading.slice(0, 8), defendingForceIds: [] });
  }
  // A siege the engine keeps (`sieges.ts`), drawn on its city -- or, laid
  // against a province at large, on the province's first city.
  for (const siege of world.sieges) {
    if (siege.status !== "active") continue;
    const province = world.map.provinces.find((candidate) => candidate.id === siege.provinceId);
    const settlementId = siege.settlementId ?? province?.settlements[0]?.id;
    if (settlementId === undefined || sieges.some((drawn) => drawn.settlementId === settlementId)) continue;
    const defending = world.material.forces.filter((force) => force.locationId === siege.provinceId && force.polityId === siege.defenderPolityId).map((force) => force.id);
    sieges.push({ settlementId, invadingForceIds: [siege.forceId], defendingForceIds: defending.slice(0, 8) });
  }
  return sieges;
}

/** The whole overlay, recomputed from the world that is. */
export function projectConflicts(world: WorldState): MapConflictsOverlay {
  return {
    battles: world.conflicts.battles,
    sieges: siegesFromProjects(world),
    wars: warsFromAgreements(world),
  };
}
