import { WorldDeltaSchema, type OrderGoal, type OrderStage, type WorldDelta, type WorldState } from "@chronica/shared";

/**
 * An act held for later, with every handle its own answer made put to the id
 * it was given.
 *
 * Held acts kept "local:fleet-question" as written, and were tried again days
 * later with a fresh map of handles -- in which nothing had that name -- so
 * the Senate's fleet question failed as "local:fleet-question, which nothing
 * in this batch created", and its part still read done (E9). A handle the
 * answer did make becomes its id; one it did not is left as written, for the
 * act held beside it that will make it.
 */
export function resolveHandles<T>(value: T, assignedIds: ReadonlyMap<string, string>): T {
  if (assignedIds.size === 0) return value;
  const walk = (entry: unknown): unknown => {
    if (typeof entry === "string") return entry.startsWith("local:") ? assignedIds.get(entry.slice("local:".length)) ?? entry : entry;
    if (Array.isArray(entry)) return entry.map(walk);
    if (entry !== null && typeof entry === "object") return Object.fromEntries(Object.entries(entry).map(([key, inner]) => [key, walk(inner)]));
    return entry;
  };
  return walk(value) as T;
}

/**
 * The same act held on the same conditions once, however many orders held it:
 * "carry the legion over" given three times held the crossing three times,
 * and each was tried, and failed, on its own.
 */
export function dedupeStages(stages: readonly OrderStage[]): OrderStage[] {
  const seen = new Set<string>();
  return stages.filter((stage) => {
    if (stage.status !== "waiting") return true;
    const key = JSON.stringify({ held: stage.held, waitsOn: stage.waitsOn });
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * What the actor can do himself of what a part wants, as acts: his own army
 * to the place the part wants it, himself to where he meant to go.
 *
 * A held instruction was always handed on, to anybody holding an office
 * except the man who gave it -- so the consul's own crossing, held for ships,
 * was given to a colleague when the ships came, and read "handed on, not yet
 * taken up" for the rest of the season (E10). What he commands, or is, he
 * does; only the rest is handed on.
 */
export function actsHeCanDo(world: WorldState, actorId: string, goals: readonly OrderGoal[], said: string): WorldDelta[] {
  const acts: WorldDelta[] = [];
  for (const goal of goals) {
    if (goal.kind === "force_at") {
      const force = world.material.forces.find((candidate) => candidate.id === goal.forceId);
      if (force === undefined || (force.commanderCharacterId !== actorId && force.controllerCharacterId !== actorId) || force.locationId === goal.provinceId) continue;
      const act = WorldDeltaSchema.safeParse({ op: "force_modify", forceRef: force.id, locationId: goal.provinceId, reason: said.slice(0, 200) });
      if (act.success) acts.push(act.data);
    } else if (goal.kind === "character_at" && goal.characterId === actorId) {
      const act = WorldDeltaSchema.safeParse({ op: "character_state_set", characterRef: actorId, moveToProvinceId: goal.provinceId, reason: said.slice(0, 200) });
      if (act.success) acts.push(act.data);
    }
  }
  return acts;
}
