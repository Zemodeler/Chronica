import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { stillStands } from "./burst";

/**
 * "Senate Reaches First Deadline for Its 150-Ship Fleet" was chronicled on
 * 6 May, three weeks after the Senate voted the fleet down and the work was
 * cancelled: the orchestrator had scheduled the first stage as an event of
 * its own, and every due event was made a fact.
 */

const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);

describe("an event whose moment comes", () => {
  it("is not fired when it only restates a work's stage, which the tick reports itself", () => {
    expect(stillStands(opening(), { kind: "project_milestone", payload: { subjectIds: ["rome"] } })).toBe(false);
  });

  it("is not fired when the question it waited on has been settled", () => {
    const world = opening();
    const procedure = world.material.politicalProcedures[0];
    if (procedure === undefined) return;
    const settled: WorldState = { ...world, material: { ...world.material, politicalProcedures: world.material.politicalProcedures.map((candidate) => (candidate.id === procedure.id ? { ...candidate, stage: "resolved" as const } : candidate)) } };
    expect(stillStands(settled, { kind: "vote_due", payload: { subjectIds: [procedure.id] } })).toBe(false);
  });

  it("still fires when its matter stands", () => {
    expect(stillStands(opening(), { kind: "envoy_arrives", payload: { subjectIds: ["rome"] } })).toBe(true);
  });
});
