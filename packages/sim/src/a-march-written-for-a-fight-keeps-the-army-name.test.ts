import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, type OrchestratorOutput, type WorldDelta } from "@chronica/shared";
import { approachFirst } from "./burst";

/**
 * The march the engine writes before a fight is a march and nothing else (docs/reports/consul-run-issues.md, H2): it was
 * written with `name: null`, and the world refused the whole batch -- "material.forces.0.name: expected string, received null".
 */
describe("a march written for a fight", () => {
  it("is a valid force_modify that names no new name", () => {
    const world = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
    const army = world.material.forces.find((force) => force.id === "roman-field-army")!;
    const enemy = world.material.forces.find((force) => force.id === "campanian-legion")!;
    expect(army.locationId).not.toBe(enemy.locationId);
    const engage = WorldDeltaSchema.parse({ op: "force_engage", forceRef: army.id, targetForceRef: enemy.id, posture: "offer_battle", tactic: null, reason: "Attack." });
    const output = { deltas: [engage], intent: { summary: "Attack.", domains: [], parts: [{ said: "Attack the Campanian legion.", acts: [0], goals: [], spend: null, factLocalIds: [], whyNot: null }] } } as unknown as OrchestratorOutput;
    const { output: written } = approachFirst({ output }, world);
    const march = written.deltas.find((delta): delta is Extract<WorldDelta, { op: "force_modify" }> => delta.op === "force_modify")!;
    expect(march.locationId).toBe(enemy.locationId);
    expect("name" in march).toBe(false);
    expect(WorldDeltaSchema.safeParse(march).success).toBe(true);
  });
});
