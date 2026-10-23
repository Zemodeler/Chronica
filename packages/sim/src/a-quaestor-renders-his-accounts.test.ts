import { describe, expect, it } from "vitest";
import { actMarkOf, spendingAllowance } from "@chronica/shared";
import { renderTheAccounts, accountStyleOf } from "./close-of-office";
import { ending, government, holderOf, opening, withSkills } from "./accounts-test-kit";

/**
 * A quaestor renders his accounts.
 *
 * When a magistrate who handled the chest lays down his office his accounts are read: what he drew against his allowance, and what his charge ought to have
 * brought in against what reached the chest. A man whose books square is told so; one who drew past his allowance is told of it and loses a little standing;
 * and none of it asks the player anything.
 */
describe("a quaestor renders his accounts", () => {
  const world = opening(365);

  it("reads each power's accounts as its people did", () => {
    expect(accountStyleOf(world, "rome")).toBe("rationes");
    expect(accountStyleOf(world, "carthage")).toBe("examination");
    expect(accountStyleOf(world, "ptolemaic-egypt")).toBe("none");
    expect(accountStyleOf(world, "boii")).toBe("none");
  });

  it("finds that an honest quaestor's books square", () => {
    const man = holderOf(world, "roman-quaestor");
    const done = renderTheAccounts(ending(world, "roman-quaestor", man));
    expect(done.renderings).toHaveLength(1);
    expect(done.renderings[0]).toMatchObject({ manId: man.id, style: "rationes", gap: 0, found: 0, overdrawn: 0 });
    expect(done.world.answerable.filter((entry) => entry.characterId === man.id)).toEqual([]);
    expect(done.world.statecraft.log.at(-1)?.why).toMatch(/^accounts: .* they squared/);
    expect(done.world.characters.find((c) => c.id === man.id)!.prestigeBps).toBe(man.prestigeBps);
  });

  it("tells a consul who drew past his allowance, and lowers him a little", () => {
    const man = holderOf(world, "roman-consul");
    const allowance = spendingAllowance(world, "roman-consul", government.offices)!;
    expect(allowance.amount).toBeGreaterThan(0);
    const drawn = (allowance.amount ?? 0) + 5_000;
    const marked = { ...world, actMarks: [...world.actMarks, { polityId: "rome", act: "spending" as const, officeId: "roman-consul", byCharacterId: man.id, byOfficeId: "roman-consul", atStep: 300, sinceStep: 100, total: drawn }] };
    expect(actMarkOf(marked.actMarks, "rome", "spending", "roman-consul")?.total).toBe(drawn);
    const done = renderTheAccounts(ending(marked, "roman-consul", man));
    expect(done.renderings[0]).toMatchObject({ drew: drawn, overdrawn: 5_000 });
    expect(done.world.characters.find((c) => c.id === man.id)!.prestigeBps).toBeLessThan(man.prestigeBps);
    expect(done.world.answerable.find((entry) => entry.characterId === man.id)).toMatchObject({ kind: "breach", weight: 1 });
    expect(done.facts).toHaveLength(1);
    expect(done.facts[0]!.summary).toMatch(/more than his office allowed/);
  });

  it("does not count what the Senate decreed against a quaestor, who pays out on its word", () => {
    const man = holderOf(world, "roman-quaestor", 1);
    const marked = { ...world, actMarks: [...world.actMarks, { polityId: "rome", act: "spending" as const, officeId: "roman-quaestor", byCharacterId: null, byOfficeId: null, atStep: 300, sinceStep: 100, total: 90_000 }] };
    const done = renderTheAccounts(ending(marked, "roman-quaestor", man));
    expect(done.renderings[0]).toMatchObject({ drew: 90_000, overdrawn: 0 });
    expect(done.world.answerable.filter((entry) => entry.characterId === man.id)).toEqual([]);
  });

  it("asks nothing of a man whose charge handles no money", () => {
    const man = holderOf(world, "roman-tribune");
    const done = renderTheAccounts(ending(withSkills(world, {}), "roman-tribune", man));
    expect(done.renderings).toEqual([]);
  });

  it("is the same on every run", () => {
    const man = holderOf(world, "roman-quaestor", 2);
    const a = renderTheAccounts(ending(world, "roman-quaestor", man));
    const b = renderTheAccounts(ending(structuredClone(world), "roman-quaestor", man));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
