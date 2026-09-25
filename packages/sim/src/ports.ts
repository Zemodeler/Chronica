/**
 * The simulation's only outbound dependency.
 *
 * `@chronica/ai` cannot be imported here: it depends on `@chronica/db` (its
 * coin gate takes a live `ChronicaDatabase`), and a simulation core that
 * transitively requires a database cannot be unit-tested without one. So the
 * loop declares the narrow shape it needs and the caller supplies it --
 * `apps/web` closes over `callWithCoinGate`, tests pass a scripted fake.
 */

/** Model calls the loop makes. Mirrors the `AiOperation` ids registered in `@chronica/shared`'s `coins.ts`. */
export type SimOperation = "simulate_orchestrate" | "simulate_cognition" | "compose_chronicle" | "reconcile_facts";

export interface SimModelPort {
  complete(operation: SimOperation, systemPrompt: string, userMessage: string): Promise<string>;
}

/**
 * Ids are assigned by the engine, never by the model (see `contract/refs.ts`).
 * A burst threads one of these so every id it mints is traceable back to it
 * and stable across a replay of the same burst.
 */
export interface IdFactory {
  next(prefix: string): string;
}

export function createIdFactory(burstId: string): IdFactory {
  let counter = 0;
  return {
    next(prefix: string): string {
      counter += 1;
      return `${prefix}-${burstId}-${counter}`;
    },
  };
}
