import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { executeWorkflow } from "../workflows/executor";
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

describe("the executor's reference guard", () => {
  it("still applies a workflow to a snapshot that arrived already broken", () => {
    // A game committed before the purse fix must stay playable. The guard is a
    // delta, so inherited breakage never blocks an unrelated action.
    const broken = withDanglingPurse();
    const force = broken.material.forces[0]!;
    const outcome = executeWorkflow(
      { actionId: "army_change_name", actorId: "marcus-atilius", parameters: { forceId: force.id, newName: "Legio Renamed" } },
      broken,
      1,
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.material.forces.find((candidate) => candidate.id === force.id)?.name).toBe("Legio Renamed");
  });

  it("lets every registered workflow that creates a character keep the world whole", () => {
    const created = executeWorkflow({
      actionId: "create_world_character",
      actorId: "marcus-atilius",
      parameters: {
        characterId: "char-guarded",
        name: "Titus Verginius",
        polityId: "rome",
        locationProvinceId: "ita-local-23120603B86473916475875",
        officeId: null,
        provenance: { reason: "Checking the guard end to end.", storylineId: null, createdByDirector: true },
      },
    }, world(), 1);

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(findWorldReferenceViolations(created.world)).toEqual([]);
  });
});
