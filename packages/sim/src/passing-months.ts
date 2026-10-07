import { advanceProvinceMaterial, type ProvinceTargets, type WorldState } from "@chronica/shared";
import { reviewTheLand } from "./economy";

/**
 * Months of the engine's own material pass, for the tests that watch a province
 * over years: the coarse recovery every province gets (`advanceProvinceMaterial`)
 * and the calendar's month of people and development (`reviewTheLand`), thirty
 * days at a time, without the rest of the tick. It is the same pair the tick runs
 * each month, so what it shows of a province is what the tick would; what it
 * leaves out -- pay, tax collection, battles -- a test that needs it runs a tick.
 *
 * `targetsOf` is what stands in each province (`provinceTargetsFrom`) as it stands
 * that month; absent, nothing does.
 */
export function months(
  world: WorldState,
  count: number,
  from = 0,
  targetsOf: (world: WorldState) => ReadonlyMap<string, ProvinceTargets> = () => new Map(),
): WorldState {
  let current = world;
  let day = from;
  // The first review only marks the day the land was last reckoned.
  current = reviewTheLand({ world: current, toDay: day, targets: () => targetsOf(current) }).world;
  for (let month = 0; month < count; month += 1) {
    day += 30;
    current = advanceProvinceMaterial(current, day, new Set(), targetsOf(current));
    current = reviewTheLand({ world: current, toDay: day, targets: () => targetsOf(current) }).world;
  }
  return current;
}
