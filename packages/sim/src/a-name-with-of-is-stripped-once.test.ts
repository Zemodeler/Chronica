import { describe, expect, it } from "vitest";
import { withoutWrites } from "./letter-voice";

describe("a report is put under its sender's name once", () => {
  it("strips 'X of Y writes:' as it strips 'X writes:' (hand run 2026-10-22, doubled prefix)", () => {
    expect(withoutWrites("Leptines of Syracuse writes: To my lord, in some distress.")).toBe("To my lord, in some distress.");
    expect(withoutWrites("Hanno son of Gisgo writes: Leptines of Syracuse writes: Send men.")).toBe("Send men.");
    expect(withoutWrites("Clepsina writes: grain is short")).toBe("grain is short");
    expect(withoutWrites("The consul writes that grain is short")).toBe("The consul writes that grain is short");
  });
});
