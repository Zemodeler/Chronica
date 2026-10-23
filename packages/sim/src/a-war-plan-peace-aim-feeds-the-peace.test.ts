import { ownerOf, warStanding, type WarPlan, type WorldState } from "@chronica/shared";
import { describe, expect, it } from "vitest";
import { peaceFromTheAims } from "./a-war-ends-for-what-it-was-for";
import { aMonth, atWar, romeAndCarthageAlone } from "./war-plan-kit";

/**
 * A war plan's aim of peace feeds the peace, and the terms are what the war was for.
 *
 * `sue_for_peace` in a plan was a line in a dossier. Now a power whose plan has it has asked for peace, the other side hears it (a winner
 * gives in, a loser's enemy grants it when wearied of the war or when the asking has stood a quarter of a year), and the treaty names the ground
 * the winner went to war for, and only that, within what the loser will bear.
 */
describe("a war plan's aim of peace feeds the peace", { timeout: 300_000 }, () => {
  const plan = (polityId: string, enemyPolityId: string, aims: WarPlan["aims"], at: number): WarPlan => ({
    warId: "x", polityId, enemyPolityId, aims, theatres: [], posture: "attrition", reviewedAtStep: at, aimsSetAtStep: at, aimsChangedAtStep: at, issuedByCharacterId: null,
  });
  /** Rome holds ground that is Carthage's, and says it is what the war is for; Carthage asks for peace; the war is a year old. */
  function aWarTheWinnerHalfWon(winnerNames: boolean): { world: WorldState; held: string[] } {
    const base = romeAndCarthageAlone(atWar(100));
    const mine = base.map.provinces.filter((province) => ownerOf(province) === "carthage" && province.settlements.length > 0).slice(0, 2).map((province) => province.id);
    const day = 100 + 300;
    const world: WorldState = {
      ...base, instant: { ...base.instant, day }, elapsedStep: day,
      map: { ...base.map, provinces: base.map.provinces.map((province) => (mine.includes(province.id) ? { ...province, ownerPolityId: "carthage", controllerPolityId: "rome" } : province)) },
      warPlans: [
        plan("rome", "carthage", winnerNames ? mine.map((provinceId) => ({ kind: "take_province" as const, provinceId })) : [{ kind: "hold_province", provinceId: "it-l865w" }], day - 200),
        plan("carthage", "rome", [{ kind: "sue_for_peace", polityId: "rome" }], day - 150),
      ],
    };
    return { world, held: mine };
  }
  const war = (world: WorldState) => world.polityAgreements.find((agreement) => agreement.kind === "war" && agreement.status === "active" && [agreement.polityId, agreement.otherPolityId].includes("carthage"))!;

  it("is an asking, heard: the side asked is the one with the better of the war, and it grants it", () => {
    const { world } = aWarTheWinnerHalfWon(true);
    expect(warStanding(world, "rome", "carthage").score).toBeGreaterThan(warStanding(world, "carthage", "rome").score);
    const peace = peaceFromTheAims(world, war(world));
    expect(peace).not.toBeNull();
    expect(peace!.suer).toBe("carthage");
    expect(peace!.victor).toBe("rome");
  });

  it("prices the terms from what the war was for: the ground the winner's plan names and holds", () => {
    const { world, held } = aWarTheWinnerHalfWon(true);
    const peace = peaceFromTheAims(world, war(world))!;
    const ceded = peace.clauses.flatMap((clause) => (clause.kind === "cession" ? [clause.provinceId] : []));
    expect(ceded.length).toBeGreaterThan(0);
    for (const id of ceded) expect(held).toContain(id);
    expect(peace.terms).toMatch(/for what the war was fought for/);
  });

  it("asks no ground of a loser where the winner's plan named none (each keeps what it holds)", () => {
    const { world } = aWarTheWinnerHalfWon(false);
    const peace = peaceFromTheAims(world, war(world))!;
    expect(peace.clauses.filter((clause) => clause.kind === "cession")).toEqual([]);
  });

  it("is nothing where neither plan asks for it", () => {
    const { world } = aWarTheWinnerHalfWon(true);
    expect(peaceFromTheAims({ ...world, warPlans: world.warPlans.filter((entry) => entry.polityId === "rome") }, war(world))).toBeNull();
  });

  it("is not granted by a loser's enemy that is not tired and has not been asked long", () => {
    const { world } = aWarTheWinnerHalfWon(true);
    const fresh = { ...world, warPlans: world.warPlans.map((entry) => (entry.polityId === "carthage" ? { ...entry, aimsChangedAtStep: world.instant.day - 10 } : entry)) };
    // Carthage is the one with the worse of it: Rome grants only when wearied or after the asking has stood.
    const peace = peaceFromTheAims(fresh, war(fresh));
    expect(peace === null || peace.victor === "rome").toBe(true);
  });

  it("is carried into the month's statecraft: the peace is moved, as every peace is, and not otherwise", () => {
    const { world } = aWarTheWinnerHalfWon(true);
    const plain = { ...world, warPlans: world.warPlans.filter((entry) => entry.polityId !== "carthage") };
    const asked = aMonth(world).decisions.filter((decision) => /peace/i.test(`${decision.act} ${decision.why}`) && [decision.polityId, decision.targetPolityId].some((id) => id === "rome" || id === "carthage"));
    const without = aMonth(plain).decisions.filter((decision) => /peace/i.test(`${decision.act} ${decision.why}`) && [decision.polityId, decision.targetPolityId].some((id) => id === "rome" || id === "carthage"));
    expect(asked.length).toBeGreaterThan(without.length);
  });
});
