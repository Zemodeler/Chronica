import type { WorldState } from "@chronica/shared";
import { createIdFactory, type IdFactory } from "./ports";

/**
 * Ids for a test's acts that the world they act on has not used.
 *
 * A burst mints its ids under its own name, and no two bursts of a game share
 * one. A test that takes two acts on one world under one seed made two rows
 * under one id, and the books lost the second (`ids.unique`); a counter kept
 * across the file gave each act its own seed and two runs of one plan two
 * different worlds (`war-plans-are-deterministic`). The seed is the test's,
 * and an id the world already holds is passed over: the first act on a fresh
 * world gets `project-test-1`, the same in every run.
 */
export function freshIds(seed: string, world: WorldState): IdFactory {
  const taken = idsIn(world);
  const ids = createIdFactory(seed);
  return {
    next(prefix: string): string {
      let id = ids.next(prefix);
      while (taken.has(id)) id = ids.next(prefix);
      return id;
    },
  };
}

/** Every id a row of the world holds, in its own collections and its material. */
function idsIn(world: WorldState): Set<string> {
  const taken = new Set<string>();
  for (const collection of [...Object.values(world), ...Object.values(world.material)]) {
    if (!Array.isArray(collection)) continue;
    for (const row of collection as unknown[]) {
      const id = (row as { id?: unknown } | null)?.id;
      if (typeof id === "string") taken.add(id);
    }
  }
  return taken;
}
