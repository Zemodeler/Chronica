import {
  fitStrengthOf,
  leaderOf,
  type CampaignPlan,
  type FactProposalDraft,
  type WarPlan,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";
import { safeLocalId } from "../safe-local-id";

/**
 * The two acts that lay down a plan (`world/war-plan.ts`): the plan of a war, and an army's orders.
 * Written by the rules for the powers nobody plays and by the model for a man it plays; the bounds
 * are the same for both. Nothing here moves an army: orders are read by the monthly pass
 * (`campaign-orders.ts`) and by the man who commands.
 */

type WarPlanSet = Extract<WorldDelta, { op: "war_plan_set" }>;
type CampaignPlanSet = Extract<WorldDelta, { op: "campaign_plan_set" }>;

interface Handles {
  readonly resolve: (ref: string) => string | undefined;
  readonly reject: (message: string, kind?: "world" | "reference") => never;
  readonly emitFact: (fact: FactProposalDraft) => void;
  readonly actorId: string | null;
}

const nameOfProvince = (world: WorldState, id: string): string => world.map.provinces.find((province) => province.id === id)?.name ?? id;
const nameOfPolity = (world: WorldState, id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;

/** The plans of wars that have ended are dropped as new ones are written, so that the list stays as short as the wars. */
function liveOnly<T extends { readonly warId: string }>(world: WorldState, plans: readonly T[]): T[] {
  const live = new Set(world.polityAgreements.filter((agreement) => agreement.kind === "war" && agreement.status === "active").map((agreement) => agreement.id));
  return plans.filter((plan) => live.has(plan.warId));
}

export function applyWarPlanSet(world: WorldState, delta: WarPlanSet, handles: Handles): WorldState {
  const { reject, resolve } = handles;
  const polityId = resolve(delta.polityId) ?? delta.polityId;
  const enemyId = resolve(delta.enemyPolityId) ?? delta.enemyPolityId;
  if (!world.map.polities.some((polity) => polity.id === polityId)) reject(`No power "${polityId}" exists to make a plan of war.`, "reference");
  if (!world.map.polities.some((polity) => polity.id === enemyId)) reject(`No power "${enemyId}" exists to be warred on.`, "reference");
  const war = world.polityAgreements.find((agreement) => agreement.kind === "war" && agreement.status === "active"
    && ((agreement.polityId === polityId && agreement.otherPolityId === enemyId) || (agreement.polityId === enemyId && agreement.otherPolityId === polityId)));
  if (war === undefined) reject(`${nameOfPolity(world, polityId)} is not at war with ${nameOfPolity(world, enemyId)}: there is no war to plan.`);
  const known = new Set(world.map.provinces.map((province) => province.id));
  for (const aim of delta.aims) {
    if (aim.kind === "sue_for_peace" || aim.kind === "break_army") {
      if (aim.polityId !== undefined && !world.map.polities.some((polity) => polity.id === aim.polityId)) reject(`No power "${aim.polityId}" exists for the aim to be against.`, "reference");
    } else if (aim.provinceId === undefined || !known.has(aim.provinceId)) {
      reject(`The aim to ${aim.kind.replace("_", " ")} names ${aim.provinceId === undefined ? "no ground" : `"${aim.provinceId}", which is no province`}.`, "reference");
    }
  }
  const mine = new Set(world.material.forces.filter((force) => force.polityId === polityId).map((force) => force.id));
  const theatres = delta.theatres.map((theatre) => ({
    ...theatre,
    provinceIds: theatre.provinceIds.filter((id) => known.has(id)),
    forceIds: theatre.forceIds.filter((id) => mine.has(id)),
  }));
  if (theatres.filter((theatre) => theatre.mainEffort).length > 1) reject("A war has one main effort; the plan names several.");
  const before = (world.warPlans ?? []).find((plan) => plan.warId === war!.id && plan.polityId === polityId);
  const aimsKey = (aims: readonly WarPlan["aims"][number][]): string => JSON.stringify(aims.map((aim) => `${aim.kind}:${aim.provinceId ?? ""}:${aim.polityId ?? ""}`).sort());
  const atStep = world.elapsedStep;
  const plan: WarPlan = {
    warId: war!.id, polityId, enemyPolityId: enemyId, aims: delta.aims.map((aim) => (aim.polityId === undefined && (aim.kind === "sue_for_peace" || aim.kind === "break_army") ? { ...aim, polityId: enemyId } : aim)), theatres, posture: delta.posture,
    ...(delta.navalPlan === undefined ? {} : { navalPlan: { ...delta.navalPlan, seaProvinceIds: delta.navalPlan.seaProvinceIds.filter((id) => known.has(id)) } }),
    reviewedAtStep: atStep,
    aimsSetAtStep: atStep,
    aimsChangedAtStep: before !== undefined && aimsKey(before.aims) === aimsKey(delta.aims) && before.posture === delta.posture ? before.aimsChangedAtStep : atStep,
    issuedByCharacterId: handles.actorId,
  };
  const main = theatres.find((theatre) => theatre.mainEffort);
  const mainChanged = before === undefined || before.posture !== plan.posture || before.theatres.find((theatre) => theatre.mainEffort)?.id !== main?.id;
  if (mainChanged) {
    const what = delta.aims.slice(0, 2).map((aim) => `${aim.kind === "hold_province" ? "to hold" : aim.kind === "take_province" ? "to take" : aim.kind === "raid" ? "to raid" : aim.kind === "blockade" ? "to shut up the harbours of" : aim.kind === "break_army" ? "to break the army of" : "to bring to peace"} ${aim.provinceId !== undefined ? nameOfProvince(world, aim.provinceId) : nameOfPolity(world, aim.polityId ?? enemyId)}`).join(" and ");
    const stance = plan.posture === "decisive" ? "means to have it out in the field" : plan.posture === "defend" ? "means to stand on the defence" : "means to wear the enemy down";
    handles.emitFact({
      localId: safeLocalId(`war_plan_${polityId}_${enemyId}_${atStep}`).slice(0, 60), kind: "war_plan",
      summary: `${nameOfPolity(world, polityId)}'s plan for the war with ${nameOfPolity(world, enemyId)} is ${what}; it ${stance}${main === undefined ? "" : `, and the weight of it falls on ${main.provinceIds.slice(0, 2).map((id) => nameOfProvince(world, id)).join(" and ")}`}.`.slice(0, 400),
      affectedRefs: [{ kind: "polity", id: polityId }, { kind: "polity", id: enemyId }],
      visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance: 35,
    });
  }
  const rest = (world.warPlans ?? []).filter((candidate) => !(candidate.warId === war!.id && candidate.polityId === polityId));
  return { ...world, warPlans: [...liveOnly(world, rest), plan].slice(-60) };
}

export function applyCampaignPlanSet(world: WorldState, delta: CampaignPlanSet, handles: Handles): WorldState {
  const { reject, resolve } = handles;
  const forceId = resolve(delta.forceRef) ?? delta.forceRef;
  const force = world.material.forces.find((candidate) => candidate.id === forceId);
  if (force === undefined) return reject(`No army "${forceId}" exists to be given orders.`, "reference");
  if (fitStrengthOf(force) <= 0) reject(`${force.name} has no men left to give orders to.`);
  const known = new Set(world.map.provinces.map((province) => province.id));
  const targetForceId = delta.objectiveForceRef === null ? null : resolve(delta.objectiveForceRef) ?? delta.objectiveForceRef;
  if ((delta.objectiveProvinceId === null) === (targetForceId === null)) reject("Orders name one object: a province, or an army, and not both.");
  if (delta.objectiveProvinceId !== null && !known.has(delta.objectiveProvinceId)) reject(`No province "${delta.objectiveProvinceId}" exists to be the object of the orders.`, "reference");
  if (targetForceId !== null && !world.material.forces.some((candidate) => candidate.id === targetForceId)) reject(`No army "${targetForceId}" exists to be the object of the orders.`, "reference");
  for (const place of [delta.baseProvinceId, delta.fallbackProvinceId]) if (place !== null && !known.has(place)) reject(`No province "${place}" exists to be a base or a fallback.`, "reference");
  const sides = [force.polityId, leaderOf(world.polityAgreements, force.polityId)].filter((id): id is string => id !== null);
  const warId = world.polityAgreements.find((agreement) => agreement.kind === "war" && agreement.status === "active" && (sides.includes(agreement.polityId) || sides.includes(agreement.otherPolityId)))?.id ?? "no-war";
  const atStep = world.elapsedStep;
  const issuer = handles.actorId ?? force.controllerCharacterId ?? force.commanderCharacterId;
  const plan: CampaignPlan = {
    forceId, polityId: force.polityId, warId, theatreId: delta.theatreId,
    objective: delta.objectiveProvinceId !== null ? { kind: "province", provinceId: delta.objectiveProvinceId } : { kind: "army", forceId: targetForceId! },
    baseProvinceId: delta.baseProvinceId, fallbackProvinceId: delta.fallbackProvinceId, mode: delta.mode,
    issuedByCharacterId: issuer, issuedStep: atStep, expiresStep: atStep + delta.days,
    ...(delta.byRule === true ? { byRule: true, forCommanderId: force.commanderCharacterId } : {}),
  };
  const before = (world.campaigns ?? []).find((candidate) => candidate.forceId === forceId);
  const same = before !== undefined && JSON.stringify(before.objective) === JSON.stringify(plan.objective) && before.mode === plan.mode;
  if (!same) {
    const where = plan.objective.kind === "province" ? nameOfProvince(world, plan.objective.provinceId) : world.material.forces.find((candidate) => candidate.id === (plan.objective as { forceId: string }).forceId)?.name ?? "the enemy";
    const giver = world.characters.find((character) => character.id === issuer)?.name ?? nameOfPolity(world, force.polityId);
    const verb = plan.mode === "seek_battle" ? "sends" : plan.mode === "siege" ? "sends" : plan.mode === "raid" ? "sends" : plan.mode === "winter" ? "quarters" : plan.mode === "garrison" ? "keeps" : "bids";
    const rest = plan.mode === "seek_battle" ? `against ${where}` : plan.mode === "siege" ? `to besiege ${where}` : plan.mode === "raid" ? `to harry ${where}` : plan.mode === "winter" ? `at ${where} for the winter` : plan.mode === "garrison" ? `at ${where}` : `keep clear of ${where} and spare his men`;
    handles.emitFact({
      localId: safeLocalId(`orders_${forceId}_${atStep}`).slice(0, 60), kind: "campaign_orders",
      summary: `${giver} ${verb} ${force.name} ${rest}.`.slice(0, 300),
      affectedRefs: [{ kind: "force", id: forceId }, { kind: "polity", id: force.polityId }],
      visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance: 25,
    });
  }
  return { ...world, campaigns: [...(world.campaigns ?? []).filter((candidate) => candidate.forceId !== forceId && world.material.forces.some((other) => other.id === candidate.forceId)), plan].slice(-120) };
}
