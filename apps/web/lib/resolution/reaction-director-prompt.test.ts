import { describe, expect, it } from "vitest";
import type { Verdict } from "@chronica/shared";
import { shouldRunReactionDirector } from "./reaction-director-prompt";

function verdict(overrides: Partial<Verdict> = {}): Verdict {
  return {
    directiveId: "directive-1",
    outcome: "succeeds",
    obstacles: [{ source: "test", weight: "trivial", reason: "Test fixture." }],
    deltas: [],
    tacticalModifiers: [],
    timeCost: { min: 1, max: 1 },
    rationale: "Test verdict.",
    knowledgeVisibility: "public",
    playerInvolvement: [{ playerId: "player-1", characterId: "character-1", role: "actor" }],
    ...overrides,
  };
}

describe("shouldRunReactionDirector", () => {
  it("wakes for a public impossible player order even without a state delta", () => {
    expect(shouldRunReactionDirector([verdict({ outcome: "impossible" })])).toBe(true);
  });

  it("does not wake for a private impossible player order", () => {
    expect(shouldRunReactionDirector([verdict({ outcome: "impossible", knowledgeVisibility: "private" })])).toBe(false);
  });

  it("does not wake for a public successful order with no consequence", () => {
    expect(shouldRunReactionDirector([verdict()])).toBe(false);
  });
});
