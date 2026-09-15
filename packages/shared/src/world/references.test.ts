import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { WorldStateSchema, type WorldState } from "./world-state";
import { findWorldReferenceViolations, referenceViolationsIntroduced } from "./references";

const world = (): WorldState => structuredClone(firstPunicWarScenario.initialWorld);

/** A snapshot carrying the dangling purse a pre-fix runtime character creation left behind. */
function withDanglingPurse(): WorldState {
  const base = world();
  return WorldStateSchema.parse({
    ...base,
    characters: base.characters.map((character, index) => index === 0 ? { ...character, personalAccountId: "account-never-opened" } : character),
  });
}

describe("findWorldReferenceViolations", () => {
  it("finds nothing in a well-formed scenario", () => {
    expect(findWorldReferenceViolations(world())).toEqual([]);
  });

  it("catches the ids Zod cannot: a purse, a province, a heir that do not exist", () => {
    const base = world();
    const broken = WorldStateSchema.parse({
      ...base,
      characters: base.characters.map((character, index) => index === 0
        ? { ...character, personalAccountId: "no-purse", locationProvinceId: "no-province", heirCharacterId: "no-heir" }
        : character),
    });

    // Zod is satisfied — these are all well-formed id strings.
    expect(WorldStateSchema.safeParse(broken).success).toBe(true);
    const violations = findWorldReferenceViolations(broken);
    expect(violations).toContain(`Character ${base.characters[0]!.id} references a missing account.`);
    expect(violations).toContain(`Character ${base.characters[0]!.id} references a missing province.`);
    expect(violations).toContain(`Character ${base.characters[0]!.id} references a missing heir.`);
  });
});

describe("referenceViolationsIntroduced", () => {
  it("reports only what a change actually broke", () => {
    const before = world();
    const after = withDanglingPurse();
    expect(referenceViolationsIntroduced(before, after)).toEqual([`Character ${before.characters[0]!.id} references a missing account.`]);
  });

  it("ignores breakage that was already there", () => {
    const already = withDanglingPurse();
    expect(referenceViolationsIntroduced(already, already)).toEqual([]);
  });
});
