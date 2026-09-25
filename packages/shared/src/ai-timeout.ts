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

/**
 * Whether a provider error has to end the turn rather than be absorbed.
 *
 * Every model call in the loop catches what it is thrown and carries on with
 * nothing, which is right for a bad answer and for a deadline: the world can
 * absorb one person not reacting. It is wrong for a player who has run out of
 * coins. That error was caught four levels down like any other, the burst
 * committed an empty answer, the clock moved on a season, and the handler
 * that would have told the player to top up never ran -- so running out of
 * coins looked exactly like the world ignoring the order.
 *
 * Matched by name, for the reason `isTimeout` is: the coin gate lives in
 * `@chronica/ai`, which the simulation cannot import.
 */
export function abortsTheTurn(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const named = error as { name?: unknown; status?: unknown; code?: unknown; message?: unknown };
  if (named.name === "InsufficientCoinsError") return true;
  // The provider's own equivalents: an account with no credit left, or a key
  // it will not accept. A live run spent its last five orders this way --
  // every call refused with "You have no credits remaining", every turn
  // committed as "nothing came of it", the clock moving on each time. Nothing
  // retried inside a turn can succeed against either, so the turn stops and
  // the player is told, instead of a season passing in silence.
  if (named.status === 401 || named.status === 403) return true;
  if (named.code === "insufficient_quota") return true;
  return named.status === 429 && typeof named.message === "string" && /credit|quota|billing/i.test(named.message);
}
