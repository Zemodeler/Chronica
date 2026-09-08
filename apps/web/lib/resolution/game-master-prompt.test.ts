import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { WorldState } from "@chronica/shared";
import { buildGameMasterSystemPrompt, type GameMasterPromptInput } from "./game-master-prompt";

const PLAYER = "marcus-atilius";

function world(): WorldState {
  return structuredClone(firstPunicWarScenario.initialWorld);
}

function baseInput(overrides: Partial<GameMasterPromptInput> = {}): GameMasterPromptInput {
  return {
    world: world(),
    actorCharacterId: PLAYER,
    atStep: 1,
    directives: [],
    selectedCharacters: [],
    playerContext: undefined,
    scenarioGovernment: undefined,
    scenarioChronicle: undefined,
    ...overrides,
  };
}

describe("world activity requirements", () => {
  it("uses relevance-derived activity allowances and recurring Roman politics", () => {
    const prompt = buildGameMasterSystemPrompt(baseInput());
    expect(prompt).toContain("ACTIVITY ALLOWANCES");
    expect(prompt).toContain("no shared world-action pool");
    expect(prompt).toContain("REGIONAL REACTION");
    expect(prompt).toContain("ROMAN REPUBLIC");
    expect(prompt).toMatch(/at least every second season/i);
  });
});

describe("capability escape hatch", () => {
  it("points to request_capability and omits define_action when invented actions are off (the default)", () => {
    const prompt = buildGameMasterSystemPrompt(baseInput());

    expect(prompt).toContain("request_capability");
    expect(prompt).not.toContain("define_action");
    expect(prompt).not.toContain("invoke_defined_action");
  });

  it("describes define_action/invoke_defined_action when allowInventedActions is on", () => {
    const prompt = buildGameMasterSystemPrompt(baseInput({ allowInventedActions: true }));

    expect(prompt).toContain("define_action");
    expect(prompt).toContain("invoke_defined_action");
    expect(prompt).toContain("request_capability");
  });
});

describe("open political procedures", () => {
  it("gives the Game Master the actual question under consideration, not an internal action id", () => {
    const prompt = buildGameMasterSystemPrompt(baseInput());

    expect(prompt).toContain("whether Hamilcar should command Carthaginian Army");
    expect(prompt).not.toContain("linkedWorkflowId");
  });
});
