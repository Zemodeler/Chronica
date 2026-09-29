import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { ScenarioDefinitionSchema, WOUND_RETURN_DAYS, WorldStateSchema, diffWorlds, type Force, type WorldState } from "@chronica/shared";
import { resolveEngagement, returnTheMended } from "./battle";

/**
 * Legio I at Messana: legionaries, allied infantry and recruits, three groups
 * of one category. The battle account said 277 dead, 14 deserters and 520
 * wounded; the legion came out 2,433 men lighter -- the whole category's
 * losses charged to each of its three groups -- with nobody in the surgeons'
 * tents and its establishment cut to match.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const MESSANA = PUNIC_IDS.messana;

function theLegion(): WorldState {
  const opening = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
  return {
    ...opening,
    material: {
      ...opening.material,
      forces: opening.material.forces.map((force) => {
        if (force.id === "syracusan-army") return { ...force, locationId: MESSANA };
        if (force.id !== "roman-field-army") return force;
        return {
          ...force,
          name: "Legio I",
          locationId: MESSANA,
          authorizedStrength: 10_000,
          personnel: [
            { categoryId: "infantry", label: "Legionaries", fit: 4_000, unavailable: [] },
            { categoryId: "infantry", label: "Allied infantry", fit: 3_500, unavailable: [] },
            { categoryId: "infantry", label: "Roman infantry recruits", fit: 2_500, unavailable: [] },
          ],
        };
      }),
    },
  };
}

const forceOf = (state: WorldState, id: string): Force => state.material.forces.find((force) => force.id === id)!;
const fit = (force: Force) => force.personnel.reduce((sum, group) => sum + group.fit, 0);
const hurt = (force: Force) => force.personnel.reduce((sum, group) => sum + group.unavailable.reduce((n, out) => n + out.count, 0), 0);

describe("a legion of three parts", () => {
  const before = theLegion();
  const fought = resolveEngagement({
    world: before,
    attacker: forceOf(before, "roman-field-army"),
    defender: forceOf(before, "syracusan-army"),
    posture: "offer_battle",
    tactic: null,
    warfare: definition.warfare,
    battleId: "battle-messana",
    seed: "messana",
  }, 0);
  // What the battle account -- the Chronicle's source -- says the legion lost.
  const { dead, deserted, wounded } = fought.account!.losses.find((loss) => loss.name === "Legio I")!;
  const after = forceOf(fought.world, "roman-field-army");

  // The wounded who will never stand in the line again.
  const maimed = after.history.filter((event) => event.kind === "wounds_death" && event.causeId === "battle-messana").reduce((sum, event) => sum + event.count, 0);

  it("loses what the battle says it lost, once", () => {
    expect(dead + deserted + wounded).toBeGreaterThan(0);
    expect(fit(after)).toBe(10_000 - dead - deserted - wounded);
    expect(hurt(after)).toBe(wounded - maimed);
  });

  it("keeps its mending wounded on the establishment, and writes each loss down once", () => {
    expect(maimed).toBeGreaterThan(0);
    expect(maimed).toBeLessThan(wounded / 3);
    expect(after.authorizedStrength).toBe(10_000 - dead - deserted - maimed);
    const ids = after.history.map((event) => event.id);
    expect(new Set(ids).size).toBe(ids.length);
    const count = (kind: string) => after.history.filter((event) => event.kind === kind && event.causeId === "battle-messana").reduce((sum, event) => sum + event.count, 0);
    expect(count("battle_death")).toBe(dead);
    expect(count("desertion")).toBe(deserted);
    expect(count("unavailable")).toBe(wounded);
  });

  it("says one thing on the map about it", () => {
    const rows = diffWorlds(before, fought.world).filter((change) => change.id === "roman-field-army");
    expect(rows.filter((row) => row.detail.startsWith("down"))).toHaveLength(1);
    expect(rows.some((row) => row.detail.startsWith("cut to"))).toBe(false);
  });

  it("has its wounded back a share at a time, over three to six weeks", () => {
    const days = [...new Set(after.personnel.flatMap((group) => group.unavailable.map((out) => out.earliestRecoveryStep)))].sort((a, b) => a - b);
    const fought0 = fought.world.elapsedStep;
    expect(days).toEqual(WOUND_RETURN_DAYS.map((day) => fought0 + day));
    expect(hurt(forceOf(returnTheMended(fought.world, days[0]! - 1), "roman-field-army"))).toBe(wounded - maimed);
    const first = forceOf(returnTheMended(fought.world, days[0]!), "roman-field-army");
    expect(hurt(first)).toBeGreaterThan(0);
    expect(hurt(first)).toBeLessThan(wounded - maimed);
    const mended = forceOf(returnTheMended(fought.world, days.at(-1)!), "roman-field-army");
    expect(hurt(mended)).toBe(0);
    expect(fit(mended)).toBe(10_000 - dead - deserted - maimed);
    expect(mended.history.filter((event) => event.kind === "recovery").reduce((sum, event) => sum + event.count, 0)).toBe(wounded - maimed);
  });
});
