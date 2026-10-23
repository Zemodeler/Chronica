import { describe, expect, it } from "vitest";
import { aMonth, atWar, dayInSeason, fed, ledBy, romeAndCarthageAlone } from "./war-plan-kit";

/**
 * An army winters in a town.
 *
 * Supply, forage and winter quarters were nobody's decision: an army stood in the field and starved, or did not. Now the general
 * goes into winter quarters in a town of his own when the cold comes on or his bread is short, unless he is a bold man with a
 * good quartermaster and his army fed; where there is no town to go to he goes to ground that will feed him.
 */
describe("an army winters in a town", () => {
  it("goes into quarters in a town of its own when winter comes", () => {
    const world = ledBy(romeAndCarthageAlone(atWar(dayInSeason("winter"))), "roman-field-army", { boldness: 40, caution: 60 });
    const { world: next } = aMonth(world);
    const orders = next.campaigns.find((entry) => entry.forceId === "roman-field-army")!;
    expect(orders.mode).toBe("winter");
    const quarters = orders.objective.kind === "province" ? orders.objective.provinceId : "";
    const province = next.map.provinces.find((candidate) => candidate.id === quarters)!;
    expect(province.controllerPolityId).toBe("rome");
    expect(province.settlements.length).toBeGreaterThan(0);
  });

  it("keeps the field through the winter if he is a bold man with a good quartermaster and his army is fed", () => {
    const world = fed(ledBy(romeAndCarthageAlone(atWar(dayInSeason("winter"))), "roman-field-army", { boldness: 90, caution: 20, logistics: 80 }), "roman-field-army", "provisioned");
    const orders = aMonth(world).world.campaigns.find((entry) => entry.forceId === "roman-field-army")!;
    expect(orders.mode).not.toBe("winter");
  });

  it("goes into quarters in summer too, when the bread has run out", () => {
    const summer = ledBy(romeAndCarthageAlone(atWar(dayInSeason("summer"))), "roman-field-army", { boldness: 90, caution: 20, logistics: 80 });
    const orders = aMonth(fed(summer, "roman-field-army", "critical")).world.campaigns.find((entry) => entry.forceId === "roman-field-army")!;
    expect(orders.mode === "winter" || orders.mode === "raid").toBe(true);
  });

  it("does not leave the town it winters in on the first warm day: its orders stand for the season", () => {
    const winter = ledBy(romeAndCarthageAlone(atWar(dayInSeason("winter"))), "roman-field-army", { boldness: 40, caution: 60 });
    const first = aMonth(winter);
    const later = aMonth({ ...first.world, instant: { ...first.world.instant, day: first.world.instant.day + 30 }, elapsedStep: first.world.elapsedStep + 30 });
    expect(later.decisions.some((decision) => decision.polityId === "rome" && decision.act === "march" && decision.actorCharacterId === "gaius-genucius")).toBe(false);
  });
});
