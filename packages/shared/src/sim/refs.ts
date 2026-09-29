import { z } from "zod";

/**
 * How the model names things it is creating, without ever minting a real id.
 *
 * A model that supplies world ids will eventually supply one that does not
 * exist, and a hallucinated id that reaches the database is indistinguishable
 * from a real one afterwards. So the contract gives the model a scratch
 * namespace instead: it declares `localId: "legion_a"` on the delta that
 * creates a thing, and writes `"local:legion_a"` anywhere it wants to refer
 * to that thing later in the same payload. The engine assigns every real id
 * and resolves the `local:` prefixes afterwards (`resolveRef` below).
 *
 * A reference that is neither a `local:` handle nor an id already present in
 * the world is rejected by the delta applier -- as friction, not as an error.
 */

export const LOCAL_REF_PREFIX = "local:";

export const LocalIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  // Hyphens too: every id the model reads in the slice is hyphenated, so it
  // writes "clepsina-continues-march" and lost whole cognition batches to a
  // rule that gained nothing.
  .regex(/^[a-z0-9_-]+$/, "A localId is lowercase letters, digits, underscores and hyphens.")
  .meta({ id: "LocalId" });

/** Either an existing world entity id, or `local:<localId>` minted in this same payload. */
export const RefSchema = z.string().trim().min(1).max(130).meta({ id: "Ref" });

/**
 * A reference that may be absent. Named, like `Ref` itself, because the
 * orchestrator's schema wrote it out in full some forty times, and every
 * character of that schema is paid on every order.
 */
export const MaybeRefSchema = RefSchema.nullable().meta({ id: "MaybeRef" });
export type Ref = z.infer<typeof RefSchema>;

export function isLocalRef(ref: string): boolean {
  return ref.startsWith(LOCAL_REF_PREFIX);
}

export function localIdOf(ref: string): string {
  return ref.slice(LOCAL_REF_PREFIX.length);
}

export function localRef(localId: string): string {
  return `${LOCAL_REF_PREFIX}${localId}`;
}

/**
 * Resolves a reference against the ids assigned so far in this payload.
 * Returns undefined for an unresolved `local:` handle, so the caller can turn
 * that into friction rather than writing a dangling reference.
 */
export function resolveRef(ref: string, assigned: ReadonlyMap<string, string>): string | undefined {
  if (!isLocalRef(ref)) return ref;
  return assigned.get(localIdOf(ref));
}
