import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { WorldState } from "../world/world-state";
import { WORKFLOW_REGISTRY } from "../workflows/registry";
import { commandKindOf } from "../workflows/types";
import { buildAutoWrappedWorldTools, buildWorldToolFromWorkflow } from "./auto-wrap";
import { ALL_WORLD_TOOLS, buildWorldToolCatalog } from "./catalog";
import { executeWorldTool } from "./executor";

function world(): WorldState {
  return structuredClone(firstPunicWarScenario.initialWorld);
}

const AGENT_CALLABLE_WORKFLOW_IDS = [...WORKFLOW_REGISTRY.values()].filter((d) => commandKindOf(d) !== "system_effect").map((d) => d.id);

describe("buildAutoWrappedWorldTools (rework: every workflow gets a world-tool)", () => {
  it("covers every agent-callable workflow not already claimed by a curated tool", () => {
    const catalogIds = new Set(ALL_WORLD_TOOLS.map((tool) => tool.id));
    const missing = AGENT_CALLABLE_WORKFLOW_IDS.filter((id) => !catalogIds.has(id));
    expect(missing).toEqual([]);
  });

  it("never produces a duplicate id against the curated set it was told to exclude", () => {
    const curatedIds = new Set(["create_force", "change_occupation", "change_administration"]);
    const wrapped = buildAutoWrappedWorldTools(curatedIds);
    expect(wrapped.some((tool) => curatedIds.has(tool.id))).toBe(false);
  });

  it("excludes system_effect workflows (deterministic-only, never agent-callable)", () => {
    const systemOnlyId = [...WORKFLOW_REGISTRY.values()].find((d) => commandKindOf(d) === "system_effect")?.id;
    if (systemOnlyId === undefined) return; // no system_effect workflow in this registry snapshot -- nothing to assert
    const wrapped = buildAutoWrappedWorldTools(new Set());
    expect(wrapped.some((tool) => tool.id === systemOnlyId)).toBe(false);
  });

  it("the whole catalog has no duplicate ids", () => {
    const ids = ALL_WORLD_TOOLS.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("wraps a workflow so it dispatches through the real executeWorkflow", () => {
    const definition = WORKFLOW_REGISTRY.get("raise_morale")!;
    const tool = buildWorldToolFromWorkflow(definition);
    const w = world();
    const forceId = w.material.forces[0]!.id;
    const outcome = executeWorldTool(tool, w, { forceId, deltaBps: 500 }, { actorId: "test-actor", atStep: 1 });
    expect(outcome.ok).toBe(true);
  });

  it("carries over an authority requirement for a tagged workflow (assign_command)", () => {
    const definition = WORKFLOW_REGISTRY.get("assign_command")!;
    const tool = buildWorldToolFromWorkflow(definition);
    expect(tool.authorityRequirement).toBeDefined();
    const requirement = tool.authorityRequirement!({ forceId: "legio-i", commanderCharacterId: "marcus-atilius" }, { actorId: "marcus-atilius", atStep: 1 });
    expect(requirement).toEqual({ domain: "military", power: "command", scope: { kind: "force", id: "legio-i" } });
  });
});

describe("buildWorldToolCatalog with the full rework", () => {
  it("lists a large, uniform catalog with no duplicate names", () => {
    const catalog = buildWorldToolCatalog();
    const names = catalog.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
    expect(catalog.length).toBeGreaterThan(50);
  });
});
