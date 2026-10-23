import { atWar, type FactProposalDraft, type WorldState } from "@chronica/shared";
import { safeLocalId } from "./safe-local-id";

/**
 * A town of the player's own power with an enemy at its gates and none of the player's men in it.
 *
 * A hand run lost its only town after the legion marched out to the hills: the order to man the walls had lapsed,
 * the town fell "with no garrison left to hold the breach", and nothing on the page had said the walls were bare.
 * Said once a month, to the player's power only, while it is true.
 */
export function ungarrisonedTowns(world: WorldState, playerPolityId: string | null, toDay: number): FactProposalDraft[] {
  if (playerPolityId === null) return [];
  const facts: FactProposalDraft[] = [];
  for (const province of world.map.provinces) {
    const towns = province.settlements.filter((settlement) => settlement.controllerPolityId === playerPolityId);
    if (towns.length === 0) continue;
    const inProvince = world.material.forces.filter((force) => force.locationId === province.id && force.personnel.length > 0);
    if (inProvince.some((force) => force.polityId === playerPolityId)) continue;
    const enemies = inProvince.filter((force) => force.polityId !== playerPolityId && atWar(world.polityAgreements, force.polityId, playerPolityId));
    if (enemies.length === 0) continue;
    for (const town of towns) {
      facts.push({
        localId: safeLocalId(`bare_walls_${town.id}_${toDay}`).slice(0, 60),
        kind: "garrison_missing",
        summary: `${town.name} has no garrison of ours: ${enemies.slice(0, 2).map((force) => force.name).join(" and ")} stand${enemies.length === 1 ? "s" : ""} in ${province.name}, and the walls are bare.`.slice(0, 400),
        affectedRefs: [{ kind: "polity", id: playerPolityId }, { kind: "province", id: province.id }, ...enemies.slice(0, 3).map((force) => ({ kind: "force" as const, id: force.id }))],
        visibility: "polity",
        discoveryState: "polity",
        knowableInDays: 0,
        significance: 70,
      });
    }
  }
  return facts;
}
