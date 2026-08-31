import { describe, expect, it } from "vitest";
import { relationshipLabelForScore, scoreForDeclaredConnection } from "./relationship-score";

describe("NPC relationship scores", () => {
  it("uses relationship history rather than starting every NPC at neutral", () => {
    expect(scoreForDeclaredConnection("estranged brother", "He blames you for the inheritance dispute.")).toBeLessThan(0);
    expect(scoreForDeclaredConnection("younger sister", "A trusted member of the household.")).toBeGreaterThan(0);
  });

  it("keeps labels aligned with the current opinion score", () => {
    expect(relationshipLabelForScore(65)).toBe("friendly");
    expect(relationshipLabelForScore(-55)).toBe("resentful");
  });
});
