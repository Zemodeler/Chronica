import type { Fact, WorldState } from "@chronica/shared";
import { campaignOf, ownSideOf, personallyTouchedBy } from "./chronicle";
import type { Office } from "@chronica/shared";

/**
 * The facts a burst's report leads with, for the player it is written for.
 *
 * Ranked by weight alone, a 300-fact season led with other powers' elections and lustrum counts, and nothing the player's own
 * hands, treaties, ships or ground had done (docs/reports/2026-10-22-hannibal-gisco-3y-hand-run.md, H3). What touches the
 * player's own side comes first, then what touches the war or the orders they have set going, then the rest, each by weight.
 */
export function factsForPlayer(
  facts: readonly Fact[],
  significanceByFactId: ReadonlyMap<string, number>,
  world: WorldState,
  characterId: string,
  polityId: string | null,
  offices: readonly Office[],
): Fact[] {
  const personal = personallyTouchedBy(world, characterId, polityId, offices);
  const own = ownSideOf(world, characterId, polityId);
  const campaign = campaignOf(world, characterId, polityId);
  const tier = (fact: Fact): number => {
    const touched = fact.affectedEntities.map((entity) => entity.id);
    if (touched.some((id) => personal.has(id))) return 3;
    if (touched.some((id) => own.has(id))) return 2;
    if (touched.some((id) => campaign.has(id))) return 1;
    return 0;
  };
  return [...facts]
    .map((fact, index) => ({ fact, index, tier: tier(fact), weight: significanceByFactId.get(fact.id) ?? 0 }))
    .sort((a, b) => b.tier - a.tier || b.weight - a.weight || a.index - b.index)
    .map((entry) => entry.fact);
}


