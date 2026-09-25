import { calculateCoinUsage } from "@chronica/billing";
import { authorizeCoinHold, settleCoinHold, releaseCoinHold, getCoinWalletSnapshot, CoinHoldRefusedError, type ChronicaDatabase } from "@chronica/db";
import type { AiOperation } from "@chronica/shared";
import { randomUUID } from "node:crypto";
import type {
  AiAdapter,
  AiCallResult,
  AiConversationMessage,
  AiToolCallResult,
  AiToolDefinition,
} from "./adapter";
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
  "gpt-6-luna": {
    inputMicroUnitsPerMillionTokens: 100_000n,
    outputMicroUnitsPerMillionTokens: 500_000n,
    cacheReadMicroUnitsPerMillionTokens: 10_000n,
    cacheWriteMicroUnitsPerMillionTokens: 0n,
  },
  "gpt-5.6-sol": {
    inputMicroUnitsPerMillionTokens: 4_000_000n,
    outputMicroUnitsPerMillionTokens: 20_000_000n,
    cacheReadMicroUnitsPerMillionTokens: 400_000n,
    cacheWriteMicroUnitsPerMillionTokens: 0n,
  },
  "gpt-6-sol": {
    inputMicroUnitsPerMillionTokens: 2_000_000n,
    outputMicroUnitsPerMillionTokens: 10_000_000n,
    cacheReadMicroUnitsPerMillionTokens: 200_000n,
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

/**
 * Settles a hold, and gives the coins back if settlement itself fails.
 *
 * The call succeeded, so the fair outcome is a charge; but a hold whose
 * settlement died is a hold nobody is coming back for, and the coins it
 * reserves stay unspendable until the stale sweep finds them. Releasing it
 * forgoes one call's charge to keep the wallet honest now. The failure is
 * still thrown, with its own name, so the caller sees what happened.
 */
async function settleOrGiveBack(db: ChronicaDatabase, operation: AiOperation, holdId: string, settlement: Parameters<typeof settleCoinHold>[1]): Promise<void> {
  try {
    await settleCoinHold(db, settlement);
  } catch (error) {
    console.error(`[ai] settling the ${operation} hold failed; releasing it instead:`, error);
    await releaseCoinHold(db, holdId).catch(() => { /* best effort */ });
    throw error;
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
  // Timed with everything else we do around the call: three database round
  // trips per model call is a number worth being able to see next to the
  // provider's own latency rather than guessing at.
  let ledgerMs = 0;
  const openedAt = performance.now();
  const snapshot = await getCoinWalletSnapshot(db, userId);
  ledgerMs += performance.now() - openedAt;
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
    const heldAt = performance.now();
    try {
      const hold = await authorizeCoinHold(db, { gameId, workId, maximumMicroUnits: maxHold, idempotencyKey });
      holdId = hold.holdId;
    } catch (error) {
      // Only a refusal is "out of coins". Anything else the ledger throws is
      // its own kind of failure and keeps its own name: a database deadlock
      // once wore this message in front of a player with a full wallet.
      if (error instanceof CoinHoldRefusedError) throw new InsufficientCoinsError();
      throw error;
    }
    ledgerMs += performance.now() - heldAt;

    let result: AiCallResult;
    const calledAt = performance.now();
    try {
      result = await adapter.call(operation, prompts.system, prompts.user);
    } catch (error) {
      await releaseCoinHold(db, holdId).catch(() => { /* best effort */ });
      throw error;
    }
    const providerMs = performance.now() - calledAt;

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

    const settledAt = performance.now();
    await settleOrGiveBack(db, operation, holdId, {
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
    ledgerMs += performance.now() - settledAt;

    logDevAiCost(operation, result, { providerCostMicroUnits, coinChargeMicroUnits }, { providerMs, ledgerMs });
    return result;
  }

  throw new AiParseError();
}

/**
 * One coin-gated step of a tool-using conversation (GM refactor).
 *
 * Each step is authorised, called, and settled on its own, exactly as a
 * single-shot call is. A Game Master turn is therefore charged for what it
 * actually spent step by step, and a wallet that empties mid-loop stops the
 * loop at the next step rather than after the whole turn's tokens are gone.
 *
 * There is deliberately no validate/retry here: a tool step is not parsed for
 * a schema, it is either a set of tool calls or it is not, and the staged
 * session refuses anything malformed with a factual message the model can act
 * on inside the same loop.
 */
export async function callWithToolsAndCoinGate(
  db: ChronicaDatabase,
  userId: string,
  gameId: string,
  operation: AiOperation,
  adapter: AiAdapter,
  systemPrompt: string,
  messages: readonly AiConversationMessage[],
  tools: readonly AiToolDefinition[],
): Promise<AiToolCallResult> {
  let ledgerMs = 0;
  const openedAt = performance.now();
  const snapshot = await getCoinWalletSnapshot(db, userId);
  ledgerMs += performance.now() - openedAt;
  if (snapshot.availableMicroUnits === 0n) throw new InsufficientCoinsError();

  const maxHold = calculateCoinUsage(HOLD_RATE, {
    inputTokens: MAX_HOLD_INPUT_TOKENS,
    outputTokens: MAX_HOLD_OUTPUT_TOKENS,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }).coinChargeMicroUnits;

  const workId = randomUUID();
  let holdId: string;
  const heldAt = performance.now();
  try {
    const hold = await authorizeCoinHold(db, {
      gameId,
      workId,
      maximumMicroUnits: maxHold,
      idempotencyKey: `${operation}:${gameId}:${workId}`,
    });
    holdId = hold.holdId;
  } catch (error) {
    if (error instanceof CoinHoldRefusedError) throw new InsufficientCoinsError();
    throw error;
  }
  ledgerMs += performance.now() - heldAt;

  let result: AiToolCallResult;
  const calledAt = performance.now();
  try {
    result = await adapter.callWithTools(operation, systemPrompt, messages, tools);
  } catch (error) {
    await releaseCoinHold(db, holdId).catch(() => { /* best effort */ });
    throw error;
  }
  const providerMs = performance.now() - calledAt;

  const actualRate = MODEL_TOKEN_RATES[result.model] ?? MODEL_TOKEN_RATES["gpt-5.6-sol"]!;
  const { providerCostMicroUnits, coinChargeMicroUnits } = calculateCoinUsage(actualRate, {
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    cacheReadTokens: result.cacheReadTokens,
    cacheWriteTokens: result.cacheWriteTokens,
  });

  const settledAt = performance.now();
  await settleOrGiveBack(db, operation, holdId, {
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
  ledgerMs += performance.now() - settledAt;

  logDevAiCost(operation, result, { providerCostMicroUnits, coinChargeMicroUnits }, { providerMs, ledgerMs });
  return result;
}
