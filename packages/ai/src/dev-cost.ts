import { formatCoins } from "@chronica/billing";
import type { AiOperation } from "@chronica/shared";
import type { AiCallResult } from "./adapter";

let sessionInputTokens = 0;
let sessionOutputTokens = 0;
let sessionCacheReadTokens = 0;
let sessionCacheWriteTokens = 0;
let sessionCalls = 0;
let sessionProviderMs = 0;
let sessionLedgerMs = 0;
let sessionProviderCostMicroUnits = 0n;
let sessionCoinChargeMicroUnits = 0n;

/** How long a call took, split so a slow turn can be blamed on the right thing. */
export interface AiCallTiming {
  /** Wall time inside the provider SDK. */
  readonly providerMs: number;
  /** Wall time spent on our own coin ledger: the snapshot, the hold, the settlement. */
  readonly ledgerMs: number;
}

const seconds = (milliseconds: number): string => (milliseconds / 1000).toFixed(1);

/**
 * What one model call cost, in time and in coins.
 *
 * The timing half is deliberately not development-only. Every performance
 * statement in this repository is denominated in model calls, and a turn that
 * takes three minutes cannot be explained by a call count: six calls is either
 * forty seconds or four minutes depending on which stage is slow, and until
 * this line existed there was no way to tell which.
 */
export function logDevAiCost(
  operation: AiOperation,
  result: AiCallResult,
  usage: Readonly<{ providerCostMicroUnits: bigint; coinChargeMicroUnits: bigint }>,
  timing: AiCallTiming,
): void {
  sessionInputTokens += result.inputTokens;
  sessionOutputTokens += result.outputTokens;
  sessionCacheReadTokens += result.cacheReadTokens;
  sessionCacheWriteTokens += result.cacheWriteTokens;
  sessionCalls += 1;
  sessionProviderMs += timing.providerMs;
  sessionLedgerMs += timing.ledgerMs;
  sessionProviderCostMicroUnits += usage.providerCostMicroUnits;
  sessionCoinChargeMicroUnits += usage.coinChargeMicroUnits;

  console.log(
    `[AI] ${operation} | ${result.model} | ${seconds(timing.providerMs)}s provider + ${seconds(timing.ledgerMs)}s ledger | in:${result.inputTokens} cached:${result.cacheReadTokens} cache-write:${result.cacheWriteTokens} out:${result.outputTokens}`,
  );

  if (process.env.NODE_ENV === "production") return;

  console.log(
    `[AI] session total: ${sessionCalls} call${sessionCalls === 1 ? "" : "s"}, ${seconds(sessionProviderMs)}s provider + ${seconds(sessionLedgerMs)}s ledger, in:${sessionInputTokens} cached:${sessionCacheReadTokens} cache-write:${sessionCacheWriteTokens} out:${sessionOutputTokens} | ${formatCoins(sessionCoinChargeMicroUnits)} coins (provider ${formatCoins(sessionProviderCostMicroUnits)} coins)`,
  );
}
