import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { deriveWorldInstant, type WorldState } from "@chronica/shared";
import { advanceWorldMatters } from "../advance";

function world(): WorldState {
  return structuredClone(firstPunicWarScenario.initialWorld);
}

function at(step: number) {
  return deriveWorldInstant(step);
}

describe("supply matter detector (docs/plans/ai-world-matters-runtime.md, Phase 5)", () => {
  it("produces exactly one matter for a force across 30 consecutive daily reviews, not one per day", () => {
    const w = world();
    w.material.forces = w.material.forces.map((f) => (f.id === "legio-i" ? { ...f, provisionStatus: "shortage" as const } : f));
    let current = w;
    for (let step = 1; step <= 30; step++) {
      current = advanceWorldMatters(current, at(step), step).world;
    }
    const supplyMatters = current.worldMatters!.filter((m) => m.kind === "supply_review" && m.sourceRef.id === "legio-i");
    expect(supplyMatters).toHaveLength(1);
    expect(supplyMatters[0]!.id).toBe("supply-review:legio-i");
  });

  it("detects a supply_review matter scoped to the force's own command authority", () => {
    const w = world();
    w.material.forces = w.material.forces.map((f) => (f.id === "legio-i" ? { ...f, provisionStatus: "critical" as const } : f));
    const result = advanceWorldMatters(w, at(1), 1);
    const matter = result.world.worldMatters!.find((m) => m.id === "supply-review:legio-i")!;
    expect(matter.status).toBe("overdue");
    expect(matter.requiredAuthority).toEqual([{ domain: "military", power: "command", scope: { kind: "force", id: "legio-i" } }]);
  });

  it("resolves the supply_review matter once provisioning is genuinely extended and status returns to provisioned", () => {
    const w = world();
    w.material.forces = w.material.forces.map((f) => (f.id === "legio-i" ? { ...f, provisionStatus: "shortage" as const, provisionedThroughStep: 1 } : f));
    const first = advanceWorldMatters(w, at(1), 1);
    expect(first.world.worldMatters!.some((m) => m.id === "supply-review:legio-i" && m.status !== "cancelled")).toBe(true);

    const resupplied = {
      ...first.world,
      material: {
        ...first.world.material,
        forces: first.world.material.forces.map((f) => (f.id === "legio-i" ? { ...f, provisionStatus: "provisioned" as const, provisionedThroughStep: 100 } : f)),
      },
    };
    const second = advanceWorldMatters(resupplied, at(2), 2);
    expect(second.world.worldMatters!.find((m) => m.id === "supply-review:legio-i")!.status).toBe("cancelled");
  });

  it("never mutates world.material.forces itself -- only a workflow may change provisionStatus/provisionedThroughStep", () => {
    const w = world();
    w.material.forces = w.material.forces.map((f) => (f.id === "legio-i" ? { ...f, provisionStatus: "critical" as const } : f));
    const before = structuredClone(w.material.forces);
    advanceWorldMatters(w, at(1), 1);
    expect(w.material.forces).toEqual(before);
  });
});
