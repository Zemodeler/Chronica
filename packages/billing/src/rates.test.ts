import { describe, expect, it } from "vitest";
import { calculateCoinUsage, calculateMarkedUpCoinCharge, calculateRetailMicrocredits, formatCoins } from "./rates";

describe("integer retail arithmetic", () => {
  it("prices fixed, input and output components without floating point", () => {
    expect(calculateRetailMicrocredits(
      { fixedMicrocredits: 100n, inputMicrocreditsPerToken: 2n, outputMicrocreditsPerToken: 5n },
      { inputTokens: 1_000, outputTokens: 200 },
    )).toBe(3_100n);
  });

  it("rejects invalid token counts and formats fractional credits exactly", () => {
    expect(() => calculateRetailMicrocredits(
      { fixedMicrocredits: 0n, inputMicrocreditsPerToken: 1n, outputMicrocreditsPerToken: 1n },
      { inputTokens: -1, outputTokens: 0 },
    )).toThrow(/non-negative/);
    expect(formatCoins(12_340n)).toBe("0.01234");
    expect(formatCoins(-1_005n)).toBe("-0.001005");
  });

  it("charges one and a half times provider-equivalent usage", () => {
    expect(calculateMarkedUpCoinCharge(30_000n)).toBe(45_000n);
    expect(calculateCoinUsage({
      inputMicroUnitsPerMillionTokens: 30_000_000n,
      outputMicroUnitsPerMillionTokens: 0n,
      cacheReadMicroUnitsPerMillionTokens: 0n,
      cacheWriteMicroUnitsPerMillionTokens: 0n,
    }, { inputTokens: 1_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toEqual({
      providerCostMicroUnits: 30_000n,
      coinChargeMicroUnits: 45_000n,
    });
  });
});
