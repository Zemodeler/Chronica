import { calculateCoinUsage } from "@chronica/billing";
import { authorizeCoinHold, settleCoinHold, releaseCoinHold, getCoinWalletSnapshot, type ChronicaDatabase } from "@chronica/db";
import type { AiOperation } from "@chronica/shared";
import { randomUUID } from "node:crypto";
import type { AiAdapter, AiCallResult } from "./adapter";
import { logDevAiCost } from "./dev-cost";

// gpt-4o-mini rate in micro-units per million tokens (matches billing rate card structure).
// Conservative overestimate for the hold — settled to the real amount.
const HOLD_RATE = {
  inputMicroUnitsPerMillionTokens: 300n,   // $0.30/M with 50% markup headroom
  outputMicroUnitsPerMillionTokens: 1200n, // $1.20/M with 50% markup headroom
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

    // Use gpt-4o-mini actual rates for settlement.
    const actualRate = {
      inputMicroUnitsPerMillionTokens: 150n,
      outputMicroUnitsPerMillionTokens: 600n,
      cacheReadMicroUnitsPerMillionTokens: 75n,
      cacheWriteMicroUnitsPerMillionTokens: 150n,
    };
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

    logDevAiCost(operation, result);
    return result;
  }

  throw new AiParseError();
}
