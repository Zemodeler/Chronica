/**
 * Telling a deadline apart from a bad answer.
 *
 * This lives in `shared` rather than beside the adapters because the two
 * places that need it are on opposite sides of a deliberate wall: the adapters
 * raise it, and the simulation loop has to recognise it, and `@chronica/sim`
 * cannot import `@chronica/ai` because the coin gate needs a live database.
 *
 * The distinction is worth the file. Both `orchestrate` and `runCognition`
 * answer a failure by re-sending the entire prompt with the schema's
 * complaints appended. For an answer the schema rejected that is exactly
 * right. For a call that ran out of time it is a second full-price call, on a
 * prompt that was not wrong, which will run out of time in the same way --
 * paying twice over to learn the same thing.
 */
export class AiTimeoutError extends Error {
  constructor(readonly operation: string, readonly timeoutMs: number) {
    super(`The ${operation} call did not answer within ${Math.round(timeoutMs / 1000)}s.`);
    this.name = "AiTimeoutError";
  }
}

/** Whether a provider error is a deadline rather than a refusal or a bad answer. */
export function isTimeout(error: unknown): boolean {
  if (error instanceof AiTimeoutError) return true;
  if (typeof error !== "object" || error === null) return false;
  // Neither SDK exposes a shared base class for this, so it is matched by the
  // names they actually use: an exceeded request deadline, and an abort.
  const named = error as { name?: unknown; message?: unknown };
  return (
    named.name === "APIConnectionTimeoutError" ||
    named.name === "AbortError" ||
    named.name === "TimeoutError" ||
    (typeof named.message === "string" && /timed? ?out/i.test(named.message))
  );
}
