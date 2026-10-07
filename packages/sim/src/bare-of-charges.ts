import { ECONOMIC_LEVERS, type WorldState } from "@chronica/shared";

/**
 * The world as it was before the economic charges were given to anybody (docs/plans/government.md, "H1 as built"): every seeded department stripped of the five levers
 * (customs, mint, markets, credit, census), so that the men who keep them move no number. A test of a mechanism that has nothing to do with who keeps the books
 * (a granary, the tax regime, a tariff) is run on this world, so that the censors' skill with the census or the aediles' with the markets does not shift what it measures.
 */
export function bareOfCharges(world: WorldState): WorldState {
  const economic: readonly string[] = ECONOMIC_LEVERS;
  return { ...world, departments: world.departments.map((department) => ({ ...department, levers: department.levers.filter((lever) => !economic.includes(lever)) })) };
}
