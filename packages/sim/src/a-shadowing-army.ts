import { WorldDeltaSchema, fitStrengthOf, type CampaignPlan, type Force, type StatecraftAct, type WorldDelta } from "@chronica/shared";
import type { Temper } from "./battle-plan";
import { enemyArmies, reachOf, type StrategyContext } from "./grand-strategy";
import { SHADOW_KM, SHADOW_MIN_MEN } from "./a-shadowed-army-goes-hungry";

/**
 * Shadowing an enemy army (docs/plans/war-plans.md, "War gaps closed"): the way of a careful strategist against a stronger enemy.
 *
 * Not to hold a town and refuse the battle (`refuse`), where the enemy is left to range the country, nor to march away: to keep within a
 * march of his army, on the road between it and its bread, and to fight him only where the odds are plainly ours. The engine does the
 * rest (`a-shadowed-army-goes-hungry.ts`): while he is shadowed his foragers do not go out and his convoys do not come, so that he must
 * either move on to ground that feeds him (and the order lapses, being no longer needed) or eat what he carried and starve.
 *
 * The rule chooses it for a man who is a strategist (skill 60) and no rash one (his boldness not twenty above his caution), against
 * an army half as strong again as his own that is not on ground its own side holds: where it is, there is something to cut it from.
 * A plain cautious man keeps his towns, as before.
 */

/** How far a general looks for an army to shadow. */
const SIGHT_KM = 600;
/** The army to be shadowed must be this many times his own. */
const STRONGER_BY = 1.3;
const SKILL_NEEDED = 60;
const CAUTION_NEEDED = 40;
const RASH_BY = 20;
/** Of the score of a post, how much a km from the enemy weighs against a km of his own marching, and what a post on the enemy's ground and on the road to his base is worth. */
const NEAR_ENEMY_WEIGHT = 0.6;
const MARCH_WEIGHT = 0.4;
const ENEMY_GROUND_PENALTY = 120;
const ON_HIS_ROAD_BONUS = 80;
/** The post is changed for a better only when it is better by this much. */
const POST_CHANGED_BY = 60;

const wd = (raw: Record<string, unknown>): WorldDelta => WorldDeltaSchema.parse(raw);

const heldByEnemy = (ctx: StrategyContext, provinceId: string): boolean => {
  const holder = ctx.provinces.get(provinceId)?.controllerPolityId ?? null;
  return holder !== null && ctx.enemies.has(holder);
};

/** The army a man of this temper would shadow, if any: the strongest within sight that is stronger than his own and not on ground its side holds. */
export function shadowTarget(ctx: StrategyContext, force: Force, temper: Temper, reach: ReadonlyMap<string, number>): Force | null {
  if (temper.skill < SKILL_NEEDED || temper.careful < CAUTION_NEEDED || temper.bold - temper.careful >= RASH_BY) return null;
  const men = fitStrengthOf(force);
  if (men < SHADOW_MIN_MEN) return null;
  return enemyArmies(ctx)
    .filter((other) => (reach.get(other.locationId) ?? Infinity) <= SIGHT_KM && fitStrengthOf(other) >= STRONGER_BY * men && fitStrengthOf(other) >= SHADOW_MIN_MEN && !heldByEnemy(ctx, other.locationId))
    .sort((a, b) => fitStrengthOf(b) - fitStrengthOf(a) || (reach.get(a.locationId) ?? 0) - (reach.get(b.locationId) ?? 0) || a.id.localeCompare(b.id))[0] ?? null;
}

/** Whether the order to shadow still serves: the army is still there, still stronger, and still on ground that does not feed it. */
export function shadowStillGood(ctx: StrategyContext, force: Force, cp: CampaignPlan): boolean {
  if (cp.objective.kind !== "army") return false;
  const forceId = cp.objective.forceId;
  const target = ctx.world.material.forces.find((other) => other.id === forceId);
  if (target === undefined || fitStrengthOf(target) <= 0) return false;
  if (fitStrengthOf(force) < SHADOW_MIN_MEN || fitStrengthOf(target) < 1.1 * fitStrengthOf(force)) return false;
  return !heldByEnemy(ctx, target.locationId);
}

/** The province to keep him in sight from: near him, near us, on our own ground, and between him and the nearest town of his side. */
export function shadowPost(ctx: StrategyContext, force: Force, target: Force, reach: ReadonlyMap<string, number>): string | null {
  const fromHim = reachOf(ctx, target.locationId, 900, true);
  let baseKm: ReadonlyMap<string, number> | null = null;
  let best: { id: string; km: number } | null = null;
  for (const [id, km] of fromHim) {
    if (id === target.locationId || !heldByEnemy(ctx, id) || (ctx.provinces.get(id)?.settlements.length ?? 0) === 0) continue;
    if (best === null || km < best.km || (km === best.km && id < best.id)) best = { id, km };
  }
  if (best !== null) baseKm = reachOf(ctx, best.id, 900, true);
  const hisDistanceToBase = baseKm?.get(target.locationId) ?? Infinity;
  const scored: { id: string; score: number }[] = [];
  for (const [id, km] of reachOf(ctx, target.locationId, SHADOW_KM, true)) {
    if (id === target.locationId) continue;
    const mine = id === force.locationId ? 0 : reach.get(id);
    if (mine === undefined) continue;
    const province = ctx.provinces.get(id);
    const friendly = province !== undefined && (province.controllerPolityId === ctx.polityId || province.controllerPolityId === null);
    const onHisRoad = baseKm !== null && (baseKm.get(id) ?? Infinity) < hisDistanceToBase;
    scored.push({ id, score: km * NEAR_ENEMY_WEIGHT + mine * MARCH_WEIGHT + (friendly ? 0 : ENEMY_GROUND_PENALTY) - (onHisRoad ? ON_HIS_ROAD_BONUS : 0) });
  }
  scored.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
  const top = scored[0];
  if (top === undefined) return null;
  const here = scored.find((entry) => entry.id === force.locationId);
  return here !== undefined && here.score - top.score < POST_CHANGED_BY ? here.id : top.id;
}

export interface ShadowMove { readonly act: StatecraftAct; readonly target: string | null; readonly why: string; readonly deltas: WorldDelta[] }

/** One month of the order, the enemy not being in the same province: keep to the post, harrying where the post is on his side's ground and has anything left. */
export function conductShadow(ctx: StrategyContext, force: Force, cp: CampaignPlan, reach: ReadonlyMap<string, number>, unhold: WorldDelta[]): ShadowMove | null {
  if (cp.objective.kind !== "army") return null;
  const forceId = cp.objective.forceId;
  const target = ctx.world.material.forces.find((other) => other.id === forceId);
  if (target === undefined) return null;
  const post = shadowPost(ctx, force, target, reach);
  if (post === null) return null;
  const placeName = (id: string): string => ctx.provinces.get(id)?.name ?? id;
  if (post !== force.locationId) {
    const why = `${target.name} is at ${placeName(target.locationId)}, and he goes to ${placeName(post)} to keep it in sight and between it and its bread`;
    return { act: "march", target: null, why, deltas: [...unhold, wd({ op: "force_modify", forceRef: force.id, locationId: post, reason: `${force.name} marches: ${why}.`.slice(0, 240) })] };
  }
  const here = ctx.provinces.get(force.locationId);
  const row = ctx.world.material.provinceMaterial.find((candidate) => candidate.provinceId === force.locationId);
  if (here !== undefined && heldByEnemy(ctx, here.id) && row !== undefined && row.warDamageBps < 6_000 && row.population > 0) {
    return { act: "raid", target: here.controllerPolityId, why: `${force.name} harries ${here.name}, where ${target.name} would draw its bread`, deltas: [...unhold, wd({ op: "force_raid", forceRef: force.id, provinceId: here.id, toAccountRef: null, reason: `${force.name} harries the country about ${here.name}.` })] };
  }
  return null;
}
