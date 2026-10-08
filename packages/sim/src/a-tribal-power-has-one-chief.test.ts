import { describe, expect, it } from "vitest";
import { allOffices, competenceOf, isMagistracy } from "@chronica/shared";
import { government, holdersOf, opening } from "./competence-test-kit";

/**
 * A tribal power has one chief.
 *
 * The scenario wrote a stand-in "ruler" for every power it had nothing better for ("boii-ruler", unseated, with a ruler's charge over the tax), and the
 * constitution then built the chief's own office beside it ("boii:ruler", seated, whose charge forbids the tax): two chiefs, one a ghost the old test passed on.
 * The stand-ins are reformed into the offices the constitution builds, so each power has the one chief it names.
 */
describe("a tribal power has one chief", () => {
  const world = opening();
  const offices = allOffices(world, government.offices);
  const tribal = world.constitutions.filter((record) => record.form === "tribal_confederation");

  it("keeps the chief the constitution names and none beside him", () => {
    expect(tribal.length).toBeGreaterThan(50);
    const doubled = tribal.filter((record) => offices.filter((office) => office.polityId === record.polityId && isMagistracy(office) && office.successionRuleId !== "abolished" && /[-:]ruler$/.test(office.id)).length !== 1);
    expect(doubled.map((record) => record.polityId)).toEqual([]);
  });

  it("seats a man in it, and no unseated stand-in claims a charge", () => {
    for (const record of tribal) {
      expect(holdersOf(world, record.rulerOfficeId!).length, record.polityId).toBeGreaterThan(0);
      const standIn = offices.find((office) => office.id === `${record.polityId}-ruler`);
      expect(standIn === undefined || standIn.successionRuleId === "abolished", record.polityId).toBe(true);
    }
  });

  it("gives the Boii's chief the charge a tribal chief has, and no tax", () => {
    const chief = competenceOf(world, "boii:ruler", government.offices)!;
    expect(chief.acts.war.grade).not.toBe("forbidden");
    expect(chief.acts.tax_rate.grade).toBe("forbidden");
    expect(competenceOf(world, "boii-ruler", government.offices)?.acts.tax_rate.grade ?? "forbidden").toBe("forbidden");
  });

  it("does the same for every other template power: one councillor office, one priesthood", () => {
    for (const record of world.constitutions) {
      for (const key of ["councillor", "priest"]) {
        const live = offices.filter((office) => office.polityId === record.polityId && office.successionRuleId !== "abolished" && new RegExp(`[-:]${key}$`).test(office.id));
        if (!offices.some((office) => office.id === `${record.polityId}:${key}`)) continue;
        expect(live.map((office) => office.id), record.polityId).toEqual([`${record.polityId}:${key}`]);
      }
    }
  });
});
