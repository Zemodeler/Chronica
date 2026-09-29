import type { WorldState } from "../world/world-state";
import type { ProvinceEdge } from "../world/map";

// Which provinces are fully simulated right now.
//
// A province used to carry a fixed detail tier chosen by whoever drew the map,
// and nothing ever changed it: a valley became a scene of war and stayed
// "far". With thousands of provinces the answer has to be found in the world.
// A province is live when something is going on in it or beside it; every
// other one is quiet ground, whose people eat, pay and serve but make no
// history of their own (no harvest news, no risings, no famine facts).
//
// Derived, not stored: the same world always gives the same set, and a
// province that stops mattering drops out without any bookkeeping. What keeps
// hunger and unrest from flickering off is that the things named below are
// themselves lasting (a war-damaged province stays live until it has healed). Hunger
// alone never makes a province live, or a famine would announce itself.

/** How near, in kilometres along an edge, a province must be to something live to be watched too. */
export const LIVE_REACH_KM = 60;

type Neighbours = ReadonlyMap<string, readonly (readonly [string, number])[]>;

const adjacencyCache = new WeakMap<readonly ProvinceEdge[], Neighbours>();

/** Neighbours with the edge distance, indexed once per edge list. */
function neighboursOf(edges: readonly ProvinceEdge[]): Neighbours {
  const cached = adjacencyCache.get(edges);
  if (cached !== undefined) return cached;
  const index = new Map<string, (readonly [string, number])[]>();
  const add = (from: string, to: string, distance: number): void => {
    const list = index.get(from);
    if (list === undefined) index.set(from, [[to, distance]]);
    else list.push([to, distance]);
  };
  for (const edge of edges) {
    add(edge.from, edge.to, edge.distance);
    add(edge.to, edge.from, edge.distance);
  }
  adjacencyCache.set(edges, index);
  return index;
}

const liveCache = new WeakMap<WorldState, ReadonlySet<string>>();

/**
 * The provinces that are fully simulated in this world: those with a town, an
 * army, a siege, a battle, an occupier, a contested owner, a living person, a
 * standing project, structure, venture, contract, plan, holding or storyline,
 * or unhealed war damage -- and every province within `LIVE_REACH_KM` of one
 * of those. Computed once per world object and reused.
 */
export function liveProvinceIds(world: WorldState): ReadonlySet<string> {
  const cached = liveCache.get(world);
  if (cached !== undefined) return cached;

  const core = new Set<string>();
  const settlementProvince = new Map<string, string>();
  for (const province of world.map.provinces) {
    if (province.settlements.length > 0) core.add(province.id);
    for (const settlement of province.settlements) settlementProvince.set(settlement.id, province.id);
    if (province.lostBy != null || province.yearning != null) core.add(province.id);
  }
  const forceProvince = new Map<string, string>();
  for (const force of world.material.forces) {
    core.add(force.locationId);
    forceProvince.set(force.id, force.locationId);
  }
  for (const siege of world.sieges) if (siege.status === "active") core.add(siege.provinceId);
  for (const siege of world.conflicts.sieges) {
    const province = settlementProvince.get(siege.settlementId);
    if (province !== undefined) core.add(province);
  }
  for (const battle of world.conflicts.battles) {
    for (const forceId of battle.participantForceIds) {
      const province = forceProvince.get(forceId);
      if (province !== undefined) core.add(province);
    }
  }
  for (const record of world.map.occupationRecords) {
    if (record.status !== "active") continue;
    const province = record.locationKind === "province" ? record.locationId : settlementProvince.get(record.locationId);
    if (province !== undefined) core.add(province);
  }
  for (const character of world.characters) if (character.alive) core.add(character.locationProvinceId);
  for (const storyline of world.storylines) if (storyline.closedAtStep === null && storyline.provinceId !== null) core.add(storyline.provinceId);
  for (const project of world.projects) {
    const place = project.completionOutcome?.provinceId;
    if (place != null && (project.status === "funded" || project.status === "in_progress")) core.add(place);
  }
  for (const structure of world.structures) core.add(structure.provinceId);
  for (const contingency of world.contingencies) if (contingency.status === "armed") core.add(contingency.provinceId);
  for (const venture of world.material.ventures) {
    if (venture.status !== "running") continue;
    core.add(venture.fromProvinceId);
    core.add(venture.toProvinceId);
  }
  for (const contract of world.material.contracts) if (contract.status === "active" && contract.provinceId !== null) core.add(contract.provinceId);
  for (const holding of world.material.holdings) core.add(holding.territoryId);
  for (const row of world.material.provinceMaterial) {
    if (row.warDamageBps > 0) core.add(row.provinceId);
  }

  // One step out along the edges, by kilometres: a province a day's march
  // from the action is watched too. Reach is measured from the core only, so
  // it never chains across the map.
  const live = new Set(core);
  const neighbours = neighboursOf(world.map.edges);
  for (const id of core) {
    for (const [other, km] of neighbours.get(id) ?? []) if (km <= LIVE_REACH_KM) live.add(other);
  }
  liveCache.set(world, live);
  return live;
}

/** Whether a province is fully simulated in this world (`liveProvinceIds`). */
export function isLiveProvince(world: WorldState, provinceId: string): boolean {
  return liveProvinceIds(world).has(provinceId);
}
