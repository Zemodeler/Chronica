import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, atWar, ensureProvinceMaterial, fitStrengthOf, type WorldState } from "@chronica/shared";
import { describe, expect, it } from "vitest";
import { ensureConstitutions } from "./constitutions";
import { aMonth, definition, forceOf } from "./war-plan-kit";

/**
 * A war the age dates.
 *
 * Nothing in a model-less world made Hiero beat the Mamertines at the Longanus, or the Mamertines write to Rome and to Carthage, or a Carthaginian garrison
 * go into Messana: the pressures of the scenario were the narrator's to offer. A pressure with `happens` is done by the rules on its day, once
 * (`a-dated-war.ts`): the war opens and the beaten side's army is the less for it, the garrison enters, the letters go. The Mamertine appeal is then the cause the
 * rules weigh for Rome (`theAppealBehind`) and the war with Carthage is the Senate's and the people's to make; none of that is forced here.
 */
describe("a war the age dates", { timeout: 240_000 }, () => {
  const pressures = definition.historicalPressures;
  const opening = (day: number): WorldState => {
    let world = ensureConstitutions({ world: ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0), government: { offices: definition.government.offices, successionRules: definition.government.successionRules }, toDay: day });
    world = { ...world, instant: { ...world.instant, day }, elapsedStep: day };
    return world;
  };
  const dated = (world: WorldState, day: number) => aMonth({ ...world, instant: { ...world.instant, day }, elapsedStep: day }, { pressures });
  const told = (month: ReturnType<typeof dated>): string => month.decisions.flatMap((decision) => decision.facts.map((fact) => fact.summary)).join(" | ");
  const wars = (world: WorldState, a: string, b: string) => world.polityAgreements.filter((agreement) => agreement.kind === "war" && [agreement.polityId, agreement.otherPolityId].includes(a) && [agreement.polityId, agreement.otherPolityId].includes(b));

  it("brings nothing before its day", () => {
    const before = dated(opening(1_900), 1_900);
    expect(told(before)).not.toMatch(/Longanus/);
    expect(before.world.material.forces.some((force) => force.name === "Carthaginian garrison of Messana")).toBe(false);
  });

  const longanus = dated(opening(2_000), 2_000);

  it("opens the war of Syracuse on the Mamertines on its day, and tells it", () => {
    expect(told(longanus)).toMatch(/Hiero of Syracuse beat the Mamertines at the river Longanus/);
    expect(wars(longanus.world, "syracuse", "mamertines").some((war) => war.status === "active")).toBe(true);
  });

  it("lays the defeat on the Mamertines' army, once", () => {
    const before = fitStrengthOf(forceOf(opening(2_000), "mamertine-garrison"));
    const after = fitStrengthOf(forceOf(longanus.world, "mamertine-garrison"));
    expect(after).toBeLessThan(before);
    const again = dated(longanus.world, 2_030);
    expect(wars(again.world, "syracuse", "mamertines")).toHaveLength(1);
    expect(fitStrengthOf(forceOf(again.world, "mamertine-garrison"))).toBeGreaterThanOrEqual(after - 50);
  });

  const hardPressed = dated(longanus.world, 2_040);
  const appealed = dated(hardPressed.world, 2_300);

  it("has the Mamertines, hard pressed, write to Rome and to Carthage, once each (the rules' own call for help, or the dated one where nobody has)", () => {
    const letters = hardPressed.world.diplomacy.filter((message) => message.fromPolityId === "mamertines" && message.kind === "military_aid_request");
    expect(new Set(letters.map((message) => message.toPolityId))).toEqual(new Set(["rome", "carthage"]));
    expect(letters).toHaveLength(2);
    const stillOnce = dated(appealed.world, 2_330).world.diplomacy.filter((message) => message.fromPolityId === "mamertines" && message.kind === "military_aid_request");
    expect(stillOnce.filter((message) => message.sentAtStep >= 2_300)).toEqual([]);
  });

  it("puts a Carthaginian garrison into Messana, once", () => {
    const garrisons = appealed.world.material.forces.filter((force) => force.name === "Carthaginian garrison of Messana");
    expect(garrisons).toHaveLength(1);
    expect(garrisons[0]!.polityId).toBe("carthage");
    expect(appealed.world.map.provinces.find((province) => province.id === garrisons[0]!.locationId)?.settlements.some((settlement) => /messana/i.test(settlement.id))).toBe(true);
    const again = dated(appealed.world, 2_330);
    expect(again.world.material.forces.filter((force) => force.name === "Carthaginian garrison of Messana")).toHaveLength(1);
  });

  it("forces no war on Rome and Carthage: it is left to the Senate and the people", () => {
    expect(wars(appealed.world, "rome", "carthage")).toEqual([]);
    expect(atWar(appealed.world.polityAgreements, "rome", "carthage")).toBe(false);
  });
});
