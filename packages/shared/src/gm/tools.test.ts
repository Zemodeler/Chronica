import { describe, expect, it } from "vitest";
import { buildActionTools, buildGameMasterTools } from "./tools";

const CHARACTER_AGENCY_ACTION_IDS = [
  "create_character_goal",
  "update_character_goal",
  "create_character_plot",
  "advance_character_plot",
  "resolve_character_plot",
];

describe("the Game Master's tool surface", () => {
  it("exposes character-agency actions to the Game Master", () => {
    const toolNames = new Set(buildActionTools().map((tool) => tool.name));
    for (const actionId of CHARACTER_AGENCY_ACTION_IDS) {
      expect(toolNames.has(actionId)).toBe(true);
    }
  });

  it("includes them in the full tool list handed to the model", () => {
    const toolNames = new Set(buildGameMasterTools().map((tool) => tool.name));
    for (const actionId of CHARACTER_AGENCY_ACTION_IDS) {
      expect(toolNames.has(actionId)).toBe(true);
    }
  });
});
