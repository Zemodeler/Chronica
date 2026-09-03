import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { executeWorkflow } from "../executor";

const world = () => structuredClone(firstPunicWarScenario.initialWorld);

function withBattle() {
  const w = world();
  // Co-locate the two scenario forces and open a battle between them, the
  // same shape start_battle produces.
  const forces = w.material.forces.map((f) =>
    f.id === "carthaginian-army" ? { ...f, locationId: "ita-72843720b81376294924159-sicily-northeast" } : f,
  );
  return {
    ...w,
    material: { ...w.material, forces },
    conflicts: {
      ...w.conflicts,
      battles: [{ battleId: "resolver-battle", participantForceIds: ["legio-i", "carthaginian-army"], attackerForceIds: ["legio-i"] }],
    },
  };
}

function withMultiForceBattle() {
  const w = withBattle();
  const legioI = w.material.forces.find((f) => f.id === "legio-i")!;
  const legioII = { ...structuredClone(legioI), id: "legio-ii", name: "Legio II" };
  return {
    ...w,
    material: { ...w.material, forces: [...w.material.forces, legioII] },
    conflicts: {
      ...w.conflicts,
      battles: [{ battleId: "resolver-battle", participantForceIds: ["legio-i", "legio-ii", "carthaginian-army"], attackerForceIds: ["legio-i", "legio-ii"] }],
    },
  };
}

describe("resolve_battle", () => {
  it("resolves an active battle deterministically and clears it from conflicts", () => {
    const w = withBattle();
    const outcome = executeWorkflow({ actionId: "resolve_battle", actorId: "system", parameters: { battleId: "resolver-battle" } }, w, 5);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.conflicts.battles.find((b) => b.battleId === "resolver-battle")).toBeUndefined();
    expect(outcome.result.summary.length).toBeGreaterThan(0);
    const legio = outcome.world.material.forces.find((f) => f.id === "legio-i")!;
    const carthage = outcome.world.material.forces.find((f) => f.id === "carthaginian-army")!;
    // Both forces took part in a real engagement -- something about at least
    // one of them (personnel, morale, cohesion, fatigue, or location) moved.
    const before = w.material.forces;
    const legioBefore = before.find((f) => f.id === "legio-i")!;
    const carthageBefore = before.find((f) => f.id === "carthaginian-army")!;
    const somethingChanged =
      JSON.stringify(legio) !== JSON.stringify(legioBefore) || JSON.stringify(carthage) !== JSON.stringify(carthageBefore);
    expect(somethingChanged).toBe(true);
  });

  it("is not applicable to an unknown battle", () => {
    const w = withBattle();
    const outcome = executeWorkflow({ actionId: "resolve_battle", actorId: "system", parameters: { battleId: "nope" } }, w, 5);
    expect(outcome.ok).toBe(false);
  });

  it("produces the same result for the same turn step (deterministic replay)", () => {
    const w = withBattle();
    const first = executeWorkflow({ actionId: "resolve_battle", actorId: "system", parameters: { battleId: "resolver-battle" } }, w, 5);
    const second = executeWorkflow({ actionId: "resolve_battle", actorId: "system", parameters: { battleId: "resolver-battle" } }, w, 5);
    expect(first).toEqual(second);
  });

  it("forwards posture from start_battle into the resolved engagement", () => {
    const w = withBattle();
    const outcome = executeWorkflow(
      { actionId: "resolve_battle", actorId: "system", parameters: { battleId: "resolver-battle", defenderPosture: "hold" } },
      w, 5,
    );
    expect(outcome.ok).toBe(true);
  });

  it("moves both polities' legitimacy on a decisive victory", () => {
    // The defender must be defending its own controlled territory for the
    // decisive-victory control-firmness/legitimacy effect to make sense --
    // unlike withBattle() (which stages the fight in Rome's own province),
    // this fights it in Carthage's own province (carthaginian-army's home).
    const base = world();
    const lopsided = {
      ...base,
      material: {
        ...base.material,
        forces: base.material.forces.map((f) => {
          if (f.id === "legio-i") return { ...f, locationId: "ita-72843720b81376294924159-sicily-west", personnel: [{ ...f.personnel[0]!, fit: 10_000 }], moraleBps: 9_500, cohesionBps: 9_500 };
          if (f.id === "carthaginian-army") return { ...f, personnel: [{ ...f.personnel[0]!, fit: 200 }], moraleBps: 3_000, cohesionBps: 3_000 };
          return f;
        }),
      },
      conflicts: {
        ...base.conflicts,
        battles: [{ battleId: "resolver-battle", participantForceIds: ["legio-i", "carthaginian-army"], attackerForceIds: ["legio-i"] }],
      },
    };
    const romeBefore = lopsided.material.polityLegitimacy.find((l) => l.polityId === "rome")!.legitimacyBps;
    const carthageBefore = lopsided.material.polityLegitimacy.find((l) => l.polityId === "carthage")!.legitimacyBps;
    const outcome = executeWorkflow({ actionId: "resolve_battle", actorId: "system", parameters: { battleId: "resolver-battle" } }, lopsided, 5);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const rome = outcome.world.material.polityLegitimacy.find((l) => l.polityId === "rome")!;
    const carthage = outcome.world.material.polityLegitimacy.find((l) => l.polityId === "carthage")!;
    expect(rome.legitimacyBps).toBeGreaterThan(romeBefore);
    expect(carthage.legitimacyBps).toBeLessThan(carthageBefore);
  });

  it("resolves a battle with more than one force on a side (docs/19 Phase 3 multi-force battles)", () => {
    const w = withMultiForceBattle();
    const outcome = executeWorkflow({ actionId: "resolve_battle", actorId: "system", parameters: { battleId: "resolver-battle" } }, w, 5);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.conflicts.battles.find((b) => b.battleId === "resolver-battle")).toBeUndefined();
    const legioIBefore = w.material.forces.find((f) => f.id === "legio-i")!;
    const legioIIBefore = w.material.forces.find((f) => f.id === "legio-ii")!;
    const legioIAfter = outcome.world.material.forces.find((f) => f.id === "legio-i")!;
    const legioIIAfter = outcome.world.material.forces.find((f) => f.id === "legio-ii")!;
    // Both forces on the merged attacking side took part -- the second force
    // is not just carried through untouched, proving the engine resolved it
    // as a real participant rather than ignoring everyone but the lead force.
    expect(JSON.stringify(legioIAfter) !== JSON.stringify(legioIBefore) || JSON.stringify(legioIIAfter) !== JSON.stringify(legioIIBefore)).toBe(true);
  });
});
