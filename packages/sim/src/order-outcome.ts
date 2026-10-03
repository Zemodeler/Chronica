import { orderPartRef, orderPartStatus, type OrderPartStatus } from "@chronica/shared";
import type { BurstResult } from "./burst";
import type { ChronicleEntry } from "./chronicle";
import { ORDER_OUTCOME_HEADING } from "./order-outcomes";

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
  /**
   * Every part of it is done -- its goal is so in the world -- or was refused
   * by the world. Reading the order's ledger, never its facts: a fact of the
   * order's acceptance once scored as the order carried out (E01, E11).
   */
  readonly carriedOut: boolean;
  /** Where each part stands, in the order's own order. */
  readonly parts: readonly OrderPartStatus[];
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
  /**
   * The Chronicle tells every part of it: a passage made of that part's
   * facts, or the engine's own line for it under "What came of the order". A
   * passage that merely held one of its facts used to count for the whole.
   */
  readonly inChronicle: boolean;
}

export function outcomeOfOrder(result: BurstResult, entries: readonly ChronicleEntry[]): OrderOutcome {
  const ours = new Set(result.orderFactIds);
  const facts = result.newFacts.filter((fact) => ours.has(fact.id));
  const summaries = (kind: string) => facts.filter((fact) => fact.kind === kind).map((fact) => fact.summary);
  const answeredOnly = facts.some((fact) => fact.kind === "order_given");
  const order = result.orderRecordId === null ? undefined : result.world.orders.find((candidate) => candidate.id === result.orderRecordId);
  const parts = order === undefined ? [] : order.parts.map((part) => orderPartStatus(result.world, part));
  const partOfFact = new Map(result.newFacts.filter((fact) => fact.sourceActionId !== null).map((fact) => [fact.id, fact.sourceActionId]));
  const told = (index: number): boolean => {
    if (order === undefined) return false;
    const ref = orderPartRef(order.id, index);
    return entries.some((entry) => entry.factIds.some((id) => partOfFact.get(id) === ref)
      || (entry.body.includes(ORDER_OUTCOME_HEADING) && entry.body.includes(`"${order.parts[index]!.said}"`)));
  };
  return {
    carriedOut: parts.length > 0 && parts.every((status) => status === "achieved" || status === "refused") && parts.includes("achieved"),
    parts,
    refusedByWorld: summaries("execution_friction"),
    ignored: summaries("order_ignored"),
    malformed: summaries("engine_rejection"),
    answeredOnly,
    unreadable: result.parseFailures,
    salvaged: result.salvaged,
    // An order the engine could not record at all is told when anything of it is.
    inChronicle: order === undefined
      ? entries.some((entry) => entry.factIds.some((id) => ours.has(id)))
      : order.parts.every((_, index) => told(index)),
  };
}
