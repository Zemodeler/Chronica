import { formatCoins, MICRO_UNITS_PER_COIN } from "@chronica/billing";
import type { AiOperation } from "@chronica/shared";
import type { AiCallResult } from "./adapter";

// gpt-4o-mini pricing (USD per million tokens, as of 2025).
// These are approximate and used only for developer logging.
const APPROX_RATES_USD_PER_M: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10.0 },
  "mock": { input: 0, output: 0 },
};

let sessionInputTokens = 0;
let sessionOutputTokens = 0;
let sessionCalls = 0;
let sessionCostUsd = 0;

function approxUsd(model: string, input: number, output: number): number {
  const rates = APPROX_RATES_USD_PER_M[model] ?? { input: 2.5, output: 10 };
  return (input * rates.input + output * rates.output) / 1_000_000;
}

function approxCoins(usd: number): string {
  const microUnits = BigInt(Math.ceil(usd * 1_500_000)); // 50% markup over provider cost
  return formatCoins(microUnits);
}

export function logDevAiCost(operation: AiOperation, result: AiCallResult): void {
  if (process.env.NODE_ENV === "production") return;

  const usd = approxUsd(result.model, result.inputTokens, result.outputTokens);
  sessionInputTokens += result.inputTokens;
  sessionOutputTokens += result.outputTokens;
  sessionCalls += 1;
  sessionCostUsd += usd;

  const sessionUsd = approxUsd(result.model, sessionInputTokens, sessionOutputTokens);

  // eslint-disable-next-line no-console
  console.log(
    `[AI] ${operation} | ${result.model} | in:${result.inputTokens} out:${result.outputTokens} | $${usd.toFixed(6)} | ~${approxCoins(usd)} coins`,
  );
  // eslint-disable-next-line no-console
  console.log(
    `[AI] session total: ${sessionCalls} call${sessionCalls === 1 ? "" : "s"}, ~${approxCoins(sessionUsd)} coins ($${sessionCostUsd.toFixed(6)})`,
  );
}

// Keeps TypeScript happy — MICRO_UNITS_PER_COIN is used indirectly via formatCoins.
void MICRO_UNITS_PER_COIN;
