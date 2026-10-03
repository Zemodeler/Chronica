import { WorldStateSchema, type WorldState } from "@chronica/shared";

/**
 * What a step left in the world that will not load, or null: each top-level
 * piece of the world it rewrote, held to its own schema.
 *
 * The burst's own bookkeeping -- the order ledger, the held acts, the
 * envelopes, plans' steps -- wrote the world directly, with nothing to check
 * it, and one bad field in it (a plan step slipped four times, a "paid" goal
 * of nothing) made the saved world fail its own schema: every order after it
 * was refused, and the game could not be loaded (E1). Only the pieces the
 * step changed are read, so a guard after every step costs what the step
 * wrote, not the whole world.
 */
export function brokenBy(before: WorldState, after: WorldState): string | null {
  const shape = WorldStateSchema.shape as unknown as Record<string, { safeParse(value: unknown): { success: boolean; error?: { issues: readonly { path: PropertyKey[]; message: string }[] } } }>;
  for (const key of Object.keys(shape)) {
    const now = (after as unknown as Record<string, unknown>)[key];
    if (now === (before as unknown as Record<string, unknown>)[key]) continue;
    const parsed = shape[key]!.safeParse(now);
    if (parsed.success) continue;
    const issue = parsed.error?.issues[0];
    return issue === undefined ? key : `${[key, ...issue.path.map(String)].join(".")}: ${issue.message}`;
  }
  return null;
}

/** The first issue of a whole world that will not load, as a path and a message; null when it loads. */
export function whyItWillNotLoad(world: WorldState): string | null {
  const parsed = WorldStateSchema.safeParse(world);
  if (parsed.success) return null;
  const issue = parsed.error.issues[0];
  return issue === undefined ? "unknown" : `${issue.path.map(String).join(".")}: ${issue.message}`;
}
