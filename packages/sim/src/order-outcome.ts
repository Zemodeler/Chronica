import type { BurstResult } from "./burst";
import type { ChronicleEntry } from "./chronicle";

/**
 * What became of one order, in the terms the game promises.
 *
 * The standard the engine is held to is that no order fails because of the
 * engine: an order may be carried out, refused by the world, ignored by the
 * people it was given to, or achieve nothing -- and in every case the player
 * hears about it. Scripted tests prove that the engine *can* do each of these;
 * only a real model shows what it *does*, and this is how a run against one is
 * scored.
 */
export interface OrderOutcome {
  /** Something the order's giver could see happened. */
  readonly carriedOut: boolean;
  /** The world would not: the treasury was short, the ground out of reach. */
  readonly refusedByWorld: readonly string[];
  /** Nobody was obliged to obey. */
  readonly ignored: readonly string[];
  /** Named something that does not exist, and the repair could not fix it. The engine's failure, not the world's. */
  readonly malformed: readonly string[];
  /** Nothing visible came of it, and the record says so. */
  readonly answeredOnly: boolean;
  /** The model's answer could not be read at all. */
  readonly unreadable: readonly string[];
  /** Fields the engine dropped from an otherwise good answer. */
  readonly salvaged: readonly string[];
  /** The Chronicle has an entry for it. The one thing that must always be true. */
  readonly inChronicle: boolean;
}

export function outcomeOfOrder(result: BurstResult, entries: readonly ChronicleEntry[]): OrderOutcome {
  const ours = new Set(result.orderFactIds);
  const facts = result.newFacts.filter((fact) => ours.has(fact.id));
  const summaries = (kind: string) => facts.filter((fact) => fact.kind === kind).map((fact) => fact.summary);
  const bookkeeping = new Set(["execution_friction", "order_ignored", "engine_rejection", "order_given", "authority_breach"]);
  const answeredOnly = facts.some((fact) => fact.kind === "order_given");
  return {
    // Visible to the one who gave it: the same test the turn uses before it
    // writes "nothing came of it", so the two can never both be true.
    carriedOut: !answeredOnly && facts.some((fact) => !bookkeeping.has(fact.kind) && fact.visibility !== "private"),
    refusedByWorld: summaries("execution_friction"),
    ignored: summaries("order_ignored"),
    malformed: summaries("engine_rejection"),
    answeredOnly,
    unreadable: result.parseFailures,
    salvaged: result.salvaged,
    inChronicle: entries.some((entry) => entry.factIds.some((id) => ours.has(id))),
  };
}
