import { describe, expect, it } from "vitest";
import { fitStrengthOf, type Force, type WorldState } from "@chronica/shared";
import { ownsAndHolds } from "@chronica/shared";
import { createIdFactory } from "./ports";
import { refillTheLegions } from "./legion-refill";
import { chestOf, definition, opening, romeFieldArmy, tickTo } from "./equipment-test-kit";

/**
 * A legion is refilled.
 *
 * A legion that lost half its men in a war stayed at half until somebody ordered a levy for it. A power at war now fills its thinned armies from the levy by rule, once a month at a
 * consul's rate (a twelfth of its host), within the roll of its assidui and the chest's bounty, and not above what the army was raised at; the men come in by bands, and they come with a household's arms.
 */
const men = (force: Force): number => force.personnel.reduce((sum, row) => sum + row.fit + row.unavailable.reduce((held, group) => held + group.count, 0), 0);
const thinned = (world: WorldState): WorldState => ({
  ...world,
  material: {
    ...world.material,
    forces: world.material.forces.map((force) => (force.id === romeFieldArmy(world).id
      ? { ...force, personnel: force.personnel.map((row) => ({ ...row, fit: Math.floor(row.fit / 2) })) }
      : force)),
  },
});

describe("a legion is refilled", () => {
  const start = thinned(opening());
  const authorized = romeFieldArmy(start).authorizedStrength;

  it("fills a thinned army by the month in a war, never above what it was raised at", () => {
    let world = start;
    const seen: number[] = [men(romeFieldArmy(world))];
    const facts: string[] = [];
    for (let month = 1; month <= 6; month += 1) {
      const result = tickTo(world, month * 30, "refill");
      world = result.world;
      facts.push(...result.factProposals.filter((fact) => fact.kind === "legions_refilled").map((fact) => fact.summary));
      seen.push(men(romeFieldArmy(world)));
    }
    expect(seen[seen.length - 1]!).toBeGreaterThan(seen[0]! + 1_000);
    expect(Math.max(...seen)).toBeLessThanOrEqual(authorized);
    // At a consul's rate: a twelfth of the host a month, so not all at once.
    expect(seen[2]! - seen[1]!).toBeLessThan(authorized * 0.2);
    expect(facts.length).toBeGreaterThan(0);
    expect(facts[0]).toMatch(/levy held for/i);
  });

  it("pays the bounty out of the chest and draws the men out of the roll", () => {
    const seeded: WorldState = { ...start, material: { ...start.material, forces: start.material.forces.map((force) => (force.id === romeFieldArmy(start).id ? { ...force, refilledAtStep: 0 } : force)) } };
    const roll = (world: WorldState): number => world.map.provinces.filter((province) => ownsAndHolds(province, "rome")).reduce((sum, province) => sum + (world.material.provinceMaterial.find((row) => row.provinceId === province.id)?.availableManpower ?? 0), 0);
    const result = refillTheLegions({ world: seeded, toDay: 30, ids: createIdFactory("refill-pay"), offices: definition.government.offices });
    const sent = men(romeFieldArmy(result.world)) - men(romeFieldArmy(seeded));
    expect(sent).toBeGreaterThan(500);
    // The levy takes the men out of the roll (the assidui only) and the bounty out of the chest.
    expect(roll(seeded) - roll(result.world)).toBe(sent);
    expect(chestOf(seeded, "rome-treasury") - chestOf(result.world, "rome-treasury")).toBeGreaterThan(0);
    expect(chestOf(seeded, "rome-treasury") - chestOf(result.world, "rome-treasury")).toBeLessThan(sent * 40);
  });

  it("does nothing at peace", () => {
    const peace: WorldState = { ...start, polityAgreements: start.polityAgreements.filter((agreement) => agreement.kind !== "war") };
    let world = peace;
    for (let month = 1; month <= 3; month += 1) world = tickTo(world, month * 30, "refill-peace").world;
    expect(fitStrengthOf(romeFieldArmy(world))).toBeLessThanOrEqual(fitStrengthOf(romeFieldArmy(peace)));
  });

  it("brings the new men in with a household's arms, which tells on the army's kit", () => {
    let world = start;
    for (let month = 1; month <= 3; month += 1) world = tickTo(world, month * 30, "refill-kit").world;
    // Looked at on the first month, then diluted by recruits who bring half a kit: below the ordinary seven in ten.
    expect(romeFieldArmy(world).equipmentBps!).toBeLessThan(7_000);
  });
});
