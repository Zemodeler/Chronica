import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { WorldStateSchema, type WorldDevelopment, type WorldState } from "@chronica/shared";
import { matterPressureId } from "./identity";
import { upgradeWorldDevelopmentsToMatters } from "./migration";

const ACTIVE_DEV: WorldDevelopment = {
  id: "scarcity:sicily",
  kind: "scarcity",
  sourceId: "sicily",
  actorId: "hanno",
  provinceId: "sicily",
  summary: "Food insecurity in Sicily puts relief and provisioning before Hanno.",
  status: "active",
  intensity: 62,
  reviews: 3,
  createdAtStep: 1,
  lastReviewedStep: 4,
  nextReviewStep: 5,
};

const RESOLVED_DEV: WorldDevelopment = {
  id: "civic:senate-1",
  kind: "civic",
  sourceId: "senate-1",
  actorId: "scipio",
  provinceId: null,
  summary: "The Senate's recurring public business places readiness before Scipio.",
  status: "resolved",
  intensity: 0,
  reviews: 2,
  createdAtStep: 1,
  lastReviewedStep: 6,
  nextReviewStep: 6,
};

function fixture(developments: WorldDevelopment[]): WorldState {
  const world = structuredClone(firstPunicWarScenario.initialWorld) as WorldState;
  return {
    ...world,
    worldDevelopments: developments,
    // Simulates a pressure the legacy scheduler already created for
    // ACTIVE_DEV, at the exact id it would have derived.
    characterPressures: [
      {
        id: matterPressureId(ACTIVE_DEV.id),
        characterId: ACTIVE_DEV.actorId,
        kind: "political_danger",
        intensity: ACTIVE_DEV.intensity,
        label: ACTIVE_DEV.summary,
        sourceEventId: null,
        createdAtStep: ACTIVE_DEV.createdAtStep,
        reviewAtStep: ACTIVE_DEV.nextReviewStep,
        expiresAtStep: null,
        visibility: "public",
        status: "active",
      },
    ],
  };
}

describe("upgradeWorldDevelopmentsToMatters", () => {
  it("is a no-op when there are no legacy developments", () => {
    const world = structuredClone(firstPunicWarScenario.initialWorld) as WorldState;
    expect(upgradeWorldDevelopmentsToMatters(world)).toBe(world);
  });

  it("upgrades an active development into an equivalent due matter, preserving the exact legacy pressure id", () => {
    const world = fixture([ACTIVE_DEV]);
    const preMigrationPressureId = world.characterPressures[0]!.id;

    const upgraded = upgradeWorldDevelopmentsToMatters(world);
    const matter = upgraded.worldMatters!.find((m) => m.id === ACTIVE_DEV.id)!;

    expect(matter).toBeDefined();
    expect(matter.kind).toBe("scarcity");
    expect(matter.sourceRef).toEqual({ kind: "province", id: ACTIVE_DEV.sourceId });
    expect(matter.status).toBe("due");
    expect(matter.summary).toBe(ACTIVE_DEV.summary);
    expect(matter.intensity).toBe(ACTIVE_DEV.intensity);
    expect(matter.reviews).toBe(ACTIVE_DEV.reviews);
    expect(matter.provinceId).toBe(ACTIVE_DEV.provinceId);
    expect(matter.createdAtStep).toBe(ACTIVE_DEV.createdAtStep);
    expect(matter.lastReviewedStep).toBe(ACTIVE_DEV.lastReviewedStep);
    expect(matter.nextReviewStep).toBe(ACTIVE_DEV.nextReviewStep);
    expect(matter.offers).toHaveLength(1);
    expect(matter.offers[0]).toMatchObject({ actorRef: { kind: "character", id: ACTIVE_DEV.actorId }, role: "responsible", outcome: "no_action" });

    // The single highest-risk detail: the migrated matter must point at the
    // SAME pressure row the legacy scheduler already created, not a new one.
    expect(matter.pressureId).toBe(preMigrationPressureId);

    expect(WorldStateSchema.safeParse(upgraded).success).toBe(true);
  });

  it("upgrades a resolved development into an addressed matter with a placeholder resolution fact", () => {
    const world = fixture([RESOLVED_DEV]);
    const upgraded = upgradeWorldDevelopmentsToMatters(world);
    const matter = upgraded.worldMatters!.find((m) => m.id === RESOLVED_DEV.id)!;
    expect(matter.status).toBe("addressed");
    expect(matter.resolutionFactIds).toEqual([`migrated:${RESOLVED_DEV.id}`]);
    expect(WorldStateSchema.safeParse(upgraded).success).toBe(true);
  });

  it("is idempotent: calling it twice produces zero new or changed matters", () => {
    const world = fixture([ACTIVE_DEV, RESOLVED_DEV]);
    const once = upgradeWorldDevelopmentsToMatters(world);
    const twice = upgradeWorldDevelopmentsToMatters(once);
    expect(twice).toBe(once);
    expect(twice.worldMatters).toHaveLength(2);
  });

  it("leaves world.worldDevelopments untouched", () => {
    const world = fixture([ACTIVE_DEV]);
    const upgraded = upgradeWorldDevelopmentsToMatters(world);
    expect(upgraded.worldDevelopments).toBe(world.worldDevelopments);
  });
});
