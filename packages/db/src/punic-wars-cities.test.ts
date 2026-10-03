import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "./punic-wars-scenario";
import { carryPunicWarsCities } from "./punic-wars-cities";
import research from "../../../scripts/map-gen/city-research.json";
import provenance from "../../../scripts/map-gen/city-provenance.json";

describe("cities and capitals", () => {
  it("uses sourced place names for every former generic town", () => {
    const cities = punicWarsScenario.initialWorld.map.provinces.flatMap((province) => province.settlements);
    expect(cities.some((city) => /assembly town|market town/i.test(city.name))).toBe(false);
    const named = research.settlements.filter((site) => /-(assembly|market)$/.test(site.id));
    expect(named).toHaveLength(168);
    for (const site of named) {
      expect(cities.find((city) => city.id === site.id)?.name, site.id).toBe(site.name);
      expect(site.source, site.id).toMatch(/^https:\/\//);
      const record = provenance.additions.find((city) => city.settlementId === site.id)!;
      expect(record.chronologyNote, site.id).toBeTruthy();
      expect(record.nameEvidence, site.id).toMatch(/ancient-name|archaeological-site-name/);
    }
  });

  it("renames old labels after conquest without resetting custom names or capital history", () => {
    const old = structuredClone(punicWarsScenario.initialWorld);
    old.map.settlementCatalogueVersion = 38;
    const primary = "settlement-gaul-aedui-assembly";
    const secondary = "settlement-gaul-aedui-market";
    const polity = old.map.polities.find((polity) => polity.id === "gaul-aedui")!;
    polity.capitalSettlementId = secondary;
    polity.displacedCapital = { settlementId: primary, warIds: [] };
    polity.formerCapitalSettlementIds = [primary];
    old.map.provinces = old.map.provinces.map((province) => ({ ...province, settlements: province.settlements.map((city) =>
      city.id === primary ? { ...city, name: `${polity.name} assembly town`, controllerPolityId: "rome", size: 11 }
        : city.id === secondary ? { ...city, name: "Player's chosen name" } : city) }));
    const carried = carryPunicWarsCities(old);
    const city = carried.map.provinces.flatMap((province) => province.settlements).find((city) => city.id === primary)!;
    expect(city).toEqual({ ...old.map.provinces.flatMap((province) => province.settlements).find((city) => city.id === primary)!, name: "Cabilonnum" });
    expect(carried.map.provinces.flatMap((province) => province.settlements).find((city) => city.id === secondary)?.name).toBe("Player's chosen name");
    expect(carried.map.polities.find((candidate) => candidate.id === polity.id)).toEqual(polity);
    expect(carried.map.settlementCatalogueVersion).toBe(40);
    expect(carryPunicWarsCities(carried)).toBe(carried);
  });

  it("gives every opening polity a unique capital it actually holds", () => {
    const { polities, provinces } = punicWarsScenario.initialWorld.map;
    const cities = provinces.flatMap((province) => province.settlements);
    const capitals = new Set<string>();
    for (const polity of polities) {
      expect(polity.capitalSettlementId, polity.id).not.toBeNull();
      const seat = cities.find((city) => city.id === polity.capitalSettlementId);
      expect(seat?.controllerPolityId, polity.id).toBe(polity.id);
      expect(capitals.has(seat!.id), polity.id).toBe(false);
      capitals.add(seat!.id);
    }
    expect(cities.length).toBeGreaterThan(253);
  });

  it("carries new cities into an old save under current control, only once", () => {
    const old = structuredClone(punicWarsScenario.initialWorld);
    const additions = new Set(provenance.additions.map((city) => city.settlementId));
    delete old.map.settlementCatalogueVersion;
    old.pins.scenarioVersion = 37;
    old.map.provinces = old.map.provinces.map((province) => ({ ...province, settlements: province.settlements.filter((city) => !additions.has(city.id)) }));
    old.map.polities = old.map.polities.map((polity) => research.newlyDesignatedPolities.includes(polity.id) ? { ...polity, capitalSettlementId: null } : polity);
    const ambracia = punicWarsScenario.initialWorld.map.provinces.find((province) => province.settlements.some((city) => city.id === "settlement-ambracia"))!;
    old.map.provinces = old.map.provinces.map((province) => province.id === ambracia.id ? { ...province, controllerPolityId: "rome" } : province);
    const carried = carryPunicWarsCities(old);
    const seat = carried.map.provinces.flatMap((province) => province.settlements).find((city) => city.id === "settlement-ambracia")!;
    expect(seat.controllerPolityId).toBe("rome");
    expect(carried.map.polities.find((polity) => polity.id === "epirus")!.capitalSettlementId).toBe("settlement-dodona");
    expect(carried.map.polities.find((polity) => polity.id === "samnites")!.capitalSettlementId).toBe("settlement-bovianum");
    expect(carryPunicWarsCities(carried)).toBe(carried);
    expect(carried.pins.scenarioVersion).toBe(37);
  });

  it("keeps its replacement on recapture outside the war in which the seat fell", () => {
    const old = structuredClone(punicWarsScenario.initialWorld);
    old.map.provinces = old.map.provinces.map((province) => ({ ...province, settlements: province.settlements.map((city) => city.id === "settlement-messana" ? { ...city, controllerPolityId: "rome" } : city) }));
    const captured = carryPunicWarsCities(old);
    const replacement = captured.map.polities.find((polity) => polity.id === "mamertines")!.capitalSettlementId;
    expect(replacement).not.toBe("settlement-messana");
    const retaken = { ...captured, map: { ...captured.map, provinces: captured.map.provinces.map((province) => ({ ...province, settlements: province.settlements.map((city) => city.id === "settlement-messana" ? { ...city, controllerPolityId: "mamertines" } : city) })) } };
    expect(carryPunicWarsCities(retaken).map.polities.find((polity) => polity.id === "mamertines")!.capitalSettlementId).toBe(replacement);
  });
});
