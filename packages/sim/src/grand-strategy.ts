import {
  AIM_KEPT_DAYS,
  atWar,
  fitStrengthOf,
  isNavalForce,
  isWinterMonth,
  kmFrom,
  kmFromAny,
  monthOfDay,
  stableHash,
  warStanding,
  warWeariness,
  type Character,
  type Force,
  type PolityAgreement,
  type ScenarioClock,
  type ScenarioWarfareRules,
  type WarAim,
  type WarPlan,
  type WarPosture,
  type WarTheatre,
  type WorldState,
} from "@chronica/shared";
import { SIEGE_NEEDED_AT } from "./occupation";
import { dispositionOf } from "./disposition";
import { commandTenureOf } from "./constitutions";

/**
 * The grand strategy of a power at war (docs/plans/war-plans.md): what the war is for, where the weight of it falls, which army goes where.
 *
 * Built by rule from what the head of the state can see: the ground he has lost and the ground worth taking, the enemy's armies, how
 * strong he is against them, what the war has cost, and the sort of man he is. It is looked at again when something happens that a
 * man would answer (a battle, a province lost, the capital threatened, weariness, a new ally, the turn of the season) and otherwise
 * not before `AIM_KEPT_DAYS` have gone, so that the aims are not changed with the weather. Nothing here moves an army;
 * `campaign-orders.ts` turns the plan into orders for each.
 */

const BY_LAND = { passable: (edge: { readonly crossing: string }) => edge.crossing !== "sea_lane" && edge.crossing !== "strait" };
/** How far from our armies an aim is worth naming, and how near two aims must lie to be one theatre. */
const AIM_REACH_KM = 900;
const THEATRE_KM = 350;
/** An enemy army this near the capital is a threat to it. */
const CAPITAL_ALARM_KM = 250;
const MAX_THEATRES = 3;
const MAX_AIMS = 5;
/** What an aim already held is worth over a new one of the same worth, so that the plan is not changed for a trifle. */
const HELD_AIM_BONUS = 1.3;

export interface StrategyContext {
  readonly world: WorldState;
  readonly gameId: string;
  readonly polityId: string;
  readonly ruler: Character;
  /** Every power on the other side, followers of the principals included. */
  readonly enemies: ReadonlySet<string>;
  readonly warfare: ScenarioWarfareRules | undefined;
  readonly clock: ScenarioClock | undefined;
  readonly provinces: ReadonlyMap<string, WorldState["map"]["provinces"][number]>;
  /** Distances worked out this month, by where from, how far and by what roads: the same province is asked about by many armies. */
  readonly reaches?: Map<string, Map<string, number>>;
}

/** The distances from a province, by land alone or by sea too, kept for the month. */
export function reachOf(ctx: Pick<StrategyContext, "world" | "reaches">, from: string, budgetKm: number, landOnly: boolean): Map<string, number> {
  const key = `${from}|${budgetKm}|${landOnly ? "l" : "s"}`;
  const kept = ctx.reaches?.get(key);
  if (kept !== undefined) return kept;
  const found = kmFrom(ctx.world, from, { budgetKm, ...(landOnly ? BY_LAND : {}) });
  ctx.reaches?.set(key, found);
  return found;
}

export const monthOf = (ctx: Pick<StrategyContext, "clock">, day: number): number | null => (ctx.clock === undefined ? null : monthOfDay(day, ctx.clock));

export const landForcesOf = (world: WorldState, polityId: string, warfare: ScenarioWarfareRules | undefined): Force[] =>
  world.material.forces.filter((force) => force.polityId === polityId && force.outlaw !== true && fitStrengthOf(force) > 0 && !isNavalForce(force, warfare));

export const enemyArmies = (ctx: StrategyContext): Force[] =>
  ctx.world.material.forces.filter((force) => ctx.enemies.has(force.polityId) && force.outlaw !== true && fitStrengthOf(force) > 0 && !isNavalForce(force, ctx.warfare));

const capitalProvinceOf = (ctx: StrategyContext, polityId: string): string | null => {
  const capital = ctx.world.map.polities.find((polity) => polity.id === polityId)?.capitalSettlementId ?? null;
  if (capital === null) return null;
  for (const province of ctx.provinces.values()) if (province.settlements.some((settlement) => settlement.id === capital)) return province.id;
  return null;
};

/** What taking a province is worth: a town, the capital, and ground of our own that was lost. */
export function worthOf(ctx: StrategyContext, provinceId: string): number {
  const province = ctx.provinces.get(provinceId);
  if (province === undefined) return 0;
  const capital = ctx.world.map.polities.find((polity) => polity.id === province.controllerPolityId)?.capitalSettlementId ?? null;
  const walls = province.settlements.reduce((best, settlement) => Math.max(best, settlement.fortificationLevel), 0);
  return (province.settlements.length > 0 ? 20 : 5) + (province.settlements.some((settlement) => settlement.id === capital) ? 30 : 0)
    + (province.ownerPolityId === ctx.polityId ? 40 : 0) + Math.min(10, walls * 2);
}

const aimKey = (aim: WarAim): string => `${aim.kind}:${aim.provinceId ?? ""}:${aim.polityId ?? ""}`;
const sameAimSet = (a: readonly WarAim[], b: readonly WarAim[]): boolean => JSON.stringify(a.map(aimKey).sort()) === JSON.stringify(b.map(aimKey).sort());

interface ScoredAim { readonly aim: WarAim; readonly value: number; readonly score: number }

/** Seasons: whether the plan was made in winter and now is not, or the other way about. */
const winterNow = (ctx: StrategyContext): boolean | null => {
  const month = monthOf(ctx, ctx.world.instant.day);
  return month === null ? null : isWinterMonth(month);
};

/** Why a war's plan must be looked at again before its time, in a few words each. */
export function shiftTriggers(ctx: StrategyContext, existing: WarPlan, war: PolityAgreement | undefined): string[] {
  const { world, polityId } = ctx;
  const since = existing.aimsSetAtStep;
  const why: string[] = [];
  const lost = world.map.provinces.find((province) => province.lostBy?.polityId === polityId && province.lostBy.atStep > since && province.controllerPolityId !== null && ctx.enemies.has(province.controllerPolityId));
  if (lost !== undefined) why.push(`${lost.name} was lost`);
  if ((war?.battles ?? []).some((battle) => battle.atStep > since && (battle.winnerPolityId === polityId || battle.loserPolityId === polityId))) why.push("a battle has been fought");
  const capital = capitalProvinceOf(ctx, polityId);
  if (capital !== null) {
    const near = reachOf(ctx, capital, CAPITAL_ALARM_KM, true);
    if (enemyArmies(ctx).some((force) => near.has(force.locationId)) && !existing.aims.some((aim) => aim.kind === "hold_province" && aim.provinceId === capital)) why.push("an army stands near the capital");
  }
  if (!existing.aims.some((aim) => aim.kind === "sue_for_peace") && warWeariness(world, polityId, existing.enemyPolityId).score >= 60) why.push("the people are weary of the war");
  if (world.polityAgreements.some((agreement) => agreement.status === "active" && agreement.kind === "alliance" && agreement.sinceStep > since && (agreement.polityId === polityId || agreement.otherPolityId === polityId))) why.push("a new ally has come in");
  const then = ctx.clock === undefined ? null : isWinterMonth(monthOfDay(since, ctx.clock));
  const now = winterNow(ctx);
  if (then !== null && now !== null && then !== now) why.push(now ? "winter is coming on" : "the campaigning season is open");
  return why;
}

/** The posture of a war, by the man at its head and the odds: to have it out, to wear them down, or to stand. */
export function postureOf(ctx: StrategyContext, mine: readonly Force[]): { readonly posture: WarPosture; readonly why: string } {
  const { world, polityId } = ctx;
  const ours = mine.reduce((sum, force) => sum + fitStrengthOf(force), 0);
  const theirs = enemyArmies(ctx).reduce((sum, force) => sum + fitStrengthOf(force), 0);
  const ratio = ours / Math.max(1, theirs);
  const d = dispositionOf(ctx.ruler, world.instant.day);
  const onOurGround = enemyArmies(ctx).some((force) => {
    const province = ctx.provinces.get(force.locationId);
    return province !== undefined && (province.ownerPolityId ?? province.controllerPolityId) === polityId;
  });
  const bold = (d.nerve - 0.5) * 1.2 + (d.greed - 0.5) * 0.6 - (d.fear - 0.5) * 0.8 + Math.log2(Math.max(0.05, ratio)) * 0.5;
  if (onOurGround && ratio < 1.1) return { posture: "defend", why: "the enemy is on our ground and we are not the stronger" };
  if (theirs === 0 && ours > 0) return { posture: "attrition", why: "there is no army of theirs in the field" };
  if (ratio < 0.7 || (ratio < 1 && d.fear > 0.6)) return { posture: "defend", why: "we are the weaker" };
  if (bold > 0.35 && ratio >= 1.2) return { posture: "decisive", why: "we are the stronger, and the man has the stomach for it" };
  return { posture: "attrition", why: "the odds do not call for a battle, and a war can be won by wearing them down" };
}

/** The aims of a war, best first. */
function aimsFor(ctx: StrategyContext, mine: readonly Force[], enemy: string, posture: WarPosture, held: readonly WarAim[]): ScoredAim[] {
  const { world, polityId } = ctx;
  const heldKeys = new Set(held.map(aimKey));
  const out: ScoredAim[] = [];
  const add = (aim: WarAim, value: number, km: number): void => {
    const bonus = heldKeys.has(aimKey(aim)) ? HELD_AIM_BONUS : 1;
    out.push({ aim, value, score: (value * bonus * 1_000) / (km + 150) });
  };
  const armies = enemyArmies(ctx);
  const here = mine.length === 0 ? [capitalProvinceOf(ctx, polityId)].filter((id): id is string => id !== null) : mine.map((force) => force.locationId);
  const havePassage = world.material.forces.some((force) => force.polityId === polityId && isNavalForce(force, ctx.warfare) && fitStrengthOf(force) > 0);
  const reach = kmFromAny(world, here, { budgetKm: AIM_REACH_KM, ...(havePassage ? {} : BY_LAND) });
  // Ground to take: the enemy's, nearest and best first; a town of ours that he holds before all.
  for (const [provinceId, km] of reach) {
    const province = ctx.provinces.get(provinceId);
    if (province === undefined || province.controllerPolityId === null || !ctx.enemies.has(province.controllerPolityId)) continue;
    const worth = worthOf(ctx, provinceId);
    if (worth < 20 && province.ownerPolityId !== polityId) continue;
    const walled = province.settlements.some((settlement) => settlement.fortificationLevel >= SIEGE_NEEDED_AT);
    const raidOnly = !walled && province.ownerPolityId !== polityId && posture === "attrition" && worth < 40 && !armies.some((force) => force.locationId === provinceId);
    add({ kind: raidOnly ? "raid" : "take_province", provinceId }, worth, km);
  }
  // Ground to hold: ours where an enemy army stands, and the capital when one is near it.
  const capital = capitalProvinceOf(ctx, polityId);
  for (const force of armies) {
    const province = ctx.provinces.get(force.locationId);
    if (province === undefined || (province.ownerPolityId ?? province.controllerPolityId) !== polityId) continue;
    add({ kind: "hold_province", provinceId: province.id }, 45 + (province.id === capital ? 30 : 0), 0);
  }
  if (capital !== null) {
    const near = reachOf(ctx, capital, CAPITAL_ALARM_KM, true);
    if (armies.some((force) => near.has(force.locationId))) add({ kind: "hold_province", provinceId: capital }, 90, 0);
  }
  // An army to break: the largest of theirs within reach that we could beat, if we mean to fight.
  if (posture !== "defend") {
    const ours = mine.reduce((sum, force) => sum + fitStrengthOf(force), 0);
    const best = armies.filter((force) => reach.has(force.locationId) && fitStrengthOf(force) * 1.1 <= ours).sort((a, b) => fitStrengthOf(b) - fitStrengthOf(a) || a.id.localeCompare(b.id))[0];
    if (best !== undefined) add({ kind: "break_army", polityId: best.polityId, provinceId: best.locationId }, (posture === "decisive" ? 55 : 35) + Math.min(15, fitStrengthOf(best) / 1_000), reach.get(best.locationId) ?? 0);
  }
  // Peace, when the war has worn the people or gone against us.
  const weary = warWeariness(world, polityId, enemy).score;
  const standing = warStanding(world, polityId, enemy).score;
  if (weary >= 50 || standing <= -25) add({ kind: "sue_for_peace", polityId: enemy }, 60 + Math.min(20, weary / 4), 0);
  return out.sort((a, b) => b.score - a.score || aimKey(a.aim).localeCompare(aimKey(b.aim)));
}

/** The theatres: the aims' ground in at most three clusters, the main effort where the most is to be won for the least marching. */
function theatresFor(ctx: StrategyContext, aims: readonly ScoredAim[], mine: readonly Force[], before: readonly WarTheatre[]): { readonly theatres: WarTheatre[]; readonly reach: ReadonlyMap<string, ReadonlyMap<string, number>> } {
  const clusters: { id: string; anchor: string; provinceIds: string[]; value: number; km: ReadonlyMap<string, number> }[] = [];
  const havePassage = ctx.world.material.forces.some((force) => force.polityId === ctx.polityId && isNavalForce(force, ctx.warfare) && fitStrengthOf(force) > 0);
  for (const { aim, value } of aims) {
    if (aim.provinceId === undefined) continue;
    let cluster = clusters.find((candidate) => candidate.km.has(aim.provinceId!) && (candidate.km.get(aim.provinceId!) ?? Infinity) <= THEATRE_KM);
    if (cluster === undefined && clusters.length < MAX_THEATRES) {
      cluster = { id: `th-${aim.provinceId}`.slice(0, 60), anchor: aim.provinceId, provinceIds: [], value: 0, km: reachOf(ctx, aim.provinceId, AIM_REACH_KM, !havePassage) };
      clusters.push(cluster);
    }
    cluster ??= clusters[0];
    if (cluster === undefined) continue;
    if (!cluster.provinceIds.includes(aim.provinceId) && cluster.provinceIds.length < 12) cluster.provinceIds.push(aim.provinceId);
    cluster.value += value;
  }
  const kept = new Set(before.filter((theatre) => theatre.mainEffort).map((theatre) => theatre.id));
  const nearest = (cluster: { km: ReadonlyMap<string, number> }): number => Math.min(...mine.map((force) => cluster.km.get(force.locationId) ?? 1_500), 1_500);
  const ranked = clusters.map((cluster) => ({ cluster, perKm: (cluster.value * (kept.has(cluster.id) ? 1.25 : 1)) / (nearest(cluster) + 150) })).sort((a, b) => b.perKm - a.perKm || a.cluster.id.localeCompare(b.cluster.id));
  const reach = new Map(clusters.map((cluster) => [cluster.id, cluster.km] as const));
  return {
    theatres: ranked.map(({ cluster }, index) => ({ id: cluster.id, provinceIds: cluster.provinceIds, mainEffort: index === 0, forceIds: [], commanderId: null })),
    reach,
  };
}

/**
 * Which army goes to which theatre, and who leads it there. Rome's allotment is the Senate's and the lot's: the strongest army to
 * the main effort by decree and the others as the lot falls, each year anew; Carthage keeps a strategos to a theatre; a king
 * sends his armies where he will, the nearest and the strongest first.
 */
function allot(ctx: StrategyContext, theatres: WarTheatre[], reach: ReadonlyMap<string, ReadonlyMap<string, number>>, mine: readonly Force[], existing: readonly { forceId: string; theatreId: string | null; issuedStep: number }[]): WarTheatre[] {
  if (theatres.length === 0) return theatres;
  const { world, polityId } = ctx;
  const tenure = commandTenureOf(world, polityId);
  const day = world.instant.day;
  const year = Math.floor(day / 365);
  const assigned = new Map<string, string[]>(theatres.map((theatre) => [theatre.id, []]));
  const strength = (force: Force): number => fitStrengthOf(force);
  const order = [...mine].sort((a, b) => strength(b) - strength(a) || a.id.localeCompare(b.id));
  const weight = (theatre: WarTheatre): number => (theatre.mainEffort ? 2 : 1);
  order.forEach((force, index) => {
    const kept = existing.find((entry) => entry.forceId === force.id && entry.theatreId !== null && theatres.some((theatre) => theatre.id === entry.theatreId));
    // An allotment is kept until the year turns (a consul's province) or a season has passed (a strategos's or a king's order).
    const keepFor = tenure === "annual_prorogable" || tenure === "annual_no_iteration" ? 365 : 150;
    if (kept !== undefined && day - kept.issuedStep < keepFor) {
      assigned.get(kept.theatreId!)!.push(force.id);
      return;
    }
    let chosen: WarTheatre;
    if (index === 0) chosen = theatres.find((theatre) => theatre.mainEffort)!;
    else if (tenure === "annual_prorogable" || tenure === "annual_no_iteration") {
      const total = theatres.reduce((sum, theatre) => sum + weight(theatre), 0);
      let at = stableHash([ctx.gameId, "lot", polityId, force.commanderCharacterId, String(year)]) % total;
      chosen = theatres.find((theatre) => (at -= weight(theatre)) < 0) ?? theatres[0]!;
    } else {
      // The theatre that most wants him, by the worth of it for the marching: the nearest first, the main effort first of all.
      chosen = [...theatres].sort((a, b) => {
        const score = (theatre: WarTheatre): number => weight(theatre) / ((reach.get(theatre.id)?.get(force.locationId) ?? 1_500) + 150) / (1 + assigned.get(theatre.id)!.length);
        return score(b) - score(a) || a.id.localeCompare(b.id);
      })[0]!;
    }
    assigned.get(chosen.id)!.push(force.id);
  });
  return theatres.map((theatre) => {
    const ids = assigned.get(theatre.id)!.slice(0, 8);
    const lead = ids.map((id) => mine.find((force) => force.id === id)).filter((force): force is Force => force !== undefined).sort((a, b) => strength(b) - strength(a) || a.id.localeCompare(b.id))[0];
    return { ...theatre, forceIds: ids, commanderId: lead?.commanderCharacterId ?? null };
  });
}

/** The theatres and the allotment of armies for aims already chosen: what the rules do for a plan a man laid down without them. */
export function theatresForAims(ctx: StrategyContext, aims: readonly WarAim[], mine: readonly Force[], before: readonly WarTheatre[], campaigns: readonly { forceId: string; theatreId: string | null; issuedStep: number }[]): WarTheatre[] {
  const { theatres, reach } = theatresFor(ctx, aims.map((aim) => ({ aim, value: aim.provinceId === undefined ? 30 : worthOf(ctx, aim.provinceId) + (aim.kind === "hold_province" ? 45 : 0), score: 0 })), mine, before);
  return allot(ctx, theatres, reach, mine, campaigns);
}

export interface PlannedWar {
  readonly plan: WarPlan;
  readonly changed: boolean;
  /** Looked at afresh, rather than carried on: what the plan on record should be told. */
  readonly rebuilt: boolean;
  readonly why: string;
}

/**
 * The plan of the war with `enemy`, from the one that stands (or none). `changed` is whether anything the head of the state would
 * say aloud differs from before: aims, posture or the main effort. Forces are always re-allotted so that new armies are in it.
 */
export function planTheWar(ctx: StrategyContext, enemy: string, war: PolityAgreement | undefined, existing: WarPlan | undefined, mine: readonly Force[], campaigns: readonly { forceId: string; theatreId: string | null; issuedStep: number }[]): PlannedWar {
  const { world, polityId } = ctx;
  const day = world.instant.day;
  const triggers = existing === undefined ? ["there is no plan yet"] : shiftTriggers(ctx, existing, war);
  const age = existing === undefined ? Infinity : day - existing.aimsSetAtStep;
  // Aims met are struck off; the plan stands until its time or something happens.
  const stillWanted = (aim: WarAim): boolean => {
    if (aim.kind === "take_province" || aim.kind === "raid") {
      const province = aim.provinceId === undefined ? undefined : ctx.provinces.get(aim.provinceId);
      return province !== undefined && province.controllerPolityId !== null && ctx.enemies.has(province.controllerPolityId);
    }
    if (aim.kind === "break_army") return enemyArmies(ctx).some((force) => force.polityId === aim.polityId);
    if (aim.kind === "hold_province") return aim.provinceId !== undefined && (ctx.provinces.get(aim.provinceId)?.controllerPolityId ?? null) === polityId;
    return atWar(world.polityAgreements, polityId, enemy);
  };
  const standing = existing?.aims.filter(stillWanted) ?? [];
  if (existing !== undefined && triggers.length === 0 && age < AIM_KEPT_DAYS && standing.length > 0) {
    const { theatres, reach } = theatresFor(ctx, standing.map((aim) => ({ aim, value: aim.provinceId === undefined ? 30 : worthOf(ctx, aim.provinceId) + (aim.kind === "hold_province" ? 45 : 0), score: 0 })), mine, existing.theatres);
    const allotted = allot(ctx, theatres, reach, mine, campaigns);
    return { plan: { ...existing, aims: standing, theatres: allotted, reviewedAtStep: day, aimsChangedAtStep: sameAimSet(standing, existing.aims) ? existing.aimsChangedAtStep : day }, changed: false, rebuilt: false, why: "" };
  }
  const posture = existing !== undefined && triggers.length === 0 && age < AIM_KEPT_DAYS * 2 ? { posture: existing.posture, why: "" } : postureOf(ctx, mine);
  const scored = aimsFor(ctx, mine, enemy, posture.posture, existing?.aims ?? []);
  // At most one of each of the aims that name no ground, and the rest the best ground.
  const aims: WarAim[] = [];
  let peace = false;
  let army = false;
  for (const { aim } of scored) {
    if (aims.some((taken) => aimKey(taken) === aimKey(aim))) continue;
    if (aim.kind === "sue_for_peace") { if (peace) continue; peace = true; }
    if (aim.kind === "break_army") { if (army) continue; army = true; }
    aims.push(aim);
    if (aims.length >= MAX_AIMS) break;
  }
  if (aims.length === 0) {
    const capital = capitalProvinceOf(ctx, polityId);
    if (capital !== null) aims.push({ kind: "hold_province", provinceId: capital });
    else if (existing !== undefined) aims.push(...existing.aims.slice(0, 1));
  }
  const { theatres, reach } = theatresFor(ctx, aims.map((aim) => scored.find((entry) => aimKey(entry.aim) === aimKey(aim)) ?? { aim, value: 30, score: 0 }), mine, existing?.theatres ?? []);
  const allotted = allot(ctx, theatres, reach, mine, campaigns);
  const sameAims = existing !== undefined && sameAimSet(existing.aims, aims);
  const plan: WarPlan = {
    warId: war?.id ?? existing?.warId ?? "no-war", polityId, enemyPolityId: enemy, aims: aims.length === 0 ? existing?.aims ?? [] : aims, theatres: allotted,
    posture: posture.posture, reviewedAtStep: day, aimsSetAtStep: day, aimsChangedAtStep: sameAims && existing!.posture === posture.posture ? existing!.aimsChangedAtStep : day,
    issuedByCharacterId: ctx.ruler.id,
    ...(existing?.navalPlan === undefined ? {} : { navalPlan: existing.navalPlan }),
  };
  const main = (theatres: readonly WarTheatre[]): string | undefined => theatres.find((theatre) => theatre.mainEffort)?.id;
  const changed = existing === undefined || existing.posture !== plan.posture || main(existing.theatres) !== main(plan.theatres) || !sameAims;
  return { plan, changed, rebuilt: true, why: `${triggers.join("; ")}${posture.why === "" ? "" : `; ${posture.why}`}`.slice(0, 300) };
}
