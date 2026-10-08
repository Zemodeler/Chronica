import {
  economyOf,
  fitStrengthOf,
  isNavalForce,
  stableHash,
  type Convoy,
  type FactProposalDraft,
  type Force,
  type MerchantHouse,
  type ServiceContract,
  type WorldState,
} from "@chronica/shared";
import { buyGrain, sourcesFor } from "./grain-purchases";
import { grainPrice } from "./grain";
import { purseOfHouse } from "./merchant-houses";
import { endContract } from "./contracts";
import type { IdFactory } from "./ports";

/**
 * An army victualled by a house of its own power (docs/economy.md, "Grain bought, and bread by contract").
 *
 * Bread for an army was bought where it stood, taken from the country, or sent up in a convoy from home: all the state's own act, out of its chest. The armies
 * of the Republic were in fact victualled by contractors, the companies of the publicani: the Spanish armies of 215 were fed by the companies that
 * undertook it for a price and were paid when the treasury could (Livy 23.48-49), and the same companies were found out in the false wrecks of 214 (Livy 25.3),
 * for the Senate had taken upon the state the risk of a loss at sea. A power with a trading house of its own may now let one the feeding of an army by contract.
 *
 * - **The contract** is a service contract of the role `victualler` (`contracts.ts` ends it as it ends any): the house's head the man hired, the treasury the
 *   employer, a term of months, a price for every thousand man-days of bread that reaches the army, fixed on the day it is let at the market's price and a
 *   margin (`MARGIN_BPS`). Pay is not by the month but by what arrived: the obligation's amount is reckoned each month from what reached the army, so a
 *   convoy taken or lost is not paid for (`reckon`).
 * - **The house** buys the grain out of the stocks of the hubs it can reach, the cheapest landed first (`grain-purchases.ts`: the market door, the hubs'
 *   prices rising by what it takes), and sends it as a convoy to the province where the army stands, the same convoy an army's own officers send, the same road and
 *   the same risks: a convoy meeting an enemy is taken (`grain.ts`), and the sea has its own chance of a loss (`voyageLossBps`). A loss is the house's.
 * - **The risk.** The price is fixed and the market is not: a dearth makes the bread cost the house more than it is paid. If the treasury cannot pay, the house
 *   waits the two periods a company waits in sound silver, and none once the coin has been debased (`mercenaryGracePeriods`), and then it stops sending: the
 *   contract lapses and the house is out of what it laid out and has not been paid for (`contracts.ts`).
 *
 * No grain is made and no silver: the stock moves from the hubs to the army, the money from the house to the country (the market door) and from the chest to
 * the house (an obligation, an ordinary transfer).
 */

/** What the house is paid over the market's price for the bread, in basis points. */
export const MARGIN_BPS = 1_500;
/** A man eats four modii a month (`GOODS`): the modii a man-day of bread is. */
export const MODII_PER_MAN_DAY = 4 / 30;
/** The days of bread a house sends the army each month. */
export const SENT_DAYS = 30;
/** The days between one sending and the next. */
export const PASS_DAYS = 30;
/** A house keeps this much in hand, whatever the bread costs, and lays out no more than this share of its purse on one army in a month. */
export const HOUSE_RESERVE = 8_000;
export const HOUSE_SHARE_OF_PURSE = 0.6;
/** A house must have this much to take on an army. */
export const LEAST_CAPITAL = 12_000;
/** The longest and shortest term, in days. */
export const LONGEST_TERM = 360;
export const SHORTEST_TERM = 60;
/** Priority of the pay among the chest's obligations: below the army's own, above a pension. */
const PAY_PRIORITY = 450;

/** The contract that feeds an army, if one stands. */
export function victuallerOf(world: Pick<WorldState, "material">, forceId: string): ServiceContract | undefined {
  return world.material.contracts.find((contract) => contract.status === "active" && contract.role === "victualler" && contract.victuals?.forceId === forceId);
}

/** The houses of a power that could take an army to feed: trading, with a purse that is open and holds enough. */
export function housesFor(world: WorldState, polityId: string): MerchantHouse[] {
  return economyOf(world).houses
    .filter((house) => house.status === "trading" && (house.seatPolityId ?? house.polityId) === polityId)
    .filter((house) => {
      const purse = purseOfHouse(world, house);
      return purse !== null && purse.active && purse.balance >= LEAST_CAPITAL;
    })
    .filter((house) => !world.material.contracts.some((contract) => contract.status === "active" && contract.role === "victualler" && contract.victuals?.houseId === house.id))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** The price a house is paid for every thousand man-days of bread that reaches the army: the market's, where the army stands, and the margin. */
export function priceOfBread(world: WorldState, polityId: string, provinceId: string): number {
  return Math.max(1, Math.round((grainPrice(world, polityId, provinceId) * (10_000 + MARGIN_BPS)) / 10_000));
}

/** What a month's bread for an army costs at that price: the figure the chamber weighs when the contract is laid before it. */
export function monthlyBill(world: WorldState, force: Force): number {
  return Math.max(1, Math.round((fitStrengthOf(force) * SENT_DAYS / 1_000) * priceOfBread(world, force.polityId, force.locationId)));
}

export type Opened =
  | { readonly world: WorldState; readonly facts: FactProposalDraft[]; readonly contract: ServiceContract; readonly house: MerchantHouse }
  | { readonly refusal: string };

/**
 * An army's feeding let to a house of its own power, for a term of days: the contract is written, the pay set going, and the house sends the first month's
 * bread the same day. A refusal says why not: a fleet, a hired company, no house of the power with the means, a contract already standing.
 */
export function openVictualling(world: WorldState, force: Force, termDays: number, payerAccountId: string, atStep: number, ids: IdFactory): Opened {
  if (isNavalForce(force, undefined)) return { refusal: `${force.name} is a fleet, victualled in port.` };
  if (fitStrengthOf(force) <= 0) return { refusal: `${force.name} has no men in it to feed.` };
  if (force.outlaw === true) return { refusal: `${force.name} is nobody's army, and no house of any power will feed it.` };
  if (victuallerOf(world, force.id) !== undefined) return { refusal: `${force.name} is fed by a house already.` };
  const houses = housesFor(world, force.polityId);
  const house = houses[stableHash([force.id, "victualler", Math.floor(atStep / 30)]) % Math.max(1, houses.length)];
  if (house === undefined) return { refusal: `No house of ${world.map.polities.find((polity) => polity.id === force.polityId)?.name ?? force.polityId} has the means to feed ${force.name}.` };
  const head = world.characters.find((character) => character.id === house.headCharacterId && character.alive);
  const purse = purseOfHouse(world, house);
  const payer = world.material.accounts.find((account) => account.id === payerAccountId);
  if (head === undefined || purse === null || payer === undefined) return { refusal: `${house.name} has nobody to put his hand to the contract.` };
  const term = Math.max(SHORTEST_TERM, Math.min(LONGEST_TERM, Math.round(termDays)));
  const price = priceOfBread(world, force.polityId, force.locationId);
  const contractId = ids.next("contract");
  const obligationId = ids.next("obligation");
  const label = `The bread of ${force.name}: ${house.name}, for ${Math.round(term / 30)} months`.slice(0, 160);
  const contract: ServiceContract = {
    id: contractId, role: "victualler", label, employerAccountId: payer.id, employeeCharacterId: head.id, obligationId, incomeSourceId: null, grantId: null,
    advance: 0, monthlyPay: Math.round((fitStrengthOf(force) * SENT_DAYS / 1_000) * price),
    duties: `Feed ${force.name} at ${price} for every thousand man-days of bread that reaches it.`.slice(0, 400),
    openedAtStep: atStep, endsAtStep: atStep + term, forceId: null, forceWas: null, provinceId: force.locationId, counterpartPolityId: null,
    victuals: { forceId: force.id, houseId: house.id, pricePerThousand: price, deliveredManDays: 0, sentManDays: 0, lostManDays: 0, passedAtStep: atStep },
    status: "active",
  };
  const opened: WorldState = {
    ...world,
    material: {
      ...world.material,
      obligations: [...world.material.obligations, {
        id: obligationId, kind: "salary" as const, label: label.slice(0, 120), payerAccountId: payer.id, recipientAccountId: purse.id, amount: 1, cadenceSteps: 30,
        nextDueStep: atStep + 30, priority: PAY_PRIORITY, arrears: 0, missedPeriods: 0, active: true,
      }],
      contracts: [...world.material.contracts, contract],
    },
  };
  const first = dispatch(opened, contract, atStep, ids);
  const name = (id: string): string => world.map.provinces.find((province) => province.id === id)?.name ?? id;
  const facts: FactProposalDraft[] = [{
    localId: `victualler_${contractId}`.slice(0, 60), kind: "army_victualled",
    summary: `${house.name} undertook to feed ${force.name} for ${Math.round(term / 30)} months, at ${price} for every thousand men a day, to be paid for what reaches the army; ${first.sentDays > 0 ? `the first bread is on the road to ${name(force.locationId)}` : "it has not the means to send the first bread yet"}.`.slice(0, 600),
    affectedRefs: [{ kind: "force", id: force.id }, { kind: "character", id: head.id }, { kind: "province", id: force.locationId }],
    visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance: 35,
  }];
  return { world: first.world, facts, contract: first.world.material.contracts.find((candidate) => candidate.id === contractId)!, house };
}

/**
 * The house buys a month's bread for the army and sends it: the cheapest hubs it can reach in order, as much as it has the means for (its purse less its reserve,
 * and not more than `HOUSE_SHARE_OF_PURSE` of it), carried to where the army stands as one convoy of the contract. What it could not buy it did not send:
 * the army is fed what was sent.
 */
export function dispatch(world: WorldState, contract: ServiceContract, atStep: number, ids: IdFactory): { readonly world: WorldState; readonly sentDays: number } {
  const victuals = contract.victuals;
  if (victuals == null) return { world, sentDays: 0 };
  const force = world.material.forces.find((candidate) => candidate.id === victuals.forceId);
  const house = economyOf(world).houses.find((candidate) => candidate.id === victuals.houseId);
  const purse = house === undefined ? null : purseOfHouse(world, house);
  const men = force === undefined ? 0 : fitStrengthOf(force);
  if (force === undefined || house === undefined || purse === null || !purse.active || men <= 0) return { world, sentDays: 0 };
  const lays = Math.max(0, Math.min(purse.balance - HOUSE_RESERVE, purse.balance * HOUSE_SHARE_OF_PURSE));
  const wanted = Math.ceil(men * SENT_DAYS * MODII_PER_MAN_DAY);
  const bought = buyGrain(world, {
    sources: sourcesFor(world, force.polityId, force.locationId), payerAccountId: purse.id, maxSpend: lays, maxUnits: wanted, atStep, ids,
    causeId: contract.id, explanation: `Grain bought by ${house.name} for the bread of ${force.name}`,
  });
  if (bought.legs.length === 0) return { world, sentDays: 0 };
  const days = Math.min(120, Math.floor(bought.units / (men * MODII_PER_MAN_DAY)));
  if (days < 1) {
    // Less than a day's bread for the army: the house keeps what it bought and sends nothing it could not feed a day on.
    return { world: bought.world, sentDays: 0 };
  }
  const slowest = Math.max(...bought.legs.map((leg) => leg.days));
  const from = [...bought.legs].sort((a, b) => b.units - a.units || a.hubId.localeCompare(b.hubId))[0]!;
  const convoy: Convoy = {
    id: ids.next("convoy"), forceId: force.id, polityId: force.polityId, fromProvinceId: from.hubId, toProvinceId: force.locationId, days, men,
    sentAtStep: atStep, arrivesAtStep: atStep + slowest, status: "on_the_road", contractId: contract.id,
  };
  const next: WorldState = {
    ...bought.world,
    convoys: [...bought.world.convoys.filter((candidate) => candidate.status === "on_the_road" || candidate.arrivesAtStep > atStep - 60), convoy],
    material: {
      ...bought.world.material,
      contracts: bought.world.material.contracts.map((candidate) => (candidate.id !== contract.id || candidate.victuals == null ? candidate
        : { ...candidate, victuals: { ...candidate.victuals, sentManDays: candidate.victuals.sentManDays + days * men, passedAtStep: atStep } })),
    },
  };
  return { world: next, sentDays: days };
}

/**
 * The monthly pass, once a month for every contract that stands: the pay reckoned on what reached the army since the last (so a convoy lost is not paid for),
 * the next month's bread bought and sent, and an end put to a contract whose army has gone or whose house has. Called from the tick after the houses have
 * looked to their cargoes. A contract the treasury has stopped paying is ended by `keepContracts`, which comes after.
 */
export function keepVictualling(world: WorldState, toDay: number, ids: IdFactory): { readonly world: WorldState; readonly facts: FactProposalDraft[] } {
  const standing = world.material.contracts.filter((contract) => contract.status === "active" && contract.role === "victualler" && contract.victuals != null);
  if (standing.length === 0) return { world, facts: [] };
  const facts: FactProposalDraft[] = [];
  let current = world;
  for (const row of standing) {
    const contract = current.material.contracts.find((candidate) => candidate.id === row.id)!;
    const victuals = contract.victuals!;
    if (toDay - victuals.passedAtStep < PASS_DAYS) continue;
    const force = current.material.forces.find((candidate) => candidate.id === victuals.forceId);
    const house = economyOf(current).houses.find((candidate) => candidate.id === victuals.houseId);
    const head = house === undefined ? undefined : current.characters.find((character) => character.id === house.headCharacterId && character.alive);
    if (force === undefined || fitStrengthOf(force) <= 0 || house === undefined || house.status !== "trading" || head === undefined) {
      current = endContract(current, contract, "ended", toDay);
      facts.push({
        localId: `victualler_ended_${contract.id}`.slice(0, 60), kind: "army_victualling_ended",
        summary: force === undefined || fitStrengthOf(force) <= 0 ? `The army that ${house?.name ?? "a house"} was feeding is no more, and the contract with it is at an end.` : `${house?.name ?? "The house"} that fed ${force.name} is no more, and the contract with it is at an end.`,
        affectedRefs: [{ kind: "force", id: victuals.forceId }], visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance: 28,
      });
      continue;
    }
    if (contract.endsAtStep !== null && contract.endsAtStep <= toDay) continue;
    // Pay for what arrived since the last reckoning; none for what was lost on the road.
    const owed = Math.max(1, Math.round((victuals.pricePerThousand * victuals.deliveredManDays) / 1_000));
    current = {
      ...current,
      material: {
        ...current.material,
        contracts: current.material.contracts.map((candidate) => (candidate.id === contract.id && candidate.victuals != null
          ? { ...candidate, monthlyPay: owed, victuals: { ...candidate.victuals, deliveredManDays: 0 } } : candidate)),
        obligations: current.material.obligations.map((obligation) => (obligation.id === contract.obligationId ? { ...obligation, amount: owed } : obligation)),
      },
    };
    const sent = dispatch(current, current.material.contracts.find((candidate) => candidate.id === contract.id)!, toDay, ids);
    current = sent.world;
    if (sent.sentDays === 0) {
      const purse = purseOfHouse(current, house);
      facts.push({
        localId: `victualler_short_${contract.id}_${toDay}`.slice(0, 60), kind: "army_victualling_short",
        summary: `${house.name} could not find the bread for ${force.name} this month: ${purse === null || purse.balance < HOUSE_RESERVE + LEAST_CAPITAL / 4 ? "its purse is thin" : "the markets within its reach have none to spare"}.`.slice(0, 600),
        affectedRefs: [{ kind: "force", id: force.id }], visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance: 30,
      });
    }
  }
  return { world: current, facts };
}
