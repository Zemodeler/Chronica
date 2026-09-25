import type { ChronicaDatabase } from "@chronica/db";
import type { AiOperation } from "@chronica/shared";
import type { AiAdapter } from "./adapter";
import { callWithCoinGate } from "./coin-gate";

/**
 * The simulation's model port: every call metered, charged, and timed.
 *
 * The timing is kept here rather than in `@chronica/sim` because the engine is
 * deliberately ignorant of everything but the port. It answers the question a
 * call count cannot: six calls is forty seconds or four minutes depending on
 * which stage is slow, and until this existed there was no way to know which.
 *
 * Two figures per operation. The sum of the calls' own durations is what the
 * provider was busy for; the wall span from the first call's start to the last
 * call's end is what the player waited, and where calls run side by side --
 * cognition shards, the Chronicle's threads -- the two differ, and the second
 * is the one a turn is measured by.
 */
export interface TimedModelPort {
  readonly port: {
    complete(operation: AiOperation, systemPrompt: string, userMessage: string): Promise<string>;
  };
  /** Per operation: calls, summed seconds, and the wall span they occupied. */
  summary(): string;
}

interface Stage {
  calls: number;
  totalMs: number;
  firstStartedAt: number;
  lastEndedAt: number;
}

export function createTimedPort(input: { readonly db: ChronicaDatabase; readonly userId: string; readonly gameId: string; readonly adapter: AiAdapter }): TimedModelPort {
  const { db, userId, gameId, adapter } = input;
  const stages = new Map<string, Stage>();
  return {
    port: {
      async complete(operation, systemPrompt, userMessage) {
        const startedAt = performance.now();
        try {
          const result = await callWithCoinGate(db, userId, gameId, operation, adapter, { system: systemPrompt, user: userMessage });
          return result.content;
        } finally {
          // In `finally`, so a call that threw still shows up: a stage that is
          // slow because it times out is exactly the one worth seeing.
          const endedAt = performance.now();
          const stage = stages.get(operation) ?? { calls: 0, totalMs: 0, firstStartedAt: startedAt, lastEndedAt: endedAt };
          stages.set(operation, {
            calls: stage.calls + 1,
            totalMs: stage.totalMs + (endedAt - startedAt),
            firstStartedAt: Math.min(stage.firstStartedAt, startedAt),
            lastEndedAt: Math.max(stage.lastEndedAt, endedAt),
          });
        }
      },
    },
    summary: () =>
      [...stages.entries()]
        .map(([operation, stage]) => {
          const summed = (stage.totalMs / 1000).toFixed(1);
          const wall = ((stage.lastEndedAt - stage.firstStartedAt) / 1000).toFixed(1);
          return `${operation} ×${stage.calls} ${summed}s${wall === summed ? "" : ` (wall ${wall}s)`}`;
        })
        .join(", "),
  };
}
