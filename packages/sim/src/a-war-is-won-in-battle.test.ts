import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, openWar, recordBattle, warStanding, type WorldState } from "@chronica/shared";

/**
 * Battles count (docs/plans/a-living-world.md §3, the user's rule): a war is
 * read from the ground each side holds, the men it has left and the blood it
 * has shed -- and from the battles it has won, on land and at sea. A fleet
 * that wins three sea fights has done something to the war even if it has
 * taken no province.
 */

const atWar = (): WorldState => {
  const world = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
  return { ...world, polityAgreements: openWar(world.polityAgreements, { id: "war-rome-carthage", polityId: "rome", otherPolityId: "carthage", terms: "War.", atStep: 0, sourceMessageId: null, reason: "Test." }) };
};

describe("a war is won in battle", () => {
  it("counts victories at sea toward how the war stands, more for great ones", () => {
    const before = atWar();
    let agreements = before.polityAgreements;
    for (let day = 1; day <= 3; day += 1) agreements = recordBattle(agreements, { atStep: day, winnerPolityId: "rome", loserPolityId: "carthage", naval: true, engaged: 300 });
    const after = { ...before, polityAgreements: agreements };
    const gained = warStanding(after, "rome", "carthage").score - warStanding(before, "rome", "carthage").score;
    expect(gained).toBe(18);
    expect(warStanding(after, "rome", "carthage").parts.join("; ")).toContain("3 at sea");
    // The same three, seen from the side that lost them.
    expect(warStanding(after, "carthage", "rome").score).toBeLessThan(warStanding(before, "carthage", "rome").score);
  });

  it("credits an ally's victory to the war its leader is fighting", () => {
    const before = atWar();
    const agreements = recordBattle(before.polityAgreements, { atStep: 5, winnerPolityId: "samnites", loserPolityId: "carthage", naval: false, engaged: 12_000 });
    const war = agreements.find((agreement) => agreement.id === "war-rome-carthage")!;
    expect(war.battles).toEqual([{ atStep: 5, winnerPolityId: "rome", loserPolityId: "carthage", naval: false, engaged: 12_000 }]);
    expect(warStanding({ ...before, polityAgreements: agreements }, "rome", "carthage").score - warStanding(before, "rome", "carthage").score).toBe(12);
  });

  it("is nobody's tally where the two are not at war", () => {
    const world = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
    expect(recordBattle(world.polityAgreements, { atStep: 1, winnerPolityId: "macedon", loserPolityId: "athens", naval: false, engaged: 100 })).toEqual(world.polityAgreements);
  });

  it("counts a city for more the fewer a power has, and its capital most of all", () => {
    const world = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
    const at = (a: string, b: string) => ({ ...world, polityAgreements: openWar(world.polityAgreements, { id: `war-${a}-${b}`, polityId: a, otherPolityId: b, terms: "War.", atStep: 0, sourceMessageId: null, reason: "Test." }) });
    const take = (state: WorldState, taker: string, loser: string, which: (city: { id: string }, capital: string | null) => boolean): WorldState => {
      const capital = state.map.polities.find((polity) => polity.id === loser)?.capitalSettlementId ?? null;
      let done = false;
      return { ...state, map: { ...state.map, provinces: state.map.provinces.map((province) => {
        if (done || province.controllerPolityId !== loser) return province;
        const city = province.settlements.find((candidate) => which(candidate, capital));
        if (city === undefined) return province;
        done = true;
        return { ...province, settlements: province.settlements.map((candidate) => (candidate.id === city.id ? { ...candidate, controllerPolityId: taker } : candidate)) };
      }) } };
    };
    const gain = (state: WorldState, taker: string, loser: string) => warStanding(state, taker, loser).score - warStanding(at(taker, loser), taker, loser).score;
    // Syracuse's capital: the greatest single prize there is.
    const capital = take(at("carthage", "syracuse"), "carthage", "syracuse", (city, cap) => city.id === cap);
    expect(gain(capital, "carthage", "syracuse")).toBeGreaterThanOrEqual(35);
    // An ordinary city of the power with fewest of them, against one of the Seleucid empire's forty-one.
    const cities = new Map<string, number>();
    for (const province of world.map.provinces) if (province.controllerPolityId !== null) cities.set(province.controllerPolityId, (cities.get(province.controllerPolityId) ?? 0) + province.settlements.length);
    const bound = new Set(world.polityAgreements.filter((agreement) => agreement.status === "active").flatMap((agreement) => [agreement.polityId, agreement.otherPolityId]));
    const small = [...cities.entries()].filter(([id, count]) => count >= 2 && !bound.has(id) && id !== "carthage").sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0]![0];
    const few = take(at("carthage", small), "carthage", small, (city, cap) => city.id !== cap);
    const seleucid = take(at("ptolemaic-egypt", "seleucid-empire"), "ptolemaic-egypt", "seleucid-empire", (city, cap) => city.id !== cap);
    expect(gain(few, "carthage", small)).toBeGreaterThan(gain(seleucid, "ptolemaic-egypt", "seleucid-empire") + 5);
  });
});
