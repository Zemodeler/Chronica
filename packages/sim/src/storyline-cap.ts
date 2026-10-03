import { openStorylines, type WorldState, type WorldStoryline } from "@chronica/shared";

/**
 * How many threads the world follows at once, counted by whose they are.
 *
 * One cap over every thread was how a player's own storyline was refused with
 * "The world is already following 12 threads" (E24): the world had filled the
 * cap itself, and four engine paths -- a covert plot, a commander cut off in
 * the field, an heirless estate, a nemesis -- added threads without asking, so
 * a save held twenty-six. The world's threads and the ones orders open are
 * now counted apart, and neither can crowd out the other.
 */
export const WORLD_THREAD_CAP = 12;
/** Threads opened by an order -- the player's, or a character acting on his own turn. */
export const ORDER_THREAD_CAP = 6;

type Pool = "world" | "order";

/** A thread an order opened is the order's; the scenario's and the world's are the world's. */
const poolOf = (storyline: WorldStoryline): Pool => (storyline.origin === "character" ? "order" : "world");

/**
 * Threads the engine is still telling something in: an unresolved plot, a
 * commander still cut off, a nemesis still pressing. Closing one would end
 * the matter's telling while the matter went on -- and a nemesis whose thread
 * closes is retired -- so these are never the ones set aside.
 */
function boundThreadIds(world: WorldState): Set<string> {
  return new Set([
    ...world.covertPlots.filter((plot) => plot.resolvedAtStep === null && plot.storylineId !== null).map((plot) => plot.storylineId!),
    ...world.fieldPerils.filter((peril) => peril.resolvedAtStep === null).map((peril) => peril.storylineId),
    ...world.nemeses.filter((nemesis) => nemesis.retiredAtStep === null).map((nemesis) => nemesis.storylineId),
  ]);
}

/** Whether the world's own threads already fill its cap, so it must close one before opening another. */
export function worldThreadsFull(world: WorldState): boolean {
  return openStorylines(world.storylines).filter((storyline) => poolOf(storyline) === "world").length >= WORLD_THREAD_CAP;
}

/**
 * Closes the stalest open threads of a pool until it holds at most `keep`,
 * saying why in each one's history. Stalest is least recently moved; threads
 * the engine is still telling are skipped, so a pool of nothing else stays over.
 */
function setAside(
  world: WorldState,
  storylines: readonly WorldStoryline[],
  pool: Pool,
  keep: number,
  atStep: number,
  why: string,
): { readonly storylines: WorldStoryline[]; readonly closed: WorldStoryline[] } {
  const open = openStorylines([...storylines]).filter((storyline) => poolOf(storyline) === pool);
  if (open.length <= keep) return { storylines: [...storylines], closed: [] };
  const bound = boundThreadIds(world);
  const closed = open
    .filter((storyline) => !bound.has(storyline.id))
    .sort((a, b) => a.updatedAtStep - b.updatedAtStep || a.openedAtStep - b.openedAtStep || a.id.localeCompare(b.id))
    .slice(0, open.length - keep);
  if (closed.length === 0) return { storylines: [...storylines], closed: [] };
  const ids = new Set(closed.map((storyline) => storyline.id));
  return {
    storylines: storylines.map((storyline) => (ids.has(storyline.id)
      ? { ...storyline, phase: "closed" as const, closedAtStep: atStep, updatedAtStep: atStep, history: [...storyline.history, why].slice(-24) }
      : storyline)),
    closed,
  };
}

/**
 * Room for a thread the order itself opens, which is never refused: the
 * player asked for it. Where the world's threads fill their cap the stalest
 * of them gives way -- one, not the whole overflow, which is the day's sweep
 * to settle -- and where the orders' do, the stalest order's.
 */
export function makeRoomForTheOrder(world: WorldState, atStep: number, title: string): WorldState {
  const why = `Set aside unresolved: the world could not follow more threads, and "${title}" was opened.`.slice(0, 480);
  const open = openStorylines(world.storylines);
  const count = (pool: Pool): number => open.filter((storyline) => poolOf(storyline) === pool).length;
  const keep = (pool: Pool, cap: number): number => (count(pool) >= cap ? count(pool) - 1 : count(pool));
  const fromWorld = setAside(world, world.storylines, "world", keep("world", WORLD_THREAD_CAP), atStep, why);
  const fromOrders = setAside(world, fromWorld.storylines, "order", keep("order", ORDER_THREAD_CAP), atStep, why);
  return fromOrders.closed.length + fromWorld.closed.length === 0 ? world : { ...world, storylines: fromOrders.storylines };
}

/**
 * The day's sweep: the world's threads brought back under its cap, oldest
 * idle first. Engine paths open threads without asking -- they must, since a
 * plot or an encirclement cannot be refused for want of room -- so the cap is
 * kept here rather than at each of them.
 */
export function sweepThreadsOverTheCap(
  world: WorldState,
  storylines: readonly WorldStoryline[],
  atStep: number,
): { readonly storylines: WorldStoryline[]; readonly closed: WorldStoryline[] } {
  return setAside(world, storylines, "world", WORLD_THREAD_CAP, atStep, "Set aside unresolved: the world had more threads than it could follow, and this one had gone longest untouched.");
}
