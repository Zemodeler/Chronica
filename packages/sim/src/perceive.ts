import { stableHash, type Character, type WorldState } from "@chronica/shared";
import type { NeighbourReading } from "./board";
import { dispositionOf } from "./disposition";

/**
 * What a ruler believes of his neighbour's strength, which is not what it is.
 *
 * The board (`board.ts`) reads exact strength from state, and every ruler used
 * to weigh every neighbour by it: nobody ever overrated himself, mistook a
 * bluff for an army, or was surprised. A man who does not know thinks. What a
 * ruler believes here is the truth moved by what a man in his place would
 * actually get wrong:
 *
 * - **How little he can find out.** A distant power is guessed at; a near one
 *   is seen. A ruler of poor intelligence and learning has few reliable
 *   informers; a well-read, intriguing one has many. A power he is at war with
 *   he has seen the armies of, and is far better informed of.
 * - **What he wants to believe.** The proud overrate themselves and underrate
 *   an enemy; the frightened see the enemy stronger than he is.
 * - **A season at a time.** What he believes is what he was told this
 *   quarter -- the same for the whole quarter, different the next -- so he
 *   changes his mind when the news does, not every month.
 *
 * Deterministic, from the ruler and the neighbour and the quarter. No model.
 */

/** The whole of a ruler's belief about one neighbour: our strength over theirs, as he reckons it. */
export function perceivedRatio(world: WorldState, ruler: Character, neighbour: Pick<NeighbourReading, "polityId" | "ratio" | "km" | "relation">): number {
  const day = world.instant.day;
  const d = dispositionOf(ruler, day);
  const intel = (ruler.skills.intrigue + ruler.skills.learning) / 200;
  const seen = neighbour.relation === "war" ? 0.4 : 1;
  const sigma = (0.12 + Math.min(3_000, Math.max(0, neighbour.km)) / 3_000 * 0.28 + (1 - intel) * 0.2) * seen;
  // Told something this quarter, and nothing else until the next.
  const told = ((stableHash([ruler.id, neighbour.polityId, String(Math.floor(day / 90)), "told"]) % 2_001) / 1_000 - 1) * sigma;
  // What he wants to believe: the proud overrate us, the frightened overrate them.
  const wishful = (d.pride - 0.5) * 0.3 - (d.fear - 0.5) * 0.2;
  return Math.max(0.02, Math.min(50, neighbour.ratio * Math.exp(told + wishful)));
}
