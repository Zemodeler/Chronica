import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { WorldStateSchema, type WorldState } from "../index";
import { diffWorlds } from "./changes";

const base = (): WorldState => WorldStateSchema.parse(structuredClone(firstPunicWarScenario.initialWorld));

const detailFor = (changes: ReturnType<typeof diffWorlds>, id: string): string | undefined =>
  changes.find((change) => change.id === id)?.detail;

describe("what changed on the map", () => {
  it("finds nothing in a world that did not move", () => {
    expect(diffWorlds(base(), base())).toEqual([]);
  });

  it("names a province that changed hands, and both powers' new reach", () => {
    const before = base();
    const province = before.map.provinces.find((candidate) => candidate.controllerPolityId !== null)!;
    const taker = before.map.polities.find((polity) => polity.id !== province.controllerPolityId)!;
    const after: WorldState = {
      ...before,
      map: { ...before.map, provinces: before.map.provinces.map((candidate) => (candidate.id === province.id ? { ...candidate, controllerPolityId: taker.id } : candidate)) },
    };

    const changes = diffWorlds(before, after);
    expect(detailFor(changes, province.id)).toContain(`to ${taker.name}`);
    expect(detailFor(changes, taker.id)).toBe("holds 1 province more");
    expect(detailFor(changes, province.controllerPolityId!)).toBe("holds 1 province fewer");
  });

  it("notices an army that bled, and one that is gone", () => {
    const before = base();
    const force = before.material.forces[0]!;
    const bled = { ...force, personnel: force.personnel.map((category) => ({ ...category, fit: Math.max(0, category.fit - 900) })) };
    const afterBled: WorldState = { ...before, material: { ...before.material, forces: [bled, ...before.material.forces.slice(1)] } };
    expect(detailFor(diffWorlds(before, afterBled), force.id)).toMatch(/^down /);

    const afterGone: WorldState = { ...before, material: { ...before.material, forces: before.material.forces.slice(1) } };
    expect(detailFor(diffWorlds(before, afterGone), force.id)).toContain("destroyed or dispersed");
  });

  it("says nothing about a handful of men, which is not a change anybody sees", () => {
    const before = base();
    const force = before.material.forces[0]!;
    const category = force.personnel[0]!;
    const after: WorldState = {
      ...before,
      material: { ...before.material, forces: [{ ...force, personnel: [{ ...category, fit: category.fit - 12 }, ...force.personnel.slice(1)] }, ...before.material.forces.slice(1)] },
    };
    expect(diffWorlds(before, after)).toEqual([]);
  });

  it("records a death", () => {
    const before = base();
    const character = before.characters.find((candidate) => candidate.alive)!;
    const after: WorldState = { ...before, characters: before.characters.map((candidate) => (candidate.id === character.id ? { ...candidate, alive: false } : candidate)) };
    expect(detailFor(diffWorlds(before, after), character.id)).toBe("dies");
  });
});

describe("an army that was only ordered bigger", () => {
  it("records a reinforcement, which moves authorized strength before it moves men", () => {
    // A garrison strengthened by three hundred produced no change row at all,
    // because the men had been called up and had not yet arrived.
    const before = base();
    const force = before.material.forces[0]!;
    const after: WorldState = {
      ...before,
      material: {
        ...before.material,
        forces: [{ ...force, authorizedStrength: force.authorizedStrength + 300 }, ...before.material.forces.slice(1)],
      },
    };
    expect(detailFor(diffWorlds(before, after), force.id)).toContain("300 more than before");
  });

  it("ignores an adjustment too small for anyone to notice", () => {
    const before = base();
    const force = before.material.forces[0]!;
    const after: WorldState = {
      ...before,
      material: { ...before.material, forces: [{ ...force, authorizedStrength: force.authorizedStrength + 20 }, ...before.material.forces.slice(1)] },
    };
    expect(diffWorlds(before, after)).toEqual([]);
  });
});
