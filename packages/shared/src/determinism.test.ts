import { describe, expect, it } from "vitest";
import { stableChoice, stableHash } from "./determinism";

describe("stableHash", () => {
  it("is deterministic for the same input", () => {
    expect(stableHash(["a", 1, "b"])).toBe(stableHash(["a", 1, "b"]));
  });

  it("differs for different input", () => {
    expect(stableHash(["a", 1])).not.toBe(stableHash(["a", 2]));
  });

  it("is always non-negative", () => {
    for (let i = 0; i < 20; i++) expect(stableHash([`x${i}`])).toBeGreaterThanOrEqual(0);
  });
});

describe("stableChoice", () => {
  it("always returns an index within range", () => {
    for (let i = 0; i < 20; i++) {
      const choice = stableChoice([`seed${i}`], 5);
      expect(choice).toBeGreaterThanOrEqual(0);
      expect(choice).toBeLessThan(5);
    }
  });
});
