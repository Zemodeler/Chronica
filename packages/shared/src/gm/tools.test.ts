import { describe, expect, it } from "vitest";
import { buildActionTools, buildGameMasterTools } from "./tools";

// Requirement 2: internal character-agency bookkeeping (goal/plot creation
// and advancement) must never be narrated as public history, and the surest
// way to guarantee that is to never hand it to the Game Master as a callable
// tool in the first place -- an unreported call to one of these could
// otherwise surface as a public Chronicle card via the "facts the report
// forgot" path.

const INTERNAL_AGENCY_ACTION_IDS = [
  "create_character_goal",
  "update_character_goal",
  "create_character_plot",
  "advance_character_plot",
  "resolve_character_plot",
];

describe("the Game Master's tool surface", () => {
  it("excludes internal character-agency bookkeeping actions entirely", () => {
    const toolNames = new Set(buildActionTools().map((tool) => tool.name));
    for (const actionId of INTERNAL_AGENCY_ACTION_IDS) {
      expect(toolNames.has(actionId)).toBe(false);
    }
  });

  it("excludes them from the full tool list handed to the model too", () => {
    const toolNames = new Set(buildGameMasterTools().map((tool) => tool.name));
    for (const actionId of INTERNAL_AGENCY_ACTION_IDS) {
      expect(toolNames.has(actionId)).toBe(false);
    }
  });
});
