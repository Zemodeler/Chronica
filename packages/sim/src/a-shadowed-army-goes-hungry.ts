import { atWar, fitStrengthOf, kmBetween, type WorldState } from "@chronica/shared";

/**
 * An army shadowed is cut off from its bread (docs/plans/war-plans.md, "War gaps closed").
 *
 * An army under orders to shadow another (`CampaignPlan.mode` "shadow", its object the other army) keeps within a march of it and between it
 * and the country it would feed on, and fights only where the odds are plainly its own. While it does, the army shadowed cannot send its
 * foragers out (the country does not feed it, as it does not feed an army penned in its camp) and the convoys from a depot farther than
 * the depot's own province do not reach it: Fabius's way with Hannibal, who could find no standing corn and no quiet road for his supplies
 * (Polybius 3.90, Livy 22.12). Ground of its own side's that feeds it where it stands (a friendly province) still does, as it did, and a
 * depot in the very province it stands in. The cut is the engine's (`keepTheField`), so that it holds whoever gave the order and for the
 * model's armies as for the rules'.
 */

/** How near the shadowing army must keep, by the roads, for the other's foragers and convoys to be cut: a march and a half. */
export const SHADOW_KM = 300;
/** An army smaller than this is a screen of horse and not a shadow: it cuts nothing. */
export const SHADOW_MIN_MEN = 1_000;

/** The armies that are shadowed on `toDay`, by the armies shadowing them. */
export function shadowedForceIds(world: WorldState, toDay: number): Set<string> {
  const out = new Set<string>();
  for (const cp of world.campaigns ?? []) {
    if (cp.mode !== "shadow" || cp.objective.kind !== "army" || cp.expiresStep <= toDay) continue;
    const me = world.material.forces.find((force) => force.id === cp.forceId);
    const target = world.material.forces.find((force) => force.id === (cp.objective as { forceId: string }).forceId);
    if (me === undefined || target === undefined || me.polityId === target.polityId || fitStrengthOf(me) < SHADOW_MIN_MEN) continue;
    if (!atWar(world.polityAgreements, me.polityId, target.polityId)) continue;
    const km = me.locationId === target.locationId ? 0 : kmBetween(world, me.locationId, target.locationId, SHADOW_KM);
    if (km !== null && km <= SHADOW_KM) out.add(target.id);
  }
  return out;
}
