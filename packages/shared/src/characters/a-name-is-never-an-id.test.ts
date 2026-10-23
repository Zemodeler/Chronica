import { describe, expect, it } from "vitest";
import { aNameFor } from "./names-by-culture";

/**
 * A people with few names is never given an id for one (docs/reports/consul-run-issues.md, L1): "Arkamani of the kush
 * xapit5", "Zelalsan of the mauretanian-peoples w9bv9z".
 */
describe("a name for a man of a people with few names", () => {
  it("is a name, given a father's where the stock runs dry, never the power's id", () => {
    const used = new Set<string>();
    for (let index = 0; index < 120; index += 1) {
      const name = aNameFor("kush", `priest-${index}`, used);
      expect(name).not.toMatch(/kush|\d/);
      used.add(name);
    }
    expect([...used].some((name) => name.includes(" son of "))).toBe(true);
  });
});
