import { boundedId } from "../determinism";
import { atWar } from "./agreements";
import type { WorldState } from "./world-state";

/** Choose a surviving seat, remembering the exact war in which the old one fell.
 * City control wins over countryside control: a capital's walls can hold out.
 */
export function reconcileCapitals(world: WorldState): WorldState {
  const cities = world.map.provinces.flatMap((province) => province.settlements);
  const byId = new Map(cities.map((city) => [city.id, city]));
  const wars = world.polityAgreements.filter((agreement) => agreement.kind === "war" && agreement.status === "active");
  const activeWarIds = new Set(wars.map((war) => war.id));
  const otherAgreements = world.polityAgreements.filter((agreement) => agreement.kind !== "war");
  let provinces = world.map.provinces;
  let changed = false;
  const polities = world.map.polities.map((polity) => {
    if (polity.endedAtStep != null) {
      if (polity.capitalSettlementId === null && polity.displacedCapital == null) return polity;
      changed = true;
      return { ...polity, capitalSettlementId: null, displacedCapital: null };
    }
    let capital = polity.capitalSettlementId;
    let displaced = polity.displacedCapital;
    let former = polity.formerCapitalSettlementIds;
    if (capital !== null && byId.get(capital)?.controllerPolityId !== polity.id) {
      if (!former?.includes(capital)) former = [...(former ?? []), capital];
      const captor = byId.get(capital)?.controllerPolityId ?? null;
      if (!displaced?.warIds.some((id) => activeWarIds.has(id))) {
        displaced = {
          settlementId: capital,
          warIds: wars.filter((war) => {
            const agreements = [...otherAgreements, war];
            return captor === null
              ? atWar(agreements, polity.id, war.polityId) || atWar(agreements, polity.id, war.otherPolityId)
              : atWar(agreements, polity.id, captor);
          }).map((war) => war.id),
        };
      }
      capital = null;
    }
    if (displaced && byId.get(displaced.settlementId)?.controllerPolityId === polity.id
      && displaced.warIds.some((id) => activeWarIds.has(id))) {
      capital = displaced.settlementId;
      if (former?.includes(capital)) former = former.filter((id) => id !== capital);
      displaced = null;
    }
    if (capital === null) {
      const remaining = cities.filter((city) => city.controllerPolityId === polity.id && city.id !== displaced?.settlementId && !former?.includes(city.id))
        .sort((a, b) => b.size - a.size || b.fortificationLevel - a.fortificationLevel || a.id.localeCompare(b.id));
      capital = remaining[0]?.id ?? null;
      // A power holding countryside after losing every city still needs a seat.
      if (capital === null) {
        const home = provinces.filter((province) => province.controllerPolityId === polity.id)
          .sort((a, b) => b.controlFirmnessBps - a.controlFirmnessBps || (b.areaKm2 ?? 0) - (a.areaKm2 ?? 0) || a.id.localeCompare(b.id))[0];
        if (home) {
          capital = boundedId("capital-seat", polity.id, home.id);
          let suffix = 0;
          while (byId.has(capital)) capital = boundedId("capital-seat", polity.id, home.id, ++suffix);
          const seat = { id: capital, name: `Seat at ${home.name}`.slice(0, 120), kind: "town" as const, provinceId: home.id, controllerPolityId: polity.id, size: 6, fortificationLevel: 0 };
          provinces = provinces.map((province) => province.id === home.id ? { ...province, settlements: [...province.settlements, seat] } : province);
          byId.set(capital, seat);
          cities.push(seat);
        }
      }
    }
    if (capital === polity.capitalSettlementId && displaced === polity.displacedCapital && former === polity.formerCapitalSettlementIds) return polity;
    changed = true;
    return { ...polity, capitalSettlementId: capital, ...(displaced === undefined ? {} : { displacedCapital: displaced }), ...(former === undefined ? {} : { formerCapitalSettlementIds: former }) };
  });
  return changed ? { ...world, map: { ...world.map, provinces, polities } } : world;
}
