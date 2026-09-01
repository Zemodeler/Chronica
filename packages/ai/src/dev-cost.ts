import { formatCoins } from "@chronica/billing";
import type { AiOperation } from "@chronica/shared";
import type { AiCallResult } from "./adapter";

let sessionInputTokens = 0;
let sessionOutputTokens = 0;
let sessionCacheReadTokens = 0;
let sessionCacheWriteTokens = 0;
let sessionCalls = 0;
let sessionProviderCostMicroUnits = 0n;
let sessionCoinChargeMicroUnits = 0n;

export function logDevAiCost(
  operation: AiOperation,
  result: AiCallResult,
  usage: Readonly<{ providerCostMicroUnits: bigint; coinChargeMicroUnits: bigint }>,
): void {
  if (process.env.NODE_ENV === "production") return;

  sessionInputTokens += result.inputTokens;
  sessionOutputTokens += result.outputTokens;
  sessionCacheReadTokens += result.cacheReadTokens;
  sessionCacheWriteTokens += result.cacheWriteTokens;
  sessionCalls += 1;
  sessionProviderCostMicroUnits += usage.providerCostMicroUnits;
  sessionCoinChargeMicroUnits += usage.coinChargeMicroUnits;

  // eslint-disable-next-line no-console
  console.log(
    `[AI] ${operation} | ${result.model} | in:${result.inputTokens} cached:${result.cacheReadTokens} cache-write:${result.cacheWriteTokens} out:${result.outputTokens} | ${formatCoins(usage.coinChargeMicroUnits)} coins`,
  );
  // eslint-disable-next-line no-console
  console.log(
    `[AI] session total: ${sessionCalls} call${sessionCalls === 1 ? "" : "s"}, in:${sessionInputTokens} cached:${sessionCacheReadTokens} cache-write:${sessionCacheWriteTokens} out:${sessionOutputTokens} | ${formatCoins(sessionCoinChargeMicroUnits)} coins (provider ${formatCoins(sessionProviderCostMicroUnits)} coins)`,
  );
}
