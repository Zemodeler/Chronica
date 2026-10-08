import {
  CAMPAIGN_MAX_DAYS,
  WorldDeltaSchema,
  aptitude,
  fitStrengthOf,
  isNavalForce,
  isWinterMonth,
  kmFrom,
  passagePlanFor,
  type Character,
  type Force,
  type CampaignMode,
  type CampaignPlan,
  type StatecraftAct,
  type WarAim,
  type WarPlan,
  type WarTheatre,
  type WorldDelta,
} from "@chronica/shared";
import { roughMen } from "./board";
import { chooseBattlePlan, chooseManoeuvre, temperOf } from "./battle-plan";
import { enemyArmies, monthOf, reachOf, worthOf, type StrategyContext } from "./grand-strategy";
import { SIEGE_NEEDED_AT } from "./occupation";
import type { StatecraftDecision } from "./statecraft";

/**
 * An army's orders, given it from the plan of the war and kept to (docs/plans/war-plans.md).
 *
 * `issueCampaign` is the head of the state, or his man in the theatre, sending an army against a province or an army, to besiege,
 * to harry, to hold, to refuse battle, or to winter; the general's own bent and skill decide what he is sent on and how he goes
 * about it. `conductByPlan` is the general carrying it out, month by month, and answering only what a sensible man would answer:
 * a stronger army before him, his bread gone, the object taken, the siege relieved. Nothing is chosen anew each month.
 */

const BY_LAND = { passable: (edge: { readonly crossing: string }) => edge.crossing !== "sea_lane" && edge.crossing !== "strait" };
/** Odds an army takes battle at, as before: beaten odds, and on its own ground to drive an invader off. */
const ATTACK_ODDS = 1.3;
const DEFEND_ODDS = 0.9;
const RETREAT_ODDS = 1.6;
/** How far an army looks for a quarter, an enemy to meet, or ground to feed on. */
const QUARTERS_KM = 350;
const SIGHT_KM = 600;
/** How far the roads are worked out from an army, for what it may be sent to. */
export const REACH_KM = 900;
const ALARM_KM = 250;
/** The days an order is given for. */
const ORDER_DAYS = 150;
const WINTER_ORDER_DAYS = 100;

const wd = (raw: Record<string, unknown>): WorldDelta => WorldDeltaSchema.parse(raw);

export interface OrderSets {
  readonly marching: ReadonlySet<string>;
  readonly fighting: ReadonlySet<string>;
  readonly besieging: ReadonlySet<string>;
}

/** What the general is as a man for the odds: skill and boldness shift what he wants and when he gives way (the same as `commandersTemper`). */
function oddsOf(commander: Character | undefined): { readonly wants: number; readonly flees: number } {
  if (commander === undefined) return { wants: 1, flees: 1 };
  const skill = (commander.skills.martial + aptitude(commander, "strategist")) / 2;
  const bold = commander.mind.temperament.boldness;
  const wants = (1 + (50 - skill) / 100) * (1 - (bold - 50) / 200);
  const flees = 1 + (bold - 50) / 100;
  return { wants: Math.max(0.6, Math.min(1.5, wants)), flees: Math.max(0.6, Math.min(1.5, flees)) };
}

const ownGround = (ctx: StrategyContext, provinceId: string): boolean => {
  const province = ctx.provinces.get(provinceId);
  return province !== undefined && (province.ownerPolityId ?? province.controllerPolityId) === ctx.polityId;
};

/** A town of ours (or an ally's), where an army can be fed and housed: nearest first, fortified before open, and the base the order names before the rest. */
function quartersFor(ctx: StrategyContext, force: Force, reach: ReadonlyMap<string, number>, preferred: string | null): string | null {
  let best: { id: string; score: number } | null = null;
  for (const [id, km] of reach) {
    if (km > QUARTERS_KM) continue;
    const province = ctx.provinces.get(id);
    if (province === undefined || province.controllerPolityId !== ctx.polityId || province.settlements.length === 0) continue;
    const walls = province.settlements.reduce((top, settlement) => Math.max(top, settlement.fortificationLevel), 0);
    const score = km - Math.min(5, walls) * 30 - (id === preferred ? 60 : 0);
    if (best === null || score < best.score || (score === best.score && id < best.id)) best = { id, score };
  }
  void force;
  return best?.id ?? null;
}

/** Ground to feed an army on, where there is no town of its own: the best-fed province near it, ours or theirs. */
function forageGround(ctx: StrategyContext, reach: ReadonlyMap<string, number>): string | null {
  const fed = new Map(ctx.world.material.provinceMaterial.map((row) => [row.provinceId, row.population * (row.foodSecurityBps / 10_000)] as const));
  let best: { id: string; score: number } | null = null;
  for (const [id, km] of reach) {
    if (km === 0 || km > 200) continue;
    const province = ctx.provinces.get(id);
    if (province === undefined || (province.controllerPolityId !== null && province.controllerPolityId !== ctx.polityId && !ctx.enemies.has(province.controllerPolityId))) continue;
    const score = (fed.get(id) ?? 0) / (km + 50);
    if (best === null || score > best.score || (score === best.score && id < best.id)) best = { id, score };
  }
  return best?.id ?? null;
}

/** The enemy armies that would beat us if we stayed, near enough to matter. */
function superiorNear(ctx: StrategyContext, force: Force, reach: ReadonlyMap<string, number>): Force | null {
  const odds = oddsOf(ctx.world.characters.find((character) => character.id === force.commanderCharacterId));
  const men = fitStrengthOf(force);
  let worst: Force | null = null;
  for (const other of enemyArmies(ctx)) {
    const km = reach.get(other.locationId);
    if (km === undefined || km > ALARM_KM) continue;
    if (fitStrengthOf(other) >= RETREAT_ODDS * odds.flees * men && (worst === null || fitStrengthOf(other) > fitStrengthOf(worst))) worst = other;
  }
  return worst;
}

const placeName = (ctx: StrategyContext, id: string): string => ctx.provinces.get(id)?.name ?? id;

export interface Issued {
  readonly campaign: CampaignPlan;
  /** True where the orders differ from those the army had: the thing that is told. */
  readonly changed: boolean;
  readonly why: string;
}

/** Whether the orders an army has are still good: not run out, their object still there, nothing happened that a sensible man would answer. */
export function campaignStillGood(ctx: StrategyContext, force: Force, cp: CampaignPlan, plan: WarPlan, theatre: WarTheatre | undefined, playedByModel: ReadonlySet<string>, reach: ReadonlyMap<string, number>): boolean {
  const day = ctx.world.instant.day;
  if (cp.expiresStep <= day || cp.warId !== plan.warId) return false;
  const here = force.locationId;
  const objectiveProvince = cp.objective.kind === "province" ? cp.objective.provinceId : ctx.world.material.forces.find((candidate) => candidate.id === (cp.objective as { forceId: string }).forceId)?.locationId ?? null;
  if (objectiveProvince === null) return false;
  if (cp.objective.kind === "army") {
    const target = ctx.world.material.forces.find((candidate) => candidate.id === (cp.objective as { forceId: string }).forceId);
    if (target === undefined || fitStrengthOf(target) <= 0 || !ctx.enemies.has(target.polityId)) return false;
  }
  const province = ctx.provinces.get(objectiveProvince);
  const held = province?.controllerPolityId ?? null;
  if (cp.mode === "siege" || cp.mode === "raid") {
    // The object is theirs still; once it is ours (or nobody's) it is done.
    if (held === null || !ctx.enemies.has(held)) return false;
  }
  if (cp.mode === "seek_battle" && cp.objective.kind === "province" && here === objectiveProvince) return false;
  if ((cp.mode === "garrison" || cp.mode === "refuse" || cp.mode === "winter") && held !== ctx.polityId) return false;
  // What a model-played head ordered stands until it runs out or its object is gone.
  if (playedByModel.has(cp.issuedByCharacterId)) return true;
  const month = monthOf(ctx, day);
  const winter = month !== null && isWinterMonth(month);
  if (cp.mode === "winter" && month !== null && !winter) return false;
  if (cp.mode !== "winter" && force.provisionStatus === "critical") return false;
  if ((cp.mode === "seek_battle" || cp.mode === "raid") && winter && force.provisionStatus !== "provisioned") return false;
  if (theatre !== undefined && cp.theatreId !== null && cp.theatreId !== theatre.id) return false;
  if (plan.aimsChangedAtStep > cp.issuedStep) return false;
  if ((cp.mode === "seek_battle" || cp.mode === "raid" || cp.mode === "siege") && superiorNear(ctx, force, reach) !== null && !ownGround(ctx, here)) return false;
  if (cp.mode === "seek_battle" && superiorNear(ctx, force, reach) !== null) return false;
  // An order to refuse battle was given for an enemy who was too strong: when he is gone it is done.
  if (cp.mode === "refuse" && superiorNear(ctx, force, reach) === null) return false;
  return true;
}

/**
 * The orders an army is given from the plan of the war. Null where the plan has nothing for it to do (it is left to the old rules).
 */
export function issueCampaign(ctx: StrategyContext, force: Force, plan: WarPlan, theatre: WarTheatre | undefined, issuer: string, existing: CampaignPlan | undefined): Issued | null {
  const { world, polityId } = ctx;
  const day = world.instant.day;
  const month = monthOf(ctx, day);
  const winter = month !== null && isWinterMonth(month);
  const commander = world.characters.find((character) => character.id === force.commanderCharacterId);
  const temper = temperOf(commander);
  const odds = oddsOf(commander);
  const men = fitStrengthOf(force);
  const havePassage = world.material.forces.some((other) => other.polityId === polityId && isNavalForce(other, ctx.warfare) && fitStrengthOf(other) > 0);
  const reach = reachOf(ctx, force.locationId, REACH_KM, true);
  const sea = havePassage ? reachOf(ctx, force.locationId, REACH_KM, false) : reach;
  const canGet = (provinceId: string): boolean => reach.has(provinceId) || (havePassage && sea.has(provinceId) && passagePlanFor(world, force, provinceId, ctx.warfare, month) !== null);
  const kmTo = (provinceId: string): number => reach.get(provinceId) ?? sea.get(provinceId) ?? 1_500;
  const hereProvince = ctx.provinces.get(force.locationId);
  const quarters = quartersFor(ctx, force, reach, existing?.baseProvinceId ?? null);
  const base = quarters ?? (hereProvince?.controllerPolityId === polityId ? force.locationId : null);
  const fallback = quarters ?? base;
  const nearEnemy = superiorNear(ctx, force, reach);
  const enemies = enemyArmies(ctx);
  const make = (mode: CampaignMode, objective: CampaignPlan["objective"], days: number, why: string): Issued => {
    const campaign: CampaignPlan = {
      forceId: force.id, polityId, warId: plan.warId, theatreId: theatre?.id ?? null, objective, baseProvinceId: base, fallbackProvinceId: fallback,
      mode, issuedByCharacterId: issuer, issuedStep: day, expiresStep: day + Math.min(CAMPAIGN_MAX_DAYS, days),
    };
    const changed = existing === undefined || existing.mode !== mode || JSON.stringify(existing.objective) !== JSON.stringify(objective);
    return { campaign, changed, why: why.slice(0, 300) };
  };

  // Supply and the season first: an army with no bread, or the winter on it, goes to a town of its own, or to ground it can feed on.
  const needsBread = force.provisionStatus === "critical" || (force.provisionStatus === "shortage" && !ownGround(ctx, force.locationId));
  const hardy = temper.bold >= 70 && temper.logistics >= 55 && force.provisionStatus === "provisioned";
  const besieging = world.sieges.some((siege) => siege.status === "active" && siege.forceId === force.id);
  if (!besieging && (needsBread || (winter && !hardy))) {
    if (quarters !== null) return make("winter", { kind: "province", provinceId: quarters }, WINTER_ORDER_DAYS, needsBread ? `his bread is short, and he goes to ${placeName(ctx, quarters)}` : `he winters at ${placeName(ctx, quarters)}`);
    const forage = needsBread ? forageGround(ctx, reach) : null;
    if (forage !== null) return make("raid", { kind: "province", provinceId: forage }, 60, `his bread is gone, and he goes to feed on ${placeName(ctx, forage)}`);
  }

  const aims = plan.aims.filter((aim) => aim.kind !== "sue_for_peace" && (aim.provinceId === undefined || theatre === undefined || theatre.provinceIds.includes(aim.provinceId) || aim.kind === "break_army"));
  const holds = aims.filter((aim) => aim.kind === "hold_province" && aim.provinceId !== undefined && canGet(aim.provinceId));
  const takes = aims.filter((aim) => (aim.kind === "take_province" || aim.kind === "raid") && aim.provinceId !== undefined && canGet(aim.provinceId));
  const careful = temper.careful - temper.bold >= 20;
  const rash = temper.bold - temper.careful >= 20;

  // Hold: to stand in a town and refuse battle where the posture is to stand, or the enemy is too strong, or the man is a careful one.
  const mustHold = plan.posture === "defend" || (nearEnemy !== null && (careful || plan.posture === "attrition"));
  if (mustHold || (careful && plan.posture !== "decisive" && holds.length > 0)) {
    const near = nearEnemy ?? enemies.filter((other) => kmTo(other.locationId) <= SIGHT_KM).sort((a, b) => kmTo(a.locationId) - kmTo(b.locationId))[0];
    const fromEnemy = near === undefined ? undefined : reachOf(ctx, near.locationId, REACH_KM, true);
    const place = holds.sort((a, b) => kmTo(a.provinceId!) - kmTo(b.provinceId!))[0]?.provinceId
      ?? (fromEnemy === undefined ? null : [...reach].filter(([id]) => ownGround(ctx, id) && (ctx.provinces.get(id)?.settlements.length ?? 0) > 0).sort((a, b) => (fromEnemy.get(a[0]) ?? 9_999) - (fromEnemy.get(b[0]) ?? 9_999) || a[1] - b[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null)
      ?? quarters;
    if (place !== null && ownGround(ctx, place)) {
      return make(nearEnemy !== null && plan.posture !== "defend" ? "refuse" : "garrison", { kind: "province", provinceId: place }, ORDER_DAYS, `${nearEnemy !== null ? "the enemy is too strong to meet" : "the plan is to stand on the defence"}, and he keeps to ${placeName(ctx, place)}`);
    }
  }

  // To meet the enemy's army: where the plan is to have it out, or the aim is to break it, or the man is a bold one with the odds.
  const breakable = enemies
    .filter((other) => canGet(other.locationId) && men >= (ownGround(ctx, other.locationId) ? DEFEND_ODDS : ATTACK_ODDS) * odds.wants * fitStrengthOf(other))
    .sort((a, b) => kmTo(a.locationId) - kmTo(b.locationId) || fitStrengthOf(b) - fitStrengthOf(a) || a.id.localeCompare(b.id))[0];
  const wantsBattle = plan.posture === "decisive" || aims.some((aim) => aim.kind === "break_army") || (rash && plan.posture !== "defend");
  if (breakable !== undefined && wantsBattle && !(careful && plan.posture !== "decisive") && kmTo(breakable.locationId) <= SIGHT_KM) {
    return make("seek_battle", { kind: "army", forceId: breakable.id }, ORDER_DAYS, `${roughMen(fitStrengthOf(breakable))} of ${placeName(ctx, breakable.locationId)}'s enemy are to be met in the field, and we are the stronger`);
  }

  // Ground to take: by siege where there are walls, by harrying where there are none and the aim is to raid.
  const target = takes.map((aim) => ({ aim, score: (aim.provinceId !== undefined ? worthOf(ctx, aim.provinceId) : 0) / (kmTo(aim.provinceId!) + 100) }))
    .sort((a, b) => b.score - a.score || a.aim.provinceId!.localeCompare(b.aim.provinceId!))[0]?.aim;
  if (target?.provinceId !== undefined) {
    const province = ctx.provinces.get(target.provinceId);
    const walled = province?.settlements.some((settlement) => settlement.fortificationLevel >= SIEGE_NEEDED_AT) === true;
    const defenders = enemies.filter((other) => other.locationId === target.provinceId).reduce((sum, other) => sum + fitStrengthOf(other), 0);
    if (defenders * ATTACK_ODDS * odds.wants <= men || walled) {
      const mode: CampaignMode = target.kind === "raid" && !walled ? "raid" : walled ? "siege" : "seek_battle";
      if (mode === "seek_battle" && province?.controllerPolityId !== null && province !== undefined) {
        // An open province is taken by marching into it: standing there is occupying it.
        return make("seek_battle", { kind: "province", provinceId: target.provinceId }, ORDER_DAYS, `${placeName(ctx, target.provinceId)}, held by ${ctx.world.map.polities.find((polity) => polity.id === province.controllerPolityId)?.name ?? "the enemy"}, is to be taken`);
      }
      return make(mode, { kind: "province", provinceId: target.provinceId }, mode === "siege" ? 200 : ORDER_DAYS, mode === "siege" ? `${placeName(ctx, target.provinceId)} is to be besieged` : `${placeName(ctx, target.provinceId)} is to be harried`);
    }
  }
  if (breakable !== undefined && kmTo(breakable.locationId) <= SIGHT_KM && !careful) {
    return make("seek_battle", { kind: "army", forceId: breakable.id }, ORDER_DAYS, "no ground is within his reach to take, and an army of theirs is there to be beaten");
  }
  if (holds.length > 0) {
    const place = holds.sort((a, b) => kmTo(a.provinceId!) - kmTo(b.provinceId!))[0]!.provinceId!;
    return make("garrison", { kind: "province", provinceId: place }, ORDER_DAYS, `${placeName(ctx, place)} is to be held`);
  }
  return null;
}

// ── Carrying them out ─────────────────────────────────────────────────

export interface ConductContext extends StrategyContext {
  readonly sets: OrderSets;
}

/** The decision a rule-made order is: the man who commands, what was weighed, and the deltas. */
const decide = (ctx: StrategyContext, force: Force, act: StatecraftAct, target: string | null, why: string, deltas: WorldDelta[]): StatecraftDecision =>
  ({ polityId: ctx.polityId, actorCharacterId: force.commanderCharacterId, act, targetPolityId: target, why: why.slice(0, 400), deltas, facts: [] });

/** The nearest town of ours to fall back on, or the order's own fallback. */
function fallBackTo(ctx: StrategyContext, force: Force, cp: CampaignPlan, reach: ReadonlyMap<string, number>): string | null {
  const named = cp.fallbackProvinceId;
  if (named !== null && named !== force.locationId && ctx.provinces.get(named)?.controllerPolityId === ctx.polityId && reach.has(named)) return named;
  let best: { id: string; km: number } | null = null;
  for (const [id, km] of reach) {
    if (km === 0 || ctx.provinces.get(id)?.controllerPolityId !== ctx.polityId) continue;
    if (best === null || km < best.km || (km === best.km && id < best.id)) best = { id, km };
  }
  return best?.id ?? null;
}

/**
 * One army's month under its orders. Null where there is nothing to do: it stands, or marches already.
 */
export function conductByPlan(ctx: ConductContext, force: Force, cp: CampaignPlan, gameId: string): StatecraftDecision | null {
  const { world, polityId } = ctx;
  const men = fitStrengthOf(force);
  const commander = world.characters.find((character) => character.id === force.commanderCharacterId);
  const odds = oddsOf(commander);
  const here = force.locationId;
  const hereProvince = ctx.provinces.get(here);
  if (hereProvince === undefined) return null;
  const enemies = enemyArmies(ctx);
  const menAt = (provinceId: string): number => enemies.filter((other) => other.locationId === provinceId).reduce((sum, other) => sum + fitStrengthOf(other), 0);
  const month = monthOf(ctx, world.instant.day);
  const reach = reachOf(ctx, here, REACH_KM, true);
  // A hold the plan laid is lifted when the army is to act: an army on hold starts no battle, and the engine refuses it.
  const unhold: WorldDelta[] = force.hold === true ? [wd({ op: "force_modify", forceRef: force.id, hold: false, reason: `${force.name} takes the field again.` })] : [];
  const modeWants = cp.mode === "seek_battle" ? 0.9 : cp.mode === "refuse" || cp.mode === "garrison" || cp.mode === "winter" ? 1.4 : 1.1;

  // The enemy is here: give battle, or give way, or keep the town.
  const facing = enemies.filter((other) => other.locationId === here).sort((a, b) => fitStrengthOf(b) - fitStrengthOf(a) || a.id.localeCompare(b.id));
  if (facing.length > 0) {
    const theirs = menAt(here);
    const bar = (ownGround(ctx, here) ? DEFEND_ODDS : ATTACK_ODDS) * odds.wants * modeWants;
    const walled = hereProvince.controllerPolityId === polityId && hereProvince.settlements.some((settlement) => settlement.fortificationLevel >= 1);
    if (men >= bar * theirs && !(force.hold === true && (cp.mode === "refuse" || cp.mode === "garrison") && theirs > men * 0.8)) {
      const tactic = chooseBattlePlan(world, here, [force], facing, commander, ctx.warfare);
      const manoeuvre = chooseManoeuvre(world, [force], facing, commander, gameId);
      return decide(ctx, force, "attack", facing[0]!.polityId, `${roughMen(men)} against ${roughMen(theirs)}: the odds are ours${manoeuvre === null ? "" : `; ${manoeuvre.why}`}`, [
        ...unhold,
        wd({ op: "force_engage", forceRef: force.id, targetForceRef: facing[0]!.id, posture: "offer_battle", tactic, ...(manoeuvre === null ? {} : { manoeuvre: manoeuvre.kind }), reason: `${force.name} offers battle: the odds are good${tactic === null ? "" : ", and the ground is read"}.` }),
      ]);
    }
    if (theirs >= RETREAT_ODDS * odds.flees * men || (cp.mode === "refuse" && theirs > men)) {
      if (walled && (cp.mode === "refuse" || cp.mode === "garrison" || cp.mode === "winter")) {
        const tactic = chooseBattlePlan(world, here, [force], facing, commander, ctx.warfare);
        if (force.hold === true && JSON.stringify(force.battlePlan ?? null) === JSON.stringify(tactic)) return null;
        return decide(ctx, force, "hold", facing[0]!.polityId, `${roughMen(theirs)} against our ${roughMen(men)}: he keeps within the walls and will not come out`, [
          wd({ op: "force_modify", forceRef: force.id, hold: true, battlePlan: tactic, reason: `${force.name} keeps to ${hereProvince.name} and will not give battle.` }),
        ]);
      }
      const home = fallBackTo(ctx, force, cp, reach);
      if (home !== null) return decide(ctx, force, "fall_back", facing[0]!.polityId, `${roughMen(theirs)} against our ${roughMen(men)}: too many`, [...unhold, wd({ op: "force_modify", forceRef: force.id, locationId: home, reason: `${force.name} falls back before a stronger army.` })]);
    }
    // In between: he stands, and if he is attacked he fights by the plan he has laid for the field.
    const standing = chooseBattlePlan(world, here, [force], facing, commander, ctx.warfare);
    if (JSON.stringify(force.battlePlan ?? null) !== JSON.stringify(standing)) {
      return decide(ctx, force, "hold", facing[0]!.polityId, "the armies are close in number: he lays his plan for the field and waits", [wd({ op: "force_modify", forceRef: force.id, battlePlan: standing, reason: `${force.name} takes up its ground and lays its plan.` })]);
    }
    return null;
  }

  // Before an enemy town with walls and no army to stop us: invest it, by the plan's way.
  const enemyHeld = hereProvince.controllerPolityId !== null && ctx.enemies.has(hereProvince.controllerPolityId);
  const walledEnemy = enemyHeld && hereProvince.settlements.some((settlement) => settlement.fortificationLevel >= SIEGE_NEEDED_AT && (settlement.controllerPolityId === null || ctx.enemies.has(settlement.controllerPolityId)));
  if (walledEnemy && cp.mode !== "winter" && cp.mode !== "refuse") {
    const already = world.sieges.some((siege) => siege.status === "active" && siege.provinceId === here);
    if (!already) {
      const temper = temperOf(commander);
      const works: ("rams" | "towers" | "lines")[] = [];
      if (temper.bold >= 50) works.push("rams");
      if (temper.skill >= 55) works.push("towers");
      return decide(ctx, force, "besiege", hereProvince.controllerPolityId, `before ${hereProvince.name}, held by ${ctx.world.map.polities.find((polity) => polity.id === hereProvince.controllerPolityId)?.name ?? "the enemy"}, with no army to stop us`, [
        ...unhold,
        wd({ op: "siege_lay", localId: `siege_${force.id}`.slice(0, 60), forceRef: force.id, settlementId: null, ...(works.length === 0 ? {} : { works: works.slice(0, 2) }), reason: `${force.name} lays siege.` }),
      ]);
    }
    return null;
  }

  // The order's object.
  const objective = cp.objective.kind === "province" ? cp.objective.provinceId : world.material.forces.find((other) => other.id === (cp.objective as { forceId: string }).forceId)?.locationId ?? null;
  if (objective === null) return null;
  if (objective === here) {
    if (cp.mode === "raid" && enemyHeld) {
      const row = world.material.provinceMaterial.find((candidate) => candidate.provinceId === here);
      if (row !== undefined && row.warDamageBps < 6_000 && row.population > 0) {
        return decide(ctx, force, "raid", hereProvince.controllerPolityId, `${force.name} harries ${hereProvince.name}`, [...unhold, wd({ op: "force_raid", forceRef: force.id, provinceId: here, toAccountRef: null, reason: `${force.name} harries the country about ${hereProvince.name}.` })]);
      }
      return null;
    }
    // Holding a town: keep it shut against an army that may come, and lift it when none does.
    if ((cp.mode === "refuse" || cp.mode === "garrison") && force.hold !== true && enemies.some((other) => (reach.get(other.locationId) ?? Infinity) <= ALARM_KM)) {
      return decide(ctx, force, "hold", null, `${hereProvince.name} is to be held against an army that is near`, [wd({ op: "force_modify", forceRef: force.id, hold: true, battlePlan: chooseBattlePlan(world, here, [force], enemies.filter((other) => (reach.get(other.locationId) ?? Infinity) <= ALARM_KM), commander, ctx.warfare), reason: `${force.name} keeps to ${hereProvince.name}.` })]);
    }
    return null;
  }
  // March: by land, or over the water with the ships of the power, as the engine can arrange it. Winter slows the road, and the order has been weighed for it.
  const month2 = month;
  const reachable = reach.has(objective) || passagePlanFor(world, force, objective, ctx.warfare, month2) !== null;
  if (!reachable) return null;
  const kmAway = reach.get(objective) ?? reachOf(ctx, here, 1_500, false).get(objective) ?? 0;
  const why = cp.objective.kind === "army"
    ? `${roughMen(menAt(objective))} of the enemy are at ${placeName(ctx, objective)}, ${Math.round(kmAway)} km off, and we are the stronger`
    : cp.mode === "winter" ? `to quarters at ${placeName(ctx, objective)}` : cp.mode === "garrison" || cp.mode === "refuse" ? `to keep ${placeName(ctx, objective)}` : `${placeName(ctx, objective)} is ${Math.round(kmAway)} km off, by the orders given`;
  const target = ctx.provinces.get(objective)?.controllerPolityId ?? null;
  return decide(ctx, force, "march", target !== null && ctx.enemies.has(target) ? target : null, why, [...unhold, wd({ op: "force_modify", forceRef: force.id, locationId: objective, reason: `${force.name} marches: ${why}.`.slice(0, 240) })]);
}

// ── The siege ──────────────────────────────────────────────────────────

/**
 * What the besieger does with a siege he has laid: starve it, storm it, or leave it, by his temper, his bread, the garrison and the
 * danger of a relief. Returns null where he waits (the common case: hunger does the work).
 */
export function besiegerOrder(ctx: StrategyContext, force: Force): StatecraftDecision | null {
  const { world } = ctx;
  const siege = world.sieges.find((candidate) => candidate.status === "active" && candidate.forceId === force.id);
  if (siege === undefined || siege.awaiting !== null) return null;
  const commander = world.characters.find((character) => character.id === force.commanderCharacterId);
  const temper = temperOf(commander);
  const men = fitStrengthOf(force);
  const garrison = world.material.forces.filter((other) => other.locationId === siege.provinceId && other.polityId === siege.defenderPolityId && fitStrengthOf(other) > 0).reduce((sum, other) => sum + fitStrengthOf(other), 0);
  const near = reachOf(ctx, siege.provinceId, 300, true);
  const reliefMen = enemyArmies(ctx).filter((other) => other.locationId !== siege.provinceId && near.has(other.locationId)).reduce((sum, other) => sum + fitStrengthOf(other), 0);
  const day = world.instant.day;
  const starving = force.provisionStatus === "critical";
  const place = ctx.provinces.get(siege.provinceId)?.name ?? siege.provinceId;
  const lay = (assault: boolean, works: ("rams" | "towers" | "lines" | "mine")[], why: string): StatecraftDecision =>
    decide(ctx, force, "besiege", siege.defenderPolityId, why, [wd({ op: "siege_lay", localId: `siege_${force.id}`.slice(0, 60), forceRef: force.id, settlementId: siege.settlementId, ...(works.length === 0 ? {} : { works }), ...(assault ? { assault: true } : {}), reason: `${force.name} presses the siege of ${place}.` })]);
  // Leave it: a relief that will crush the lines, or no bread and no hope of the walls.
  if (reliefMen >= men * 1.5 || (starving && siege.pressureBps < 8_000)) {
    if (temper.careful >= 40 || starving) {
      const home = [...reachOf(ctx, siege.provinceId, 600, true)].filter(([id]) => ctx.provinces.get(id)?.controllerPolityId === ctx.polityId).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
      return decide(ctx, force, "fall_back", siege.defenderPolityId, `${starving ? "the bread is gone" : `${roughMen(reliefMen)} are coming to the relief`}: he raises the siege of ${place} rather than be caught between`, [
        wd({ op: "siege_lift", siegeRef: siege.id, reason: `${force.name} raises the siege of ${place} before ${starving ? "hunger takes the lines" : "the relief comes up"}.` }),
        ...(home === null ? [] : [wd({ op: "force_modify", forceRef: force.id, locationId: home, reason: `${force.name} draws off.` })]),
      ]);
    }
  }
  // Storm it: the bold and the strong at a breach, or against the clock of a relief or of his own bread.
  const strong = men >= Math.max(1, garrison) * 1.5;
  const hurried = reliefMen > 0 || force.provisionStatus === "shortage";
  if (siege.pressureBps >= 5_000 && ((temper.bold >= 55 && strong) || (hurried && men >= garrison * 1.2 && temper.bold >= 40))) {
    return lay(true, [], `${place} is breached and he is ${strong ? "the stronger by half" : "short of time"}: he storms it`);
  }
  // Starve it, and build what will hasten the end: lines where a relief may come, rams for the bold, towers for the skilled.
  const have = new Set(siege.works.filter((work) => work.status === "building" || work.status === "ready").map((work) => work.kind));
  const want: ("rams" | "towers" | "lines" | "mine")[] = [];
  if (reliefMen > 0 && temper.skill >= 45 && !have.has("lines")) want.push("lines");
  if (temper.bold >= 55 && !have.has("rams") && day - siege.startedAtStep >= 5) want.push("rams");
  if (temper.skill >= 60 && garrison > 0 && !have.has("towers") && day - siege.startedAtStep >= 20) want.push("towers");
  if (want.length > 0 && siege.works.length < 3) return lay(false, want.slice(0, 1), `the siege of ${place} is to be pressed with ${want[0]}`);
  return null;
}
