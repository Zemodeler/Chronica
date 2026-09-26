import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema } from "../index";
import { accountLabel } from "./account-names";
import type { WorldState } from "../world/world-state";

const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
type Account = WorldState["material"]["accounts"][number];
const owned = (kind: Account["owner"]["kind"], id: string): Account => ({
  id: `acct-${id}`, owner: { kind, id }, currencyId: "denarius", balance: 0, status: "active", visibility: "public",
} as Account);

describe("naming an account", () => {
  it("calls a force's account the pay chest of that force", () => {
    const state = world();
    const force = state.material.forces[0]!;
    const account = owned("force", force.id);
    expect(accountLabel(state, account)).toBe(`Pay chest of the ${force.name.replace(/^the\s+/i, "")}`);
    expect(accountLabel(state, account, "clause")).toBe(`the pay chest of the ${force.name.replace(/^the\s+/i, "")}`);
  });

  it("does not say 'the the' for a force whose name has its own article", () => {
    const state = world();
    const force = { ...state.material.forces[0]!, name: "The Sacred Band" };
    const renamed: WorldState = { ...state, material: { ...state.material, forces: [force, ...state.material.forces.slice(1)] } };
    expect(accountLabel(renamed, owned("force", force.id))).toBe("Pay chest of the Sacred Band");
  });

  it("names treasuries, purses and funds from their owners", () => {
    const state = world();
    const polity = state.map.polities[0]!;
    const character = state.characters[0]!;
    expect(accountLabel(state, owned("polity", polity.id))).toBe(`${polity.name} treasury`);
    expect(accountLabel(state, owned("polity", polity.id), "clause")).toBe(`the ${polity.name} treasury`);
    expect(accountLabel(state, owned("character", character.id))).toBe(`${character.name}'s purse`);
  });

  it("describes an owner it cannot find rather than printing an id", () => {
    const state = world();
    for (const kind of ["polity", "character", "force", "entity"] as const) {
      const label = accountLabel(state, owned(kind, "no-such-owner-17"));
      expect(label).not.toContain("no-such-owner-17");
      expect(label.length).toBeGreaterThan(0);
    }
  });
});
