import type { TokenUsage } from "@chronica/shared";

export const MICRO_UNITS_PER_COIN = 1_000_000n;
/** @deprecated Kept for source compatibility while persistence column names migrate. */
export const MICROCREDITS_PER_CREDIT = MICRO_UNITS_PER_COIN;

export type CoinTokenRate = Readonly<{
  inputMicroUnitsPerMillionTokens: bigint;
  outputMicroUnitsPerMillionTokens: bigint;
  cacheReadMicroUnitsPerMillionTokens: bigint;
  cacheWriteMicroUnitsPerMillionTokens: bigint;
}>;

const TOKENS_PER_MILLION = 1_000_000n;

function ceilDivide(value: bigint, divisor: bigint): bigint {
  return value === 0n ? 0n : (value + divisor - 1n) / divisor;
}

export function calculateCoinUsage(rate: CoinTokenRate, usage: TokenUsage): Readonly<{
  providerCostMicroUnits: bigint;
  coinChargeMicroUnits: bigint;
}> {
  for (const count of Object.values(usage)) {
    if (!Number.isSafeInteger(count) || count < 0) throw new RangeError("Token counts must be non-negative safe integers.");
  }
  for (const value of Object.values(rate)) {
    if (value < 0n) throw new RangeError("Token rates cannot be negative.");
  }
  const weighted = BigInt(usage.inputTokens) * rate.inputMicroUnitsPerMillionTokens
    + BigInt(usage.outputTokens) * rate.outputMicroUnitsPerMillionTokens
    + BigInt(usage.cacheReadTokens) * rate.cacheReadMicroUnitsPerMillionTokens
    + BigInt(usage.cacheWriteTokens) * rate.cacheWriteMicroUnitsPerMillionTokens;
  const providerCostMicroUnits = ceilDivide(weighted, TOKENS_PER_MILLION);
  return { providerCostMicroUnits, coinChargeMicroUnits: calculateMarkedUpCoinCharge(providerCostMicroUnits) };
}

export function calculateMarkedUpCoinCharge(providerCostMicroUnits: bigint): bigint {
  if (providerCostMicroUnits < 0n) throw new RangeError("Provider cost cannot be negative.");
  return ceilDivide(providerCostMicroUnits * 3n, 2n);
}

export type OperationRate = Readonly<{
  fixedMicrocredits: bigint;
  inputMicrocreditsPerToken: bigint;
  outputMicrocreditsPerToken: bigint;
}>;

export function calculateRetailMicrocredits(
  rate: OperationRate,
  usage: Readonly<{ inputTokens: number; outputTokens: number }>,
): bigint {
  if (!Number.isSafeInteger(usage.inputTokens) || usage.inputTokens < 0) throw new RangeError("Input tokens must be a non-negative safe integer.");
  if (!Number.isSafeInteger(usage.outputTokens) || usage.outputTokens < 0) throw new RangeError("Output tokens must be a non-negative safe integer.");
  for (const amount of [rate.fixedMicrocredits, rate.inputMicrocreditsPerToken, rate.outputMicrocreditsPerToken]) {
    if (amount < 0n) throw new RangeError("Retail rates cannot be negative.");
  }
  return rate.fixedMicrocredits
    + rate.inputMicrocreditsPerToken * BigInt(usage.inputTokens)
    + rate.outputMicrocreditsPerToken * BigInt(usage.outputTokens);
}

export function formatCredits(microcredits: bigint): string {
  const sign = microcredits < 0n ? "-" : "";
  const absolute = microcredits < 0n ? -microcredits : microcredits;
  const whole = absolute / MICRO_UNITS_PER_COIN;
  const fraction = absolute % MICRO_UNITS_PER_COIN;
  return fraction === 0n ? `${sign}${whole}` : `${sign}${whole}.${fraction.toString().padStart(6, "0").replace(/0+$/, "")}`;
}

export const formatCoins = formatCredits;
