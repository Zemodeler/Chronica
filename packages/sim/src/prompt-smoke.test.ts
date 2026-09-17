import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { ORCHESTRATOR_SYSTEM_PROMPT } from "./orchestrate";
import { buildWorldSlice, renderWorldSlice } from "./slice";

describe("orchestrator prompt", () => {
  it("renders the contract's JSON schema without throwing", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("money_transfer");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("localId");
  });

  it("stays small enough to send on every call", () => {
    // Roughly 4 characters per token. The system prompt is sent every burst
    // iteration, so a schema that balloons is a per-call tax forever.
    console.log("system prompt chars:", ORCHESTRATOR_SYSTEM_PROMPT.length, "~tokens:", Math.round(ORCHESTRATOR_SYSTEM_PROMPT.length / 4));
    expect(ORCHESTRATOR_SYSTEM_PROMPT.length).toBeLessThan(40_000);
  });
});

describe("the world slice", () => {
  it("stays small enough to send with every order", () => {
    const clock = ScenarioDefinitionSchema.parse(punicWarsScenario.definition).clock;
    const world: WorldState = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
    const text = renderWorldSlice(
      buildWorldSlice({
        world,
        clock,
        actorRef: { kind: "character", id: world.characters[0]!.id },
        actorPolityId: "rome",
        orderText: "Invade the Boii lands",
        facts: [],
        dueEvents: [],
        pendingEvents: [],
      }),
    );

    // Roughly 4 characters per token. The slice grows every time the world
    // learns to show something new, and each section is paid for on every
    // orchestration call. A section that pushes past this should have its cap
    // tightened rather than the budget raised.
    console.log("slice chars:", text.length, "~tokens:", Math.round(text.length / 4));
    expect(Math.round(text.length / 4)).toBeLessThan(6_000);
  });
});
