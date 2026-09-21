/**
 * How long one model call may go quiet, how long it may take in total, and how
 * often the SDK may try again.
 *
 * Neither adapter set any of these, so both SDKs applied their own defaults --
 * ten minutes, retried twice -- and a single wedged call could hold a player's
 * turn for half an hour with nothing in the logs to say so.
 *
 * The thirty seconds is a *stall* deadline, not a total one, and the difference
 * is the whole reason the number is usable. Measured on a live burst,
 * orchestration answered in 27.1 and 29.5 seconds: against a total deadline of
 * thirty, the player loses their order to a call that was working perfectly and
 * simply had a lot to say. Against a stall deadline it is not close, because
 * the answer arrives in a steady stream of tokens and the clock restarts on
 * every one. What thirty seconds of silence actually means is a call that has
 * stopped, which is the thing worth abandoning.
 *
 * `maxRetries` is set explicitly because leaving it alone multiplies the
 * deadline: thirty seconds retried twice is a ninety-second wait, which is not
 * what anybody reading "thirty seconds" would expect.
 */
const DEFAULT_STALL_MS = 30_000;
const DEFAULT_MAX_MS = 150_000;
const DEFAULT_MAX_RETRIES = 1;

function positiveInteger(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw?.trim());
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** How long a call may produce nothing at all before it is abandoned. */
export function aiRequestTimeoutMs(): number {
  return positiveInteger(process.env.CHRONICA_AI_TIMEOUT_MS, DEFAULT_STALL_MS);
}

/** The backstop: how long a call may take however steadily it is answering. */
export function aiMaxMs(): number {
  return positiveInteger(process.env.CHRONICA_AI_MAX_MS, DEFAULT_MAX_MS);
}

export function aiMaxRetries(): number {
  return positiveInteger(process.env.CHRONICA_AI_MAX_RETRIES, DEFAULT_MAX_RETRIES);
}

/**
 * Abandons a call that has gone quiet for `stallMs`, resetting on every sign of
 * life. The caller streams a response and calls `alive()` per chunk.
 */
export function stallWatchdog(stallMs: number): { readonly signal: AbortSignal; alive: () => void; done: () => void } {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined = setTimeout(() => controller.abort(), stallMs);
  return {
    signal: controller.signal,
    alive: () => {
      if (timer === undefined) return;
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), stallMs);
    },
    done: () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}

// The error itself, and the predicate that recognises it, live in
// `@chronica/shared`: the simulation loop has to tell a deadline from a bad
// answer, and it cannot import this package.
export { AiTimeoutError, isTimeout } from "@chronica/shared";
