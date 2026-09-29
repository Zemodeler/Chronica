import {
  applyRecruitmentToMaterial,
  boundedId,
  ensureProvinceMaterial,
  LEVY_REACH_KM,
  kmFrom,
  type ForcePersonnelCategory,
  type WorldState,
} from "@chronica/shared";
import type { IdFactory } from "./ports";

/**
 * Men are raised out of a country, paid for, and take time to come in.
 *
 * `force_create`, a draft of new men into an army and a recruitment project
 * finishing each made soldiers out of nothing: no province gave up a man, no
 * treasury paid a bounty, and a legion of eight thousand stood ready the day
 * it was ordered. `applyRecruitmentToMaterial` had been written for exactly
 * this and nothing ever called it, so the Italian allies' manpower -- the
 * reason Rome could lose at Cannae and fight on -- was a number nobody drew.
 *
 * A levy now draws `availableManpower`: first the province it is raised in,
 * then the rest of its power's ground, nearest first. It is a power's own
 * people it calls: a consul's levy enrols citizens. The peoples bound to it by
 * foedus owe it a contingent by their treaty, sent when a war opens
 * (`treaties.ts`), and nothing more -- a relief force of ten thousand Romans
 * used to empty Etruria and Picenum of men before the allies' own call-up had
 * found anybody. A levy called in an ally's country raises its men from the
 * power's own nearest ground. It costs a bounty and kit for every
 * man, from whoever raises it; and a large one musters over days, its men
 * reaching the standard in bands (`mustering` below, carried in by
 * `returnTheMended` on their day).
 *
 * Never refused for being short: a levy that asks for more men than the
 * country has, or more than the treasury can arm, raises what it can, and says
 * so. Ground nobody has counted -- a world with no people reckoned in it at
 * all -- is not a limit, so an older world raises what it asks.
 */

/** A man's bounty and kit, per thousand men, in the world's money: about a month and a half of a legion's pay. */
export const LEVY_COST_PER_THOUSAND = 30;
/** Men who can be at the standard the day a levy is called. */
export const MUSTER_AT_ONCE = 1_000;
/** Men a muster brings in a day beyond those. */
export const MEN_MUSTERED_PER_DAY = 300;
/** Bands a muster comes in: the men of the nearer towns first. */
const MUSTER_BANDS = 3;

export interface LevyRequest {
  readonly polityId: string;
  readonly provinceId: string;
  readonly men: number;
  /** Who pays the bounty. Null: the power's treasury, if it has one; nobody, if not. */
  readonly payerAccountId: string | null;
  /** False for men a project has already paid for, milestone by milestone. */
  readonly pays: boolean;
  readonly atStep: number;
  readonly cause: string;
  readonly ids: IdFactory;
}

export interface Levy {
  readonly world: WorldState;
  /** Men actually raised: what was asked, or less. */
  readonly men: number;
  readonly cost: number;
  /** Why fewer came than were asked for, in a sentence; null when all came. */
  readonly short: string | null;
}

export function levyCost(men: number): number {
  return Math.ceil((Math.max(0, men) * LEVY_COST_PER_THOUSAND) / 1_000);
}

/** The provinces a power raises men from, in the order it draws on them: its own, never an ally's. */
function poolsFor(world: WorldState, polityId: string, provinceId: string): string[] {
  const here = world.map.provinces.find((province) => province.id === provinceId)?.controllerPolityId ?? null;
  // How far a power sends for men: past this, a levy is a province's own.
  const reach = kmFrom(world, provinceId, { budgetKm: LEVY_REACH_KM });
  const own = world.map.provinces
    .filter((province) => province.id !== provinceId && province.controllerPolityId === polityId)
    .map((province) => ({ id: province.id, km: reach.get(province.id) ?? Infinity }))
    .filter((entry) => entry.km <= LEVY_REACH_KM)
    .sort((a, b) => a.km - b.km || a.id.localeCompare(b.id))
    .map((entry) => entry.id);
  // Its own people where the levy is raised on its own ground; never an ally's, a rival's or nobody's.
  return [...(here === polityId ? [provinceId] : []), ...own];
}

export function raiseLevy(given: WorldState, request: LevyRequest): Levy {
  const asked = Math.max(0, Math.floor(request.men));
  const name = (id: string): string => given.map.provinces.find((province) => province.id === id)?.name ?? id;
  let world = given.material.provinceMaterial.length === 0 ? given : ensureProvinceMaterial(given, request.atStep);
  const pools = poolsFor(world, request.polityId, request.provinceId);
  const rows = pools.map((id) => world.material.provinceMaterial.find((row) => row.provinceId === id));
  // Whether anybody is counted anywhere: a levy with nowhere of its own to
  // draw on raises nobody, but a world that reckons no people is no limit.
  const counted = world.material.provinceMaterial.some((row) => row.population > 0);
  const manpower = counted ? rows.reduce((sum, row) => sum + (row?.availableManpower ?? 0), 0) : Infinity;

  const payer = !request.pays
    ? undefined
    : request.payerAccountId !== null
      ? world.material.accounts.find((account) => account.id === request.payerAccountId)
      : world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === request.polityId && account.status === "active");
  const affordable = payer === undefined ? Infinity : Math.floor((payer.balance * 1_000) / LEVY_COST_PER_THOUSAND);
  const men = Math.min(asked, manpower, affordable);

  // Drawn from each pool in turn, as far as it goes.
  if (counted && men > 0) {
    let owed = men;
    const taken = new Map<string, number>();
    for (const [index, id] of pools.entries()) {
      const row = rows[index];
      if (row === undefined || owed <= 0) continue;
      const draw = Math.min(owed, row.availableManpower);
      if (draw <= 0) continue;
      taken.set(id, draw);
      owed -= draw;
    }
    world = {
      ...world,
      material: {
        ...world.material,
        provinceMaterial: world.material.provinceMaterial.map((row) => {
          const draw = taken.get(row.provinceId);
          return draw === undefined ? row : applyRecruitmentToMaterial(row, draw, request.atStep);
        }),
      },
    };
  }

  const cost = payer === undefined ? 0 : levyCost(men);
  if (payer !== undefined && cost > 0) {
    world = {
      ...world,
      material: {
        ...world.material,
        accounts: world.material.accounts.map((account) => (account.id === payer.id ? { ...account, balance: Math.max(0, account.balance - cost) } : account)),
        transactions: [...world.material.transactions, {
          id: request.ids.next("txn"),
          atStep: request.atStep,
          kind: "purchase" as const,
          amount: cost,
          sourceAccountId: payer.id,
          cause: { kind: "action" as const, id: request.cause, explanation: `Bounty and kit for ${men} men levied in ${name(request.provinceId)}.`.slice(0, 240) },
          visibility: "polity" as const,
        }].slice(-500),
      },
    };
  }

  const short = men >= asked
    ? null
    : men < asked && manpower <= affordable
      ? pools[0] !== request.provinceId
        ? `Of the ${asked} men called up in ${name(request.provinceId)}, only ${men} could be found: its people are allies, who send men by their treaty and not to a levy, and the levy's own country within reach had no more men of age to give.`
        : `Of the ${asked} men called up in ${name(request.provinceId)}, only ${men} could be found: its country${pools.length > 1 ? " and every other the levy could reach" : ""} had no more men of age to give.`
      : `Of the ${asked} men called up in ${name(request.provinceId)}, only ${men} were raised: there was money for no more bounties.`;
  return { world, men, cost, short };
}

/**
 * The men of a levy as they come in: the first thousand at the standard the
 * day it is called, the rest in bands over the days a muster that size takes.
 */
export function mustering(categoryId: string, label: string, men: number, atStep: number, idPrefix: string): ForcePersonnelCategory {
  const now = Math.min(men, MUSTER_AT_ONCE);
  const later = men - now;
  if (later <= 0) return { categoryId, label, fit: now, unavailable: [] };
  const days = Math.ceil(later / MEN_MUSTERED_PER_DAY);
  const bands = Math.min(MUSTER_BANDS, later);
  const unavailable = Array.from({ length: bands }, (_, index) => {
    const share = index === bands - 1 ? later - Math.floor(later / bands) * (bands - 1) : Math.floor(later / bands);
    return {
      id: boundedId(idPrefix, "muster", index),
      count: share,
      causeKind: "mustering" as const,
      causeId: boundedId(idPrefix, "levy"),
      earliestRecoveryStep: atStep + Math.max(1, Math.ceil((days * (index + 1)) / bands)),
    };
  }).filter((band) => band.count > 0);
  return { categoryId, label, fit: now, unavailable };
}
