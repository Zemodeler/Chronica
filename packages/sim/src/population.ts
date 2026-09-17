import type { Fact, WorldState } from "@chronica/shared";

/**
 * Which countries the world owes people (VISION §4, §5).
 *
 * A scenario is deliberately sparse: it names polities and territory and leaves
 * the rest to be generated when history requires it. Nothing was requiring it.
 * The result was a map of countries that could not act, negotiate or resist --
 * an invasion of the Boii found no Boii to fight, because the Boii were a name
 * on a province and nothing else.
 *
 * This finds the gaps deterministically and cheaply. Filling them is the
 * orchestrator's job, in the call it was already making, through the
 * `character_create` and `force_create` it already has. Nothing here spends a
 * model call of its own.
 *
 * Ranked, not exhaustive. A world does not need every hill tribe to have a
 * named chieftain the moment play begins, but the country a legion is marching
 * into needs one now, and the large neighbours need one soon.
 */

export interface PolityGap {
  readonly polityId: string;
  readonly name: string;
  readonly provinceCount: number;
  readonly needsLeader: boolean;
  readonly needsForce: boolean;
  /** Why this one, in words the prompt can use. */
  readonly why: string;
}

export interface PopulationInput {
  readonly world: WorldState;
  readonly ownPolityId: string | null;
  /** Recent history: a polity these facts touch is one the player is dealing with now. */
  readonly facts: readonly Fact[];
  readonly limit?: number;
}

/** Polities named by recent history -- whoever the player is currently entangled with. */
function involvedPolityIds(facts: readonly Fact[]): Set<string> {
  return new Set(
    facts.flatMap((fact) => fact.affectedEntities.filter((entity) => entity.kind === "polity").map((entity) => entity.id)),
  );
}

export function findPolityGaps(input: PopulationInput): PolityGap[] {
  const { world } = input;
  const involved = involvedPolityIds(input.facts);

  const provincesBy = new Map<string, number>();
  for (const province of world.map.provinces) {
    if (province.controllerPolityId === null) continue;
    provincesBy.set(province.controllerPolityId, (provincesBy.get(province.controllerPolityId) ?? 0) + 1);
  }

  // Who we share a border with. A neighbour matters more than a distant power,
  // whatever its size.
  const ourProvinces = new Set(world.map.provinces.filter((province) => province.controllerPolityId === input.ownPolityId).map((province) => province.id));
  const controllerOf = new Map(world.map.provinces.map((province) => [province.id, province.controllerPolityId]));
  const neighbours = new Set<string>();
  for (const edge of world.map.edges) {
    const fromOurs = ourProvinces.has(edge.from);
    const toOurs = ourProvinces.has(edge.to);
    if (fromOurs === toOurs) continue;
    const theirs = controllerOf.get(fromOurs ? edge.to : edge.from);
    if (theirs !== null && theirs !== undefined && theirs !== input.ownPolityId) neighbours.add(theirs);
  }

  const gaps: { gap: PolityGap; score: number }[] = [];
  for (const polity of world.map.polities) {
    if (polity.id === input.ownPolityId) continue;
    const provinceCount = provincesBy.get(polity.id) ?? 0;
    if (provinceCount === 0) continue;

    const needsLeader = !world.characters.some((character) => character.polityId === polity.id && character.alive);
    const needsForce = !world.material.forces.some((force) => force.polityId === polity.id);
    if (!needsLeader && !needsForce) continue;

    const reasons: string[] = [];
    let score = provinceCount;
    if (involved.has(polity.id)) {
      score += 10;
      reasons.push("the player is dealing with them now");
    }
    if (neighbours.has(polity.id)) {
      score += 4;
      reasons.push("they border us");
    }
    if (polity.capitalSettlementId !== null) {
      score += 2;
      reasons.push("they hold a named capital");
    }
    if (provinceCount > 1) reasons.push(`they hold ${provinceCount} provinces`);

    gaps.push({
      score,
      gap: {
        polityId: polity.id,
        name: polity.name,
        provinceCount,
        needsLeader,
        needsForce,
        why: reasons.length === 0 ? "they hold territory and nobody speaks for them" : reasons.join(", "),
      },
    });
  }

  // Deterministic: score, then name, never map order.
  gaps.sort((a, b) => b.score - a.score || a.gap.polityId.localeCompare(b.gap.polityId));
  return gaps.slice(0, input.limit ?? 2).map((entry) => entry.gap);
}
