import { newsDaysBetween, whereItHappened, whereTheyHear, type Fact, type WorldState } from "@chronica/shared";
import { STRANGER_RELATION, newsRelations } from "./far-powers";

/**
 * Far news that reaches the player (docs/plans/a-living-world.md §9, the
 * user's rule: "only if it is genuinely interesting").
 *
 * The world now moves everywhere at once -- wars in Gaul, raids in Numidia,
 * occupations in Phoenicia, coups in Aetolia -- and every one of those is a
 * public fact. Told to Rome as public news, two years of it would bury the
 * Chronicle. Each fact the player's own side is not in is scored: what kind
 * of thing it is (a war, a dead king, a city sacked, a throne seized count; a
 * district occupied or a border raid does not), how far off it happened, how
 * near the powers in it stand to the player's (`newsRelations`), and whether
 * a great power is in it. Below the bar it stays the news of the powers it
 * happened to -- `polity`, known to their own people -- and never reaches
 * Rome's record.
 *
 * Relevance was once a yes-or-no: a fact naming any power the government had
 * ever "dealt with" -- most of the map -- counted in full, anything else at six
 * tenths, and a fact naming no power was never weighed at all. A war declared
 * between two Greek leagues passed at 42 against a bar of 40, and forty days
 * of play wrote 487 facts (L16). Now it is two measures multiplied: how far
 * off it happened, and what its powers are to him.
 */

/** How much a kind of news is worth telling, before distance. */
const IMPORTANCE: Readonly<Record<string, number>> = {
  war_declared: 70, war_cause: 70, revolt: 70, peace_made: 60, polity_ended: 80, polity_created: 60,
  usurpation: 85, succession_seized: 85, succession_disputed: 55, city_sacked: 70, execution: 45,
  alliance_made: 45, siege_ended: 45, battle: 40, sea_battle: 45, subsidy: 25, rumour: 25, reputation: 30,
  peace_talks_failed: 35, character_died: 50, death: 50,
  province_occupied: 10, province_raided: 10, siege_laid: 15, siege_progress: 5, siege_event: 10,
};
/** A fact must score this to cross the world to the player. */
export const TELLING_BAR = 40;

/** Within this many days of the player's ground, distance takes nothing off. */
export const NEAR_NEWS_DAYS = 6;
/** Over this many days more, the share distance leaves falls to its floor. */
const FADE_NEWS_DAYS = 14;
/** What distance leaves of news from the far side of the world. */
const FAR_NEWS_FLOOR = 0.2;

/** The share of a fact's importance that survives the road: all of it near, a fifth from the far side of the world. */
export function distanceFactor(days: number | null): number {
  if (days === null) return 1;
  return Math.max(FAR_NEWS_FLOOR, Math.min(1, 1 - (days - NEAR_NEWS_DAYS) / FADE_NEWS_DAYS));
}

/** Where the player hears things, and what every power is to him: worked out once a window, not once a fact. */
export interface NewsReach {
  readonly playerId: string;
  readonly ownPolityId: string;
  readonly relations: ReadonlyMap<string, number>;
  /** Where he stands, his power's seat, and the ground it holds. */
  readonly seats: readonly string[];
}

export function newsReachOf(world: WorldState, playerId: string | null): NewsReach | null {
  if (playerId === null) return null;
  const relations = newsRelations(world, playerId);
  const ownPolityId = world.characters.find((character) => character.id === playerId)?.polityId ?? null;
  if (relations === null || ownPolityId === null) return null;
  const seats = [...new Set([
    whereTheyHear(world, { kind: "character", id: playerId }),
    whereTheyHear(world, { kind: "polity", id: ownPolityId }),
    ...world.map.provinces.filter((province) => province.controllerPolityId === ownPolityId).map((province) => province.id),
  ].filter((seat): seat is string => seat !== null))];
  return { playerId, ownPolityId, relations, seats };
}

/** The power behind each thing a fact names: a person's, an army's, the holder of a place or a town. */
function derivedPowers(fact: Pick<Fact, "affectedEntities">, world: WorldState): string[] {
  const derived = new Set<string>();
  for (const entity of fact.affectedEntities) {
    const polityId = entity.kind === "polity" ? entity.id
      : entity.kind === "character" ? world.characters.find((character) => character.id === entity.id)?.polityId
        : entity.kind === "force" ? world.material.forces.find((force) => force.id === entity.id)?.polityId
          : entity.kind === "province" ? world.map.provinces.find((province) => province.id === entity.id)?.controllerPolityId
            : entity.kind === "settlement" ? world.map.provinces.find((province) => province.settlements.some((settlement) => settlement.id === entity.id))?.controllerPolityId
              : undefined;
    if (polityId != null) derived.add(polityId);
  }
  return [...derived];
}

/**
 * The powers a fact is about: those it names, or else the powers of the
 * people, armies, places and towns it names. A fact naming no power used to
 * pass whatever it was, because nobody had written a power beside it.
 */
export function powersOfFact(fact: Pick<Fact, "affectedEntities">, world: WorldState): string[] {
  const named = fact.affectedEntities.filter((entity) => entity.kind === "polity").map((entity) => entity.id);
  return named.length > 0 ? named : derivedPowers(fact, world);
}

/** Days word takes from where a fact happened to the nearest place the player hears things; null where it happened nowhere in particular. */
function daysOff(fact: Fact, world: WorldState, reach: NewsReach): number | null {
  const places = whereItHappened(world, fact);
  if (places.length === 0 || reach.seats.length === 0) return null;
  return Math.min(...places.flatMap((place) => reach.seats.map((seat) => newsDaysBetween(world, place, seat))));
}

/** How much of a fact's importance reaches the player: distance times what its powers are to him. */
export function relevance(fact: Fact, world: WorldState, reach: NewsReach): number {
  const polities = powersOfFact(fact, world);
  const relation = polities.length === 0 ? STRANGER_RELATION : Math.max(...polities.map((id) => reach.relations.get(id) ?? STRANGER_RELATION));
  return distanceFactor(daysOff(fact, world, reach)) * relation;
}

/** How worth telling a fact is, to the player of this world. `weight` is its author's, for a kind the table does not know. */
export function newsworthiness(fact: Fact, world: WorldState, reach: NewsReach, weight?: number): number {
  const polities = powersOfFact(fact, world);
  const base = IMPORTANCE[fact.kind] ?? weight ?? 30;
  // News of a great power carries further.
  const great = world.map.polities.filter((polity) => polities.includes(polity.id))
    .some((polity) => world.map.provinces.filter((province) => province.controllerPolityId === polity.id).length >= 60);
  return Math.round(base * relevance(fact, world, reach) * (great ? 1.2 : 1));
}

/**
 * Whether a fact is the player's own: it names him, or anything of his
 * power's -- its people, its armies, its ground. Never kept from him, whatever
 * it weighs: his army, his city, his offices and his letters are the first
 * thing his record is for.
 */
export function isHisOwn(fact: Pick<Fact, "affectedEntities">, world: WorldState, reach: NewsReach): boolean {
  if (fact.affectedEntities.some((entity) => entity.kind === "character" && entity.id === reach.playerId)) return true;
  return derivedPowers(fact, world).includes(reach.ownPolityId);
}

/**
 * The facts of a window, with what is not worth telling kept to the powers it
 * happened to. A fact of the player's own is always told; so is anything
 * already private or kept to a power, and anything that happened nowhere and
 * to nobody in particular, which cannot be weighed.
 */
export function keepFarNewsHome(facts: Fact[], from: number, world: WorldState, playerId: string | null, weights?: ReadonlyMap<string, number>): void {
  const reach = newsReachOf(world, playerId);
  if (reach === null) return;
  for (let index = from; index < facts.length; index += 1) {
    const fact = facts[index]!;
    if (fact.visibility !== "public") continue;
    if (isHisOwn(fact, world, reach)) continue;
    if (powersOfFact(fact, world).length === 0 && whereItHappened(world, fact).length === 0) continue;
    if (newsworthiness(fact, world, reach, weights?.get(fact.id)) >= TELLING_BAR) continue;
    facts[index] = { ...fact, visibility: "polity" };
  }
}

/**
 * How much a fact about a power's own monthly business must weigh to be
 * written down at all, or undefined when it is anybody's to read.
 *
 * Statecraft moves every power every month, and each move left its facts:
 * levies, marches, letters between kings at the far end of the map. Forty
 * days of play wrote 487 of them, and every one was a candidate the Chronicle
 * had to weigh and carry. A power that is neither the player's own, at war or
 * in league with it, its neighbour, nor one it has had words with this year
 * (`newsRelations`) does its small business unrecorded; what is weighty --
 * a war, a throne -- is still written, and still kept home if it is not
 * worth the telling.
 */
export function farBusinessFloor(relations: ReadonlyMap<string, number> | null, polityIds: readonly (string | null)[]): number | undefined {
  if (relations === null) return undefined;
  const nearest = Math.max(...polityIds.map((id) => (id === null ? 0 : relations.get(id) ?? STRANGER_RELATION)));
  return nearest >= 0.5 ? undefined : TELLING_BAR;
}
