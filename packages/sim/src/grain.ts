import {
  atWar,
  hopsBetween,
  isNavalForce,
  sameConfederation,
  stableHash,
  warfareWith,
  type Convoy,
  type FactProposalDraft,
  type Force,
  type ScenarioWarfareRules,
  type WorldState,
} from "@chronica/shared";
import type { IdFactory } from "./ports";

/**
 * Bread for an army beyond what it forages (docs/plans/battles-that-last.md).
 *
 * Three ways, and each has its cost:
 *
 * - **Bought** from the towns where it stands, at a price the power's own pay
 *   sets and scarcity raises. A country can spare only so much, and selling it
 *   leaves the country hungrier.
 * - **Requisitioned**: taken, which costs nothing in money and a great deal in
 *   the people's temper -- more on one's own ground, where they expected better.
 * - **Sent up by convoy** from one's own ground or a depot, taking the road's
 *   time, and liable to be taken on arrival by an enemy standing there -- the
 *   more surely when he is penning the army in, and the more so with horse.
 */

/** Why no bread could be had: said to the orchestrator as the act's refusal. */
export class GrainRefused extends Error {}

const fitOf = (force: Force): number => force.personnel.reduce((sum, group) => sum + group.fit, 0);
const clampBps = (value: number): number => Math.max(0, Math.min(10_000, Math.round(value)));

/** Of a country's people, the share of a day's bread it can spare an army for every day asked. */
const SPARE_SHARE = 0.05;
/** A requisition takes half as much again as a market would sell. */
const REQUISITION_REACH = 1.5;
/** Days on the road for every province between. */
const DAYS_PER_HOP = 3;
/** What carrying grain adds to its price, for every province it goes. */
const CARRIAGE_PER_HOP = 0.1;
/** Where no power says what its soldiers are paid, what a thousand men's pay is a month. */
const DEFAULT_PAY_PER_THOUSAND = 30;

const friendlyTo = (world: WorldState, polityId: string, other: string | null): boolean =>
  other !== null && (other === polityId || sameConfederation(world.polityAgreements, polityId, other));

/**
 * What bread for a thousand men for a day costs here: half a day's pay at the
 * power's own rate, up to three times that where the country is going hungry.
 */
export function grainPrice(world: WorldState, polityId: string, provinceId: string): number {
  const pay = world.map.polities.find((polity) => polity.id === polityId)?.soldierPayPerThousand ?? DEFAULT_PAY_PER_THOUSAND;
  const food = world.material.provinceMaterial.find((row) => row.provinceId === provinceId)?.foodSecurityBps ?? 10_000;
  return (pay / 60) * (1 + (10_000 - food) / 5_000);
}

/** How many man-days of bread a country can give up. */
function spareManDays(world: WorldState, provinceId: string): number {
  const row = world.material.provinceMaterial.find((candidate) => candidate.provinceId === provinceId);
  if (row === undefined) return 0;
  return Math.floor(row.population * (row.foodSecurityBps / 10_000) * SPARE_SHARE * 30);
}

/** Whether a penned army can reach this market at all: only a walled town of its own side inside its lines. */
function reachableMarket(world: WorldState, force: Force): boolean {
  const province = world.map.provinces.find((candidate) => candidate.id === force.locationId);
  if (province === undefined) return false;
  const penned = world.engagements.some((engagement) => engagement.status === "open" && engagement.defenderForceIds.includes(force.id));
  return province.settlements.some((settlement) => settlement.controllerPolityId !== null
    && !atWar(world.polityAgreements, force.polityId, settlement.controllerPolityId)
    && (!penned || (settlement.fortificationLevel >= 2 && friendlyTo(world, force.polityId, settlement.controllerPolityId))));
}

export interface Provisioned {
  readonly world: WorldState;
  readonly facts: FactProposalDraft[];
  /** What the bread cost, to be paid by whoever is paying. Zero for a requisition. */
  readonly cost: number;
  /** Who is paid for it, where it is anybody the world keeps an account for; null for the country at large. */
  readonly sellerAccountId: string | null;
  /** Days of bread actually got, which may be fewer than asked. */
  readonly days: number;
}

/** Bread bought or taken where the army stands. A refusal is thrown as a string. */
export function breadWhereItStands(world: WorldState, force: Force, how: "buy" | "requisition", daysAsked: number, day: number): Provisioned {
  const men = fitOf(force);
  if (men === 0) throw new GrainRefused("An army with no men in it needs no bread.");
  const province = world.map.provinces.find((candidate) => candidate.id === force.locationId);
  if (province === undefined) throw new GrainRefused(`${force.name} stands nowhere bread can be had.`);
  if (how === "buy" && !reachableMarket(world, force)) {
    throw new GrainRefused(`There is no market ${force.name} can buy from in ${province.name}: the towns there are held against it, or it is penned in its camp.`);
  }
  const reach = spareManDays(world, province.id) * (how === "requisition" ? REQUISITION_REACH : 1);
  const days = Math.min(daysAsked, Math.floor(reach / men));
  if (days < 1) throw new GrainRefused(`${province.name} has no bread to spare for ${force.name}: the country is too hungry, or too empty.`);
  const manDays = men * days;
  const row = world.material.provinceMaterial.find((candidate) => candidate.provinceId === province.id)!;
  const eaten = Math.min(2_000, Math.round((manDays / Math.max(1, row.population)) * 20_000 / 30));
  const ownGround = friendlyTo(world, force.polityId, province.controllerPolityId);
  const anger = how === "requisition" ? (ownGround ? 800 : 300) : 0;
  const cost = how === "buy" ? Math.max(1, Math.round((manDays / 1_000) * grainPrice(world, force.polityId, province.id))) : 0;
  // Paid to the farmers and dealers who sell it, not to anybody's treasury:
  // the money leaves the payer's chest for the country at large.
  const seller = null;
  const next: WorldState = {
    ...world,
    material: {
      ...world.material,
      provinceMaterial: world.material.provinceMaterial.map((candidate) => (candidate.provinceId !== province.id ? candidate : {
        ...candidate,
        foodSecurityBps: clampBps(candidate.foodSecurityBps - eaten),
        stabilityBps: clampBps(candidate.stabilityBps - anger),
      })),
      forces: world.material.forces.map((candidate) => (candidate.id !== force.id ? candidate : {
        ...candidate,
        provisionedThroughStep: Math.max(candidate.provisionedThroughStep, day) + days,
        provisionStatus: "provisioned" as const,
      })),
    },
  };
  const summary = how === "buy"
    ? `${force.name} bought ${days} days' bread in ${province.name}.`
    : ownGround
      ? `${force.name} took ${days} days' bread from the farms of ${province.name} by requisition, from its own people, who will not soon forget it.`
      : `${force.name} stripped ${province.name} of ${days} days' bread by requisition.`;
  return {
    world: next,
    facts: [{
      localId: `bread_${force.id}_${day}`.slice(0, 60),
      kind: how === "buy" ? "grain_bought" : "grain_requisitioned",
      summary,
      affectedRefs: [{ kind: "force", id: force.id }, { kind: "province", id: province.id }],
      visibility: how === "requisition" ? "public" : "polity",
      discoveryState: how === "requisition" ? "public" : "polity",
      knowableInDays: 0,
      significance: how === "requisition" && ownGround ? 50 : 30,
    }],
    cost,
    sellerAccountId: seller,
    days,
  };
}

/**
 * A convoy sent: bread bought where it is sent from, at that country's price
 * and the carriage on top, on the road for as long as the road is long.
 */
export function sendConvoy(world: WorldState, force: Force, fromProvinceId: string, days: number, day: number, ids: IdFactory): Provisioned & { readonly convoy: Convoy } {
  const from = world.map.provinces.find((candidate) => candidate.id === fromProvinceId);
  if (from === undefined) throw new GrainRefused(`No province "${fromProvinceId}" exists to send a convoy from.`);
  const home = friendlyTo(world, force.polityId, from.controllerPolityId)
    || world.structures.some((structure) => structure.provinceId === fromProvinceId && structure.ownerPolityId === force.polityId && structure.supplyRadius > 0);
  if (!home) throw new GrainRefused(`${from.name} is not ${force.name}'s own ground, nor does its power keep a depot there: bread is sent from home.`);
  const hops = fromProvinceId === force.locationId ? 0 : hopsBetween(world, fromProvinceId, force.locationId, 12);
  if (hops === null) throw new GrainRefused(`No road runs from ${from.name} to where ${force.name} stands.`);
  const men = fitOf(force);
  if (men === 0) throw new GrainRefused("An army with no men in it needs no bread.");
  const manDays = men * days;
  if (spareManDays(world, fromProvinceId) < manDays / 2) throw new GrainRefused(`${from.name} cannot spare ${days} days' bread for ${force.name}.`);
  const cost = Math.max(1, Math.round((manDays / 1_000) * grainPrice(world, force.polityId, fromProvinceId) * (1 + CARRIAGE_PER_HOP * hops)));
  const convoy: Convoy = {
    id: ids.next("convoy"), forceId: force.id, polityId: force.polityId, fromProvinceId, toProvinceId: force.locationId,
    days, men, sentAtStep: day, arrivesAtStep: day + Math.max(1, hops * DAYS_PER_HOP), status: "on_the_road",
  };
  const row = world.material.provinceMaterial.find((candidate) => candidate.provinceId === fromProvinceId);
  const eaten = row === undefined ? 0 : Math.min(1_500, Math.round((manDays / Math.max(1, row.population)) * 20_000 / 30));
  return {
    world: {
      ...world,
      convoys: [...world.convoys.filter((candidate) => candidate.status === "on_the_road" || candidate.arrivesAtStep > day - 60), convoy],
      material: { ...world.material, provinceMaterial: world.material.provinceMaterial.map((candidate) => (candidate.provinceId === fromProvinceId ? { ...candidate, foodSecurityBps: clampBps(candidate.foodSecurityBps - eaten) } : candidate)) },
    },
    facts: [{
      localId: `convoy_${convoy.id}`.slice(0, 60),
      kind: "convoy_sent",
      summary: `A convoy of ${days} days' bread set out from ${from.name} for ${force.name}, ${hops === 0 ? "close at hand" : `${hops} provinces off`}.`,
      affectedRefs: [{ kind: "force", id: force.id }, { kind: "province", id: fromProvinceId }],
      visibility: "polity",
      discoveryState: "polity",
      knowableInDays: 0,
      significance: 25,
    }],
    cost,
    sellerAccountId: null,
    days,
    convoy,
  };
}

/**
 * Convoys arriving: into the army's stores, or into the enemy's. An army
 * penned in its camp is fed only if the convoy can be got through the lines,
 * and an enemy with horse takes it more often than not.
 */
export function deliverConvoys(world: WorldState, toDay: number, warfare: ScenarioWarfareRules | undefined): { readonly world: WorldState; readonly facts: FactProposalDraft[] } {
  if (!world.convoys.some((convoy) => convoy.status === "on_the_road" && convoy.arrivesAtStep <= toDay)) return { world, facts: [] };
  const rules = warfare === undefined ? undefined : warfareWith(world, warfare);
  const facts: FactProposalDraft[] = [];
  let forces = world.material.forces;
  const name = (id: string): string => world.map.provinces.find((province) => province.id === id)?.name ?? id;
  const convoys = world.convoys.map((convoy): Convoy => {
    if (convoy.status !== "on_the_road" || convoy.arrivesAtStep > toDay) return convoy;
    const army = forces.find((force) => force.id === convoy.forceId && fitOf(force) > 0);
    // Gone, or moved on: the bread goes where the army was, and is lost.
    if (army === undefined || army.locationId !== convoy.toProvinceId) {
      facts.push(said(convoy, "convoy_lost", `The convoy sent to ${army?.name ?? "an army"} reached ${name(convoy.toProvinceId)} and found nobody to feed.`, 30));
      return { ...convoy, status: "lost" };
    }
    const enemies = forces.filter((force) => force.locationId === convoy.toProvinceId && fitOf(force) > 0 && !isNavalForce(force, rules)
      && force.polityId !== convoy.polityId && atWar(world.polityAgreements, force.polityId, convoy.polityId));
    const penned = world.engagements.some((engagement) => engagement.status === "open" && engagement.defenderForceIds.includes(army.id));
    const horse = horseShare(enemies, rules);
    const chance = enemies.length === 0 ? 0 : penned ? 0.35 + 0.45 * horse : 0.15 + 0.3 * horse;
    const roll = (stableHash([convoy.id, "intercept"]) % 10_000) / 10_000;
    if (roll < chance) {
      const taker = [...enemies].sort((a, b) => fitOf(b) - fitOf(a))[0]!;
      const fed = Math.max(1, Math.floor((convoy.days * convoy.men) / Math.max(1, fitOf(taker))));
      forces = forces.map((force) => (force.id === taker.id ? { ...force, provisionedThroughStep: Math.max(force.provisionedThroughStep, toDay) + fed, provisionStatus: "provisioned" as const } : force));
      facts.push(said(convoy, "convoy_taken", `${taker.name} fell on the convoy bringing bread to ${army.name} at ${name(convoy.toProvinceId)}, and ate it themselves.`, 55, [taker.id, army.id]));
      return { ...convoy, status: "taken" };
    }
    // The bread feeds as many days as it was sent for the men it was sent for.
    const fed = Math.max(1, Math.floor((convoy.days * convoy.men) / Math.max(1, fitOf(army))));
    forces = forces.map((force) => (force.id === army.id ? { ...force, provisionedThroughStep: Math.max(force.provisionedThroughStep, toDay) + fed, provisionStatus: "provisioned" as const } : force));
    facts.push(said(convoy, "convoy_arrived", penned
      ? `A convoy got through the enemy's lines at ${name(convoy.toProvinceId)} with ${fed} days' bread for ${army.name}.`
      : `A convoy reached ${army.name} at ${name(convoy.toProvinceId)} with ${fed} days' bread.`, penned ? 45 : 25, [army.id]));
    return { ...convoy, status: "delivered" };
  });
  return { world: { ...world, convoys, material: { ...world.material, forces } }, facts };
}

function said(convoy: Convoy, kind: string, summary: string, significance: number, forceIds: readonly string[] = [convoy.forceId]): FactProposalDraft {
  return {
    localId: `${kind}_${convoy.id}`.slice(0, 60),
    kind,
    summary: summary.slice(0, 600),
    affectedRefs: [{ kind: "province", id: convoy.toProvinceId }, ...forceIds.map((id) => ({ kind: "force" as const, id }))],
    visibility: kind === "convoy_taken" ? "public" : "polity",
    discoveryState: kind === "convoy_taken" ? "public" : "polity",
    knowableInDays: 0,
    significance,
  };
}

function horseShare(side: readonly Force[], rules: ScenarioWarfareRules | undefined): number {
  const all = side.reduce((sum, force) => sum + fitOf(force), 0);
  if (all === 0 || rules === undefined) return 0;
  const horse = side.reduce((sum, force) => sum + force.personnel
    .filter((group) => (rules.troopCategories.find((category) => category.id === group.categoryId)?.mobilityBps ?? 0) >= 8_000)
    .reduce((men, group) => men + group.fit, 0), 0);
  return horse / all;
}
