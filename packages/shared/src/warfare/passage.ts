import type { Force } from "../material-state";
import type { ScenarioWarfareRules } from "./battle";
import type { WorldState } from "../world/world-state";
import { leaderOf } from "../world/agreements";
import { adjacentTo, kmBetween, kmFrom, landKmBetween, provinceOf, strictKmBetween } from "../world/movement";
import { DETOUR_FACTOR, FERRY_GATHER_KM, describeKm, marchDaysFor, sailDaysFor } from "../world/travel";
import { fitStrengthOf, isNavalForce, isWaterCrossing, transportCapacityOf } from "./sea";
import { sailingSeason } from "./seasons";

/** The longest crossing made when the sea is shut: Messana's strait, the Bosporus, not the open water. */
const SHUT_SEASON_CROSSING_KM = 60;

/**
 * How an army gets from where it stands to a province some way off.
 *
 * On foot where there is a road; over water only in its own power's ships.
 * The ships need not carry it all at once: forty transports that hold 1,200
 * ferry a legion of 9,100 across a strait in eight loads, which is how every
 * army of the period crossed one. Nor need they be on the beach already: a
 * power's hulls within `FERRY_GATHER_KM` are sent for, and the crossing
 * waits for them. The fleets then sail with the army.
 *
 * A march is judged by this when it is ordered and again when it arrives, so a
 * fleet that was sunk or sent elsewhere in the meantime leaves the army on the
 * shore.
 */
export type Passage =
  | { readonly by: "land"; readonly km: number }
  | { readonly by: "sea"; readonly km: number; readonly ferry: Ferry; readonly over: "strait" | "sea_lane" }
  | { readonly by: null; readonly reason: string };

export interface Ferry {
  /** Every fleet the crossing uses; all of them sail with the army. */
  readonly fleets: readonly Force[];
  /** Men they carry at one go. */
  readonly capacity: number;
  /** Loads it takes to put the whole army across. */
  readonly trips: number;
  /** How many kilometres the furthest fleet has to come to the army first; 0 if all stand with it. */
  readonly gatherKm: number;
  /** Days each load after the first adds: one over a strait, more over open water. */
  readonly daysPerLoad: number;
}

/**
 * A crossing that would keep the hulls shuttling longer than this is not a
 * ferry but a season's work: build or hire more hulls.
 *
 * It was a cap of twelve loads, whatever the water: eighteen allied hulls
 * carrying 540 a load could not put 8,772 men over the Messana strait -- an
 * hour's sail, where they could make a load a day -- because it took
 * seventeen. Days are what a commander counts, so days are what is capped.
 */
export const MAX_FERRY_DAYS = 45;
/** Days one more load adds to a crossing over open water: over, unload, back. */
export const DAYS_PER_EXTRA_LOAD = 3;
/** A strait no wider than this (centre to centre; Rhegium to Messana is 26) is crossed, unloaded and recrossed in a day. */
export const SHORT_HOP_KM = 40;

/** Days each load after the first adds over this much water. */
export const daysPerExtraLoad = (seaKm: number | null): number => (seaKm !== null && seaKm <= SHORT_HOP_KM ? 1 : DAYS_PER_EXTRA_LOAD);

/** The most loads a crossing of this much water can take inside `MAX_FERRY_DAYS`. */
export const maxFerryLoads = (seaKm: number | null): number => 1 + Math.floor(MAX_FERRY_DAYS / daysPerExtraLoad(seaKm));

/** The days a sea passage adds to the march itself: gathering the hulls and the extra loads. */
export function ferryDays(ferry: Ferry): number {
  return sailDaysFor(ferry.gatherKm) + (ferry.trips - 1) * ferry.daysPerLoad;
}

/**
 * Whether this fleet's hulls are the army's to sail in: its own power's, or
 * those of a power that follows its power by foedus. The socii navales -- the
 * Greek cities of the south -- owed Rome ships as the Latins owed it men;
 * filed under the ally that sent them, they were invisible to every crossing
 * Rome planned.
 */
export function hullsAtTheCallOf(world: WorldState, fleet: Force, army: Pick<Force, "polityId">): boolean {
  return fleet.polityId === army.polityId || leaderOf(world.polityAgreements, fleet.polityId) === army.polityId;
}

/** " (requisitioned from the Tarentines)": whose hulls an allied fleet is, said where it sails. */
function requisitioned(world: WorldState, fleet: Force, army: Force): string {
  if (fleet.polityId === army.polityId) return "";
  return ` (requisitioned from ${world.map.polities.find((polity) => polity.id === fleet.polityId)?.name ?? fleet.polityId})`;
}

/**
 * The ships of the army's own power that could put it across, nearest first,
 * or null when they are too few or too far.
 */
export function ferryFor(world: WorldState, army: Force, warfare: ScenarioWarfareRules | undefined, seaKm: number | null = null): Ferry | null {
  const needed = fitStrengthOf(army);
  const near = world.material.forces
    .filter((force) => force.id !== army.id && hullsAtTheCallOf(world, force, army) && isNavalForce(force, warfare))
    .map((fleet) => ({ fleet, km: fleet.locationId === army.locationId ? 0 : kmBetween(world, fleet.locationId, army.locationId, FERRY_GATHER_KM), capacity: transportCapacityOf(fleet, warfare) }))
    .filter((entry): entry is { fleet: Force; km: number; capacity: number } => entry.km !== null && entry.km <= FERRY_GATHER_KM && entry.capacity > 0)
    // The nearest first; among those, the smallest that will do, so a great
    // fleet is not tied up ferrying when a squadron would carry them.
    .sort((a, b) => a.km - b.km || (a.capacity >= needed ? 0 : 1) - (b.capacity >= needed ? 0 : 1) || a.capacity - b.capacity);
  const fleets: Force[] = [];
  let capacity = 0;
  let gatherKm = 0;
  for (const entry of near) {
    if (capacity >= needed) break;
    fleets.push(entry.fleet);
    capacity += entry.capacity;
    gatherKm = Math.max(gatherKm, entry.km);
  }
  if (capacity <= 0) return null;
  const trips = Math.max(1, Math.ceil(needed / capacity));
  if (trips > maxFerryLoads(seaKm)) return null;
  return { fleets, capacity, trips, gatherKm, daysPerLoad: daysPerExtraLoad(seaKm) };
}

/** "in one crossing" / "in 8 loads, once the Campanian transports have come down from Campania". */
export function describeFerry(world: WorldState, army: Force, ferry: Ferry): string {
  const name = (id: string): string => provinceOf(world, id)?.name ?? id;
  const loads = ferry.trips === 1 ? "in one crossing" : `in ${ferry.trips} loads of about ${Math.min(ferry.capacity, fitStrengthOf(army))} men`;
  const coming = ferry.fleets.filter((fleet) => fleet.locationId !== army.locationId);
  const gather = coming.length === 0 ? "" : `, once ${coming.map((fleet) => `the ${fleet.name.replace(/^the /i, "")} from ${name(fleet.locationId)}`).join(" and ")} ${coming.length === 1 ? "has" : "have"} come to it`;
  return `${loads} in ${ferry.fleets.map((fleet) => `${fleet.name}${requisitioned(world, fleet, army)}`).join(" and ")}${gather}`;
}

/**
 * `month`, where the caller knows the calendar: from December to February the
 * open sea is shut (`seasons.ts`), and only a strait -- the hour's sail to
 * Messana -- may still be risked. Unknown, the sea is open.
 */
export function passageFor(world: WorldState, force: Force, toProvinceId: string, warfare: ScenarioWarfareRules | undefined, month: number | null = null): Passage {
  const name = (id: string): string => provinceOf(world, id)?.name ?? id;
  const onFoot = landKmBetween(world, force.locationId, toProvinceId);
  if (onFoot !== null) return { by: "land", km: onFoot };
  const anyWay = kmBetween(world, force.locationId, toProvinceId);
  if (anyWay === null) return { by: null, reason: `${force.name} stands in ${name(force.locationId)} and cannot reach ${name(toProvinceId)}: no road at all leads there.` };
  // The way over water, and whether it needs the open sea or only a strait.
  const over = strictKmBetween(world, force.locationId, toProvinceId, (crossing) => crossing !== "sea_lane", anyWay * DETOUR_FACTOR) === null ? "sea_lane" as const : "strait" as const;
  if (over === "sea_lane" && sailingSeason(month) === "shut") {
    return { by: null, reason: `${force.name} cannot sail from ${name(force.locationId)} to ${name(toProvinceId)} now: the sea is shut for the winter, and no captain will take ships out on it before March.` };
  }
  if (isNavalForce(force, warfare)) return { by: "land", km: anyWay };
  const ferry = ferryFor(world, force, warfare, anyWay);
  if (ferry !== null) return { by: "sea", km: anyWay, ferry, over };
  // What the power does have, and where: eighteen hulls two provinces off
  // were never mentioned, so the player could not know to send for them or
  // how far short they fell.
  const fleets = world.material.forces
    .filter((candidate) => hullsAtTheCallOf(world, candidate, force) && candidate.id !== force.id && isNavalForce(candidate, warfare))
    .map((fleet) => ({ fleet, km: fleet.locationId === force.locationId ? 0 : kmBetween(world, force.locationId, fleet.locationId) }))
    .filter((entry): entry is { fleet: Force; km: number } => entry.km !== null)
    .sort((a, b) => a.km - b.km);
  const needed = fitStrengthOf(force);
  const within = fleets.filter((entry) => entry.km <= FERRY_GATHER_KM);
  const carried = within.reduce((sum, entry) => sum + transportCapacityOf(entry.fleet, warfare), 0);
  const nearest = fleets[0];
  // All its ships together, wherever they are: whether sending for them could
  // ever be enough. Told to "order them nearer" when every hull it had would
  // still take fourteen loads, the player was sent to do something useless.
  const everything = fleets.reduce((sum, entry) => sum + transportCapacityOf(entry.fleet, warfare), 0);
  const most = maxFerryLoads(anyWay);
  const tooFew = everything > 0 && Math.ceil(needed / everything) > most;
  const have = nearest === undefined
    ? " Its power has no ships at all."
    : tooFew
      ? ` All its power's ships together carry ${everything} at a time: ${Math.ceil(needed / everything)} loads, more than the ${most} that ${MAX_FERRY_DAYS} days of crossing allow. It needs more hulls, built, hired or requisitioned from its allies.`
    : within.length > 0
      ? ` Its ships within reach carry ${carried} at a time: ${Math.ceil(needed / Math.max(1, carried))} loads, more than the ${most} that ${MAX_FERRY_DAYS} days of crossing allow. It needs more hulls, built, hired or requisitioned from its allies.`
      : ` The nearest of its power's ships, ${nearest.fleet.name}, lie in ${name(nearest.fleet.locationId)}, ${describeKm(nearest.km)} off, and carry ${transportCapacityOf(nearest.fleet, warfare)}. They must be ordered nearer first.`;
  return {
    by: null,
    reason: `${force.name} cannot reach ${name(toProvinceId)} from ${name(force.locationId)} on foot, nor sail there without ships enough: the way lies over water, and it has ${needed} men to carry.${have}`,
  };
}

/**
 * A crossing that has to be arranged first: the army walks to a shore, the
 * fleet sails to meet it there, and then it goes over in as many loads as it
 * takes.
 *
 * "Carry Legio I from Rome to Messana in the Roman Navy" was refused four
 * times in five weeks because the navy lay at Messana, more than
 * `FERRY_GATHER_KM` from Rome, and the refusal told the player to order it
 * nearer -- routine work, which is the engine's to arrange (VISION §13). The
 * shore is the one the army can reach on foot from which the destination is
 * soonest reached: Rhegium, for Messana, and not Ostia. The fleets are the
 * ones named, then those that can carry the army at all, nearest first --
 * not the nearest squadron that carries a tenth of it.
 */
export interface PassagePlan {
  readonly embarkProvinceId: string;
  /** How far the army walks to the shore. 0 when it stands on it. */
  readonly marchKm: number;
  /** Each fleet, and how far it sails to the shore. */
  readonly fleets: readonly { readonly fleet: Force; readonly sailKm: number }[];
  readonly capacity: number;
  readonly trips: number;
  /** From the shore to the destination. */
  readonly seaKm: number;
  readonly over: "strait" | "sea_lane";
  /** Days until the army and every fleet stand on the shore. */
  readonly gatherDays: number;
  /** Days of the crossing itself, every load of it, once they do. */
  readonly crossingDays: number;
}

/** Days one crossing takes to begin and end, besides the sailing: embarking, landing. */
export const CROSSING_OVERHEAD_DAYS = 2;

/** Whether a province has water on any side: a shore an army can take ship from. */
function isShore(world: WorldState, provinceId: string): boolean {
  return adjacentTo(world, provinceId).some((neighbour) => isWaterCrossing(neighbour.edge.crossing));
}

/** The shore nearest a province by land, the province itself when it is one: where ships hired from it muster. */
export function nearestShore(world: WorldState, provinceId: string): string {
  if (isShore(world, provinceId)) return provinceId;
  const onFoot = kmFrom(world, provinceId, { passable: (edge) => !isWaterCrossing(edge.crossing) });
  let best: { id: string; km: number } | null = null;
  for (const [id, km] of onFoot) if (isShore(world, id) && (best === null || km < best.km)) best = { id, km };
  return best?.id ?? provinceId;
}

export function passagePlanFor(
  world: WorldState,
  army: Force,
  toProvinceId: string,
  warfare: ScenarioWarfareRules | undefined,
  month: number | null = null,
  preferredFleetIds: readonly string[] = [],
): PassagePlan | null {
  if (isNavalForce(army, warfare)) return null;
  if (landKmBetween(world, army.locationId, toProvinceId) !== null) return null;
  const onFoot = kmFrom(world, army.locationId, { passable: (edge) => !isWaterCrossing(edge.crossing) });
  const fromDestination = kmFrom(world, toProvinceId);
  const needed = fitStrengthOf(army);
  const preferred = new Set(preferredFleetIds);
  // Ships already promised to another army's voyage are not free for this
  // one: four crossings planned on one hired fleet were each refused as "the
  // world at odds with itself", and took their order parts down with them.
  const promised = new Set(world.projects
    .filter((project) => (project.status === "in_progress" || project.status === "funded") && project.completionOutcome?.kind === "force_move" && project.completionOutcome.forceId !== army.id)
    .flatMap((project) => project.completionOutcome?.fleetIds ?? []));
  const hulls = world.material.forces
    .filter((force) => force.id !== army.id && hullsAtTheCallOf(world, force, army) && isNavalForce(force, warfare) && !promised.has(force.id))
    .map((fleet) => ({ fleet, capacity: transportCapacityOf(fleet, warfare), reach: kmFrom(world, fleet.locationId) }))
    .filter((entry) => entry.capacity > 0);
  if (hulls.length === 0) return null;
  const shut = sailingSeason(month) === "shut";
  // The shore from which army and ships together put it over soonest:
  // Rhegium for Messana, where the hulls lie, and not a nearer shore the army
  // reaches in a week and the ships in a month. Judged by the march and the
  // sailing alone, Legio I once walked to Etruria while every hull it could
  // use lay at Rhegium, 730 km away, and the crossing failed.
  let best: PassagePlan | null = null;
  let bestDays = Number.POSITIVE_INFINITY;
  for (const [provinceId, marchKm] of onFoot) {
    const seaKm = fromDestination.get(provinceId);
    if (seaKm === undefined || !isShore(world, provinceId)) continue;
    const candidates = hulls
      .map((entry) => ({ fleet: entry.fleet, capacity: entry.capacity, sailKm: entry.fleet.locationId === provinceId ? 0 : entry.reach.get(provinceId) ?? null }))
      .filter((entry): entry is { fleet: Force; capacity: number; sailKm: number } => entry.sailKm !== null)
      // The fleets named first; then those that carry the army in the fewest
      // loads; then the nearest.
      .sort((a, b) => Number(preferred.has(b.fleet.id)) - Number(preferred.has(a.fleet.id))
        || Math.ceil(needed / a.capacity) - Math.ceil(needed / b.capacity)
        || a.sailKm - b.sailKm);
    const fleets: { fleet: Force; sailKm: number }[] = [];
    let capacity = 0;
    for (const entry of candidates) {
      if (capacity >= needed) break;
      // Enough to put it over in loads, and every named fleet in: the rest stay where they are.
      const namedLeft = candidates.some((candidate) => preferred.has(candidate.fleet.id) && !fleets.some((taken) => taken.fleet.id === candidate.fleet.id));
      if (fleets.length > 0 && !namedLeft && Math.ceil(needed / capacity) <= maxFerryLoads(seaKm)) break;
      fleets.push({ fleet: entry.fleet, sailKm: entry.sailKm });
      capacity += entry.capacity;
    }
    if (capacity <= 0) continue;
    const trips = Math.max(1, Math.ceil(needed / capacity));
    if (trips > maxFerryLoads(seaKm)) continue;
    const gatherDays = Math.max(Math.ceil(marchDaysFor(marchKm)), ...fleets.map((entry) => sailDaysFor(entry.sailKm)));
    const crossingDays = CROSSING_OVERHEAD_DAYS + sailDaysFor(seaKm) + (trips - 1) * daysPerExtraLoad(seaKm);
    const days = gatherDays + crossingDays;
    if (best !== null && (days > bestDays || (days === bestDays && seaKm >= best.seaKm))) continue;
    const over = strictKmBetween(world, provinceId, toProvinceId, (crossing) => crossing !== "sea_lane", seaKm * DETOUR_FACTOR) === null ? "sea_lane" as const : "strait" as const;
    // Out of season only a strait is crossed: a short hop in sight of the far
    // shore. A "strait" of fifteen hundred sea miles is the open sea -- the
    // Carthaginian relief of Syracuse was sent to embark at Tingitana, because
    // a road ran on from there by Spain and Gaul, and it took half a year.
    if (shut && (over === "sea_lane" || seaKm > SHUT_SEASON_CROSSING_KM)) continue;
    best = { embarkProvinceId: provinceId, marchKm, fleets, capacity, trips, seaKm, over, gatherDays, crossingDays };
    bestDays = days;
  }
  return best;
}

/** "Legio I marches to Rhegium, the Roman Navy sails there from Messana, and it crosses in 2 loads." */
export function describePassagePlan(world: WorldState, army: Force, plan: PassagePlan): string {
  const name = (id: string): string => provinceOf(world, id)?.name ?? id;
  const shore = name(plan.embarkProvinceId);
  const walk = plan.marchKm === 0 ? `${army.name} takes ship in ${shore}` : `${army.name} marches to ${shore}, about ${describeKm(plan.marchKm)}`;
  const coming = plan.fleets.filter((entry) => entry.sailKm > 0);
  const sail = coming.length === 0 ? "" : `; ${coming.map((entry) => `${entry.fleet.name} sails there from ${name(entry.fleet.locationId)}`).join(", ")}`;
  const loads = plan.trips === 1 ? "in one crossing" : `in ${plan.trips} loads`;
  return `${walk}${sail}; it crosses ${loads} in ${plan.fleets.map((entry) => `${entry.fleet.name}${requisitioned(world, entry.fleet, army)}`).join(" and ")}`;
}
