import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  EMPTY_ECONOMY_MEMORY,
  ScenarioDefinitionSchema,
  WorldDeltaSchema,
  WorldStateSchema,
  collectionEfficiency,
  ensureMarkets,
  marketGeography,
  ensureProvinceMaterial,
  polityTaxReadings,
  stepsFromCapital,
  taxBurdens,
  type ProvinceMaterial,
  type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";

/**
 * "The Sicilian grain-lands will pay a tithe of the harvest, as they did to
 * Hiero. Latium will pay the levy. The allies owe us men, not silver. And I
 * want the harbours taxed, not the hills."
 *
 * A power taxed every province of its own the same way, in one lump set
 * against what all of them together could bear, and a province two hundred
 * miles from the capital paid as readily as the one under its walls. Each
 * province now has a policy -- a regime and a rate, its own or its power's --
 * and what it yields follows the regime: a tithe swings with the harvest, a
 * land levy does not, customs follow the harbour and the town, and a tribute
 * of men is no money at all. What reaches the treasury is less the farther it
 * came, and less where the tax office is poor.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const LATIUM = PUNIC_IDS.rome;
const SYRACUSE_PROVINCE = PUNIC_IDS.syracuse;
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const withRow = (world: WorldState, id: string, patch: Partial<ProvinceMaterial>): WorldState => ({
  ...world,
  material: { ...world.material, provinceMaterial: world.material.provinceMaterial.map((row) => (row.provinceId === id ? { ...row, ...patch } : row)) },
});
const rowOf = (world: WorldState, id: string): ProvinceMaterial => world.material.provinceMaterial.find((row) => row.provinceId === id)!;
const reading = (world: WorldState, polityId: string, provinceId: string) => polityTaxReadings(world, polityId).find((entry) => entry.provinceId === provinceId)!;
const as = (characterId: string): ApplyContext => ({
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: characterId },
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory(`policy-${characterId}`),
  gameId: "game-1",
});
const apply = (world: WorldState, deltas: readonly unknown[], context: ApplyContext) => applyDeltas(world, deltas.map((delta) => WorldDeltaSchema.parse(delta)), context);

describe("a tax regime is chosen", () => {
  it("takes a tithe that swings with the harvest, and a levy that does not", () => {
    const base = opening();
    const at = (regime: "tithe" | "land_levy", food: number) => reading(withRow(base, LATIUM, { taxRegime: regime, taxRateBps: 1_000, foodSecurityBps: food }), "rome", LATIUM).monthly;
    const fair = at("tithe", 8_000);
    // A drought year takes the tithe to about a third; a glut raises it by a quarter; the levy is the same in all three.
    expect(at("tithe", 3_000)).toBeLessThan(fair * 0.45);
    expect(at("tithe", 10_000)).toBeGreaterThan(fair * 1.2);
    expect(at("land_levy", 3_000)).toBeCloseTo(at("land_levy", 10_000), 6);
    // At the ordinary harvest the two come to the same, and to what the old uniform levy took.
    expect(fair).toBeCloseTo(at("land_levy", 8_000), 6);
    expect(fair).toBeCloseTo(reading(base, "rome", LATIUM).monthly, 6);
  });

  it("takes customs from a hub in proportion to the trade that crosses it, and next to nothing from a valley without any", () => {
    // Phase D: customs are read off what the hub's market really trades (its last month's flows), not off its harbour and its size.
    const quiet = ensureMarkets(opening());
    const syracuse = quiet.map.provinces.find((province) => province.id === SYRACUSE_PROVINCE)!;
    expect(syracuse.settlements.some((settlement) => settlement.kind === "port")).toBe(true);
    const hubOfSyracuse = marketGeography(quiet).hubOf.get(SYRACUSE_PROVINCE)!;
    expect(hubOfSyracuse).toBe(SYRACUSE_PROVINCE);
    // The same hub with as much crossing it in a month as its country uses.
    const busy: WorldState = {
      ...quiet,
      economy: {
        ...quiet.economy!,
        markets: quiet.economy!.markets.map((hub) => (hub.hubId !== hubOfSyracuse ? hub : { ...hub, goods: hub.goods.map((good) => ({ ...good, inflow: Math.round(good.demand / 2), outflow: Math.round(good.demand / 2) })) })),
      },
    };
    const valley = quiet.map.provinces.find((province) => province.controllerPolityId === "syracuse" && province.settlements.length === 0)!;
    const yields = (world: WorldState, id: string, regime: "land_levy" | "customs"): number => reading(withRow(world, id, { taxRegime: regime, taxRateBps: 1_000 }), "syracuse", id).monthly;
    // Where nothing crosses it a harbour bears only its quays and stalls; where goods pass it bears more than the land does.
    expect(yields(quiet, SYRACUSE_PROVINCE, "customs")).toBeLessThan(yields(quiet, SYRACUSE_PROVINCE, "land_levy") * 0.25);
    expect(yields(busy, SYRACUSE_PROVINCE, "customs")).toBeGreaterThan(yields(busy, SYRACUSE_PROVINCE, "land_levy") * 1.2);
    expect(yields(busy, valley.id, "customs")).toBeLessThan(yields(busy, valley.id, "land_levy") * 0.5);
  });

  it("asks men of an ally and no money: a tribute of manpower", () => {
    const base = opening();
    const before = taxBurdens(base).get("rome")!;
    const tribute = withRow(base, LATIUM, { taxRegime: "men", taxRateBps: 1_000 });
    const entry = reading(tribute, "rome", LATIUM);
    expect(entry.monthly).toBe(0);
    expect(entry.menPerYear).toBeGreaterThan(1_000);
    const after = taxBurdens(tribute).get("rome")!;
    expect(after.menPerYear).toBe(entry.menPerYear);
    // Its money is gone from what Rome's lands bear, and shows in no regime but this.
    expect(after.bearable).toBeLessThan(before.bearable);
    expect(after.bearableByRegime?.men ?? 0).toBe(0);
    // And a province that pays in men resents it more than one that pays a tithe, at the same rate.
    expect(after.provinceStabilityShiftBps?.get(LATIUM)).toBeLessThan(taxBurdens(withRow(base, LATIUM, { taxRegime: "tithe", taxRateBps: 1_000 })).get("rome")!.provinceStabilityShiftBps!.get(LATIUM)!);
  });

  it("loses what is far from the capital, and less where the tax office is good", () => {
    const world = opening();
    const steps = stepsFromCapital(world, "seleucid-empire")!;
    const readings = polityTaxReadings(world, "seleucid-empire");
    const far = readings.reduce((worst, entry) => ((steps.get(entry.provinceId) ?? 0) > (steps.get(worst.provinceId) ?? 0) ? entry : worst));
    const near = readings.find((entry) => steps.get(entry.provinceId) === 0)!;
    expect(steps.get(far.provinceId)!).toBeGreaterThan(20);
    expect(near.efficiency).toBe(1);
    expect(far.efficiency).toBeLessThan(0.95);
    expect(far.efficiency).toBeGreaterThanOrEqual(0.5);
    // By the table: a tithe is gathered where it grows and leaks least, a levy most, customs at the harbour; the middling office is the ordinary rate.
    expect(collectionEfficiency(40, "tithe", 50)).toBeGreaterThan(collectionEfficiency(40, "land_levy", 50));
    expect(collectionEfficiency(40, "customs", 50)).toBeGreaterThan(collectionEfficiency(40, "land_levy", 50));
    expect(collectionEfficiency(40, "land_levy", 90)).toBeGreaterThan(collectionEfficiency(40, "land_levy", 50));
    expect(collectionEfficiency(40, "land_levy", 10)).toBeLessThan(collectionEfficiency(40, "land_levy", 50));
    expect(collectionEfficiency(40, "men", 10)).toBe(1);
    // Never below half, however far it is.
    expect(collectionEfficiency(10_000, "land_levy", 0)).toBe(0.5);
    // And the whole of it counts: the same power's bearable falls with the leak, against a capital with the same ground and none.
    const reach = taxBurdens(world, { officeSkill: () => 90 }).get("seleucid-empire");
    const poor = taxBurdens(world, { officeSkill: () => 10 }).get("seleucid-empire");
    if (reach !== undefined && poor !== undefined) expect(reach.bearable).toBeGreaterThan(poor.bearable);
  });

  it("is a lever: a heavier rate brings in more, and costs order where it is chosen", () => {
    const base = opening();
    const withPolicy = (rateBps: number): WorldState => ({ ...base, economy: { ...EMPTY_ECONOMY_MEMORY, taxPolicies: [{ polityId: "rome", regime: "land_levy", rateBps }] } });
    const ordinary = taxBurdens(withPolicy(1_000)).get("rome")!;
    const heavy = taxBurdens(withPolicy(2_000)).get("rome")!;
    expect(heavy.rateScale).toBeCloseTo(2, 3);
    expect(heavy.bearable).toBeGreaterThan(ordinary.bearable * 1.9);
    expect(heavy.asked).toBeGreaterThan(ordinary.asked);
    // Taxed more heavily by a chosen policy, a province is a sullener place for it, province by province.
    expect(ordinary.provinceStabilityShiftBps!.get(LATIUM)).toBeLessThan(0);
    expect(heavy.provinceStabilityShiftBps!.get(LATIUM)!).toBeLessThan(ordinary.provinceStabilityShiftBps!.get(LATIUM)!);
    expect(taxBurdens(base).get("rome")!.provinceStabilityShiftBps!.size).toBe(0);
    // And the treasury sees it in the month's collection.
    const collected = (world: WorldState): number => runDeterministicTick({ world: { ...world, elapsedStep: 30, instant: { day: 30, minute: 0 } }, toDay: 30, ids: createIdFactory("lever"), warfare: definition.warfare, clock: definition.clock })
      .world.material.transactions.filter((txn) => txn.kind === "tax" && txn.destinationAccountId === "rome-treasury").reduce((sum, txn) => sum + txn.amount, 0);
    expect(collected(withPolicy(2_000))).toBeGreaterThan(collected(withPolicy(1_000)) * 1.5);
  });

  it("is a lever that a ruler holds and a senator does not, for his own power's own ground, within bounds", () => {
    const world = opening();
    const aProvince = { op: "tax_policy_set", scope: "province", polityId: "rome", provinceId: LATIUM, regime: "tithe", rateBps: 800, reason: "Latium pays the tithe." };
    const lawful = apply(world, [aProvince], as("gaius-genucius"));
    expect(lawful.rejected).toEqual([]);
    expect(lawful.breaches).toEqual([]);
    expect(rowOf(lawful.world, LATIUM).taxRegime).toBe("tithe");
    expect(rowOf(lawful.world, LATIUM).taxRateBps).toBe(800);
    // Nobody in Syracuse was told, and nothing else in Rome moved.
    expect(rowOf(lawful.world, SYRACUSE_PROVINCE).taxRegime).toBeUndefined();

    // A rate beyond what the land can bear is brought down to what it can.
    const greedy = apply(world, [{ ...aProvince, rateBps: 9_500 }], as("gaius-genucius"));
    expect(rowOf(greedy.world, LATIUM).taxRateBps).toBe(6_000);

    // The power's own default, for every province without a word of its own.
    const polity = apply(world, [{ op: "tax_policy_set", scope: "polity", polityId: "rome", regime: "land_levy", rateBps: 1_100, reason: "Rome keeps the levy." }], as("gaius-genucius"));
    expect(polity.rejected).toEqual([]);
    expect(polity.world.economy?.taxPolicies).toContainEqual({ polityId: "rome", regime: "land_levy", rateBps: 1_100 });
    // Said again, it replaces what was said, and does not pile up.
    const again = apply(polity.world, [{ op: "tax_policy_set", scope: "polity", polityId: "rome", regime: "tithe", rateBps: 900, reason: "Rome changes its mind." }], as("gaius-genucius"));
    expect(again.world.economy?.taxPolicies.filter((policy) => policy.polityId === "rome")).toEqual([{ polityId: "rome", regime: "tithe", rateBps: 900 }]);

    // A senator with no office over the treasury is not heard: the collectors go on as before.
    const heard = apply(world, [aProvince], as("manius-curius"));
    expect(heard.rejected.map((rejection) => rejection.kind)).toEqual(["ignored"]);
    expect(rowOf(heard.world, LATIUM).taxRegime).toBeUndefined();

    // Only ground the power holds: Syracuse's province is not Rome's to tax, however the order is put.
    const foreign = apply(world, [{ ...aProvince, provinceId: SYRACUSE_PROVINCE }], as("gaius-genucius"));
    expect(foreign.rejected.length).toBeGreaterThan(0);
    expect(rowOf(foreign.world, SYRACUSE_PROVINCE).taxRegime).toBeUndefined();
    // And a province policy must name its province.
    const nameless = apply(world, [{ op: "tax_policy_set", scope: "province", polityId: "rome", regime: "tithe", rateBps: 800, reason: "Somewhere." }], as("gaius-genucius"));
    expect(nameless.rejected.length).toBeGreaterThan(0);
  });

  it("opens Syracuse taxing its grain by a tithe, as the lex Hieronica did, and every other power by the old levy", () => {
    const world = opening();
    expect(world.economy?.taxPolicies).toEqual([{ polityId: "syracuse", regime: "tithe", rateBps: 1_000 }]);
    const syracuse = taxBurdens(world).get("syracuse")!;
    expect(Object.keys(syracuse.bearableByRegime ?? {})).toEqual(["tithe"]);
    expect(Object.keys(taxBurdens(world).get("rome")!.bearableByRegime ?? {})).toEqual(["land_levy"]);
    // So a bad harvest thins the king's revenue where Rome's, on the steady levy, is not touched.
    const drought = (polityId: string): number => {
      const stricken = {
        ...world,
        material: { ...world.material, provinceMaterial: world.material.provinceMaterial.map((row) => (world.map.provinces.find((province) => province.id === row.provinceId)?.controllerPolityId === polityId ? { ...row, foodSecurityBps: 3_000 } : row)) },
      };
      return taxBurdens(stricken).get(polityId)!.bearable / taxBurdens(world).get(polityId)!.bearable;
    };
    expect(drought("syracuse")).toBeLessThan(0.5);
    expect(drought("rome")).toBeCloseTo(1, 6);
  });

  it("weighs what is asked against the one ceiling, whatever the regime, so a tax asked tenfold is not collected tenfold", () => {
    // Every domestic revenue counts against the same bearable (a tax farmer's too: `a-contract-goes-unpaid`).
    const world = opening();
    const before = taxBurdens(world).get("rome")!;
    const farmed = { ...world, material: { ...world.material, incomeSources: world.material.incomeSources.map((source) => (source.kind === "tax" && source.beneficiaryAccountId === "rome-treasury" ? { ...source, amount: source.amount * 10 } : source)) } };
    const after = taxBurdens(farmed).get("rome")!;
    expect(after.asked).toBeGreaterThan(before.asked * 5);
    expect(after.bearable).toBe(before.bearable);
    expect(before.collectedShare).toBe(1);
    expect(after.collectedShare).toBeLessThan(1);
    expect(after.collectedShare).toBeCloseTo(after.bearable / after.asked, 6);
  });
});
