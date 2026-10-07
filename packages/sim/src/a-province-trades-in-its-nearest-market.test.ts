import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  INLAND_HUB_SETTLED_SIZE,
  PORT_HUB_SETTLED_SIZE,
  WorldStateSchema,
  adjacentTo,
  ensureProvinceMaterial,
  hubOf,
  kmFrom,
  marketGeography,
  type WorldState,
} from "@chronica/shared";

/**
 * A province trades in its nearest market (phase C of the economy rework).
 *
 * Markets are not stored per province: some seventy hubs (a harbour of size, or
 * a large town) hold the stocks, and every other province belongs to the hub
 * nearest it by the map's own distance. These pin the rule, not the figures:
 * how many hubs there are, that nobody is left out, that the same map always
 * gives the same answer, and that a province's hub really is the nearest one.
 */

const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);

describe("a province trades in its nearest market", () => {
  const world = opening();
  const geography = marketGeography(world);

  it("has between forty and eighty hubs on the Punic map", () => {
    expect(geography.hubs.length).toBeGreaterThanOrEqual(40);
    expect(geography.hubs.length).toBeLessThanOrEqual(80);
  });

  it("chooses harbours of size and large towns", () => {
    const provinces = new Map(world.map.provinces.map((province) => [province.id, province]));
    let rule = 0;
    for (const hub of geography.hubs) {
      const province = provinces.get(hub)!;
      const size = province.settlements.reduce((total, settlement) => total + settlement.size, 0);
      const harbour = province.settlements.some((settlement) => settlement.kind === "port");
      if ((harbour && size >= PORT_HUB_SETTLED_SIZE) || size >= INLAND_HUB_SETTLED_SIZE) rule += 1;
    }
    // Nearly all by the rule; the few that are not are a stretch of country the rest cannot reach, given its biggest town.
    expect(rule).toBeGreaterThanOrEqual(geography.hubs.length - 8);
    // Rome, Carthage and Syracuse each have a market of their own to trade in.
    for (const id of [PUNIC_IDS.rome, PUNIC_IDS.carthage, PUNIC_IDS.syracuse]) expect(geography.hubs).toContain(geography.hubOf.get(id));
  });

  it("puts every province in some market, and a hub in its own", () => {
    expect(geography.hubOf.size).toBe(world.map.provinces.length);
    for (const province of world.map.provinces) expect(geography.hubs).toContain(geography.hubOf.get(province.id));
    for (const hub of geography.hubs) expect(geography.hubOf.get(hub)).toBe(hub);
    // The countries between them are all of the map, once each.
    const counted = [...geography.country.values()].reduce((total, ids) => total + ids.length, 0);
    expect(counted).toBe(world.map.provinces.length);
  });

  it("gives the same markets to the same map on every run, and whoever holds a province", () => {
    const again = marketGeography(opening());
    expect(again.hubs).toEqual(geography.hubs);
    expect([...again.hubOf.entries()]).toEqual([...geography.hubOf.entries()]);
    // Geography does not change when a province changes hands.
    const conquered: WorldState = { ...world, map: { ...world.map, provinces: world.map.provinces.map((province) => (province.id === PUNIC_IDS.rome ? { ...province, controllerPolityId: "carthage" } : province)) } };
    expect(marketGeography(conquered).hubOf.get(PUNIC_IDS.capua)).toBe(geography.hubOf.get(PUNIC_IDS.capua));
    expect(hubOf(conquered, PUNIC_IDS.capua)).toBe(geography.hubOf.get(PUNIC_IDS.capua));
  });

  it("is the nearest hub by the map's own distance, ties to the lower id", () => {
    // Sample every fortieth province: its hub is no further than any other hub.
    const ids = world.map.provinces.map((province) => province.id).sort();
    for (let index = 0; index < ids.length; index += 40) {
      const id = ids[index]!;
      const from = kmFrom(world, id);
      const own = geography.hubOf.get(id)!;
      const ownKm = from.get(own);
      if (ownKm === undefined) continue;
      for (const hub of geography.hubs) {
        const km = from.get(hub);
        if (km === undefined) continue;
        expect(ownKm).toBeLessThanOrEqual(km);
        if (km === ownKm) expect(own.localeCompare(hub)).toBeLessThanOrEqual(0);
      }
    }
  });

  it("knows which hubs touch, and by how far: the graph trade will run over", () => {
    for (const hub of geography.hubs) {
      for (const near of geography.neighbours.get(hub) ?? []) {
        expect(geography.hubs).toContain(near.hubId);
        expect(near.km).toBeGreaterThan(0);
        // Symmetrical: if one hub touches another the other touches it, by the same road.
        expect((geography.neighbours.get(near.hubId) ?? []).find((back) => back.hubId === hub)?.km).toBe(near.km);
      }
    }
    // Neighbouring provinces of different countries are the reason: some hub has one.
    const edges = world.map.edges.filter((edge) => geography.hubOf.get(edge.from) !== geography.hubOf.get(edge.to));
    expect(edges.length).toBeGreaterThan(0);
    expect(adjacentTo(world, PUNIC_IDS.rome).length).toBeGreaterThan(0);
  });
});
