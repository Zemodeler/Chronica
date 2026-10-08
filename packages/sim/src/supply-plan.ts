import {
  REFERENCE_PROVINCE_KM,
  WorldDeltaSchema,
  fitStrengthOf,
  isNavalForce,
  kmFrom,
  sameConfederation,
  type Force,
  type ScenarioWarfareRules,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";
import { GrainRefused, breadWhereItStands, grainPrice, sendConvoy } from "./grain";
import { housesFor, monthlyBill, openVictualling, victuallerOf } from "./army-victualling";
import type { ExecutionHand } from "./delegation";

/**
 * Bread for an army, found by rule (docs/economy.md, "Orders, calls and consequences").
 *
 * "Find supply for my army" is the commonest order a general gives and the least worth the model's asking. It is handed to the man who feeds the army (its quaestor, its
 * prefect of works, the head of the power's supply, or the commander), and he finds it the way an officer would, in an order that is the same every time:
 *
 *  1. **buy** where the army stands, if the country's markets will sell it bread at the price of the day;
 *  2. a **convoy** from the nearest ground of its own power with bread to spare;
 *  3. an **ally's** bread, sent up by convoy from the nearest ground of a friend by the foedus;
 *  4. a **firm** of its own power, let the feeding for a term at the market's price and a margin (an army of fifteen hundred men or more);
 *  5. and, the last resort, **requisition**: taken from the country, which costs nothing in money and a good deal in the people's patience (the state's standing as well as
 *     the province's temper).
 *
 * It returns what to do (acts for the engine's own appliers, which weigh them against the competence of whoever does them), what it costs, what it costs in standing,
 * and, where nothing could be found, why not in the officer's words: "no grain within reach". Where the army is to stay, a depot is added to the plan.
 */

/** The shortest a bread is worth buying for, and the share of the days asked that is enough to go on with before the last resort is tried. */
const ENOUGH_SHARE = 0.5;
/** How far a convoy is sent, in reference provinces: the convoys of `grain.ts` are sent from as far as twelve. */
const SEARCH_REACH_KM = 12 * REFERENCE_PROVINCE_KM;
/** How many of the nearest friendly provinces are tried for a convoy. */
const PROVINCES_TRIED = 8;
/** What a requisition costs the state's standing, in basis points for every day of bread taken: on its own ground, where the people expected better, and abroad. */
const REQUISITION_BPS_PER_DAY_OWN = 12;
const REQUISITION_BPS_PER_DAY_ABROAD = 4;
const REQUISITION_BPS_CAP = 400;
/** A firm's term, and the army that is worth letting to one. */
export const CONTRACT_FROM_MEN = 1_500;
export const CONTRACT_DAYS = 180;
/** A depot is worth building for an army that stays: its cost in money for every thousand men, and its least. */
const DEPOT_PER_THOUSAND = 1_200;
const DEPOT_LEAST = 2_000;
const DEPOT_DAYS = 30;

export type SupplyHow = "buy" | "convoy" | "ally" | "contract" | "requisition";

export interface SupplyOptions {
  /** The day; defaults to the world's. */
  readonly day?: number | undefined;
  /** Who pays for the bread that is bought or sent: the account of the power's chest, or the issuer's purse. Absent, the army's power's chest. */
  readonly payAccountId?: string | null | undefined;
  /** The army will stay where it is (in a siege, in winter quarters, on a hold): a depot is added. */
  readonly stays?: boolean | undefined;
  /** The man who finds it, for the quality of his hands (`assessExecution`): the waste and the thieving in them are days of bread that never arrive. */
  readonly hand?: ExecutionHand | null | undefined;
  /** The scenario's troop categories, which say which forces are fleets. */
  readonly warfare?: ScenarioWarfareRules | undefined;
}

export interface SupplyPlan {
  readonly ok: boolean;
  readonly how: SupplyHow | null;
  /** The acts to be done, for the engine's own appliers: bread (`force_provision`), and the depot (`project_create`) where one was asked. */
  readonly deltas: readonly WorldDelta[];
  /** What the treasury pays, estimated by the price of the day. */
  readonly cost: number;
  /** What it costs the power's standing, in basis points: the last resort's. */
  readonly legitimacyCost: number;
  /** Days of bread it comes to, which may be fewer than asked. */
  readonly days: number;
  /** The days asked that this does not make up. */
  readonly shortfall: number;
  /** In the officer's words, whether it was done or why it could not be: the line the order is answered with. */
  readonly words: string;
  /** Each way tried that did not serve, and why. */
  readonly considered: readonly string[];
  readonly refusal: string | null;
}

const clampDays = (days: number): number => Math.max(1, Math.min(360, Math.round(days)));

const friendlyPower = (world: WorldState, polityId: string, other: string | null): boolean => other !== null && other !== polityId && sameConfederation(world.polityAgreements, polityId, other);
const ownPower = (polityId: string, other: string | null): boolean => other === polityId;

/** The treasury of a power, if it keeps one. */
export function chestOfPower(world: WorldState, polityId: string): string | null {
  return world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === polityId && account.status === "active")?.id ?? null;
}

/**
 * Who pays for an army's bread when this man gives the order: the chest of the power the army serves, where it is his power's; his own purse where it is not (a band he
 * keeps himself, an army of a power he does not head).
 */
export function payerOf(world: WorldState, issuerId: string, force: Force): string | null {
  const issuer = world.characters.find((character) => character.id === issuerId);
  if (issuer === undefined) return chestOfPower(world, force.polityId);
  if (issuer.polityId === force.polityId && force.outlaw !== true) return chestOfPower(world, force.polityId) ?? issuer.personalAccountId ?? null;
  return issuer.personalAccountId ?? chestOfPower(world, force.polityId);
}

const idsOf = { next: (prefix: string): string => `${prefix}-supply-plan` };

/**
 * Plans the bread of one army for `daysWanted` days. Pure: it tries each way against the world as it stands and changes nothing.
 */
export function planSupply(world: WorldState, force: Force, daysWanted: number, options: SupplyOptions = {}): SupplyPlan {
  const day = options.day ?? world.elapsedStep;
  const wanted = clampDays(daysWanted);
  const polity = world.map.polities.find((candidate) => candidate.id === force.polityId);
  const place = world.map.provinces.find((province) => province.id === force.locationId)?.name ?? force.locationId;
  const nameOfProvince = (id: string): string => world.map.provinces.find((province) => province.id === id)?.name ?? id;
  const considered: string[] = [];
  const refuse = (why: string): SupplyPlan => ({ ok: false, how: null, deltas: [], cost: 0, legitimacyCost: 0, days: 0, shortfall: wanted, words: why, considered, refusal: why });

  if (isNavalForce(force, options.warfare)) return refuse(`${force.name} is a fleet, victualled in port.`);
  const men = fitStrengthOf(force);
  if (men <= 0) return refuse(`${force.name} has no men in it to feed.`);
  if (force.outlaw === true) return refuse(`${force.name} is nobody's army, and no officer of any power will feed it.`);
  const payAccountId = options.payAccountId ?? chestOfPower(world, force.polityId);
  const purse = payAccountId === null ? undefined : world.material.accounts.find((account) => account.id === payAccountId);
  const balance = purse?.balance ?? 0;
  const hand = options.hand ?? null;
  // What is lost in these hands: bread that was paid for and does not reach the men (the waste), and what is quietly kept back.
  const keptShare = hand === null ? 1 : Math.max(0.3, (1 - hand.skimBps / 10_000) / (1 + Math.max(0, hand.wasteBps) / 10_000));

  const provision = (how: SupplyHow, days: number, fromProvinceId: string | null): WorldDelta => WorldDeltaSchema.parse({
    op: "force_provision", forceRef: force.id, how: how === "ally" ? "convoy" : how, days: clampDays(days), fromProvinceId,
    payAccountRef: how === "requisition" ? null : payAccountId,
    reason: `Bread for ${force.name}, ${how === "requisition" ? "taken from the country" : how === "contract" ? "let to a firm" : how === "ally" ? "sent up by an ally" : how === "convoy" ? "sent up from home" : "bought where it stands"}.`.slice(0, 240),
  });

  interface Route { readonly how: SupplyHow; readonly days: number; readonly cost: number; readonly delta: WorldDelta; readonly words: string; readonly legitimacy: number }
  const routes: Route[] = [];
  /** Tries one way for some days; a way that finds fewer is tried again for what the chest can pay. */
  const tryRoute = (how: SupplyHow, run: (days: number) => { days: number; cost: number; from: string | null; words: (days: number) => string; legitimacy?: number }): void => {
    try {
      let days = clampDays(Math.ceil(wanted / keptShare));
      let got = run(days);
      if (how !== "requisition" && got.cost > balance && got.cost > 0) {
        days = Math.max(1, Math.floor((days * balance) / got.cost));
        if (balance <= 0) throw new GrainRefused(`the chest holds nothing to pay for it, and the bread costs ${got.cost}`);
        got = run(days);
      }
      const arrives = Math.max(1, Math.floor(got.days * keptShare));
      routes.push({ how, days: arrives, cost: got.cost, delta: provision(how, got.days, got.from), words: got.words(arrives), legitimacy: got.legitimacy ?? 0 });
    } catch (refusal) {
      if (refusal instanceof GrainRefused) considered.push(refusal.message);
      else throw refusal;
    }
  };

  // 1. Bought where it stands.
  tryRoute("buy", (days) => {
    const got = breadWhereItStands(world, force, "buy", days, day);
    return { days: got.days, cost: got.cost, from: null, words: (kept) => `${kept} days' bread was bought for ${force.name} in ${place}, ${got.cost} out of the chest` };
  });

  // 2 and 3. A convoy from the nearest ground of its own power, then of an ally's, with bread to spare.
  const near = [...kmFrom(world, force.locationId, { budgetKm: SEARCH_REACH_KM }).entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  const provinceOf = (id: string) => world.map.provinces.find((province) => province.id === id);
  const sources = (kind: "own" | "ally"): string[] => near
    .map(([id]) => id)
    .filter((id) => {
      const controller = provinceOf(id)?.controllerPolityId ?? null;
      return kind === "own" ? ownPower(force.polityId, controller) : friendlyPower(world, force.polityId, controller);
    })
    .slice(0, PROVINCES_TRIED);
  for (const kind of ["own", "ally"] as const) {
    const how: SupplyHow = kind === "own" ? "convoy" : "ally";
    if (routes.some((route) => route.days >= wanted)) break;
    for (const from of sources(kind)) {
      const before = routes.length;
      tryRoute(how, (days) => {
        const got = sendConvoy(world, force, from, days, day, idsOf);
        return {
          days: got.days, cost: got.cost, from,
          words: (kept) => `${kept} days' bread was sent up to ${force.name} from ${nameOfProvince(from)}${kind === "ally" ? ", the bread of an ally" : ""}, ${got.cost} out of the chest, and will be ${got.convoy.arrivesAtStep - day <= 1 ? "a day" : `some ${got.convoy.arrivesAtStep - day} days`} on the road`,
        };
      });
      if (routes.length > before) break;
    }
  }

  // 4. A firm of its own power.
  if (!routes.some((route) => route.days >= wanted) && men >= CONTRACT_FROM_MEN && victuallerOf(world, force.id) === undefined && housesFor(world, force.polityId).length > 0 && payAccountId !== null) {
    const opened = openVictualling(world, force, Math.max(CONTRACT_DAYS, wanted), payAccountId, day, idsOf);
    if ("refusal" in opened) considered.push(opened.refusal);
    else {
      const months = Math.max(CONTRACT_DAYS, wanted) / 30;
      const bill = monthlyBill(world, force) * months;
      routes.push({
        how: "contract", days: Math.max(1, Math.floor(Math.max(CONTRACT_DAYS, wanted) * keptShare)), cost: bill,
        delta: provision("contract", Math.max(CONTRACT_DAYS, wanted), null),
        words: `the feeding of ${force.name} was let to ${opened.house.name} for ${Math.round(months)} months, some ${Math.round(bill)} out of the chest at the market's price and a margin`,
        legitimacy: 0,
      });
    }
  } else if (men < CONTRACT_FROM_MEN) considered.push(`${force.name} is too small an army to be let to a firm.`);

  const best = routes.filter((route) => route.how !== "requisition").sort((a, b) => b.days - a.days)[0];
  let chosen: Route | undefined = routes.find((route) => route.days >= wanted);
  // 5. The last resort: where nothing found half of what was wanted, the officer takes it from the country.
  if (chosen === undefined && (best === undefined || best.days < wanted * ENOUGH_SHARE)) {
    tryRoute("requisition", (days) => {
      const got = breadWhereItStands(world, force, "requisition", days, day);
      const own = ownPower(force.polityId, provinceOf(force.locationId)?.controllerPolityId ?? null) || friendlyPower(world, force.polityId, provinceOf(force.locationId)?.controllerPolityId ?? null);
      const legitimacy = Math.min(REQUISITION_BPS_CAP, Math.round(got.days * (own ? REQUISITION_BPS_PER_DAY_OWN : REQUISITION_BPS_PER_DAY_ABROAD)));
      return {
        days: got.days, cost: 0, from: null, legitimacy,
        words: (kept) => `${kept} days' bread was taken from the country round ${place} by requisition, from ${own ? "the army's own people, who will not soon forget it" : "a country that is not the army's own"}`,
      };
    });
    const taken = routes.find((route) => route.how === "requisition");
    if (taken !== undefined && (best === undefined || taken.days > best.days)) chosen = taken;
  }
  chosen ??= best;
  if (chosen === undefined) {
    const why = considered.length === 0 ? "nothing could be found" : considered[considered.length - 1]!;
    return refuse(`The bread of ${force.name} could not be found: no grain within reach of ${place}${polity === undefined ? "" : ` for ${polity.name}`} (${why.replace(/\.$/, "")}).`);
  }

  const deltas: WorldDelta[] = [chosen.delta];
  let cost = Math.round(chosen.cost);
  // Where the army stays, a depot is built beside it, and the bread comes to it of its own accord after (`structures`, `supplyRadius`).
  let depotWords = "";
  if (options.stays === true && payAccountId !== null && !world.structures.some((structure) => structure.provinceId === force.locationId && structure.supplyRadius > 0 && structure.ownerPolityId === force.polityId)) {
    const price = Math.max(DEPOT_LEAST, Math.round((men / 1_000) * DEPOT_PER_THOUSAND));
    if (balance - cost >= price) {
      deltas.push(WorldDeltaSchema.parse({
        op: "project_create", localId: `depot_${force.id}`.slice(0, 60), kind: "depot", label: `Depot at ${place}`.slice(0, 120), sponsorRef: { kind: "polity", id: force.polityId },
        fundingAccountRef: payAccountId, milestones: [{ label: `The stores of ${place} are raised`, dueInDays: DEPOT_DAYS, costAmount: price }],
        completionOutcome: { kind: "structure", label: `Depot at ${place}`.slice(0, 120), amount: 200, provinceId: force.locationId, polityId: force.polityId, structureKind: "depot", effects: [{ quantity: "supply", direction: "raise", band: "marked", scope: "here" }] },
        reason: `${force.name} will stay at ${place}, and the bread is to be had there.`.slice(0, 240),
      }));
      cost += price;
      depotWords = `; and a depot is begun at ${place}, ${price} for the stores, which will feed the army that stays`;
    } else considered.push(`The chest cannot also pay ${price} for a depot at ${place}.`);
  }
  const shortfall = Math.max(0, wanted - chosen.days);
  const scarcity = shortfall > 0 ? ` -- ${shortfall} days short of the ${wanted} asked${chosen.how === "requisition" ? "" : ", for that was all the money or the country could give"}` : "";
  const legitimacyCost = chosen.legitimacy;
  return {
    ok: true, how: chosen.how, deltas, cost, legitimacyCost, days: chosen.days, shortfall,
    words: `${chosen.words}${scarcity}${depotWords}${legitimacyCost > 0 ? ". The state's name is the lower for it" : ""}.`.replace(/\.\.$/, "."),
    considered, refusal: null,
  };
}

/** The price of a day's bread for the men of an army, where it stands. */
export function dayOfBread(world: WorldState, force: Force): number {
  return Math.max(1, Math.round((fitStrengthOf(force) / 1_000) * grainPrice(world, force.polityId, force.locationId)));
}

/** Days a supply order is a standing charge: the officer who found the army's bread goes on feeding it for half a year (the length of a firm's term). */
export const SUPPLY_CHARGE_DAYS = CONTRACT_DAYS;

/**
 * The armies the player has handed to an officer to feed (a supply order answered, whether the bread is in the army's hands or still on the road): the officers of
 * his own power keep them fed month by month (`magistrates.ts`, `theSupply`), though the power is his and the rules otherwise leave it alone.
 */
export function suppliedByDelegation(world: WorldState, playerId: string | null, day: number): ReadonlySet<string> {
  if (playerId === null) return new Set();
  return new Set(world.orderAttempts
    .filter((attempt) => attempt.ask?.kind === "supply" && attempt.ask.ref !== undefined && attempt.issuerRef.id === playerId
      && (attempt.status === "accepted" || attempt.status === "carried_out") && attempt.decidedAtStep !== null && day - attempt.decidedAtStep <= SUPPLY_CHARGE_DAYS)
    .map((attempt) => attempt.ask!.ref as string));
}
