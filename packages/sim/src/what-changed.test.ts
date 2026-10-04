import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { whatChanged, whatChangedEntry } from "./what-changed";

const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);

describe("what a turn changed", () => {
  it("says nothing when nothing changed", () => {
    const world = opening();
    expect(whatChanged({ before: world, after: world, polityId: "rome", characterId: "gaius-genucius" })).toEqual([]);
    expect(whatChangedEntry({ before: world, after: world, polityId: "rome", characterId: null }, 0)).toBeNull();
  });

  it("reads treasury, an army's move and a seat from the two worlds", () => {
    const before = opening();
    const legion = before.material.forces.find((force) => force.polityId === "rome")!;
    const other = before.map.provinces.find((province) => province.id !== legion.locationId)!;
    const treasury = before.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === "rome")!;
    const after: WorldState = {
      ...before,
      material: {
        ...before.material,
        accounts: before.material.accounts.map((account) => account.id === treasury.id ? { ...account, balance: account.balance - 500 } : account),
        forces: before.material.forces.map((force) => force.id === legion.id ? { ...force, locationId: other.id } : force),
      },
    };
    const lines = whatChanged({ before, after, polityId: "rome", characterId: null });
    expect(lines.some((line) => line.startsWith("Treasury:") && line.includes("(-500)"))).toBe(true);
    expect(lines.some((line) => line.includes(`${legion.name} moved from`) && line.includes(other.name))).toBe(true);
    expect(whatChangedEntry({ before, after, polityId: "rome", characterId: null }, 7)!.kind).toBe("recorded");
  });
});
