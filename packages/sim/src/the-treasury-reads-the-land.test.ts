import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, readAbroad, readTheBooks, readTheRegions, readTheTrade, taxBurdens, type WorldState } from "@chronica/shared";
import { opening } from "./trade-test-kit";

/**
 * "What does the treasury say of the land?"
 *
 * The consul who keeps the treasury reads, beside the month's income and
 * expenditure, how developed each region is, how far war has scarred it and by
 * what regime and rate it is taxed; and what the markets hold and which pacts
 * stand. All of it is derived from the world and stored nowhere. And the
 * opening (scenario v51) says how the age taxed: the tributum on Rome's
 * citizens, the tithe of Sicily, the heavy levy on Carthage's Libyans and the allies'
 * tribute in men, which takes no money from a power that keeps none.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const world = (): WorldState => opening();
const row = (w: WorldState, id: string) => w.material.provinceMaterial.find((candidate) => candidate.provinceId === id);

describe("the treasury reads the land", () => {
  it("lists Rome's regions with the land levy it opens under, and who may change it", () => {
    const w = world();
    const regions = readTheRegions(w, "rome", true)!;
    expect(regions.polityLabel).toBe("Roman Republic");
    expect(regions.defaultPolicy).toEqual({ regime: "land_levy", rateBps: 1_000, explicit: true });
    expect(regions.provinceCount).toBe(72);
    expect(regions.regions.length).toBeGreaterThan(1);
    expect(regions.regions[0]!.population).toBeGreaterThanOrEqual(regions.regions.at(-1)!.population);
    expect(regions.developmentHighBps).toBeGreaterThan(regions.developmentLowBps);
    expect(regions.canSet).toBe(true);
    expect(readTheRegions(w, "rome", false)!.canSet).toBe(false);
  });

  it("goes to a consul with the treasury's powers and not to a private man", () => {
    const w = world();
    const consul = readTheBooks(w, "gaius-genucius", definition.government.offices, "kept");
    expect(consul.regions?.polityId).toBe("rome");
    expect(consul.regions?.canSet).toBe(true);
    expect(consul.trade?.polityLabel).toBe("Roman Republic");
    expect(consul.coin?.name).toBe("Roman aes and silver");
    const citizen = readTheBooks(w, "manius-curius", definition.government.offices, "kept");
    expect(citizen.regions ?? null).toBeNull();
  });

  it("opens Sicily under the tithe, whoever holds it, and Carthage's Libya under a heavy levy", () => {
    const w = world();
    const sicilian = w.map.provinces.filter((province) => province.id.startsWith("sic-"));
    expect(sicilian.length).toBeGreaterThan(5);
    // Written in no row: the custom of the country, which stays with the ground.
    for (const province of sicilian) expect(row(w, province.id)?.taxRegime).toBeUndefined();
    const lines = (polity: string) => readTheRegions(w, polity, true)!.regions.flatMap((region) => region.provinces);
    expect(lines("carthage").some((line) => line.policy.regime === "tithe")).toBe(true);
    expect(lines("syracuse").every((line) => line.policy.regime === "tithe")).toBe(true);
    expect(lines("carthage").some((line) => line.policy.regime === "land_levy" && line.policy.rateBps === 1_500)).toBe(true);
    // A province's own word overrides the custom; and Rome, holding Sicilian ground, would tithe it as the island always did.
    const roman = { ...w, map: { ...w.map, provinces: w.map.provinces.map((province) => (province.id === sicilian[0]!.id ? { ...province, controllerPolityId: "rome" } : province)) } };
    expect(readTheRegions(roman, "rome", true)!.regions.flatMap((region) => region.provinces).find((line) => line.id === sicilian[0]!.id)!.policy.regime).toBe("tithe");
  });

  it("asks the allies for men to Rome and leaves them a land levy and a chest of their own (v53), zeroing no treasury that has income", () => {
    const w = world();
    const samnites = readTheRegions(w, "samnites", true)!;
    expect(samnites.defaultPolicy).toEqual({ regime: "men", rateBps: 500, explicit: true });
    expect(samnites.regions.flatMap((region) => region.provinces).every((line) => line.policy.regime === "men" && line.menPerYear > 0)).toBe(true);
    // Every power with a chest and a tax roll is weighed against what its land can bear, the allies too: the men they owe Rome are no money, but the levy they keep is.
    const burdens = taxBurdens(w);
    for (const id of ["rome", "carthage", "syracuse", "samnites", "etruscan-cities", "apulian-cities"]) expect(burdens.get(id)!.collectedShare).toBeGreaterThan(0.5);
    const samnite = burdens.get("samnites")!;
    expect(samnite.menPerYear).toBeGreaterThan(1_000);
    expect(samnite.bearable).toBeGreaterThan(0);
    expect(samnite.asked / samnite.bearable).toBeLessThan(0.5);
    expect(samnite.bearableByRegime?.men).toBeCloseTo(samnite.bearable, 0);
    expect(w.material.accounts.find((account) => account.id === "samnites-treasury")!.balance).toBeGreaterThan(0);
  });

  it("reads the markets, and the trade pacts in force, for a power that holds hubs", () => {
    const w = world();
    const trade = readTheTrade(w, "rome")!;
    expect(trade.main.length).toBeGreaterThan(0);
    expect(trade.main.length).toBeLessThanOrEqual(5);
    expect(trade.main[0]!.goods).toHaveLength(6);
    expect(trade.customsRateBps).toBe(250);
    expect(trade.pacts.some((pact) => pact.kind === "trade_pact" && pact.withLabel === "Carthage" && pact.terms.includes("customs capped"))).toBe(true);
  });

  it("sets a trade pact's terms out on the treaties' line, a term at a time", () => {
    const w = world();
    const abroad = readAbroad(w, "gaius-genucius", definition.government.offices, definition.clock);
    const line = abroad.powers.find((power) => power.label === "Carthage")!.lines.find((candidate) => candidate.kind === "trade_pact")!;
    expect(line.trade).toMatchObject({ tariffCapBps: 500, heldByWar: false });
  });
});
