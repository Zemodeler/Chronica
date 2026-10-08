import {
  WorldDeltaSchema,
  campaignOf,
  alliesLedBy,
  isNavalForce,
  kmFrom,
  warPlanOf,
  leaderOf,
  warsOf,
  fitStrengthOf,
  type Character,
  type CampaignPlan,
  type ScenarioClock,
  type ScenarioWarfareRules,
  type WarPlan,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";
import { REACH_KM, besiegerOrder, campaignStillGood, conductByPlan, issueCampaign, type OrderSets } from "./campaign-orders";
import { commandTenureOf } from "./constitutions";
import { shareArmies } from "./two-fronts";
import { landForcesOf, planTheWar, reachOf, theatresForAims, type StrategyContext } from "./grand-strategy";
import { fleetOrder, navalForces, navalPlanFor } from "./naval-orders";
import type { StatecraftDecision } from "./statecraft";

/**
 * A power's war, directed by rule (docs/plans/war-plans.md): once a month the head of the state looks at his plan (`grand-strategy.ts`),
 * sends each army its orders (`campaign-orders.ts`), and each army and fleet does what it was sent to do. Armies the model plays,
 * and the player's, are not touched here; the model's man writes his own plan (`war_plan_set`, `campaign_plan_set`) and the
 * armies under him keep to it.
 */

const wd = (raw: Record<string, unknown>): WorldDelta => WorldDeltaSchema.parse(raw);
/** Orders are renewed when they have this many days to run. */
const RENEW_WITHIN_DAYS = 35;
/** A plan a model-played ruler laid down stands this long before the rules look at it. */
const MODEL_PLAN_DAYS = 180;

export interface DirectInput {
  readonly world: WorldState;
  readonly gameId: string;
  readonly polityId: string;
  readonly ruler: Character;
  readonly enemies: ReadonlySet<string>;
  readonly warfare: ScenarioWarfareRules | undefined;
  readonly clock: ScenarioClock | undefined;
  readonly playedByModel: ReadonlySet<string>;
  readonly playerCharacterId: string | null;
  readonly sets: OrderSets;
  /** The old rules, for an army the plan has nothing for. */
  readonly legacy: (force: WorldState["material"]["forces"][number]) => StatecraftDecision | null;
}

const isHis = (input: DirectInput, force: WorldState["material"]["forces"][number]): boolean =>
  force.commanderCharacterId === input.playerCharacterId || force.controllerCharacterId === input.playerCharacterId;
const isModels = (input: DirectInput, force: WorldState["material"]["forces"][number]): boolean =>
  input.playedByModel.has(force.commanderCharacterId) || input.playedByModel.has(force.controllerCharacterId ?? "");

/** Everything a power at war does with its armies and fleets this month, plans first and then orders. */
export function directTheWar(input: DirectInput): StatecraftDecision[] {
  const { world, polityId, ruler } = input;
  const provinces = new Map(world.map.provinces.map((province) => [province.id, province] as const));
  const ctx: StrategyContext = { world, gameId: input.gameId, polityId, ruler, enemies: input.enemies, warfare: input.warfare, clock: input.clock, provinces, reaches: new Map() };
  const day = world.instant.day;
  const decisions: StatecraftDecision[] = [];
  const mine = landForcesOf(world, polityId, input.warfare).filter((force) => !isHis(input, force) && force.private !== true);
  // A people that follows a leader by foedus has no war of its own: its armies go where the leader sends his, and take his orders.
  if (leaderOf(world.polityAgreements, polityId) !== null) return directFollower(input, ctx, mine);
  const tenure = commandTenureOf(world, polityId);
  // The wars, the bigger enemy first: it has the first claim on the armies.
  const sideOf = (enemy: string): Set<string> => new Set([enemy, ...alliesLedBy(world.polityAgreements, enemy)].filter((id) => input.enemies.has(id)));
  const weight = (enemy: string): number => world.material.forces.filter((force) => sideOf(enemy).has(force.polityId) && force.outlaw !== true && !isNavalForce(force, input.warfare)).reduce((sum, force) => sum + fitStrengthOf(force), 0);
  const principals = warsOf(world.polityAgreements, polityId).sort((a, b) => weight(b) - weight(a) || a.localeCompare(b));
  const ctxOf = new Map<string, StrategyContext>();
  const plans: WarPlan[] = [];
  const claimed = new Set<string>();
  const warWith = (enemy: string) => world.polityAgreements.find((agreement) => agreement.kind === "war" && agreement.status === "active"
    && ((agreement.polityId === polityId && agreement.otherPolityId === enemy) || (agreement.polityId === enemy && agreement.otherPolityId === polityId)));
  // The armies are shared among the wars by what each has at stake (two-fronts.ts), the second war keeping a reserve.
  const warIds = new Map(principals.map((enemy) => [warWith(enemy)?.id ?? "", enemy] as const));
  const placedIn = new Map((world.campaigns ?? []).filter((entry) => entry.polityId === polityId && entry.expiresStep > day && warIds.has(entry.warId)).map((entry) => [entry.forceId, warIds.get(entry.warId)!] as const));
  const shares = shareArmies(principals.filter((enemy) => warWith(enemy) !== undefined).map((enemy) => ({ enemy, ctx: { ...ctx, enemies: sideOf(enemy) } })), mine, placedIn);
  for (const enemy of principals) {
    const war = warWith(enemy);
    if (war === undefined) continue;
    const existing = warPlanOf(world, polityId, enemy);
    const wctx: StrategyContext = { ...ctx, enemies: sideOf(enemy) };
    ctxOf.set(enemy, wctx);
    const campaigns = (world.campaigns ?? []).filter((entry) => entry.polityId === polityId).map((entry) => ({ forceId: entry.forceId, theatreId: entry.theatreId, issuedStep: entry.issuedStep }));
    // A plan the model's man laid down stands for a while; the rules do not unwrite what he wrote.
    const modelMade = existing !== undefined && existing.issuedByCharacterId !== null && input.playedByModel.has(existing.issuedByCharacterId) && day - existing.aimsSetAtStep < MODEL_PLAN_DAYS;
    const free = (shares.get(enemy) ?? []).filter((force) => !claimed.has(force.id));
    const planned = modelMade
      ? { plan: existing.theatres.length > 0 ? existing : { ...existing, theatres: theatresForAims(wctx, existing.aims, free, [], campaigns) }, changed: false, rebuilt: false, why: "" }
      : planTheWar(wctx, enemy, war, existing, free, campaigns);
    // The sea part of the plan: what the fleets are for. Armies that no road reaches want ships.
    const unreachable = planned.plan.aims.filter((aim) => aim.provinceId !== undefined && aim.kind !== "hold_province"
      && free.length > 0 && !reachOf(ctx, free[0]!.locationId, REACH_KM, true).has(aim.provinceId)).map((aim) => aim.provinceId!);
    const naval = modelMade ? existing.navalPlan : navalPlanFor(wctx, planned.plan, unreachable);
    const plan: WarPlan = { ...planned.plan, ...(naval === undefined ? {} : { navalPlan: naval }) };
    if (naval === undefined && "navalPlan" in plan) delete (plan as { navalPlan?: unknown }).navalPlan;
    for (const theatre of plan.theatres) for (const id of theatre.forceIds) claimed.add(id);
    plans.push(plan);
    const navalChanged = JSON.stringify(existing?.navalPlan ?? null) !== JSON.stringify(plan.navalPlan ?? null);
    // The man who leads each theatre is part of the allotment: a new consul or a recalled strategos is a plan to be written again.
    const allotment = (entry: WarPlan | undefined): string => JSON.stringify((entry?.theatres ?? []).map((theatre) => [theatre.id, [...theatre.forceIds].sort(), theatre.commanderId ?? null]));
    if (!modelMade && (planned.changed || planned.rebuilt || navalChanged || allotment(existing) !== allotment(plan) || existing === undefined)) {
      decisions.push({
        polityId, actorCharacterId: ruler.id, act: "war_plan", targetPolityId: enemy, why: (planned.why || "the plan is looked at again").slice(0, 400), facts: [],
        deltas: [wd({
          op: "war_plan_set", polityId, enemyPolityId: enemy, aims: plan.aims, theatres: plan.theatres, posture: plan.posture,
          ...(plan.navalPlan === undefined ? {} : { navalPlan: plan.navalPlan }),
          reason: (planned.why || "The plan is looked at again.").slice(0, 280),
        })],
      });
    }
  }
  const planOf = (force: { id: string }): WarPlan | undefined => plans.find((plan) => plan.theatres.some((theatre) => theatre.forceIds.includes(force.id)));

  // Orders to each army from the plan; the army then goes about them.
  for (const force of mine) {
    const plan = planOf(force);
    if (plan === undefined) continue;
    const wctx = ctxOf.get(plan.enemyPolityId) ?? ctx;
    const theatre = plan.theatres.find((entry) => entry.forceIds.includes(force.id));
    const existing = campaignOf(world, force.id);
    // Who sends him: the consul is his own master in the field, the Senate having given him his province; a strategos answers to the
    // man who leads the theatre, a king's general to the king.
    const lead = theatre?.commanderId ?? null;
    const issuer = tenure === "indefinite_answerable" && lead !== null && lead !== force.commanderCharacterId ? lead
      : tenure === "annual_prorogable" || tenure === "annual_no_iteration" ? (force.controllerCharacterId ?? force.commanderCharacterId)
      : ruler.id;
    const reach = reachOf(ctx, force.locationId, REACH_KM, true);
    let cp: CampaignPlan | undefined = existing;
    const good = existing !== undefined && campaignStillGood(wctx, force, existing, plan, theatre, input.playedByModel, reach);
    if (!good) {
      const issued = issueCampaign(wctx, force, plan, theatre, issuer, existing);
      cp = issued?.campaign;
      if (issued !== null) {
        decisions.push(campaignDecision(input, issuer, force, issued.campaign, issued.why, enemyOf(plan, issued.campaign)));
      }
    } else if (existing !== undefined && existing.expiresStep - day < RENEW_WITHIN_DAYS) {
      // Renewed as it stands, so that an order does not run out under an army that is doing it.
      const renewed: CampaignPlan = { ...existing, issuedStep: existing.issuedStep, expiresStep: day + 120 };
      cp = renewed;
      decisions.push(campaignDecision(input, existing.issuedByCharacterId, force, renewed, "the orders stand", enemyOf(plan, renewed)));
    }
    // Whether the army acts this month, and by which rules. A man the model plays leads his own army, except where the orders on it are the rules' own
    // (written in his name): then he has taken nothing in hand, and the army does not sit while the model answers that he does nothing.
    if ((isModels(input, force) && cp?.byRule !== true) || input.sets.marching.has(force.id) || input.sets.fighting.has(force.id)) continue;
    if (input.sets.besieging.has(force.id)) {
      const order = besiegerOrder(wctx, force);
      if (order !== null) decisions.push(order);
      continue;
    }
    // An army on hold with no orders is held by somebody's word, and is not ours to lift; with orders, the hold is the plan's own (it is laid to refuse battle in a town and lifted when the army is to act).
    if (force.hold === true && cp === undefined) continue;
    const order = cp === undefined ? input.legacy(force) : conductByPlan({ ...wctx, sets: input.sets }, force, cp, input.gameId);
    if (order !== null) decisions.push(order);
  }
  // Armies of the power that are in no theatre (new levies, a war with only a follower) are led by the old rules.
  for (const force of mine) {
    if (planOf(force) !== undefined || isModels(input, force) || input.sets.marching.has(force.id) || input.sets.fighting.has(force.id) || force.hold === true) continue;
    if (input.sets.besieging.has(force.id)) {
      const order = besiegerOrder(ctx, force);
      if (order !== null) decisions.push(order);
      continue;
    }
    const order = input.legacy(force);
    if (order !== null) decisions.push(order);
  }
  // The fleets.
  for (const fleet of navalForces(ctx, polityId)) {
    if (isHis(input, fleet) || isModels(input, fleet) || fleet.hold === true) continue;
    const order = fleetOrder(ctx, fleet, plans[0], input.sets);
    if (order !== null) decisions.push(order);
  }
  return decisions;
}

const enemyOf = (plan: WarPlan, _cp: CampaignPlan): string => plan.enemyPolityId;

function campaignDecision(input: DirectInput, issuer: string, force: WorldState["material"]["forces"][number], cp: CampaignPlan, why: string, enemy: string): StatecraftDecision {
  const objective = cp.objective.kind === "province"
    ? { objectiveProvinceId: cp.objective.provinceId, objectiveForceRef: null }
    : { objectiveProvinceId: null, objectiveForceRef: cp.objective.forceId };
  return {
    polityId: input.polityId, actorCharacterId: issuer, act: "war_plan", targetPolityId: enemy, why: why.slice(0, 400), facts: [],
    deltas: [wd({
      op: "campaign_plan_set", forceRef: force.id, mode: cp.mode, ...objective, byRule: cp.byRule === true, baseProvinceId: cp.baseProvinceId, fallbackProvinceId: cp.fallbackProvinceId,
      days: Math.max(10, Math.min(240, cp.expiresStep - input.world.instant.day)), theatreId: cp.theatreId, reason: why.slice(0, 280),
    })],
  };
}

/** The contingents of a power that follows a leader: his main army's orders, given them as their own and kept to as any army's are. */
function directFollower(input: DirectInput, ctx: StrategyContext, mine: readonly WorldState["material"]["forces"][number][]): StatecraftDecision[] {
  const { world, polityId } = input;
  const leader = leaderOf(world.polityAgreements, polityId)!;
  const day = world.instant.day;
  const leaderPlan = (world.warPlans ?? []).find((plan) => plan.polityId === leader);
  const main = leaderPlan?.theatres.find((theatre) => theatre.mainEffort)?.id ?? null;
  const orders = (world.campaigns ?? []).filter((entry) => entry.polityId === leader && entry.expiresStep > day && (entry.mode === "seek_battle" || entry.mode === "siege" || entry.mode === "raid"))
    .sort((a, b) => Number(b.theatreId === main) - Number(a.theatreId === main) || a.forceId.localeCompare(b.forceId));
  const decisions: StatecraftDecision[] = [];
  for (const force of mine) {
    if (isModels(input, force)) continue;
    const kept = campaignOf(world, force.id);
    const reach = reachOf(ctx, force.locationId, REACH_KM, true);
    const good = kept !== undefined && leaderPlan !== undefined && kept.warId === leaderPlan.warId && campaignStillGood(ctx, force, kept, leaderPlan, undefined, input.playedByModel, reach);
    let cp: CampaignPlan | undefined = good ? kept : undefined;
    const given = orders[0];
    if (cp === undefined && given !== undefined && leaderPlan !== undefined) {
      cp = { ...given, forceId: force.id, polityId, theatreId: null, issuedByCharacterId: given.issuedByCharacterId, issuedStep: day, expiresStep: day + 120 };
      decisions.push(campaignDecision(input, given.issuedByCharacterId, force, cp, "bidden to serve with the leader's army", leaderPlan.enemyPolityId));
    }
    if (input.sets.marching.has(force.id) || input.sets.fighting.has(force.id) || (force.hold === true && cp === undefined)) continue;
    if (input.sets.besieging.has(force.id)) {
      const order = besiegerOrder(ctx, force);
      if (order !== null) decisions.push(order);
      continue;
    }
    // While the leader has orders out and none that an ally can keep (he winters, he holds a town), the allies stay: they do not go off on their own.
    if (cp === undefined && (world.campaigns ?? []).some((entry) => entry.polityId === leader && entry.expiresStep > day)) continue;
    const order = cp === undefined ? input.legacy(force) : conductByPlan({ ...ctx, sets: input.sets }, force, cp, input.gameId);
    if (order !== null) decisions.push(order);
  }
  return decisions;
}

