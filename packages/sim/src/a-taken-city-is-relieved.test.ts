import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  EMPTY_ECONOMY_MEMORY,
  ScenarioDefinitionSchema,
  SiegeSchema,
  WorldStateSchema,
  astronomicalYearOf,
  calendarDateOf,
  ensureMarkets,
  ensureProvinceMaterial,
  marketEntry,
  marketGeography,
  type WorldState,
} from "@chronica/shared";
import { HARVEST_MONTH, reviewTheLand } from "./economy";
import { TAKEN_CITY_CUT_OFF_DAYS } from "./markets";

/**
 * A taken city is relieved.
 *
 * Rhegium (160,000 souls) fell to Rome a few weeks after the harvest, which had been cut to a quarter by the siege: the country's crop stayed on its farms, the
 * hub's grain stood at the cap for a year, its people starved a thousand a month and its food never left the 2,000s. A city a siege has taken is opened after a
 * season (the carters come back), and the crop they held back comes in with them: the town is fed again within a season or two.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const clock = definition.clock;
const LATIUM = PUNIC_IDS.rome;
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);

const HARVEST_DAY = ((): number => {
  for (let day = 1; day < 800; day += 1) {
    const date = calendarDateOf({ day, minute: 0 }, clock);
    if (date.month === HARVEST_MONTH && date.day === 1) return day;
  }
  throw new Error("no harvest");
})();
const HARVEST_YEAR = astronomicalYearOf(calendarDateOf({ day: HARVEST_DAY, minute: 0 }, clock));
const FELL_ON = HARVEST_DAY + 30;

describe("a taken city is relieved", () => {
  const opened = ensureMarkets(opening(), HARVEST_DAY / 30);
  const base: WorldState = { ...opened, economy: { ...EMPTY_ECONOMY_MEMORY, ...opened.economy, lastReviewStep: 0, lastHarvestYear: HARVEST_YEAR - 1 } };
  const hub = marketGeography(base).hubOf.get(LATIUM)!;
  const reckon = (world: WorldState, fromDay: number, toDay: number): WorldState => {
    let current = world;
    for (let day = fromDay + 30; day <= toDay; day += 30) current = reviewTheLand({ world: current, toDay: day, clock }).world;
    return current;
  };
  const food = (world: WorldState): number => world.material.provinceMaterial.find((row) => row.provinceId === hub)!.foodSecurityBps;
  const siege = (status: "active" | "taken") => SiegeSchema.parse({
    id: `siege-${hub}`, forceId: "an-army", provinceId: hub, besiegerPolityId: "carthage", defenderPolityId: "rome",
    startedAtStep: 0, pressedToStep: 0, reportedAtStep: 0, status, ...(status === "taken" ? { endedAtStep: FELL_ON } : {}),
  });

  it("brings the crop the siege held back, once the city is opened, and its people are out of famine within a season", () => {
    // Besieged over the harvest, then taken: the enemy holds it.
    const besieged = reckon({ ...base, sieges: [siege("active")] }, 0, FELL_ON);
    const fell: WorldState = {
      ...besieged,
      sieges: [siege("taken")],
      map: { ...besieged.map, provinces: besieged.map.provinces.map((province) => (province.id === hub ? { ...province, ownerPolityId: "rome", controllerPolityId: "carthage" } : province)) },
    };
    const starving = food(fell);
    expect(starving).toBeLessThan(8_000);
    const grainAtFall = marketEntry(fell, hub, "grain")!;
    // A season on it is opened, and the carters' crop is in the granary.
    const opened = reckon(fell, FELL_ON, FELL_ON + TAKEN_CITY_CUT_OFF_DAYS + 30);
    expect(marketEntry(opened, hub, "grain")!.stock).toBeGreaterThan(grainAtFall.stock * 1.5);
    expect(marketEntry(opened, hub, "grain")!.priceBps).toBeLessThan(marketEntry(fell, hub, "grain")!.priceBps);
    // And a month on the town is out of famine, which nothing but the crop could do before the next harvest.
    const fed = reckon(opened, FELL_ON + TAKEN_CITY_CUT_OFF_DAYS + 30, FELL_ON + TAKEN_CITY_CUT_OFF_DAYS + 60);
    expect(food(fed)).toBeGreaterThanOrEqual(4_000);
  });
});
