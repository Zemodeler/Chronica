import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  GOODS,
  ScenarioDefinitionSchema,
  WorldStateSchema,
  ensureMarkets,
  ensureProvinceMaterial,
  hubFlows,
  marketGeography,
  marketPriceBps,
  nearestHubOf,
  sackTheMarket,
  sellCaptives,
  slaveWorkDemand,
  stockIn,
  type Force,
  type WorldState,
} from "@chronica/shared";
import { resolveEngagement } from "./battle";
import { reviewTheLand } from "./economy";

/**
 * The slave market floats on war and on the country's wealth (v58).
 *
 * The slave sat at its price limit in thirty of seventy-four hubs: a frontier trickle that was five times what a province could use in
 * poor country and nothing in rich, against a demand so small that no hub's supply and demand ever met. Now a country supplies some of
 * its own (the households' own, the debtors sold), the frontier's trickle is no more than the country can take, and what a war brings
 * (the beaten side's prisoners, a stormed city's poor, a sack's captives) goes on the winner's nearest market, where the dealers are.
 * Demand follows wealth and what the mines, the great estates and the state's works absorb, and thins where war has emptied a place.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = (): WorldState => ensureMarkets(ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0));
const SLAVES = GOODS.findIndex((good) => good.id === "slaves");
const ROME = PUNIC_IDS.rome;

describe("captives fill the slave market", () => {
  it("puts a sack's captives on the taker's nearest market, not the sacked town's", () => {
    const world = opening();
    const place = world.map.provinces.find((province) => province.controllerPolityId === "carthage" && province.id.startsWith("sic-"))!;
    const hubOfPlace = marketGeography(world).hubOf.get(place.id)!;
    const takerHub = nearestHubOf(world, "rome", place.id);
    expect(takerHub).not.toBeNull();
    expect(world.map.provinces.find((province) => province.id === takerHub)!.controllerPolityId).toBe("rome");
    const before = { taker: stockIn(world, takerHub!, "slaves"), sacked: stockIn(world, hubOfPlace, "slaves") };
    const sacked = sackTheMarket(world, place.id, 20_000, 1, "rome");
    expect(stockIn(sacked, takerHub!, "slaves")).toBeGreaterThan(before.taker);
    // The sacked market's buyers are ruined and its dealers fled: it gains none.
    expect(stockIn(sacked, hubOfPlace, "slaves")).toBeLessThanOrEqual(before.sacked);
    expect(marketPriceBps(sacked, takerHub!, "slaves")).toBeLessThan(marketPriceBps(world, takerHub!, "slaves"));
  });

  it("sells a winner's prisoners in proportion to what the beaten side lost, and only at the winner's markets", () => {
    const world = opening();
    const fromAnywhere = sellCaptives(world, "rome", PUNIC_IDS.messana, 3_000);
    expect(fromAnywhere.hubId).not.toBeNull();
    expect(fromAnywhere.heads).toBeGreaterThan(0);
    const small = sellCaptives(world, "rome", PUNIC_IDS.messana, 100);
    expect(small.heads).toBeLessThan(fromAnywhere.heads);
    // A power with no hub to bring them to sells none.
    expect(sellCaptives(world, "no-such-power", PUNIC_IDS.messana, 3_000).heads).toBe(0);
  });

  it("fills the winner's market from a battle (the same seeds, the same heads)", () => {
    const base = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
    const start = ensureMarkets(ensureProvinceMaterial({
      ...base,
      material: { ...base.material, forces: base.material.forces.map((force) => (force.id === "syracusan-army" ? { ...force, locationId: PUNIC_IDS.messana } : force)) },
    }, 0));
    const force = (id: string): Force => start.material.forces.find((candidate) => candidate.id === id)!;
    const heldBy = (world: WorldState, polityId: string): number => marketGeography(world).hubs
      .filter((hub) => world.map.provinces.find((province) => province.id === hub)!.controllerPolityId === polityId)
      .reduce((sum, hub) => sum + stockIn(world, hub, "slaves"), 0);
    let found = false;
    for (const seed of ["a", "b", "c", "d", "e", "f"]) {
      const result = resolveEngagement({ world: start, attacker: force("syracusan-army"), defender: force("mamertine-garrison"), posture: "offer_battle", tactic: null, warfare: definition.warfare, battleId: `battle-${seed}`, seed }, 0);
      const winner = result.world.material.forces.find((candidate) => candidate.id === "syracusan-army")!.polityId;
      const after = heldBy(result.world, winner);
      if (after > heldBy(start, winner)) found = true;
      const again = resolveEngagement({ world: start, attacker: force("syracusan-army"), defender: force("mamertine-garrison"), posture: "offer_battle", tactic: null, warfare: definition.warfare, battleId: `battle-${seed}`, seed }, 0);
      expect(heldBy(again.world, winner)).toBe(after);
    }
    expect(found).toBe(true);
  });

  it("matches supply to demand in every hub of the opening within a band the market can float in", () => {
    const flows = hubFlows(opening());
    const ratios = [...flows.values()].map((flow) => flow.supply[SLAVES]! / Math.max(1e-9, flow.demand[SLAVES]!));
    // A price floats where supply and demand are within about 0.45 and 1.5 of each other (the response ranges of the market).
    for (const ratio of ratios) {
      expect(ratio).toBeGreaterThan(0.45);
      expect(ratio).toBeLessThan(1.5);
    }
  });

  it("holds no hub at a price bound over a year of peace, bar a handful", () => {
    let world = opening();
    world = reviewTheLand({ world, toDay: 0 }).world;
    for (let month = 1; month <= 12; month += 1) world = reviewTheLand({ world, toDay: month * 30 }).world;
    const hubs = marketGeography(world).hubs;
    const spec = GOODS[SLAVES]!;
    const atBound = hubs.filter((hub) => {
      const price = marketPriceBps(world, hub, "slaves");
      return price <= spec.floorBps + 5 || price >= spec.ceilingBps - 5;
    });
    expect(hubs.length).toBeGreaterThan(50);
    expect(atBound.length).toBeLessThan(5);
  });

  it("asks more of a province with great estates and works in it, and less of one a war has emptied", () => {
    const world = opening();
    const plain = hubFlows(world).get(marketGeography(world).hubOf.get(ROME)!)!.demand[SLAVES]!;
    const estate = world.material.holdings[0]!;
    const province = estate.territoryId ?? ROME;
    const big: WorldState = {
      ...world,
      material: { ...world.material, holdings: [...world.material.holdings, ...Array.from({ length: 40 }, (_, index) => ({ ...estate, id: `extra-${index}`, territoryId: province }))] },
    };
    expect(slaveWorkDemand(big).get(province)!).toBeGreaterThan(slaveWorkDemand(world).get(province) ?? 0);
    const hub = marketGeography(world).hubOf.get(province)!;
    expect(hubFlows(big).get(hub)!.demand[SLAVES]!).toBeGreaterThan(hubFlows(world).get(hub)!.demand[SLAVES]!);
    // And the same province after a war has laid it waste has fewer buyers.
    const wasted: WorldState = { ...world, material: { ...world.material, provinceMaterial: world.material.provinceMaterial.map((row) => (row.provinceId === province ? { ...row, warDamageBps: 8_000 } : row)) } };
    expect(hubFlows(wasted).get(hub)!.demand[SLAVES]!).toBeLessThan(hubFlows(world).get(hub)!.demand[SLAVES]!);
    expect(plain).toBeGreaterThan(0);
  });
});
