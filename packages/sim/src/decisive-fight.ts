import { isNavalForce, type Force, type ScenarioWarfareRules, type WorldState } from "@chronica/shared";

/**
 * Whether a fight is big enough to stop the turn and ask the player
 * (plan item 5, battle narrowing). Every turning point used to ask him, however
 * small the skirmish; now only a fight that can decide a campaign does, and
 * the rest the commander on the spot settles by the rule the engine plays by.
 *
 * Decisive when the two sides together are more than a skirmish AND any of:
 * either side puts a quarter or more of its power's field army on the ground,
 * the ground is a capital, or a city there is under siege.
 */
export const SKIRMISH_MEN = 1_500;
/** A quarter of a power's field strength, in basis points. */
export const DECISIVE_SHARE_BPS = 2_500;

const fitOf = (force: Force): number => force.personnel.reduce((sum, group) => sum + group.fit, 0);

export function isDecisiveFight(world: WorldState, provinceId: string, mine: readonly Force[], theirs: readonly Force[], rules?: ScenarioWarfareRules): boolean {
  const men = (side: readonly Force[]): number => side.reduce((sum, force) => sum + fitOf(force), 0);
  if (mine.length === 0 || theirs.length === 0 || men(mine) + men(theirs) < SKIRMISH_MEN) return false;
  const fieldArmy = (polityId: string): number => world.material.forces
    .filter((force) => force.polityId === polityId && !isNavalForce(force, rules))
    .reduce((sum, force) => sum + fitOf(force), 0);
  const share = (side: readonly Force[]): number => Math.round((men(side) / Math.max(1, fieldArmy(side[0]!.polityId))) * 10_000);
  if (share(mine) >= DECISIVE_SHARE_BPS || share(theirs) >= DECISIVE_SHARE_BPS) return true;
  const province = world.map.provinces.find((candidate) => candidate.id === provinceId);
  const capital = world.map.polities.some((polity) => province?.settlements.some((settlement) => settlement.id === polity.capitalSettlementId) === true);
  if (capital) return true;
  return world.sieges.some((siege) => siege.status === "active" && siege.provinceId === provinceId);
}
