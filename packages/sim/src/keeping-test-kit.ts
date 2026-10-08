import { treasuryOf, type WorldState } from "@chronica/shared";

/**
 * What a power's chest paid out in the span between two worlds to keep its state (`keeping-the-state.ts`): the costs of government, the upkeep, and the
 * contractors of its works. A test that reads the chest over a month of the real tick and means to read the army's pay, a fleet's cost or a levy adds this back.
 */
export function keepingSpent(before: WorldState, after: WorldState, polityId: string): number {
  const chest = treasuryOf(after, polityId);
  const known = new Set(before.material.transactions.map((line) => line.id));
  return after.material.transactions
    .filter((line) => !known.has(line.id) && line.sourceAccountId === chest && (line.cause.id.startsWith("keeping_") || line.cause.id.startsWith("works:")))
    .reduce((sum, line) => sum + line.amount, 0);
}
