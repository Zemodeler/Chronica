import type { WorldState } from "@chronica/shared";

/**
 * The censors' mark (*nota censoria*): a man struck from the roll of the Senate by the censors stays off it, and is not enrolled again with the other men
 * who held a magistracy, until the next censors read the roll (`the-lectio.ts`) and lift it or lay it again. Kept as a small record on the world, one a man,
 * and no more than the censors strike.
 */
export const NOTA_KIND = "nota";

/** Whether the censors have a mark against this man now. */
export const isNoted = (world: Pick<WorldState, "genericEntities">, characterId: string): boolean =>
  world.genericEntities.some((entity) => entity.kind === NOTA_KIND && entity.attributes?.["characterId"] === characterId);
