import type { Force } from "../material-state";
import type { ScenarioWarfareRules } from "./battle";
import type { CrossingType } from "../world/map";

/**
 * Ships, and what having them lets an army do (VISION §6, §8).
 *
 * The map has carried strait and sea-lane crossings from the start and the
 * engine treated them like roads, so Sicily was another province of Italy: a
 * legion could walk to it, and the First Punic War -- a naval war -- could be
 * fought without anybody owning a ship. §6 lists ships in a polity's state and
 * §8's worked example is "build 200 warships within six months".
 *
 * What is naval is scenario data, like everything else about warfare here. A
 * period without ships declares no naval category and carries no naval system.
 */

/** The crossings only ships can make. */
export const WATER_CROSSINGS: readonly CrossingType[] = ["strait", "sea_lane"];

export const isWaterCrossing = (crossing: CrossingType): boolean => WATER_CROSSINGS.includes(crossing);

const categoryOf = (warfare: ScenarioWarfareRules | undefined, categoryId: string) =>
  warfare?.troopCategories.find((category) => category.id === categoryId);

/** A force with ships in it. Mixed fleets count: the hulls are what matter. */
export function isNavalForce(force: Force, warfare: ScenarioWarfareRules | undefined): boolean {
  return force.personnel.some((category) => categoryOf(warfare, category.categoryId)?.naval === true && category.fit > 0);
}

/** How many men this force can carry over water, ships included. */
export function transportCapacityOf(force: Force, warfare: ScenarioWarfareRules | undefined): number {
  return force.personnel.reduce((sum, category) => {
    const definition = categoryOf(warfare, category.categoryId);
    return definition === undefined ? sum : sum + category.fit * definition.transportPerHead;
  }, 0);
}

/** "men" for an army, "ships" for a fleet: what a force's count is a count of. */
export function countWord(force: Force, warfare: ScenarioWarfareRules | undefined, count: number): string {
  if (!isNavalForce(force, warfare)) return "men";
  return count === 1 ? "ship" : "ships";
}

/** A fleet's estimate is of hulls: "about 110 men" was a count of ships. */
export const asShips = (label: string, naval: boolean): string => (naval ? label.replace(/\bmen\b/g, "ships") : label);

/** Men actually present, which is what has to be carried. */
export function fitStrengthOf(force: Force): number {
  return force.personnel.reduce((sum, category) => sum + category.fit, 0);
}

/**
 * Which of this polity's fleets, standing here, could carry that army across.
 *
 * Returned rather than merely tested, because the fleet goes with them: an army
 * that crosses and leaves its ships on the far shore has not sailed, it has
 * teleported and abandoned a navy.
 */
export function transportFor(
  army: Force,
  candidates: readonly Force[],
  warfare: ScenarioWarfareRules | undefined,
): Force | null {
  const needed = fitStrengthOf(army);
  return (
    candidates
      .filter((force) => force.id !== army.id && force.polityId === army.polityId && force.locationId === army.locationId)
      .filter((force) => isNavalForce(force, warfare))
      .filter((force) => transportCapacityOf(force, warfare) >= needed)
      // The smallest fleet that will do, so a great one is not tied up ferrying.
      .sort((first, second) => transportCapacityOf(first, warfare) - transportCapacityOf(second, warfare))[0] ?? null
  );
}
