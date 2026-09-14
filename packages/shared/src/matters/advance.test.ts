import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { deriveWorldInstant, ensureProvinceMaterial, WorldStateSchema, type WorldState } from "@chronica/shared";
import { advanceWorldMatters, MAX_MATTER_REVIEWS_PER_INSTANT } from "./advance";

// Ports every case from the old `world-development-scheduler.test.ts` that
// has a Phase 1 analog against `advanceWorldMatters` (docs/plans/
// ai-world-matters-runtime.md, Phase 1 -- "the replay-safety proof"). The
// old suite's 7th case ("reserves bounded NPC attention...") exercises
// `selectDevelopmentActors`, which still reads `world.worldDevelopments`
// unchanged this phase -- it stays in `world-development-scheduler.test.ts`,
// now built from a hand-written fixture instead of the deleted
// `advanceWorldDevelopments`. Assertions that read a `CharacterPressure`
// are adapted to read the matter's own state instead: `advanceWorldMatters`
// is pure lifecycle/detection and, per the plan, does not touch
// `CharacterPressure` at all -- that bookkeeping now lives in
// `apps/web/lib/resolution/matters/matter-scheduler.ts`, a web-layer
// wrapper outside this package's pure contract.

function fixture() {
  const world = ensureProvinceMaterial(structuredClone(firstPunicWarScenario.initialWorld), 0);
  const province = world.map.provinces.find((p) => p.controllerPolityId === "carthage")!;
  world.material.provinceMaterial = world.material.provinceMaterial.map((p) => (p.provinceId === province.id ? { ...p, foodSecurityBps: 2_000 } : p));
  return { world, province };
}

function at(step: number) {
  return deriveWorldInstant(step);
}

describe("advanceWorldMatters", () => {
  it("persists a distant shortage, escalates it, and preserves replay and same-step idempotence", () => {
    const { world, province } = fixture();
    const initial = advanceWorldMatters(world, at(1), 1);
    expect(advanceWorldMatters(world, at(1), 1)).toEqual(initial);
    expect(world.worldMatters).toBeUndefined();
    expect(WorldStateSchema.safeParse(initial.world).success).toBe(true);

    const replay = advanceWorldMatters(initial.world, at(1), 1);
    expect(replay.world).toEqual(initial.world);
    expect(replay.events).toEqual([]);

    const later = advanceWorldMatters(WorldStateSchema.parse(initial.world), at(2), 2);
    const before = initial.world.worldMatters!.find((m) => m.id === `scarcity:${province.id}`)!;
    const after = later.world.worldMatters!.find((m) => m.id === before.id)!;
    expect(after.intensity).toBeGreaterThan(before.intensity);
    expect(after.urgency).toBe(after.intensity);
    expect(after.createdAtStep).toBe(before.createdAtStep);
    expect(after.createdAt).toEqual(before.createdAt);
    expect(after.reviews).toBe(2);
    expect(after.status).toBe("due");
  });

  it("clears the matter when the source improves, and can reopen it without duplicate ids", () => {
    const { world, province } = fixture();
    const initial = advanceWorldMatters(world, at(1), 1).world;
    const shortage = initial.worldMatters!.find((m) => m.id === `scarcity:${province.id}`)!;
    const relieved: WorldState = { ...initial, material: { ...initial.material, provinceMaterial: initial.material.provinceMaterial.map((p) => ({ ...p, foodSecurityBps: 8_000 })) } };
    const cleared = advanceWorldMatters(relieved, at(2), 2);
    expect(cleared.world.worldMatters!.find((m) => m.id === shortage.id)?.status).toBe("cancelled");

    const reopenedWorld = { ...cleared.world, material: { ...cleared.world.material, provinceMaterial: cleared.world.material.provinceMaterial.map((p) => (p.provinceId === province.id ? { ...p, foodSecurityBps: 2_000 } : p)) } };
    const reopened = advanceWorldMatters(reopenedWorld, at(3), 3).world;
    expect(reopened.worldMatters!.filter((m) => m.id === shortage.id)).toHaveLength(1);
    expect(reopened.worldMatters!.find((m) => m.id === shortage.id)?.status).toBe("due");
    expect(WorldStateSchema.safeParse(reopened).success).toBe(true);
  });

  it("does not narrate unchanged institutional reviews as new crises", () => {
    const { world } = fixture();
    const first = advanceWorldMatters(world, at(1), 1);
    const later = advanceWorldMatters(first.world, at(5), 5);
    const civicIds = first.world.worldMatters!.filter((m) => m.kind === "civic").map((m) => m.id);
    expect(civicIds.length).toBeGreaterThan(0);
    expect(later.events.filter((e) => civicIds.includes(String(e.parameters["matterId"])))).toHaveLength(0);
    expect(later.world.worldMatters!.find((m) => m.id === civicIds[0])!.reviews).toBe(2);
  });

  it("records continuing wars without needing a synthetic war entity id", () => {
    const { world } = fixture();
    world.conflicts.wars = [{ polityAId: "carthage", polityBId: "rome" }];
    const result = advanceWorldMatters(world, at(1), 1);
    expect(result.world.worldMatters!.filter((m) => m.kind === "war_burden")).toHaveLength(2);
    expect(WorldStateSchema.safeParse(result.world).success).toBe(true);
  });

  it("keeps household needs out of the public event feed", () => {
    const { world, province } = fixture();
    const head = world.characters.find((c) => c.alive)!;
    head.locationProvinceId = province.id;
    world.households = [{ id: "test-household", name: "Test Household", polityId: head.polityId, headCharacterId: head.id, active: true }];
    const result = advanceWorldMatters(world, at(1), 1);
    const household = result.world.worldMatters!.find((m) => m.kind === "household");
    expect(household).toBeDefined();
    expect(household!.visibility).toBe("private");
    expect(result.events.some((e) => e.summary.includes("Test Household"))).toBe(false);
  });

  it("bounds reviews and eventually visits all due sources", () => {
    const { world } = fixture();
    const institution = world.material.institutions[0]!;
    world.material.institutions = Array.from({ length: 30 }, (_, i) => ({ ...institution, id: `institution-${i}`, name: `Council ${i}` }));
    let current = world;
    for (let step = 1; step <= 4; step++) {
      current = advanceWorldMatters(current, at(step), step).world;
      expect(current.worldMatters!.filter((m) => m.lastReviewedStep === step).length).toBeLessThanOrEqual(MAX_MATTER_REVIEWS_PER_INSTANT);
    }
    expect(current.worldMatters!.filter((m) => m.kind === "civic")).toHaveLength(30);
  });
});
