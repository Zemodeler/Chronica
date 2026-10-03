import { atWar, fitStrengthOf, kmFromAny, takenBy, type FactProposalDraft, type WorldState } from "@chronica/shared";

/**
 * Open country is occupied by the army standing in it (docs/plans/a-living-world.md §3).
 *
 * Ground changed hands only when a city in it was taken by siege, or when the
 * model wrote it -- and 5 960 of the map's 6 384 provinces have no city at
 * all, so a war could cross half a kingdom and hold none of it. As in EU4, an
 * army at war standing in enemy country with no defending army in it occupies
 * it, and its foragers and patrols hold the undefended country round about
 * (`FORAGE_KM`): the ground is held, not owned (`world/occupation.ts`), and
 * counts toward the war. Ground with walls -- a town of any strength -- is
 * still taken by siege.
 */

/** Walls this strong need a siege; below it, the town opens to the army in its fields. */
export const SIEGE_NEEDED_AT = 2;
/** How far an army's foragers and patrols hold the undefended country around it. */
export const FORAGE_KM = 80;
/** An army smaller than this holds the province it stands in, and no more. */
const PATROL_MEN = 1_000;

export function occupyOpenCountry(world: WorldState, toDay: number): { world: WorldState; facts: FactProposalDraft[] } {
  const facts: FactProposalDraft[] = [];
  const armed = world.material.forces.filter((force) => force.outlaw !== true && fitStrengthOf(force) > 0);
  if (armed.length === 0) return { world, facts };
  const provinceById = new Map(world.map.provinces.map((province) => [province.id, province]));
  const presentIn = new Map<string, typeof armed>();
  for (const force of armed) presentIn.set(force.locationId, [...(presentIn.get(force.locationId) ?? []), force]);
  const name = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;

  // Where each army's patrols reach. Country two hostile armies both reach is
  // contested and held by neither: without this, two armies a few districts
  // apart took the same ground back from each other every month.
  const reachOf = new Map<string, ReadonlySet<string>>();
  const patrolled = new Map<string, Set<string>>();
  for (const force of armed) {
    const reach = new Set(fitStrengthOf(force) >= PATROL_MEN ? kmFromAny(world, [force.locationId], { budgetKm: FORAGE_KM }).keys() : [force.locationId]);
    reachOf.set(force.id, reach);
    for (const provinceId of reach) patrolled.set(provinceId, (patrolled.get(provinceId) ?? new Set()).add(force.polityId));
  }

  // Each army at war standing on enemy ground, and the country it holds.
  const takenBy_ = new Map<string, (typeof armed)[number]>();
  for (const force of armed) {
    const here = provinceById.get(force.locationId);
    if (here?.controllerPolityId == null || !atWar(world.polityAgreements, force.polityId, here.controllerPolityId)) continue;
    for (const provinceId of reachOf.get(force.id)!) {
      const contested = provinceId !== force.locationId
        && [...(patrolled.get(provinceId) ?? [])].some((other) => other !== force.polityId && atWar(world.polityAgreements, force.polityId, other));
      if (contested) continue;
      const province = provinceById.get(provinceId);
      const holder = province?.controllerPolityId ?? null;
      if (province === undefined || holder === null || !atWar(world.polityAgreements, force.polityId, holder)) continue;
      if (province.settlements.some((settlement) => settlement.fortificationLevel >= SIEGE_NEEDED_AT)) continue;
      // Defended: an army of the holder's side stands in it.
      if ((presentIn.get(provinceId) ?? []).some((other) => other.polityId === holder || !atWar(world.polityAgreements, force.polityId, other.polityId) && other.polityId !== force.polityId)) continue;
      const rival = takenBy_.get(provinceId);
      if (rival === undefined || fitStrengthOf(force) > fitStrengthOf(rival)) takenBy_.set(provinceId, force);
    }
  }
  if (takenBy_.size === 0) return { world, facts };

  const held = new Map<string, { force: (typeof armed)[number]; names: string[]; from: Set<string> }>();
  const provinces = world.map.provinces.map((province) => {
    const taker = takenBy_.get(province.id);
    if (taker === undefined) return province;
    const holder = province.controllerPolityId!;
    const entry = held.get(taker.id) ?? { force: taker, names: [], from: new Set<string>() };
    entry.names.push(province.name);
    entry.from.add(holder);
    held.set(taker.id, entry);
    return {
      ...province,
      ...takenBy(province, taker.polityId, world.polityAgreements),
      settlements: province.settlements.map((settlement) => (settlement.controllerPolityId === holder || settlement.controllerPolityId === null ? { ...settlement, controllerPolityId: taker.polityId } : settlement)),
      controlFirmnessBps: Math.min(province.controlFirmnessBps, 2_000),
      lostBy: { polityId: holder, atStep: toDay },
    };
  });
  // One line an army, however much country it took.
  for (const { force, names, from } of held.values()) {
    const where = names.length === 1 ? names[0]! : `${names.length} districts, ${names.slice(0, 2).join(" and ")} among them`;
    facts.push({
      localId: `occupied_${force.id}_${toDay}`.slice(0, 60),
      kind: "province_occupied",
      summary: `${force.name}${force.name.includes(name(force.polityId)) ? "" : ` of ${name(force.polityId)}`} occupied ${where}, ground of ${[...from].map(name).join(" and ")}.`.slice(0, 400),
      affectedRefs: [{ kind: "polity" as const, id: force.polityId }, ...[...from].map((id) => ({ kind: "polity" as const, id })), { kind: "force" as const, id: force.id }].slice(0, 16),
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      significance: Math.min(60, 25 + 3 * names.length),
    });
  }
  return { world: { ...world, map: { ...world.map, provinces } }, facts };
}
