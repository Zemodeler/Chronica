import { describe, expect, it } from "vitest";
import type { WorldState } from "@chronica/shared";
import { opening } from "./fiscal-test-kit";
import { readPersonalTension } from "./narrator";

/** "Life has been going well for Libo: purse is full" was told every turn of a man condemned with 704 drachmae. */
const withPurse = (world: WorldState, id: string, balance: number): WorldState => {
  const purse = world.characters.find((c) => c.id === id)!.personalAccountId;
  return { ...world, material: { ...world.material, accounts: world.material.accounts.map((a) => (a.id === purse ? { ...a, balance } : a)) } };
};

describe("the line about a man's purse", () => {
  it("is as full as the purse is", () => {
    const world = opening(150);
    const id = "gaius-genucius";
    expect(readPersonalTension(withPurse(world, id, 704), id).summary).not.toMatch(/purse is full/);
    expect(readPersonalTension(withPurse(world, id, 0), id).summary).toMatch(/nearly empty/);
    expect(readPersonalTension(withPurse(world, id, 50_000), id).summary).toMatch(/purse is full/);
  });
});
