import { calculateCoinUsage } from "@chronica/billing";
import { authorizeCoinHold, settleCoinHold, releaseCoinHold, getCoinWalletSnapshot, type ChronicaDatabase } from "@chronica/db";
import type { AiOperation } from "@chronica/shared";
import { randomUUID } from "node:crypto";
import type { AiAdapter, AiCallResult } from "./adapter";
import { logDevAiCost } from "./dev-cost";

type ModelTokenRate = Readonly<{
  inputMicroUnitsPerMillionTokens: bigint;
  outputMicroUnitsPerMillionTokens: bigint;
  cacheReadMicroUnitsPerMillionTokens: bigint;
  cacheWriteMicroUnitsPerMillionTokens: bigint;
}>;

const MODEL_TOKEN_RATES: Record<string, ModelTokenRate> = {
  "gpt-5-nano": {
    inputMicroUnitsPerMillionTokens: 50_000n,
    outputMicroUnitsPerMillionTokens: 400_000n,
    cacheReadMicroUnitsPerMillionTokens: 5_000n,
    cacheWriteMicroUnitsPerMillionTokens: 0n,
  },
  "gpt-5.6-luna": {
    inputMicroUnitsPerMillionTokens: 200_000n,
    outputMicroUnitsPerMillionTokens: 1_200_000n,
    cacheReadMicroUnitsPerMillionTokens: 20_000n,
    cacheWriteMicroUnitsPerMillionTokens: 0n,
  },
  "gpt-5.6-sol": {
    inputMicroUnitsPerMillionTokens: 4_000_000n,
    outputMicroUnitsPerMillionTokens: 20_000_000n,
    cacheReadMicroUnitsPerMillionTokens: 400_000n,
    cacheWriteMicroUnitsPerMillionTokens: 0n,
  },
};

// Conservative overestimate for the hold — settled to the actual model's cost.
const HOLD_RATE = {
  inputMicroUnitsPerMillionTokens: 4_000_000n,
  outputMicroUnitsPerMillionTokens: 20_000_000n,
  cacheReadMicroUnitsPerMillionTokens: 0n,
  cacheWriteMicroUnitsPerMillionTokens: 0n,
};

// Conservative token ceiling for the hold (actual usage is always lower).
const MAX_HOLD_INPUT_TOKENS = 8_000;
const MAX_HOLD_OUTPUT_TOKENS = 2_000;

export class InsufficientCoinsError extends Error {
  constructor() {
    super("Insufficient coins — top up your wallet to continue.");
    this.name = "InsufficientCoinsError";
  }
}

export class AiParseError extends Error {
  constructor() {
    super("AI response could not be parsed — coins were not charged.");
    this.name = "AiParseError";
  }
}

export async function callWithCoinGate(
  db: ChronicaDatabase,
  userId: string,
  gameId: string,
  operation: AiOperation,
  adapter: AiAdapter,
  prompts: { system: string; user: string },
  validate?: (content: string) => boolean,
  options?: { maxRetries?: number },
): Promise<AiCallResult> {
  // Fast pre-check: refuse immediately if wallet is empty (before touching holds).
  const snapshot = await getCoinWalletSnapshot(db, userId);
  if (snapshot.availableMicroUnits === 0n) throw new InsufficientCoinsError();

  const maxHold = calculateCoinUsage(HOLD_RATE, {
    inputTokens: MAX_HOLD_INPUT_TOKENS,
    outputTokens: MAX_HOLD_OUTPUT_TOKENS,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }).coinChargeMicroUnits;

  const maxRetries = options?.maxRetries ?? 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const workId = randomUUID();
    const idempotencyKey = `${operation}:${gameId}:${workId}`;

    let holdId: string;
    try {
      const hold = await authorizeCoinHold(db, { gameId, workId, maximumMicroUnits: maxHold, idempotencyKey });
      holdId = hold.holdId;
    } catch {
      throw new InsufficientCoinsError();
    }

    let result: AiCallResult;
    try {
      result = await adapter.call(operation, prompts.system, prompts.user);
    } catch (error) {
      await releaseCoinHold(db, holdId).catch(() => { /* best effort */ });
      throw error;
    }

    if (validate !== undefined && !validate(result.content)) {
      await releaseCoinHold(db, holdId).catch(() => { /* best effort */ });
      if (attempt < maxRetries) {
        console.warn(`[ai] parse validation failed on attempt ${attempt + 1}/${maxRetries + 1} for ${operation} — retrying`);
        continue;
      }
      throw new AiParseError();
    }

    const actualRate = MODEL_TOKEN_RATES[result.model] ?? MODEL_TOKEN_RATES["gpt-5.6-sol"]!;
    const { providerCostMicroUnits, coinChargeMicroUnits } = calculateCoinUsage(actualRate, {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cacheReadTokens: result.cacheReadTokens,
      cacheWriteTokens: result.cacheWriteTokens,
    });

    await settleCoinHold(db, {
      holdId,
      callId: `${workId}:settled`,
      operation,
      routingProfileVersion: 1,
      usage: {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cacheReadTokens: result.cacheReadTokens,
        cacheWriteTokens: result.cacheWriteTokens,
      },
      providerCostMicroUnits,
      coinChargeMicroUnits,
    });

    logDevAiCost(operation, result, { providerCostMicroUnits, coinChargeMicroUnits });
    return result;
  }

  throw new AiParseError();
}
