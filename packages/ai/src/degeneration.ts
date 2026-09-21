import type { AiOperation } from "@chronica/shared";

/**
 * Noticing that a model has stopped saying anything and is only still typing.
 *
 * Observed on a live burst: a cognition call fell into producing
 * "1p2q3r4s5t6u7v8w9x0y1z2a3b4c5d..." and carried on until it hit its output
 * ceiling sixteen thousand tokens later, seventy-five seconds in, two-fifths
 * of the whole turn. Nothing else could have stopped it. The stall deadline
 * cannot: a model producing nonsense is producing, and the clock it resets is
 * the clock for silence. The ceiling does stop it, but only at the far end,
 * after the tokens have been generated and paid for.
 *
 * The signal is the shape of the failure rather than its content. Every one of
 * these answers is JSON, so a healthy stream is never far from a quotation
 * mark, a comma or a brace. Degeneration happens *inside* an unterminated
 * string, where there is no structure at all -- so a long enough run without
 * any is the thing worth acting on, and the limit is set well above the
 * longest string the schema will even accept.
 *
 * What it deliberately does not try to catch is a model repeating well-formed
 * structure. That failure is already bounded, because it runs into the output
 * ceiling like any other long answer; this exists for the one that would
 * otherwise run to the ceiling with nothing in it.
 */

/** Characters that mean the answer is still shaped like JSON. */
const STRUCTURE = new Set(['"', "{", "}", "[", "]", ",", ":"]);

/**
 * How long a run without any of them may get, per operation.
 *
 * The two structured calls are bounded by their own schemas: the longest
 * string either may contain is six hundred characters, so three thousand is
 * five times the largest legal value and cannot be reached by a good answer.
 * The Chronicle writes prose into an unbounded `body`, so it is given far more
 * room -- enough that only a genuine runaway reaches it, and its own ceiling
 * bounds what happens if one slips through.
 */
const STRUCTURE_RUN_LIMIT: Partial<Record<AiOperation, number>> = {
  simulate_orchestrate: 3_000,
  simulate_cognition: 3_000,
  compose_chronicle: 12_000,
};
const DEFAULT_STRUCTURE_RUN_LIMIT = 6_000;

/**
 * Nothing is judged before this much has been said. A short answer is never
 * worth abandoning however it looks, and this keeps the whole mechanism away
 * from the ordinary case.
 */
const MIN_BEFORE_ARMED = 1_500;

export interface DegenerationWatch {
  /** The reason to stop, once there is one; null while the answer still looks like an answer. */
  feed(chunk: string): string | null;
}

export function watchForDegeneration(operation: AiOperation): DegenerationWatch {
  const limit = STRUCTURE_RUN_LIMIT[operation] ?? DEFAULT_STRUCTURE_RUN_LIMIT;
  let total = 0;
  let sinceStructure = 0;

  return {
    feed(chunk: string): string | null {
      for (const character of chunk) {
        total += 1;
        if (STRUCTURE.has(character)) {
          sinceStructure = 0;
          continue;
        }
        sinceStructure += 1;
      }
      if (total < MIN_BEFORE_ARMED || sinceStructure < limit) return null;
      return `${sinceStructure} characters without any JSON structure in them`;
    },
  };
}
