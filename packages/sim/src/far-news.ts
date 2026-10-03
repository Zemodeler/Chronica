import type { Fact, WorldState } from "@chronica/shared";
import { powersDealtWith } from "./far-powers";

/**
 * Far news that reaches the player (docs/plans/a-living-world.md §9, the
 * user's rule: "only if it is genuinely interesting").
 *
 * The world now moves everywhere at once -- wars in Gaul, raids in Numidia,
 * occupations in Phoenicia, coups in Aetolia -- and every one of those is a
 * public fact. Told to Rome as public news, two years of it would bury the
 * Chronicle. Each fact naming powers the player's government has no business
 * with is scored: what kind of thing it is (a war, a dead king, a city
 * sacked, a throne seized count; a district occupied or a border raid does
 * not), how near the powers in it stand to the player's (`powersDealtWith`),
 * and whether a great power is in it. Below the bar it
 * stays the news of the powers it happened to -- `polity`, known to their own
 * people -- and never reaches Rome's record.
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

/** The share of a fact's importance that reaches the player, by how near its powers are to his. */
function relevance(polityIds: readonly string[], dealt: ReadonlySet<string> | null): number {
  if (dealt === null || polityIds.length === 0) return 1;
  if (polityIds.some((id) => dealt.has(id))) return 1;
  return 0.6;
}

/** How worth telling a fact is, to the player of this world. */
export function newsworthiness(fact: Fact, world: WorldState, playerId: string | null): number {
  const polities = fact.affectedEntities.filter((entity) => entity.kind === "polity").map((entity) => entity.id);
  const base = IMPORTANCE[fact.kind] ?? 30;
  const dealt = powersDealtWith(world, playerId);
  // News of a great power carries further.
  const great = world.map.polities.filter((polity) => polities.includes(polity.id))
    .some((polity) => world.map.provinces.filter((province) => province.controllerPolityId === polity.id).length >= 60);
  return Math.round(base * relevance(polities, dealt) * (great ? 1.2 : 1));
}

/**
 * The facts of a window, with what is not worth telling kept to the powers it
 * happened to. A fact the player's own power is in, or a near power's, is
 * always told; so is anything already private or kept to a power.
 */
export function keepFarNewsHome(facts: Fact[], from: number, world: WorldState, playerId: string | null): void {
  if (playerId === null) return;
  const dealt = powersDealtWith(world, playerId);
  if (dealt === null) return;
  for (let index = from; index < facts.length; index += 1) {
    const fact = facts[index]!;
    if (fact.visibility !== "public") continue;
    const polities = fact.affectedEntities.filter((entity) => entity.kind === "polity").map((entity) => entity.id);
    const people = fact.affectedEntities.filter((entity) => entity.kind === "character").map((entity) => entity.id);
    if (people.includes(playerId)) continue;
    if (polities.length === 0 || polities.some((id) => dealt.has(id))) continue;
    if (newsworthiness(fact, world, playerId) >= TELLING_BAR) continue;
    facts[index] = { ...fact, visibility: "polity" };
  }
}
