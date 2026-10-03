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

/**
 * How much ground a country must hold before the world owes it a leader without
 * the player having gone anywhere near it, as a share of the map. Set where the
 * Punic Wars map's real powers sit: twelve of its 780 provinces, which seventeen
 * countries clear and the sixty-odd single-province peoples do not. A share and
 * not a count, so a map cut into five times as many provinces asks for five
 * times as many; province area is near enough uniform for that to be the same
 * ground.
 */
const MAJOR_POWER_SHARE = 12 / 780;

/** Ceiling on what sheer size contributes, kept below the smallest relevance bonus. */
const MAX_SIZE_SCORE = 100;

/** The size score the old 780-province map gave a country holding `count` provinces. */
const SIZE_SCORE_PER_SHARE = 780;

export interface PolityGap {
  readonly polityId: string;
  readonly name: string;
  readonly provinceCount: number;
  readonly needsLeader: boolean;
  readonly needsForce: boolean;
  /** Where to raise them: a few of the provinces they hold, by id. Without these the model raised forces in "numidian-kingdoms". */
  readonly provinceIds: readonly string[];
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
/**
 * The calendar's own facts: a term run out, an election called or held, a
 * seat filled. A power far away holding its yearly elections is not history
 * naming it, and counting them had Heraclea Pontica and the Ionian Islands
 * filled in for a consul in Sicily.
 */
const ROUTINE_KINDS: ReadonlySet<string> = new Set(["office_term_ended", "election_called", "election_held", "election_failed", "office_filled"]);

function involvedPolityIds(facts: readonly Fact[]): Set<string> {
  return new Set(
    facts.filter((fact) => !ROUTINE_KINDS.has(fact.kind))
      .flatMap((fact) => fact.affectedEntities.filter((entity) => entity.kind === "polity").map((entity) => entity.id)),
  );
}

/** Three provinces to raise them in: the capital's first, then by name so the choice does not follow map order. */
function landOf(world: WorldState, polity: WorldState["map"]["polities"][number]): string[] {
  const held = world.map.provinces.filter((province) => province.controllerPolityId === polity.id);
  const capital = held.find((province) => province.settlements.some((settlement) => settlement.id === polity.capitalSettlementId));
  const rest = held.filter((province) => province !== capital).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return [...(capital === undefined ? [] : [capital]), ...rest].slice(0, 3).map((province) => province.id);
}

export function findPolityGaps(input: PopulationInput): PolityGap[] {
  const { world } = input;
  const involved = involvedPolityIds(input.facts);

  const majorProvinces = Math.max(2, Math.ceil(world.map.provinces.length * MAJOR_POWER_SHARE));
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

    // Contact, or consequence. The map holds over a hundred countries, and
    // inventing a chieftain for each would spend the world's attention on
    // people nobody will ever meet -- and keep spending it, burst after burst,
    // until the roster was full. A country earns its people when the player can
    // reach it, when history has already named it, or when it is large enough
    // that the powers of the age would have to reckon with it. The rest stay
    // names on the map until play arrives, which is the moment this same check
    // starts returning them.
    // By size alone: nearly every country on the whole map has a capital, and
    // counting one as reason enough had the Boii and the Dacians filled in
    // turn after turn for a consul at Messana.
    const major = provinceCount >= majorProvinces;
    if (!involved.has(polity.id) && !neighbours.has(polity.id) && !major) continue;

    const needsLeader = !world.characters.some((character) => character.polityId === polity.id && character.alive);
    const needsForce = !world.material.forces.some((force) => force.polityId === polity.id);
    if (!needsLeader && !needsForce) continue;

    // Relevance first, size only to break ties between equals. These were once
    // small bonuses added to the province count, which worked while no country
    // held more than a dozen provinces; on the whole map a quiet people holding
    // sixty-four of them outranked the country the player was invading. Size is
    // now bounded well below the smallest relevance bonus, so it can order the
    // shortlist but never choose it.
    const reasons: string[] = [];
    let score = Math.min(Math.round((provinceCount / world.map.provinces.length) * SIZE_SCORE_PER_SHARE), MAX_SIZE_SCORE);
    if (involved.has(polity.id)) {
      score += 1_000;
      reasons.push("recent events name them");
    }
    if (neighbours.has(polity.id)) {
      score += 400;
      reasons.push("they border us");
    }
    if (polity.capitalSettlementId !== null) {
      score += 200;
      reasons.push("they hold a named capital");
    }
    if (provinceCount > 1) reasons.push(`they hold ${provinceCount} provinces`);

    gaps.push({
      score,
      gap: {
        polityId: polity.id,
        name: polity.name,
        provinceCount,
        provinceIds: landOf(world, polity),
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
