import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, ensureProvinceMaterial, type WorldState } from "../index";
import { DEBT_WEIGHT, PEACE_AT, arrearsStrainOf, warWeariness } from "./war-weariness";

/**
 * A power's weariness of its war reads every loss and the whole of its debts.
 *
 * Only the dead of battle were counted, and a year of hunger in the camps was nobody's grief; the treasury's part was two points
 * a missed payment, capped at fifteen, however deep the arrears; so Rome, bankrupt and starving in a war it was not losing in the
 * field, could never be tired enough to treat. The dead of hunger and sickness count now, the arrears are weighed against what
 * the chest can find, and each part stays bounded and named.
 */
const CAMPANIANS = "rhegium-campanians";
const ARMY = "roman-field-army";
const base = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);

const atDay = (world: WorldState, day: number): WorldState => ({ ...world, elapsedStep: day, instant: { ...world.instant, day } });

type Event = WorldState["material"]["forces"][number]["history"][number];
const lost = (world: WorldState, forceId: string, events: readonly Event[]): WorldState => ({
  ...world,
  material: { ...world.material, forces: world.material.forces.map((force) => (force.id === forceId ? { ...force, history: [...force.history, ...events] } : force)) },
});
const event = (kind: Event["kind"], count: number, atStep: number, causeId: string): Event => ({ id: `${kind}-${atStep}-${causeId}`, atStep, kind, categoryId: "infantry", count, causeId });

/** Rome's chest and its debts as given: the balance, the arrears on the legion's pay and the payments missed. */
const owing = (world: WorldState, balance: number, arrears: number, missed: number): WorldState => ({
  ...world,
  material: {
    ...world.material,
    accounts: world.material.accounts.map((account) => (account.id === "rome-treasury" ? { ...account, balance } : account)),
    obligations: world.material.obligations.map((obligation) => (obligation.id === "rome-legion-pay" ? { ...obligation, arrears, missedPeriods: missed } : obligation)),
  },
});

describe("a power's weariness of its war", () => {
  it("counts the dead of hunger and sickness with the dead of battle", () => {
    const quiet = atDay(base(), 200);
    const starved = lost(quiet, ARMY, [event("attrition_death", 3_000, 100, `${ARMY}:hunger`), event("attrition_death", 500, 120, `${ARMY}:sickness`)]);
    const before = warWeariness(quiet, "rome", CAMPANIANS);
    const after = warWeariness(starved, "rome", CAMPANIANS);
    expect(before.parts).not.toContain("the men it has lost");
    expect(after.score).toBeGreaterThan(before.score);
    expect(after.parts).toEqual(expect.arrayContaining(["the men it has lost", "hunger and sickness in the camps"]));
  });

  it("weighs the arrears against what the chest can pay, not the count of payments missed", () => {
    const world = atDay(base(), 200);
    // Three payments missed on a full chest: the old count, and little strain.
    const behind = owing(world, 2_790_000, 390_000, 3);
    // A year's pay owed on an empty chest: ruin, though it is still twelve payments.
    const ruined = owing(world, 0, 1_560_000, 12);
    expect(arrearsStrainOf(behind, "rome").strain).toBeLessThan(0.5);
    expect(arrearsStrainOf(ruined, "rome")).toMatchObject({ broke: true, strain: 1 });
    const little = warWeariness(behind, "rome", CAMPANIANS).score;
    const much = warWeariness(ruined, "rome", CAMPANIANS).score;
    expect(much).toBeGreaterThan(little);
    expect(much - warWeariness(world, "rome", CAMPANIANS).score).toBe(DEBT_WEIGHT);
    expect(warWeariness(ruined, "rome", CAMPANIANS).parts).toContain("a treasury that cannot pay");
  });

  it("brings a bankrupt, starving power in a war it is not losing in the field to the point of offering peace", () => {
    // Rome, two years in: the chest empty with a year's pay owed, the army eaten by hunger and sickness, the people restless and hungry.
    const world = owing(lost(atDay(base(), 720), ARMY, [event("attrition_death", 6_000, 300, `${ARMY}:hunger`), event("attrition_death", 2_000, 400, `${ARMY}:sickness`), event("desertion", 1_000, 500, `${ARMY}:hunger`)]), 0, 1_560_000, 12);
    const home = new Set(world.map.provinces.filter((province) => province.controllerPolityId === "rome").map((province) => province.id));
    const hungry: WorldState = { ...world, material: { ...world.material, provinceMaterial: world.material.provinceMaterial.map((entry) => (home.has(entry.provinceId) ? { ...entry, stabilityBps: 2_500, foodSecurityBps: 2_500 } : entry)) } };
    const tired = warWeariness(hungry, "rome", CAMPANIANS);
    expect(tired.score).toBeGreaterThanOrEqual(PEACE_AT);
    expect(tired.parts).toEqual(expect.arrayContaining(["the men it has lost", "a treasury that cannot pay", "unrest and hunger at home", "2 years of it"]));
    // And the same power, paid and fed, with the same men lost, is not there: the threshold is reached by collapse, not lowered.
    expect(warWeariness(lost(atDay(base(), 720), ARMY, [event("attrition_death", 6_000, 300, `${ARMY}:hunger`)]), "rome", CAMPANIANS).score).toBeLessThan(PEACE_AT);
  });

  it("stays between 0 and 100 whatever the world throws at it", () => {
    const world = owing(lost(atDay(base(), 3_000), ARMY, [event("attrition_death", 1_000_000, 100, "hunger"), event("battle_death", 1_000_000, 200, "a-battle")]), -5, 1_000_000_000, 500);
    const tired = warWeariness(world, "rome", CAMPANIANS);
    expect(tired.score).toBeLessThanOrEqual(100);
    expect(tired.score).toBeGreaterThanOrEqual(0);
    expect(warWeariness(world, "rome", "carthage")).toEqual({ score: 0, parts: [] });
  });
});
