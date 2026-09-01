import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { applyInventedWorkflow, type InventedWorkflowDefinition } from "./invented-workflow";

const definition: InventedWorkflowDefinition = {
  actionId: "set_character_health",
  intent: "Set a character's health from a grounded event.",
  description: "Updates one existing character's health.",
  parameters: [
    { name: "characterId", type: "entity_id", required: true },
    { name: "healthBps", type: "number", required: true },
  ],
  operations: [{ op: "replace", path: "/characters[id={{characterId}}]/healthBps", value: "{{healthBps}}" }],
  invokerAuthority: ["player"],
};

describe("invented workflow patches", () => {
  it("adds a schema-valid entity through a JSON parameter", () => {
    const world = structuredClone(firstPunicWarScenario.initialWorld);
    const addStoryline: InventedWorkflowDefinition = {
      ...definition,
      actionId: "add_storyline",
      parameters: [{ name: "storyline", type: "json", required: true }],
      operations: [{ op: "add", path: "/storylines/-", value: "{{storyline}}" }],
    };
    const outcome = applyInventedWorkflow(addStoryline, world, {
      storyline: {
        id: "invented-storyline", title: "A new pressure", participantIds: [world.characters[0]!.id], provinceId: null,
        phase: "opening", stakes: "Control", history: ["Created by test"], nextDevelopment: "Observe", visibility: "public", updatedAtStep: 1,
      },
    });
    expect("world" in outcome).toBe(true);
    if ("world" in outcome) expect(outcome.world.storylines?.find((storyline) => storyline.id === "invented-storyline")).toBeDefined();
  });

  it("reuses one parameterized template for different entities", () => {
    const world = structuredClone(firstPunicWarScenario.initialWorld);
    const firstId = world.characters[0]!.id;
    const secondId = world.characters[1]!.id;
    const first = applyInventedWorkflow(definition, world, { characterId: firstId, healthBps: 7_500 });
    expect("world" in first).toBe(true);
    if (!("world" in first)) return;
    const second = applyInventedWorkflow(definition, first.world, { characterId: secondId, healthBps: 6_500 });
    expect("world" in second).toBe(true);
    if (!("world" in second)) return;
    expect(second.world.characters.find((character) => character.id === firstId)?.healthBps).toBe(7_500);
    expect(second.world.characters.find((character) => character.id === secondId)?.healthBps).toBe(6_500);
  });

  it("rejects protected state and leaves the input untouched", () => {
    const world = structuredClone(firstPunicWarScenario.initialWorld);
    const unsafe: InventedWorkflowDefinition = { ...definition, actionId: "rewrite_clock", operations: [{ op: "replace", path: "/elapsedStep", value: 99 }] };
    const outcome = applyInventedWorkflow(unsafe, world, { characterId: world.characters[0]!.id, healthBps: 1 });
    expect(outcome).toEqual(expect.objectContaining({ error: expect.stringContaining("protected") }));
    expect(world.elapsedStep).toBe(firstPunicWarScenario.initialWorld.elapsedStep);
  });

  it("rejects a destructive patch that violates world references", () => {
    const world = structuredClone(firstPunicWarScenario.initialWorld);
    const remove: InventedWorkflowDefinition = {
      ...definition,
      actionId: "remove_map",
      parameters: [],
      operations: [{ op: "remove", path: "/map" }],
    };
    const outcome = applyInventedWorkflow(remove, world, {});
    expect(outcome).toEqual(expect.objectContaining({ error: expect.stringContaining("invalid world") }));
  });
});
