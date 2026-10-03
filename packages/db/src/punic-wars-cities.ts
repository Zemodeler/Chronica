import { reconcileCapitals, type Settlement, type WorldState } from "@chronica/shared";
import { PUNIC_WARS_GRAPH_POLITIES, PUNIC_WARS_GRAPH_SETTLEMENTS } from "./punic-wars-map-graph";
import research from "../../../scripts/map-gen/city-research.json";

const newlyDesignated = new Set(research.newlyDesignatedPolities);

/** Carry the additive catalogue into older saves without resetting conquest.
 * New cities follow the current holder of their province, not its 270 BCE owner.
 * The marker is persisted so adding the catalogue does not reset capital succession.
 */
function carryOriginalCatalogue(world: WorldState): WorldState {
  if (world.pins.scenarioId !== "00000000-0000-4000-8000-000000000102" || (world.map.settlementCatalogueVersion ?? 0) >= 38) {
    return reconcileCapitals(world);
  }
  const existing = new Set(world.map.provinces.flatMap((province) => province.settlements.map((city) => city.id)));
  const declared = new Set(world.map.polities.map((polity) => polity.id));
  const additions = new Map<string, Settlement[]>();
  const provincesById = new Map(world.map.provinces.map((province) => [province.id, province]));
  for (const city of PUNIC_WARS_GRAPH_SETTLEMENTS) {
    const province = provincesById.get(city.provinceId);
    if (existing.has(city.id) || province === undefined || !declared.has(city.controllerPolityId)) continue;
    // Rhegium's garrison holds a city inside Bruttian countryside.
    const controller = city.controllerPolityId === "rhegium-campanians"
      ? province.settlements.find((settlement) => settlement.id === "settlement-rhegium")?.controllerPolityId ?? province.controllerPolityId
      : province.controllerPolityId;
    const added: Settlement = { ...city, kind: city.kind as Settlement["kind"], controllerPolityId: controller };
    additions.set(province.id, [...(additions.get(province.id) ?? []), added]);
  }
  const provinces = world.map.provinces.map((province) => additions.has(province.id)
    ? { ...province, settlements: [...province.settlements, ...additions.get(province.id)!] } : province);
  const holders = new Map(provinces.flatMap((province) => province.settlements.map((city) => [city.id, city.controllerPolityId] as const)));
  const seats = new Map(PUNIC_WARS_GRAPH_POLITIES.map((polity) => [polity.polityId, polity.capitalSettlementId]));
  const polities = world.map.polities.map((polity) => {
    const seat = seats.get(polity.id);
    if (polity.capitalSettlementId !== null || polity.endedAtStep != null || !newlyDesignated.has(polity.id) || seat == null || holders.get(seat) !== polity.id) return polity;
    return { ...polity, capitalSettlementId: seat };
  });
  return reconcileCapitals({ ...world, map: { ...world.map, provinces, polities, settlementCatalogueVersion: 38 } });
}

/** Rename only the old generated labels; preserve custom names and all campaign state. */
export function carryPunicWarsCities(world: WorldState): WorldState {
  const carried = carryOriginalCatalogue(world);
  if (carried.pins.scenarioId !== "00000000-0000-4000-8000-000000000102" || (carried.map.settlementCatalogueVersion ?? 0) >= 40) return carried;
  const replacements = new Map(research.settlements.map((site) => [site.id, site.name]));
  const names = new Map(PUNIC_WARS_GRAPH_POLITIES.map((polity) => [polity.polityId, polity.name]));
  const provinces = carried.map.provinces.map((province) => {
    let changed = false;
    const settlements = province.settlements.map((city) => {
      const replacement = replacements.get(city.id);
      const role = city.id.endsWith("-assembly") ? "assembly" : city.id.endsWith("-market") ? "market" : null;
      if (replacement === undefined || role === null) return city;
      // Parse the original polity from the stable ID: conquest may have changed control.
      const polityId = city.id.slice("settlement-".length, -(role.length + 1));
      if (city.name !== `${names.get(polityId)} ${role} town`) return city;
      changed = true;
      return { ...city, name: replacement };
    });
    return changed ? { ...province, settlements } : province;
  });
  return { ...carried, map: { ...carried.map, provinces, settlementCatalogueVersion: 40 } };
}
