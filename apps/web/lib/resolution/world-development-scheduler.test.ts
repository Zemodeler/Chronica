import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { ensureProvinceMaterial, WorldStateSchema, type WorldState } from "@chronica/shared";
import { advanceWorldDevelopments, selectDevelopmentActors } from "./world-development-scheduler";

function fixture() {
  const world = ensureProvinceMaterial(structuredClone(firstPunicWarScenario.initialWorld), 0);
  const province = world.map.provinces.find(p => p.controllerPolityId === "carthage")!;
  world.material.provinceMaterial = world.material.provinceMaterial.map(p => p.provinceId === province.id ? { ...p, foodSecurityBps: 2_000 } : p);
  return { world, province };
}

describe("scheduled world developments", () => {
  it("persists a distant shortage, escalates it, and preserves replay and same-step idempotence", () => {
    const { world, province } = fixture();
    const initial = advanceWorldDevelopments(world, 1);
    expect(advanceWorldDevelopments(world, 1)).toEqual(initial);
    expect(world.worldDevelopments).toBeUndefined();
    expect(WorldStateSchema.safeParse(initial.world).success).toBe(true);
    const replay = advanceWorldDevelopments(initial.world, 1);
    expect(replay.world).toEqual(initial.world);
    expect(replay.events).toEqual([]);
    const later = advanceWorldDevelopments(WorldStateSchema.parse(initial.world), 2);
    const before = initial.world.worldDevelopments!.find(d => d.id === `scarcity:${province.id}`)!;
    const after = later.world.worldDevelopments!.find(d => d.id === before.id)!;
    expect(after.intensity).toBeGreaterThan(before.intensity);
    expect(after.createdAtStep).toBe(before.createdAtStep);
    expect(after.reviews).toBe(2);
    expect(later.world.characterPressures.some(p => p.characterId === after.actorId && p.label === after.summary && p.status === "active")).toBe(true);
  });

  it("clears the pressure when the source improves, and can reopen it without duplicate ids", () => {
    const { world, province } = fixture();
    const initial = advanceWorldDevelopments(world, 1).world;
    const shortage = initial.worldDevelopments!.find(d => d.id === `scarcity:${province.id}`)!;
    const pressure = initial.characterPressures.find(p => p.label === shortage.summary)!;
    const relieved: WorldState = { ...initial, material: { ...initial.material, provinceMaterial: initial.material.provinceMaterial.map(p => ({ ...p, foodSecurityBps: 8_000 })) } };
    const cleared = advanceWorldDevelopments(relieved, 2);
    expect(cleared.world.worldDevelopments!.find(d => d.id === shortage.id)?.status).toBe("resolved");
    expect(cleared.world.characterPressures.find(p => p.id === pressure.id)?.status).toBe("resolved");
    expect(cleared.world.characters.find(c => c.id === shortage.actorId)?.mind.currentPressures).not.toContain(pressure.id);
    cleared.world.material.provinceMaterial = cleared.world.material.provinceMaterial.map(p => p.provinceId === province.id ? { ...p, foodSecurityBps: 2_000 } : p);
    const reopened = advanceWorldDevelopments(cleared.world, 3).world;
    expect(reopened.worldDevelopments!.filter(d => d.id === shortage.id)).toHaveLength(1);
    expect(reopened.characterPressures.filter(p => p.id === pressure.id)).toHaveLength(1);
    expect(reopened.characterPressures.find(p => p.id === pressure.id)?.status).toBe("active");
    expect(WorldStateSchema.safeParse(reopened).success).toBe(true);
  });

  it("does not narrate unchanged institutional reviews as new crises", () => {
    const { world } = fixture();
    const first = advanceWorldDevelopments(world, 1);
    const later = advanceWorldDevelopments(first.world, 5);
    const civicIds = first.world.worldDevelopments!.filter(d => d.kind === "civic").map(d => d.id);
    expect(civicIds.length).toBeGreaterThan(0);
    expect(later.events.filter(e => civicIds.includes(String(e.parameters["developmentId"])))).toHaveLength(0);
    expect(later.world.worldDevelopments!.find(d => d.id === civicIds[0])!.reviews).toBe(2);
  });

  it("records continuing wars without needing a synthetic war entity id", () => {
    const { world } = fixture();
    world.conflicts.wars = [{ polityAId: "carthage", polityBId: "rome" }];
    const result = advanceWorldDevelopments(world, 1);
    expect(result.world.worldDevelopments!.filter(d => d.kind === "war_burden")).toHaveLength(2);
    expect(WorldStateSchema.safeParse(result.world).success).toBe(true);
  });

  it("keeps household needs out of the public event feed", () => {
    const { world, province } = fixture();
    const head = world.characters.find(c => c.alive)!;
    head.locationProvinceId = province.id;
    world.households = [{ id: "test-household", name: "Test Household", polityId: head.polityId, headCharacterId: head.id, active: true }];
    const result = advanceWorldDevelopments(world, 1);
    expect(result.world.worldDevelopments!.some(d => d.kind === "household")).toBe(true);
    expect(result.world.characterPressures.some(p => p.kind === "family_obligation" && p.visibility === "private")).toBe(true);
    expect(result.events.some(e => e.summary.includes("Test Household"))).toBe(false);
  });

  it("bounds reviews and eventually visits all due sources", () => {
    const { world } = fixture();
    const institution = world.material.institutions[0]!;
    world.material.institutions = Array.from({ length: 30 }, (_, i) => ({ ...institution, id: `institution-${i}`, name: `Council ${i}` }));
    let current = world;
    for (let step = 1; step <= 4; step++) {
      current = advanceWorldDevelopments(current, step).world;
      expect(current.worldDevelopments!.filter(d => d.lastReviewedStep === step).length).toBeLessThanOrEqual(12);
    }
    expect(current.worldDevelopments!.filter(d => d.kind === "civic")).toHaveLength(30);
  });

  it("reserves bounded NPC attention without choosing actions for the player", () => {
    const { world } = fixture();
    const result = advanceWorldDevelopments(world, 1).world;
    const playerId = result.worldDevelopments![0]!.actorId;
    const selected = selectDevelopmentActors(result, 1, playerId);
    expect(selected.length).toBeLessThanOrEqual(3);
    expect(selected.some(c => c.characterId === playerId)).toBe(false);
    expect(new Set(selected.map(c => c.characterId)).size).toBe(selected.length);
  });
});
