import { describe, expect, it } from "vitest";
import { coinDifference, purseIsSpent } from "./use-game-view";

describe("what the last order cost", () => {
  it("subtracts in millionths, so 0.3 is never 0.29999", () => {
    expect(coinDifference("1.3", "1")).toBe("0.3");
    expect(coinDifference("2.000314", "1.9")).toBe("0.1");
    expect(coinDifference("0.4567", "0.1")).toBe("0.357");
  });

  it("gives whole coins without a fraction, and never a negative cost", () => {
    expect(coinDifference("3", "1")).toBe("2");
    expect(coinDifference("1", "1")).toBe("0");
    expect(coinDifference("0.5", "1")).toBe("0");
  });
});

describe("a spent purse", () => {
  it("is an empty wallet or a save at its cap", () => {
    expect(purseIsSpent({ available: "0", spent: "1", cap: "5" })).toBe(true);
    expect(purseIsSpent({ available: "3", spent: "5", cap: "5" })).toBe(true);
    expect(purseIsSpent({ available: "3", spent: "5.2", cap: "5" })).toBe(true);
  });

  it("is not a purse with coins and room under the cap, nor one not yet read", () => {
    expect(purseIsSpent({ available: "3", spent: "1.2", cap: "5" })).toBe(false);
    expect(purseIsSpent({ available: "3", spent: null, cap: null })).toBe(false);
    expect(purseIsSpent(undefined)).toBe(false);
  });
});
