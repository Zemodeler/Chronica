import {
  EQUIPMENT_NEUTRAL_BPS,
  HULL_METAL_BARS,
  HULL_TIMBER_LOADS,
  YARD_MONTHS,
  HORSE_PRICE,
  KIT_BUYERS_SHARE,
  LEGIONARY_PAY_GROSS,
  PAY_STOPPAGES_SHARE,
  WARSHIP_PAY_PER_HULL,
  crewPerHull,
  drawStock,
  economyOf,
  isOccupied,
  kitNeedOf,
  kmFromAny,
  leaderOf,
  marketEntry,
  marketGeography,
  priceInDrachmae,
  selfArmedShare,
  wearBpsOf,
  type FactProposalDraft,
  type Force,
  type GoodId,
  type MoneyTransaction,
  type WorldState,
} from "@chronica/shared";
import { CARRIAGE_PER_100_KM, BUYING_REACH_KM } from "./grain-purchases";
import { cutOffHubs } from "./markets";
import type { IdFactory } from "./ports";
import { chestOfPower } from "./supply-plan";

/**
 * The quartermaster (docs/economy.md, "Equipment").
 *
 * Once a month, for every army its power keeps on pay: the kit wears with what the army did in the month (marching on foreign ground, a siege, a day of battle:
 * `wearBpsOf`), and is bought again out of the stoppage, the third of a legionary's pay that Polybius says was stopped for his grain, his clothes and his arms (6.39).
 * The tick keeps that third back in the chest when it pays an army (`tick.ts`); the quartermaster spends it here, at the markets of the hubs the army's power holds
 * round about it, through the market door: the stock leaves the hubs, whose prices rise by what is taken, and the silver goes out to the country. A war that wears
 * many armies drains the metal of the hubs behind it and makes it dear, and the dearer it is the less a month's stoppage buys: so the kit of an army in a long war runs down.
 * Where the state arms the men (`equipment: "state"`) it spends twice the stoppage. Horses are bought of the horse-owning classes at a price (`HORSE_PRICE`), not out of a stock.
 *
 * Nothing is made: units leave the hubs' stocks and the silver passes the market door. No order is wanted; no model call is made.
 */

/** The most hubs one army buys from in a month, the nearest first. */
const HOME_HUBS = 3;
/** Months of wear one reckoning takes in at the most, where the world was not looked at for long. */
const MAX_MONTHS = 3;
const MONTH = 30;
/** A kit at or under this is a want worth telling. */
export const SHORT_OF_ARMS_BPS = 5_000;
/** An army buys this much of its kit in a month and the paymaster is thought to have done something worth a line. */
const WORTH_A_LINE_BPS = 300;

const GOODS_OF_KIT: readonly { readonly good: GoodId; readonly of: "metals" | "textiles" | "timber"; readonly name: string }[] = [
  { good: "metals", of: "metals", name: "bars of metal" },
  { good: "textiles", of: "textiles", name: "lengths of cloth" },
  { good: "timber", of: "timber", name: "loads of timber" },
];

/** The monthly budget for an army's kit: the stoppage from its pay. */
export function kitBudgetOf(force: Pick<Force, "personnel">, state: boolean): number {
  const wage = force.personnel.reduce((sum, row) => sum + row.fit * (crewPerHull(row.categoryId) > 0 ? WARSHIP_PAY_PER_HULL : LEGIONARY_PAY_GROSS), 0);
  return Math.round(wage * PAY_STOPPAGES_SHARE * (state ? 2 : 1));
}

interface Leg { readonly hubId: string; readonly good: GoodId; readonly units: number; readonly price: number }

/** Whether a force is on the kit's books at all: kept on pay by a power's own treasury, and not an outlaw band or a private man's. */
function kept(force: Force): boolean {
  return force.payObligationId !== null && force.outlaw !== true && force.private !== true;
}

/** The hubs an army may buy from: held by its power, or one it leads or follows by treaty, not shut, nearest first. */
function homeHubs(world: WorldState, polityId: string, locationId: string, cut: ReadonlySet<string>, reach: ReadonlyMap<string, ReadonlyMap<string, number>>): { readonly hubId: string; readonly km: number }[] {
  const near = reach.get(locationId) ?? new Map<string, number>();
  const geography = marketGeography(world);
  const provinces = new Map(world.map.provinces.map((province) => [province.id, province]));
  const found: { hubId: string; km: number }[] = [];
  for (const hubId of geography.hubs) {
    const km = near.get(hubId);
    if (km === undefined || cut.has(hubId)) continue;
    const province = provinces.get(hubId);
    if (province === undefined || isOccupied(province)) continue;
    const holder = province.controllerPolityId;
    if (holder === null) continue;
    if (holder !== polityId && leaderOf(world.polityAgreements, holder) !== polityId && leaderOf(world.polityAgreements, polityId) !== holder) continue;
    found.push({ hubId, km });
  }
  return found.sort((a, b) => a.km - b.km || a.hubId.localeCompare(b.hubId)).slice(0, HOME_HUBS);
}

export interface KitInput {
  readonly world: WorldState;
  readonly toDay: number;
  readonly ids: IdFactory;
}

/** What the month's wear and buying did to one army, for the line the player may read. */
interface Reckoning {
  readonly force: Force;
  readonly spent: number;
  readonly bought: readonly { readonly name: string; readonly units: number }[];
  readonly from: string | null;
  readonly before: number;
}

export function keepTheKit(input: KitInput): { world: WorldState; facts: FactProposalDraft[] } {
  const start = drawYardStock(input.world, input.toDay);
  const day = input.toDay;
  if (start.material.forces.length === 0 || economyOf(start).markets.length === 0) return { world: start, facts: [] };
  // Who is looked at this month, before anything is built: most ticks look at nobody.
  const due = start.material.forces.filter((force) => kept(force) && (force.equipmentReckonedToStep === undefined || day - force.equipmentReckonedToStep >= MONTH));
  if (due.length === 0) return { world: start, facts: [] };

  const provinceById = new Map(start.map.provinces.map((province) => [province.id, province]));
  const besiegers = new Set(start.sieges.filter((siege) => siege.status === "active").map((siege) => siege.forceId));
  const cut = cutOffHubs(start, marketGeography(start).hubs);
  const reach = new Map<string, ReadonlyMap<string, number>>();
  let world = start;
  const changed = new Map<string, Force>();
  const transactions: MoneyTransaction[] = [];
  const reckonings: Reckoning[] = [];
  const nameOfProvince = (id: string): string => provinceById.get(id)?.name ?? id;

  for (const force of due.sort((a, b) => a.id.localeCompare(b.id))) {
    // The first look only sets the army down at the ordinary condition.
    if (force.equipmentBps === undefined || force.equipmentReckonedToStep === undefined) {
      changed.set(force.id, { ...force, equipmentBps: EQUIPMENT_NEUTRAL_BPS, equipmentReckonedToStep: day });
      continue;
    }
    const months = Math.min(MAX_MONTHS, Math.max(1, Math.floor((day - force.equipmentReckonedToStep) / MONTH)));
    const here = provinceById.get(force.locationId);
    const campaigning = here !== undefined && here.controllerPolityId !== force.polityId && leaderOf(start.polityAgreements, here.controllerPolityId ?? "") !== force.polityId;
    const sieging = besiegers.has(force.id);
    const battleDays = new Set(force.history.filter((event) => event.atStep > force.equipmentReckonedToStep! && (event.kind === "battle_death" || event.kind === "capture")).map((event) => event.atStep)).size;
    const wear = wearBpsOf({ campaigning, sieging, battles: battleDays }) * months;
    const before = force.equipmentBps;
    let condition = Math.max(0, before - wear);

    const establishment = start.establishments.find((candidate) => candidate.polityId === force.polityId);
    const state = establishment?.equipment === "state";
    const need = kitNeedOf(force, { sieging, armed: selfArmedShare(establishment?.recruitment.basis, establishment?.equipment) });
    const chest = chestOfPower(world, force.polityId);
    const account = chest === null ? undefined : world.material.accounts.find((candidate) => candidate.id === chest);
    let spent = 0;
    const bought: { name: string; units: number }[] = [];
    let from: string | null = null;

    if (account !== undefined && condition < 10_000) {
      if (!reach.has(force.locationId)) reach.set(force.locationId, kmFromAny(world, [force.locationId], { budgetKm: BUYING_REACH_KM }));
      const hubs = homeHubs(world, force.polityId, force.locationId, cut, reach);
      const budget = Math.min(kitBudgetOf(force, state) * months, Math.max(0, account.balance));
      // How much of the kit's whole issue the markets could give, and the silver would buy.
      const available = (good: GoodId): number => hubs.reduce((sum, hub) => sum + Math.floor((marketEntry(world, hub.hubId, good)?.stock ?? 0) * KIT_BUYERS_SHARE), 0);
      let stockLimit = 1;
      for (const line of GOODS_OF_KIT) {
        const wanted = need[line.of];
        if (wanted > 0) stockLimit = Math.min(stockLimit, available(line.good) / wanted);
      }
      const plan = (fraction: number): { legs: Leg[]; cost: number } => {
        const legs: Leg[] = [];
        let cost = need.horses * fraction * HORSE_PRICE;
        for (const line of GOODS_OF_KIT) {
          let owed = Math.floor(need[line.of] * fraction);
          for (const hub of hubs) {
            if (owed <= 0) break;
            const stock = Math.floor((marketEntry(world, hub.hubId, line.good)?.stock ?? 0) * KIT_BUYERS_SHARE);
            const units = Math.min(owed, stock);
            if (units <= 0) continue;
            const price = priceInDrachmae(world, hub.hubId, line.good) * (1 + (CARRIAGE_PER_100_KM * hub.km) / 100);
            legs.push({ hubId: hub.hubId, good: line.good, units, price });
            cost += units * price;
            owed -= units;
          }
        }
        return { legs, cost };
      };
      const gap = (10_000 - condition) / 10_000;
      let fraction = hubs.length === 0 ? 0 : Math.min(gap, stockLimit);
      let planned = fraction > 0 ? plan(fraction) : { legs: [] as Leg[], cost: 0 };
      if (planned.cost > budget && planned.cost > 0) {
        fraction = fraction * (budget / planned.cost);
        planned = plan(fraction);
      }
      if (planned.legs.length > 0 || need.horses * fraction >= 1) {
        const hubCost = planned.legs.reduce((sum, leg) => sum + leg.units * leg.price, 0);
        const horseCost = Math.round(need.horses * fraction) * HORSE_PRICE;
        spent = Math.max(0, Math.min(Math.round(hubCost + horseCost), Math.floor(budget)));
        if (spent > 0) {
          for (const leg of planned.legs) world = drawStock(world, leg.hubId, leg.good, leg.units).world;
          const byGood = new Map<string, number>();
          for (const leg of planned.legs) byGood.set(leg.good, (byGood.get(leg.good) ?? 0) + leg.units);
          for (const line of GOODS_OF_KIT) if ((byGood.get(line.good) ?? 0) > 0) bought.push({ name: line.name, units: byGood.get(line.good)! });
          from = planned.legs[0] === undefined ? null : nameOfProvince(planned.legs[0].hubId);
          condition = Math.min(10_000, condition + Math.round(fraction * 10_000));
          world = {
            ...world,
            material: { ...world.material, accounts: world.material.accounts.map((candidate) => (candidate.id === account.id ? { ...candidate, balance: candidate.balance - spent } : candidate)) },
          };
          transactions.push({
            id: input.ids.next("txn"), atStep: day, kind: "purchase", amount: spent, sourceAccountId: account.id, external: "market",
            cause: { kind: "action", id: force.id, explanation: `Arms, clothing and shafts bought for ${force.name} out of the stoppage.`.slice(0, 240) }, visibility: "polity",
          });
        }
      }
    }
    const next: Force = { ...force, equipmentBps: Math.round(condition), equipmentReckonedToStep: force.equipmentReckonedToStep + months * MONTH };
    changed.set(force.id, next);
    reckonings.push({ force: next, spent, bought, from, before });
  }

  if (changed.size === 0) return { world: start, facts: [] };
  world = {
    ...world,
    material: {
      ...world.material,
      forces: world.material.forces.map((force) => changed.get(force.id) ?? force),
      transactions: transactions.length === 0 ? world.material.transactions : [...world.material.transactions, ...transactions].slice(-500),
    },
  };
  return { world, facts: kitFacts(world, reckonings, day) };
}

/** What the player may read: an army that has fallen short of arms, and a paymaster who bought a good deal. One line a force a month at the most. */
function kitFacts(world: WorldState, reckonings: readonly Reckoning[], day: number): FactProposalDraft[] {
  const facts: FactProposalDraft[] = [];
  const holders = new Set(world.map.provinces.flatMap((province) => (province.controllerPolityId === null ? [] : [province.controllerPolityId])));
  const roman = (polityId: string): boolean => world.establishments.find((candidate) => candidate.polityId === polityId)?.recruitment.basis === "property_class";
  for (const entry of reckonings) {
    const { force } = entry;
    if (!holders.has(force.polityId)) continue;
    const officer = roman(force.polityId) ? "the quaestor" : "the paymaster";
    const condition = force.equipmentBps ?? EQUIPMENT_NEUTRAL_BPS;
    const buyer = `${officer}`;
    const refs = [{ kind: "force" as const, id: force.id }, { kind: "polity" as const, id: force.polityId }];
    if (condition < SHORT_OF_ARMS_BPS && entry.before >= SHORT_OF_ARMS_BPS) {
      facts.push({
        localId: `short_of_arms_${force.id}_${day}`.slice(0, 60), kind: "short_of_arms", affectedRefs: refs, visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance: 45,
        summary: `${force.name} is short of arms: its kit is worn to ${Math.round(condition / 100)} in a hundred of an issue, and ${entry.spent > 0 ? `what ${buyer} bought${entry.from === null ? "" : ` at ${entry.from}`} does not keep pace` : `${buyer} has nothing to buy it with or nowhere to buy`}.`.slice(0, 600),
      });
    } else if (condition - entry.before >= WORTH_A_LINE_BPS && entry.bought.length > 0) {
      facts.push({
        localId: `kit_bought_${force.id}_${day}`.slice(0, 60), kind: "kit_bought", affectedRefs: refs, visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance: 25,
        summary: `${buyer} bought ${entry.bought.map((line) => `${line.units} ${line.name}`).join(", ")}${entry.from === null ? "" : ` from ${entry.from}`} to re-arm ${force.name}: its kit stands at ${Math.round(condition / 100)} in a hundred.`.slice(0, 600),
      });
    }
  }
  return facts.slice(0, 6);
}

/**
 * What of an army's pay is stopped and kept in the chest for its kit: the third of what is paid, for an army on pay out of a power's own treasury (not an outlaw band,
 * not a private man's, not a company hired by contract, which keeps its own arms). Nothing is stopped where there is nothing to buy it with.
 */
export function stoppageOf(world: Pick<WorldState, "material">, obligation: { readonly id: string; readonly kind: string; readonly recipientAccountId?: string | undefined }, owed: number): number {
  if (obligation.kind !== "army_pay" || obligation.recipientAccountId !== undefined || owed <= 0) return 0;
  const force = world.material.forces.find((candidate) => candidate.payObligationId === obligation.id);
  if (force === undefined || !kept(force)) return 0;
  return Math.floor(owed * PAY_STOPPAGES_SHARE);
}

/**
 * The timber and the metal of a fleet being built come out of the hub of its yard, a fifth of it each month of the five the work takes (the felling, the seasoning, the keels, the
 * planking and the fitting). The money is the work's own, paid by its stages (`a-fleet-by-decree.ts`, priced by `hullCostAt`); here only the stock goes, and the hub's price rises by it.
 * A month is marked on the work once drawn, so a tick that looks twice draws once.
 */
export function drawYardStock(world: WorldState, day: number): WorldState {
  let current = world;
  let projects = world.projects;
  for (const project of world.projects) {
    if (project.kind !== "shipbuilding" || project.status === "completed" || project.status === "cancelled" || project.completionOutcome === null || project.completionOutcome.kind !== "force") continue;
    const month = Math.floor((day - project.startedAtStep) / MONTH);
    if (month < 0 || month >= YARD_MONTHS) continue;
    const mark = `yard-stock-${month}`;
    if (project.provenanceEventIds.includes(mark)) continue;
    const hulls = project.completionOutcome.amount;
    const yard = project.completionOutcome.provinceId;
    if (yard === null) continue;
    current = drawStock(current, yard, "timber", Math.round((hulls * HULL_TIMBER_LOADS) / YARD_MONTHS)).world;
    current = drawStock(current, yard, "metals", Math.round((hulls * HULL_METAL_BARS) / YARD_MONTHS)).world;
    projects = projects.map((candidate) => (candidate.id === project.id ? { ...candidate, provenanceEventIds: [...candidate.provenanceEventIds, mark].slice(-20) } : candidate));
  }
  return projects === world.projects ? current : { ...current, projects };
}
