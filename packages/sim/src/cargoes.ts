import {
  atWar,
  isNavalForce,
  kmBetween,
  provinceGrainPriceBps,
  tradePremiumBps,
  warfareWith,
  type FactProposalDraft,
  type MoneyTransaction,
  type ScenarioWarfareRules,
  type TradeVenture,
  type WorldState,
} from "@chronica/shared";
import type { IdFactory } from "./ports";
import { routeOpenBps } from "./tick";

/**
 * Cargoes at sea (play-test L9).
 *
 * A venture by sea paid three tenths of a per cent of a province's tax a month,
 * for ever, from the day it was opened: a merchant who put his money into a
 * ship never saw the ship come in, and a cargo was a shop that happened to
 * float. Now a venture between two ports is a cargo: bought, sailed, and sold
 * when it comes in, at a margin set by the two markets and by whatever war has
 * reached either end. A single cargo is done when it is sold; a regular trade
 * buys the next out of what the last one fetched, and sails again.
 */

/** How far a merchantman makes in a day, coasting and putting in at night. */
const SAILING_KM_PER_DAY = 90;
/** Days in port at each end: buying the goods, loading, and selling them. */
const MARKET_DAYS = 10;
/** Where the map gives no route, a voyage of a month. */
const UNKNOWN_VOYAGE_DAYS = 30;
const MAX_VOYAGE_DAYS = 60;
/** What a cargo makes over its cost: a quarter in an ordinary year, between three twentieths and two fifths. */
const BASE_MARGIN_BPS = 2_500;
export const MIN_MARGIN_BPS = 1_500;
export const MAX_MARGIN_BPS = 4_000;
/** A cargo that cannot come in -- an enemy fleet off its port, or the port the enemy's -- waits this long, and tries again. */
const HELD_DAYS = 15;
/** Voyages landed for one venture in one tick, at most: the tick's own guard against a pathological span. */
const MAX_VOYAGES_PER_TICK = 24;

/** Days from buying a cargo to selling it at the other end. */
export function voyageDays(world: WorldState, fromProvinceId: string, toProvinceId: string): number {
  const km = kmBetween(world, fromProvinceId, toProvinceId);
  const sailing = km === null ? UNKNOWN_VOYAGE_DAYS : Math.max(2, Math.ceil(km / SAILING_KM_PER_DAY));
  return Math.min(MAX_VOYAGE_DAYS, sailing + MARKET_DAYS);
}

/**
 * What a cargo makes over its cost, in basis points.
 *
 * Grain carried from a cheap market into a dear one does well and the other
 * way badly (`tradePremiumBps`, the same reading a venture's monthly return
 * takes); and a war at either end, an occupation or a blockade, makes buyers
 * fewer and the voyage dearer.
 */
export function cargoMarginBps(world: WorldState, venture: Pick<TradeVenture, "fromProvinceId" | "toProvinceId">): number {
  const premium = tradePremiumBps(provinceGrainPriceBps(world, venture.fromProvinceId), provinceGrainPriceBps(world, venture.toProvinceId));
  const open = Math.min(routeOpenBps(world, venture.fromProvinceId), routeOpenBps(world, venture.toProvinceId));
  const margin = BASE_MARGIN_BPS + Math.round((premium - 10_000) * 0.3) - Math.round((10_000 - open) * 0.12);
  return Math.max(MIN_MARGIN_BPS, Math.min(MAX_MARGIN_BPS, margin));
}

/** The port a cargo comes in at: the first harbour of the province it sails to. */
function portOf(world: WorldState, provinceId: string): string {
  const province = world.map.provinces.find((candidate) => candidate.id === provinceId);
  return province?.settlements.find((settlement) => settlement.kind === "port")?.name ?? province?.name ?? provinceId;
}

/**
 * Why a cargo cannot come in today, or null: what stops a venture's monthly
 * return stops a cargo too -- a war with the power holding the far port, or an
 * enemy fleet off either end.
 */
function heldBy(world: WorldState, venture: TradeVenture, warfare: ScenarioWarfareRules | undefined): string | null {
  const own = world.characters.find((character) => character.id === venture.ownerCharacterId)?.polityId ?? null;
  if (own === null) return null;
  const holder = world.map.provinces.find((province) => province.id === venture.toProvinceId)?.controllerPolityId ?? null;
  if (holder !== null && holder !== own && atWar(world.polityAgreements, own, holder)) return "the port is held by a power at war with his own";
  const rules = warfare === undefined ? undefined : warfareWith(world, warfare);
  const fleetOff = (provinceId: string): boolean => world.material.forces.some((force) =>
    force.locationId === provinceId && force.polityId !== own && isNavalForce(force, rules) && atWar(world.polityAgreements, force.polityId, own));
  if (fleetOff(venture.toProvinceId) || fleetOff(venture.fromProvinceId)) return "an enemy fleet lies off the port";
  return null;
}

/**
 * Every cargo whose day has come: sold at the far end and paid into its
 * owner's purse, with a fact he hears; then sent out again or wound up. A
 * cargo that cannot come in waits in a friendly harbour and tries again.
 */
export function landCargoes(world: WorldState, toDay: number, ids: IdFactory, warfare?: ScenarioWarfareRules): { world: WorldState; facts: FactProposalDraft[] } {
  if (!world.material.ventures.some((venture) => venture.status === "running" && venture.cargo !== undefined && venture.cargo.arrivesAtStep <= toDay)) return { world, facts: [] };
  const facts: FactProposalDraft[] = [];
  let accounts = world.material.accounts;
  const transactions: MoneyTransaction[] = [];
  const ventures = world.material.ventures.map((start) => {
    let venture = start;
    for (let voyage = 0; voyage < MAX_VOYAGES_PER_TICK && venture.status === "running" && venture.cargo !== undefined && venture.cargo.arrivesAtStep <= toDay; voyage += 1) {
      const cargo: NonNullable<TradeVenture["cargo"]> = venture.cargo;
      const source = world.material.incomeSources.find((candidate) => candidate.id === venture.incomeSourceId);
      const purseId = source?.beneficiaryAccountId ?? world.characters.find((character) => character.id === venture.ownerCharacterId)?.personalAccountId ?? null;
      const purse = accounts.find((account) => account.id === purseId);
      const port = portOf(world, venture.toProvinceId);
      const held = heldBy(world, venture, warfare);
      if (held !== null) {
        // Said once, the day it should have come in; after that it simply waits.
        if (venture.interruptedBy === null) {
          facts.push({
            localId: `cargo_held_${venture.id}`.slice(0, 60), kind: "venture_interrupted",
            summary: `${venture.title} cannot come in at ${port}: ${held}. The ship waits in a friendly harbour.`,
            affectedRefs: [{ kind: "character", id: venture.ownerCharacterId }, { kind: "province", id: venture.toProvinceId }],
            visibility: "private", discoveryState: "private", knowableInDays: 0, significance: 25, knownToRefs: [{ kind: "character", id: venture.ownerCharacterId }],
          });
        }
        venture = { ...venture, interruptedBy: held.startsWith("an enemy fleet") ? "blockade" : "war", cargo: { ...cargo, arrivesAtStep: Math.max(cargo.arrivesAtStep, toDay) + HELD_DAYS } };
        break;
      }
      // A dead man's cargo is his heirs' business; a locked purse is paid nothing.
      if (purse === undefined || purse.status !== "active") {
        venture = { ...venture, status: "closed" };
        break;
      }
      if (venture.interruptedBy !== null) {
        facts.push({
          localId: `cargo_free_${venture.id}`.slice(0, 60), kind: "venture_resumed",
          summary: `The way into ${port} is open again, and the ${venture.title} comes in.`,
          affectedRefs: [{ kind: "character", id: venture.ownerCharacterId }, { kind: "province", id: venture.toProvinceId }],
          visibility: "private", discoveryState: "private", knowableInDays: 0, significance: 20, knownToRefs: [{ kind: "character", id: venture.ownerCharacterId }],
        });
      }
      const margin = cargoMarginBps(world, venture);
      const sold =Math.max(1, Math.round((cargo.cost * (10_000 + margin)) / 10_000));
      accounts = accounts.map((account) => (account.id === purse.id ? { ...account, balance: account.balance + sold } : account));
      transactions.push({
        id: ids.next("txn"), atStep: cargo.arrivesAtStep, kind: "income", amount: sold, destinationAccountId: purse.id,
        cause: { kind: "scheduled_income", id: venture.incomeSourceId, explanation: `Sale of the cargo of ${venture.title}`.slice(0, 240) }, visibility: "private",
      });
      const balance = accounts.find((account) => account.id === purse.id)!.balance;
      const again = cargo.rollsOver && balance >= cargo.cost;
      if (again) {
        accounts = accounts.map((account) => (account.id === purse.id ? { ...account, balance: account.balance - cargo.cost } : account));
        transactions.push({
          id: ids.next("txn"), atStep: cargo.arrivesAtStep, kind: "purchase", amount: cargo.cost, sourceAccountId: purse.id,
          cause: { kind: "action", id: venture.id, explanation: `The next cargo of ${venture.title}`.slice(0, 240) }, visibility: "private",
        });
      }
      const after = again
        ? `${cargo.cost} of it buys the next cargo, and the ship sails again.`
        : cargo.rollsOver ? `There is not ${cargo.cost} to buy another, and the trade is wound up.` : "The venture is done.";
      facts.push({
        localId: `cargo_sold_${venture.id}_${cargo.voyages}`.slice(0, 60), kind: "cargo_sold",
        summary: `The ${venture.title} came in at ${port}; the cargo sold for ${sold}, against the ${cargo.cost} it cost (${Math.round(margin / 100)}% over). ${after}`.slice(0, 600),
        affectedRefs: [{ kind: "character", id: venture.ownerCharacterId }, { kind: "account", id: purse.id }, { kind: "province", id: venture.toProvinceId }],
        visibility: "private", discoveryState: "private", knowableInDays: 0, significance: 30, knownToRefs: [{ kind: "character", id: venture.ownerCharacterId }],
      });
      const sailsAt = cargo.arrivesAtStep;
      venture = again
        ? { ...venture, interruptedBy: null, cargo: { ...cargo, voyages: cargo.voyages + 1, sailedAtStep: sailsAt, arrivesAtStep: sailsAt + voyageDays(world, venture.fromProvinceId, venture.toProvinceId) } }
        : { ...venture, interruptedBy: null, status: "closed", cargo: { ...cargo, voyages: cargo.voyages + 1 } };
    }
    return venture;
  });
  return {
    world: { ...world, material: { ...world.material, accounts, transactions: [...world.material.transactions, ...transactions], ventures } },
    facts,
  };
}
