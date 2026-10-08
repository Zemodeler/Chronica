import {
  WorldDeltaSchema,
  fitStrengthOf,
  isNavalForce,
  isWinterMonth,
  kmFrom,
  sailingSeason,
  type Force,
  type NavalPlan,
  type StatecraftAct,
  type WarPlan,
  type WorldDelta,
} from "@chronica/shared";
import { roughMen } from "./board";
import { chooseBattlePlan, temperOf } from "./battle-plan";
import { monthOf, type StrategyContext } from "./grand-strategy";
import type { OrderSets } from "./campaign-orders";
import type { StatecraftDecision } from "./statecraft";

/**
 * The fleets of a power at war (docs/plans/war-plans.md): they meet the enemy's fleet when they are the stronger, shut up his harbours,
 * keep to port in the winter, and stand ready to carry an army over (the engine arranges the crossing of an army from the hulls
 * of its power, `passagePlanFor`; a fleet that is not wanted for it keeps its station). Nothing here is learned from the model:
 * it is the simplest sea war that reads the plan.
 *
 * Boarding: a fleet fights as its doctrines make it (`boarding`), and the scenario gives the Ptolemaic great ships the boarding
 * lever; Rome's boarding-bridge is not in the scenario's data, and is not invented here.
 */

const wd = (raw: Record<string, unknown>): WorldDelta => WorldDeltaSchema.parse(raw);
const SEA_SIGHT_KM = 800;
/** A fleet engages an enemy fleet at this odds or better: the stronger side by a fifth. */
const FLEET_ODDS = 1.2;

export const navalForces = (ctx: StrategyContext, polityId: string): Force[] =>
  ctx.world.material.forces.filter((force) => force.polityId === polityId && force.outlaw !== true && fitStrengthOf(force) > 0 && isNavalForce(force, ctx.warfare));

const isPortProvince = (ctx: StrategyContext, provinceId: string): boolean => ctx.provinces.get(provinceId)?.settlements.some((settlement) => settlement.kind === "port") === true;

/** What the power means to do at sea, from what it has there and what the enemy has: or nothing, where it has no ships. */
export function navalPlanFor(ctx: StrategyContext, plan: WarPlan, landUnreachable: readonly string[]): NavalPlan | undefined {
  const mine = navalForces(ctx, ctx.polityId);
  if (mine.length === 0) return undefined;
  const ours = mine.reduce((sum, force) => sum + fitStrengthOf(force), 0);
  const theirs = ctx.world.material.forces.filter((force) => ctx.enemies.has(force.polityId) && force.outlaw !== true && fitStrengthOf(force) > 0 && isNavalForce(force, ctx.warfare));
  const reach = kmFrom(ctx.world, mine[0]!.locationId, { budgetKm: SEA_SIGHT_KM * 1.5 });
  const near = theirs.filter((force) => reach.has(force.locationId));
  const nearMen = near.reduce((sum, force) => sum + fitStrengthOf(force), 0);
  const temper = temperOf(ctx.world.characters.find((character) => character.id === mine[0]!.commanderCharacterId));
  if (near.length > 0 && ours >= nearMen * FLEET_ODDS && (plan.posture === "decisive" || temper.bold >= 50)) {
    return { kind: "seek_fleet", seaProvinceIds: [...new Set(near.map((force) => force.locationId))].slice(0, 3) };
  }
  if (landUnreachable.length > 0) return { kind: "escort", seaProvinceIds: landUnreachable.slice(0, 3) };
  const ports = [...reach].filter(([id]) => {
    const province = ctx.provinces.get(id);
    return province !== undefined && province.controllerPolityId !== null && ctx.enemies.has(province.controllerPolityId) && isPortProvince(ctx, id);
  }).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([id]) => id);
  if (ports.length > 0 && plan.posture !== "defend") return { kind: "blockade", seaProvinceIds: ports };
  return undefined;
}

const decide = (ctx: StrategyContext, force: Force, act: StatecraftAct, target: string | null, why: string, deltas: WorldDelta[]): StatecraftDecision =>
  ({ polityId: ctx.polityId, actorCharacterId: force.commanderCharacterId, act, targetPolityId: target, why: why.slice(0, 400), deltas, facts: [] });

/** One fleet's month. Null where it keeps its station. */
export function fleetOrder(ctx: StrategyContext, force: Force, plan: WarPlan | undefined, sets: OrderSets): StatecraftDecision | null {
  const { world } = ctx;
  if (sets.marching.has(force.id) || sets.fighting.has(force.id)) return null;
  const month = monthOf(ctx, world.instant.day);
  const commander = world.characters.find((character) => character.id === force.commanderCharacterId);
  const temper = temperOf(commander);
  const men = fitStrengthOf(force);
  const here = force.locationId;
  const season = sailingSeason(month);
  const enemyFleets = world.material.forces.filter((other) => ctx.enemies.has(other.polityId) && other.outlaw !== true && fitStrengthOf(other) > 0 && isNavalForce(other, ctx.warfare));
  const reach = kmFrom(world, here, { budgetKm: SEA_SIGHT_KM });
  const harbour = (): string | null => [...reach].filter(([id]) => id !== here && ctx.provinces.get(id)?.controllerPolityId === ctx.polityId && isPortProvince(ctx, id)).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;

  // An enemy fleet on the same water: fight it if we are the stronger, or draw off to a harbour.
  const facing = enemyFleets.filter((other) => other.locationId === here);
  if (facing.length > 0) {
    const theirs = facing.reduce((sum, other) => sum + fitStrengthOf(other), 0);
    const bar = FLEET_ODDS * (1 - (temper.bold - 50) / 250);
    if (men >= bar * theirs) {
      const tactic = chooseBattlePlan(world, here, [force], facing, commander, ctx.warfare);
      return decide(ctx, force, "attack", facing[0]!.polityId, `${roughMen(men)} ships against ${roughMen(theirs)}: the fleet is the stronger`, [
        wd({ op: "force_engage", forceRef: force.id, targetForceRef: facing[0]!.id, posture: "offer_battle", tactic, reason: `${force.name} closes with the enemy's ships.` }),
      ]);
    }
    const port = harbour();
    if (port !== null) return decide(ctx, force, "fall_back", facing[0]!.polityId, `${roughMen(theirs)} ships against our ${roughMen(men)}: too many`, [wd({ op: "force_modify", forceRef: force.id, locationId: port, reason: `${force.name} draws off to ${ctx.provinces.get(port)?.name ?? port} before a stronger fleet.` })]);
    return null;
  }
  // The sea is shut: a fleet off a hostile or open coast goes to a harbour of its own and is beached for the winter.
  if (season === "shut" || (month !== null && isWinterMonth(month) && season !== "open")) {
    if (isPortProvince(ctx, here) && ctx.provinces.get(here)?.controllerPolityId === ctx.polityId) return null;
    const port = harbour();
    return port === null ? null : decide(ctx, force, "fall_back", null, "the sea is shut for the winter", [wd({ op: "force_modify", forceRef: force.id, locationId: port, reason: `${force.name} is beached at ${ctx.provinces.get(port)?.name ?? port} for the winter.` })]);
  }
  const naval = plan?.navalPlan;
  if (naval === undefined) return null;
  if (naval.kind === "seek_fleet") {
    const target = enemyFleets.filter((other) => reach.has(other.locationId)).sort((a, b) => (reach.get(a.locationId) ?? 0) - (reach.get(b.locationId) ?? 0) || a.id.localeCompare(b.id))[0];
    if (target === undefined) return null;
    const theirs = enemyFleets.filter((other) => other.locationId === target.locationId).reduce((sum, other) => sum + fitStrengthOf(other), 0);
    if (men < FLEET_ODDS * theirs) return null;
    return decide(ctx, force, "march", target.polityId, `${roughMen(theirs)} ships of theirs lie at ${ctx.provinces.get(target.locationId)?.name ?? target.locationId}, and we are the stronger`, [wd({ op: "force_modify", forceRef: force.id, locationId: target.locationId, reason: `${force.name} stands out to seek the enemy's fleet.` })]);
  }
  if (naval.kind === "blockade") {
    if (naval.seaProvinceIds.includes(here)) return null;
    const port = naval.seaProvinceIds.filter((id) => reach.has(id)).sort((a, b) => (reach.get(a) ?? 0) - (reach.get(b) ?? 0) || a.localeCompare(b))[0];
    if (port === undefined) return null;
    return decide(ctx, force, "march", ctx.provinces.get(port)?.controllerPolityId ?? null, `${ctx.provinces.get(port)?.name ?? port} is to be shut up`, [wd({ op: "force_modify", forceRef: force.id, locationId: port, reason: `${force.name} goes to blockade ${ctx.provinces.get(port)?.name ?? port}.` })]);
  }
  return null;
}
