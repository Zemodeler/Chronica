import { describe, expect, it } from "vitest";
import { deriveChronicleDepth, chronicleWordBudget } from "./depth";

describe("deriveChronicleDepth", () => {
  it("gives the player's own action a scene regardless of relevance scoring", () => {
    expect(deriveChronicleDepth({ playerRelevance: "none", materialConsequence: false, isPlayerAction: true })).toBe("scene");
  });

  it("gives a major event a scene even from a background director", () => {
    expect(deriveChronicleDepth({ playerRelevance: "low", materialConsequence: true, isPlayerAction: false, isMajorEvent: true })).toBe("scene");
  });

  it("gives a high-relevance background event a scene", () => {
    expect(deriveChronicleDepth({ playerRelevance: "high", materialConsequence: false, isPlayerAction: false })).toBe("scene");
  });

  it("gives a medium-relevance or consequential background event a paragraph", () => {
    expect(deriveChronicleDepth({ playerRelevance: "medium", materialConsequence: false, isPlayerAction: false })).toBe("paragraph");
    expect(deriveChronicleDepth({ playerRelevance: "low", materialConsequence: true, isPlayerAction: false })).toBe("paragraph");
  });

  it("compresses a low-relevance, consequence-free event to a dispatch", () => {
    expect(deriveChronicleDepth({ playerRelevance: "low", materialConsequence: false, isPlayerAction: false })).toBe("dispatch");
    expect(deriveChronicleDepth({ playerRelevance: "none", materialConsequence: false, isPlayerAction: false })).toBe("dispatch");
  });
});

describe("chronicleWordBudget", () => {
  it("increases strictly from dispatch to paragraph to scene", () => {
    expect(chronicleWordBudget("dispatch").max).toBeLessThan(chronicleWordBudget("paragraph").min + chronicleWordBudget("paragraph").max);
    expect(chronicleWordBudget("paragraph").max).toBeLessThan(chronicleWordBudget("scene").max);
  });
});
