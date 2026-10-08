import { describe, expect, it } from "vitest";
import { PUNIC_IDS } from "@chronica/db";
import { assiduiShareBps, ownsAndHolds } from "@chronica/shared";
import { raiseLevy } from "./levies";
import { createIdFactory } from "./ports";
import { opening } from "./equipment-test-kit";

/**
 * Only the assidui serve.
 *
 * In Rome the census classes limited the levy: the assidui, who had the property to arm themselves, were enrolled for the legions (Livy 1.43; Polybius 6.19); the capite censi and
 * the proletarii, rated under four thousand asses, were not (Gellius 16.10), and were taken for the fleet (Polybius 6.19.4) or, in the extremity after Cannae, for the legions with
 * the slaves (Livy 22.57). Where land is given to the landless the assidui grow (`reform-laws.ts`). A people that raises its men by another basis (citizens, hired companies, settlers) has no such class.
 */
const LATIUM = PUNIC_IDS.rome;
const ask = (world: ReturnType<typeof opening>, polityId: string, provinceId: string, extra: { extremity?: boolean } = {}) => raiseLevy(world, {
  polityId, provinceId, men: 10_000_000, payerAccountId: null, pays: false, atStep: 0, cause: "assidui", ids: createIdFactory("assidui"), categoryId: "infantry", ...extra,
});
const rollOf = (world: ReturnType<typeof opening>, polityId: string): number => world.map.provinces.filter((province) => ownsAndHolds(province, polityId))
  .reduce((sum, province) => sum + (world.material.provinceMaterial.find((row) => row.provinceId === province.id)?.availableManpower ?? 0), 0);

describe("only the assidui serve", () => {
  const world = opening();

  it("gives the assidui a larger share of a richer country, and everyone the vote of a country with no census", () => {
    expect(assiduiShareBps("property_class", "low", 0)).toBeLessThan(assiduiShareBps("property_class", "low", 10_000));
    expect(assiduiShareBps("property_class", "low", 5_000)).toBeLessThan(10_000);
    expect(assiduiShareBps("property_class", "high", 5_000)).toBeLessThan(assiduiShareBps("property_class", "low", 5_000));
    expect(assiduiShareBps("citizens", "none", 5_000)).toBe(10_000);
    expect(assiduiShareBps("mercenary", "none", 5_000)).toBe(10_000);
  });

  it("raises fewer men for Rome than its roll holds, and leaves the landless on the roll", () => {
    const roll = rollOf(world, "rome");
    const levy = ask(world, "rome", LATIUM);
    expect(levy.men).toBeGreaterThan(0);
    expect(levy.men).toBeLessThan(roll * 0.95);
    expect(levy.men).toBeGreaterThan(roll * 0.5);
    expect(rollOf(levy.world, "rome")).toBeGreaterThan(roll * 0.1);
  });

  it("takes the landless too when the power is in its extremity (Livy 22.57)", () => {
    const usual = ask(world, "rome", LATIUM);
    const extreme = ask(world, "rome", LATIUM, { extremity: true });
    expect(extreme.men).toBeGreaterThan(usual.men);
  });

  it("makes no such distinction in a people that does not rate its men by property", () => {
    const syracuse = world.map.provinces.find((province) => ownsAndHolds(province, "syracuse"))!;
    const usual = ask(world, "syracuse", syracuse.id);
    const extreme = ask(world, "syracuse", syracuse.id, { extremity: true });
    expect(usual.men).toBe(extreme.men);
  });

  it("grows the pool where a land law makes assidui of the landless (more on the roll, more served)", () => {
    const more = {
      ...world,
      material: { ...world.material, provinceMaterial: world.material.provinceMaterial.map((row) => (row.provinceId === LATIUM ? { ...row, availableManpower: row.availableManpower + 5_000 } : row)) },
    };
    expect(ask(more, "rome", LATIUM).men).toBeGreaterThan(ask(world, "rome", LATIUM).men + 2_000);
  });
});
