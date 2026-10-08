import { fitStrengthOf, type Force } from "@chronica/shared";
import { enemyArmies, reachOf, worthOf, type StrategyContext } from "./grand-strategy";

/**
 * A power at war with two enemies divides its armies between them (docs/plans/war-plans.md, "War gaps closed").
 *
 * The bigger enemy used to have the first claim on every army, and the smaller war's plan was made with none to carry it out. A
 * Roman consul with the Carthaginians in Sicily and the Campanians at Rhegium sent every legion to the one and left the other to
 * itself. The claim of a war is now reckoned from what is to be feared in it and what is to be won or lost in it: the enemy's men
 * in the field (the hundreds, as a man counts a threat), the ground of ours that he holds, his armies on our ground and near the
 * capital. Each war that has an enemy army in the field keeps at least one army of its own, where the power has as many armies as wars
 * (the reserve for the second war), and the rest go where the claim per army is greatest. An army already at work in a war stays in it
 * while the war's share allows, so that the split is not changed month by month.
 */

/** A war's claim: the enemy's men by the hundred, and the worth of the ground of ours he holds and of the armies he has on it. */
export function claimOf(ctx: StrategyContext): number {
  const armies = enemyArmies(ctx);
  const men = armies.reduce((sum, force) => sum + fitStrengthOf(force), 0);
  let ground = 0;
  for (const province of ctx.provinces.values()) {
    if (province.controllerPolityId !== null && ctx.enemies.has(province.controllerPolityId) && (province.ownerPolityId ?? province.controllerPolityId) === ctx.polityId) ground += worthOf(ctx, province.id);
  }
  for (const force of armies) {
    const province = ctx.provinces.get(force.locationId);
    if (province !== undefined && (province.ownerPolityId ?? province.controllerPolityId) === ctx.polityId) ground += 45;
  }
  return men / 100 + ground;
}

export interface WarClaim {
  readonly enemy: string;
  readonly ctx: StrategyContext;
}

/**
 * The armies of each war: `mine` shared among the wars by their claims. `placedIn` says which war each army is at work in (from its orders), so
 * that an army keeps to its war while the share allows.
 */
export function shareArmies(wars: readonly WarClaim[], mine: readonly Force[], placedIn: ReadonlyMap<string, string>): Map<string, Force[]> {
  const out = new Map<string, Force[]>(wars.map((war) => [war.enemy, []]));
  if (wars.length === 0) return out;
  if (wars.length === 1) { out.get(wars[0]!.enemy)!.push(...mine); return out; }
  const claims = new Map(wars.map((war) => [war.enemy, claimOf(war.ctx)] as const));
  // Wars with nothing in the field and nothing lost have no claim: the army goes where there is something to do.
  const live = wars.filter((war) => (claims.get(war.enemy) ?? 0) > 0);
  const eligible = live.length === 0 ? [wars[0]!] : live;
  const quota = new Map<string, number>(eligible.map((war) => [war.enemy, 0] as const));
  // The reserve: one army to each war, the greater claims first, while there are armies to give.
  const byClaim = [...eligible].sort((a, b) => (claims.get(b.enemy) ?? 0) - (claims.get(a.enemy) ?? 0) || a.enemy.localeCompare(b.enemy));
  let left = mine.length;
  for (const war of byClaim) { if (left <= 0) break; quota.set(war.enemy, 1); left -= 1; }
  // The rest where the claim per army is greatest.
  while (left > 0) {
    const next = [...byClaim].sort((a, b) => (claims.get(b.enemy) ?? 0) / ((quota.get(b.enemy) ?? 0) + 1) - (claims.get(a.enemy) ?? 0) / ((quota.get(a.enemy) ?? 0) + 1) || a.enemy.localeCompare(b.enemy))[0]!;
    quota.set(next.enemy, (quota.get(next.enemy) ?? 0) + 1);
    left -= 1;
  }
  const strongest = [...mine].sort((a, b) => fitStrengthOf(b) - fitStrengthOf(a) || a.id.localeCompare(b.id));
  const unplaced: Force[] = [];
  for (const force of strongest) {
    const war = placedIn.get(force.id);
    const given = war === undefined ? undefined : out.get(war);
    if (war !== undefined && given !== undefined && given.length < (quota.get(war) ?? 0)) given.push(force);
    else unplaced.push(force);
  }
  // The war with the most still owing takes the nearest of the armies left (the strongest, where the roads tell nothing), the greater claims first.
  for (const war of byClaim) {
    while ((out.get(war.enemy)?.length ?? 0) < (quota.get(war.enemy) ?? 0) && unplaced.length > 0) {
      const there = enemyArmies(war.ctx).map((force) => force.locationId);
      const km = (force: Force): number => {
        const reach = reachOf(war.ctx, force.locationId, 900, true);
        return there.length === 0 ? 900 : Math.min(...there.map((place) => reach.get(place) ?? 900), 900);
      };
      const first = out.get(war.enemy)!.length === 0;
      // A war's first army is the strongest left to be had if it is the greater war, and the nearest if it is the lesser.
      const pick = [...unplaced].sort((a, b) => (first && war === byClaim[0] ? fitStrengthOf(b) - fitStrengthOf(a) : km(a) - km(b) || fitStrengthOf(b) - fitStrengthOf(a)) || a.id.localeCompare(b.id))[0]!;
      out.get(war.enemy)!.push(pick);
      unplaced.splice(unplaced.indexOf(pick), 1);
    }
  }
  return out;
}
