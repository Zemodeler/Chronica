import { createHash } from "node:crypto";
import type { SimModelPort } from "@chronica/sim";

/**
 * Every model request a durable attempt makes, written down before and after
 * it is made (`turn_job_calls`), and answered from an earlier attempt where
 * that attempt already asked the very same thing.
 *
 * What this does not do is promise a provider call is billed exactly once.
 * A call is recorded `started` before the provider is asked; an attempt that
 * dies before the answer is recorded leaves it `started`, the next lease marks
 * it `uncertain`, and the next attempt asks again -- the provider may have
 * done (and billed) the first one, and nothing here can know. The coins the
 * player put on hold for it are given back by the stale-hold sweep, so the
 * player is not charged for an answer nobody read.
 *
 * What it does promise: an answer an earlier attempt received and recorded is
 * not asked for, nor paid for, again. A request is "the same" when its
 * operation, system prompt and user message hash alike and it is the same
 * nth asking within its attempt; a turn that runs the same way twice asks the
 * same things in the same order, and one that does not simply asks afresh.
 */

export interface TurnCallStore {
  readonly findReplayable: (key: TurnCallKeyInput) => Promise<{ id: number; response: string } | undefined>;
  readonly recordReplayed: (key: TurnCallKeyInput, replayedFrom: number) => Promise<void>;
  readonly recordStarted: (key: TurnCallKeyInput) => Promise<number>;
  readonly recordAnswered: (callId: number, response: string) => Promise<void>;
  readonly recordFailed: (callId: number, error: string) => Promise<void>;
}

export interface TurnCallKeyInput {
  readonly burstId: string;
  readonly attempt: number;
  readonly operation: string;
  readonly requestHash: string;
  readonly occurrence: number;
}

export interface EvidenceCounts {
  asked: number;
  replayed: number;
  /** Answers received but not written down: if this attempt dies, they become uncertain to the next. */
  unrecorded: number;
}

export function requestHash(operation: string, systemPrompt: string, userMessage: string): string {
  return createHash("sha256").update(operation).update("\u0000").update(systemPrompt).update("\u0000").update(userMessage).digest("hex");
}

export function evidencePort(store: TurnCallStore, at: { readonly burstId: string; readonly attempt: number }, inner: SimModelPort): { port: SimModelPort; counts: EvidenceCounts } {
  const occurrences = new Map<string, number>();
  const counts: EvidenceCounts = { asked: 0, replayed: 0, unrecorded: 0 };
  const port: SimModelPort = {
    complete: async (operation, systemPrompt, userMessage) => {
      const hash = requestHash(operation, systemPrompt, userMessage);
      const occurrence = occurrences.get(hash) ?? 0;
      occurrences.set(hash, occurrence + 1);
      const key: TurnCallKeyInput = { burstId: at.burstId, attempt: at.attempt, operation, requestHash: hash, occurrence };
      if (at.attempt > 1) {
        const earlier = await store.findReplayable(key);
        if (earlier !== undefined) {
          await store.recordReplayed(key, earlier.id);
          counts.replayed += 1;
          return earlier.response;
        }
      }
      // Written before the provider is asked. If it cannot be written the
      // call is not made: an attempt that cannot keep its evidence cannot be
      // recovered honestly, and the error ends the attempt like any other.
      const callId = await store.recordStarted(key);
      counts.asked += 1;
      let answer: string;
      try {
        answer = await inner.complete(operation, systemPrompt, userMessage);
      } catch (error) {
        await store.recordFailed(callId, error instanceof Error ? `${error.name}: ${error.message}` : String(error)).catch(() => undefined);
        throw error;
      }
      // The answer is in hand and was paid for: a failure to write it down
      // costs the next attempt a replay, never this one its answer.
      await store.recordAnswered(callId, answer).catch((error: unknown) => {
        counts.unrecorded += 1;
        console.warn(`[burst ${at.burstId}] attempt ${at.attempt}: an answered ${operation} call could not be recorded; a later attempt would ask it again:`, error);
      });
      return answer;
    },
  };
  return { port, counts };
}
