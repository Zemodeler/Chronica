import type { SimModelPort, SimOperation } from "./ports";

/**
 * One allowance for every request a turn makes (player-focused simulation
 * plan, S3): the order's own calls, the world's decisions, repairs and
 * retries, and the historian. `maxModelCalls` counted only the burst's own
 * decisions and excluded parallel shards and the Chronicle, so a turn could
 * spend several times its budget (the Rhegium burst: 77 calls against 40).
 *
 * Requests are counted where they leave -- the port -- so no path, retry or
 * parallel dispatch can go uncounted. Capacity is reserved for the player's
 * order and for the closing account: ambient work can never spend those.
 * A request the allowance cannot pay for is refused here with
 * `AllowanceSpentError`; every caller already turns a failed request into
 * "nothing said", which is how the engine keeps the order and the decisions
 * still owed instead of dropping them.
 */

export type RequestClass = "order" | "chronicle" | "ambient";

const CLASS_OF: Readonly<Record<SimOperation, RequestClass>> = {
  simulate_orchestrate: "order",
  repair_deltas: "order",
  reconcile_facts: "order",
  compose_chronicle: "chronicle",
  simulate_cognition: "ambient",
  write_mechanic: "ambient",
  voice_letters: "ambient",
};

export const requestClassOf = (operation: SimOperation): RequestClass => CLASS_OF[operation];

export interface RequestAllowance {
  /** Every request of the turn, whatever it is for. */
  readonly total: number;
  /** Kept back for the player's order (orchestrate, its repairs and reconciliations). */
  readonly reserveForOrder: number;
  /** Kept back for the closing account of the turn. */
  readonly reserveForChronicle: number;
}

export const DEFAULT_ALLOWANCE: RequestAllowance = { total: 120, reserveForOrder: 12, reserveForChronicle: 24 };

export class AllowanceSpentError extends Error {
  constructor(readonly operation: SimOperation, readonly spent: number, readonly total: number) {
    super(`the turn's request allowance is spent (${spent} of ${total}); ${operation} was not sent`);
    this.name = "AllowanceSpentError";
  }
}

export interface RequestLedger {
  readonly allowance: RequestAllowance;
  /** Whether one more request of this operation can be paid for without touching what is reserved for the others. */
  canSpend(operation: SimOperation, count?: number): boolean;
  /** How many more requests the class may make now. */
  remaining(requestClass: RequestClass): number;
  /** Count a request. Throws `AllowanceSpentError` when it cannot be paid for. */
  spend(operation: SimOperation): void;
  readonly spent: number;
  /** Requests made, by operation. */
  counts(): Readonly<Record<string, number>>;
}

export function createRequestLedger(allowance: RequestAllowance = DEFAULT_ALLOWANCE): RequestLedger {
  const byOperation = new Map<SimOperation, number>();
  const byClass: Record<RequestClass, number> = { order: 0, chronicle: 0, ambient: 0 };
  let spent = 0;
  const unspentReserve = (requestClass: RequestClass): number => requestClass === "order" ? Math.max(0, allowance.reserveForOrder - byClass.order)
    : requestClass === "chronicle" ? Math.max(0, allowance.reserveForChronicle - byClass.chronicle) : 0;
  const remaining = (requestClass: RequestClass): number => {
    const others = (["order", "chronicle"] as const).filter((other) => other !== requestClass).reduce((sum, other) => sum + unspentReserve(other), 0);
    return Math.max(0, allowance.total - spent - others);
  };
  return {
    allowance,
    canSpend: (operation, count = 1) => remaining(requestClassOf(operation)) >= count,
    remaining,
    spend(operation) {
      if (remaining(requestClassOf(operation)) < 1) throw new AllowanceSpentError(operation, spent, allowance.total);
      spent += 1;
      byClass[requestClassOf(operation)] += 1;
      byOperation.set(operation, (byOperation.get(operation) ?? 0) + 1);
    },
    get spent() { return spent; },
    counts: () => Object.fromEntries(byOperation),
  };
}

/** The port with every request counted and paid for out of the ledger. */
export function meteredPort(port: SimModelPort, ledger: RequestLedger): SimModelPort {
  return {
    complete(operation, systemPrompt, userMessage) {
      try {
        ledger.spend(operation);
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
      return port.complete(operation, systemPrompt, userMessage);
    },
  };
}

/** The allowance from the environment (`CHRONICA_REQUEST_ALLOWANCE`, a total), else the default. */
export function allowanceFromEnv(value: string | undefined): RequestAllowance {
  const total = value === undefined ? NaN : Number(value);
  return Number.isInteger(total) && total >= DEFAULT_ALLOWANCE.reserveForOrder + DEFAULT_ALLOWANCE.reserveForChronicle + 1 ? { ...DEFAULT_ALLOWANCE, total } : DEFAULT_ALLOWANCE;
}
