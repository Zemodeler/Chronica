import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema, type MoneyAccount } from "../material-state";
import type { WorldState } from "./world-state";

/**
 * Coinages: several moneys in one world, on one counting unit (phase E of the
 * economy rework).
 *
 * THE CONTRACT. Every balance, price, wage and treasury in the engine is an
 * integer number of *silver units*: the weight of silver in one Attic drachma
 * of the old reckoning (about 4.3 g), the unit the whole economy has counted
 * in since version 47 ("drachmae"). That does not change, so every piece of
 * integer arithmetic in the engine keeps working untouched. A coinage is what
 * a power's mint strikes from that silver, and it matters in four places only:
 *
 *  1. At an account's boundary. Money passing between two accounts of
 *     different coinages goes through a money-changer, who takes a cut
 *     (`conversionBps`); the cut leaves the books through the `abroad` door
 *     so the money audit still balances. Money inside one coinage moves as it
 *     always did.
 *  2. In the price level. A power that debases its coin (`coinage_debase`)
 *     mints new coin from the same silver and so gets a one-off seigniorage;
 *     then, over months, prices in its country rise toward the ratio of the old
 *     silver content to the new (`priceLevelBps`), so bread and the army's keep
 *     cost it more silver units than before.
 *  3. In the exchange rate: a coin's market premium over its silver content
 *     (`premiumBps`) drifts with the issuer's trade balance, with war and
 *     arrears, and with the price level a debasement has built.
 *  4. In display: a sum shown as local coin (`faceAmount`) with its silver
 *     equivalent beside it.
 *
 * A coin's "face" amount is silver units / silverBps x 10 000: a coinage that
 * strikes 7 400 bps of silver to the unit shows 1 000 silver units as 1 351
 * of its own coin. Nothing below ever stores face amounts.
 *
 * Optional on the economy memory: a world with no coinages has one silver
 * everywhere and every function here reads it as "same coinage, no cut, no
 * price level".
 */

/** What an Attic drachma of silver is, in the coinage's own measure: a coin that carries as much silver reads 10 000. */
export const REFERENCE_SILVER_BPS = 10_000;
/** The coinage an account falls back on when its owner's power strikes none: foreign silver, the age's by weight. */
export const FOREIGN_COINAGE_ID = "foreign_silver";
/** A coin trades at most this far above or below its silver content. */
export const MAX_PREMIUM_BPS = 1_500;
/** Prices never read below half or above three times the ordinary, whatever the coin. */
export const MIN_PRICE_LEVEL_BPS = 5_000;
export const MAX_PRICE_LEVEL_BPS = 30_000;
/** The money-changer's own cut of every sum that crosses from one coinage to another, whatever the rates. */
export const CHANGERS_FEE_BPS = 150;
/** No coinage is struck below four in ten of its standard, nor above eleven in ten of it. */
export const MIN_STANDARD_SHARE_BPS = 4_000;
export const MAX_STANDARD_SHARE_BPS = 11_000;
/** One act of coining or re-coining moves the silver content no more than this share of what it is. */
export const MAX_DEBASE_STEP_BPS = 2_500;
/** A mint changes its coin no oftener than this many days. */
export const COINAGE_COOLDOWN_DAYS = 60;
/** The share of the coin in the issuer's country that is called in and re-struck in the year of a debasement: what seigniorage is a share of. */
export const RECOINED_SHARE_BPS = 3_000;

export const CoinageHistorySchema = z.object({
  atStep: ElapsedStepSchema,
  fromSilverBps: z.number().int(),
  toSilverBps: z.number().int(),
}).strict();

export const CoinageSchema = z
  .object({
    id: EntityIdSchema,
    name: z.string().trim().min(1).max(80),
    /** The power whose mint it is, and whose fiscal office alone may debase or reform it; null for a standard nobody in particular controls. */
    issuerPolityId: EntityIdSchema.nullable().default(null),
    /** Powers whose accounts hold this coin unless an account says otherwise (the issuer is one). */
    polityIds: z.array(EntityIdSchema).max(80).default([]),
    /** The silver in one unit of the coin relative to the reference drachma, 10 000 being as much. Falls with debasement. */
    silverBps: z.number().int().min(1_000).max(30_000),
    /** What it was struck at when the world began: the price level is the ratio of this to `silverBps`. Absent: `silverBps` itself. */
    standardBps: z.number().int().min(1_000).max(30_000).optional(),
    /** The day of the last change of its silver content, if it has ever changed (what the price level's lag is counted from). */
    debasedSinceStep: ElapsedStepSchema.nullable().default(null),
    /** Prices in the countries that use it, basis points of ordinary: they follow debasement a few months behind. */
    priceLevelBps: z.number().int().min(MIN_PRICE_LEVEL_BPS).max(MAX_PRICE_LEVEL_BPS).default(10_000),
    /** What the coin fetches above (+) or below (-) its silver content among the money-changers. */
    premiumBps: z.number().int().min(-MAX_PREMIUM_BPS).max(MAX_PREMIUM_BPS).default(0),
    /** The day the world was last told its issuer's coin is under strain, so that it is told no oftener than once a year. */
    strainToldStep: ElapsedStepSchema.nullable().default(null),
    /** What its mint has done to it, newest last, a few lines. */
    history: z.array(CoinageHistorySchema).max(8).default([]),
  })
  .strict();
export type Coinage = z.infer<typeof CoinageSchema>;

export const MAX_COINAGES = 40;

/** The coinage nobody strikes: silver by weight, what an account with no better claim holds. */
export const FOREIGN_SILVER: Coinage = {
  id: FOREIGN_COINAGE_ID,
  name: "Foreign silver",
  issuerPolityId: null,
  polityIds: [],
  silverBps: REFERENCE_SILVER_BPS,
  standardBps: REFERENCE_SILVER_BPS,
  debasedSinceStep: null,
  priceLevelBps: 10_000,
  premiumBps: 0,
  strainToldStep: null,
  history: [],
};

type CoinageWorld = Pick<WorldState, "economy">;
type AccountWorld = Pick<WorldState, "economy" | "material" | "characters">;

export const coinagesOf = (world: CoinageWorld): readonly Coinage[] => world.economy?.coinages ?? [];

/** The silver content a coinage was struck at, which a debasement is measured against. */
export const standardOf = (coinage: Pick<Coinage, "silverBps" | "standardBps">): number => coinage.standardBps ?? coinage.silverBps;

const byPolity = new WeakMap<readonly Coinage[], Map<string, Coinage>>();

/** Which coinage each power's accounts hold, built once per list of coinages: the issuer's own first, then those that name a power among theirs. */
function polityIndex(coinages: readonly Coinage[]): Map<string, Coinage> {
  let index = byPolity.get(coinages);
  if (index === undefined) {
    index = new Map<string, Coinage>();
    for (const coinage of coinages) {
      for (const polityId of coinage.polityIds) if (!index.has(polityId)) index.set(polityId, coinage);
    }
    for (const coinage of coinages) if (coinage.issuerPolityId !== null) index.set(coinage.issuerPolityId, coinage);
    byPolity.set(coinages, index);
  }
  return index;
}

/** One coinage by id; the foreign silver stands in where a world has not written its own. */
export function coinageById(world: CoinageWorld, id: string): Coinage | undefined {
  const found = coinagesOf(world).find((coinage) => coinage.id === id);
  return found ?? (id === FOREIGN_COINAGE_ID ? FOREIGN_SILVER : undefined);
}

/** The money a power's own people and accounts hold: the coinage it strikes or shares, or foreign silver. */
export function coinageOfPolity(world: CoinageWorld, polityId: string | null | undefined): Coinage {
  const coinages = coinagesOf(world);
  if (coinages.length === 0 || polityId === null || polityId === undefined) return coinageById(world, FOREIGN_COINAGE_ID) ?? FOREIGN_SILVER;
  return polityIndex(coinages).get(polityId) ?? coinageById(world, FOREIGN_COINAGE_ID) ?? FOREIGN_SILVER;
}

/**
 * The power an account's owner belongs to: a government's own, a character's
 * or a force's. An arrangement's fund (kind "entity") belongs to no power the
 * model records: it holds foreign silver in a ledger, and in a transfer it is
 * neutral (`convertSilver`) unless it is told otherwise.
 */
export function polityOfOwner(world: Pick<WorldState, "material" | "characters">, owner: { readonly kind: string; readonly id: string }): string | null {
  if (owner.kind === "polity") return owner.id;
  if (owner.kind === "character") return charactersIndex(world.characters).get(owner.id) ?? null;
  if (owner.kind === "force") return forcesIndex(world.material.forces).get(owner.id) ?? null;
  return null;
}

const charactersByList = new WeakMap<object, Map<string, string | null>>();
const forcesByList = new WeakMap<object, Map<string, string | null>>();
/** Who belongs to which power, indexed once per list (a list is replaced, never edited, when the world changes). */
function charactersIndex(characters: WorldState["characters"]): Map<string, string | null> {
  let index = charactersByList.get(characters);
  if (index === undefined) {
    index = new Map(characters.map((character) => [character.id, character.polityId ?? null] as const));
    charactersByList.set(characters, index);
  }
  return index;
}
function forcesIndex(forces: WorldState["material"]["forces"]): Map<string, string | null> {
  let index = forcesByList.get(forces);
  if (index === undefined) {
    index = new Map(forces.map((force) => [force.id, force.polityId ?? null] as const));
    forcesByList.set(forces, index);
  }
  return index;
}

/** The coinage of an account already in hand: the one it names, or its owner's power's. */
export function coinageOfAccount(world: AccountWorld, account: Pick<MoneyAccount, "owner" | "coinageId">): Coinage {
  const ofOwner = (): Coinage => coinageOfPolity(world, polityOfOwner(world, account.owner));
  if (account.coinageId === undefined) return ofOwner();
  return coinageById(world, account.coinageId) ?? ofOwner();
}

/** The coinage an account's money is in: the one it names, or its owner's power's. */
export function coinageOf(world: AccountWorld, accountId: string): Coinage {
  const coinages = coinagesOf(world);
  if (coinages.length === 0) return FOREIGN_SILVER;
  const account = world.material.accounts.find((candidate) => candidate.id === accountId);
  return account === undefined ? coinageOfPolity(world, null) : coinageOfAccount(world, account);
}

/** The price level where a power buys, basis points of ordinary: 10 000 where it strikes no debased coin. */
export function priceLevelBpsOf(world: CoinageWorld, polityId: string | null | undefined): number {
  if (coinagesOf(world).length === 0 || polityId === null || polityId === undefined) return 10_000;
  return coinageOfPolity(world, polityId).priceLevelBps;
}

/** Where a coin's price level is heading: the ordinary price times what it was struck at over what it holds now, bounded. */
export function targetPriceLevelBps(coinage: Pick<Coinage, "silverBps" | "standardBps">): number {
  return Math.max(MIN_PRICE_LEVEL_BPS, Math.min(MAX_PRICE_LEVEL_BPS, Math.round((10_000 * standardOf(coinage)) / coinage.silverBps)));
}

/**
 * How much of its own coin one unit of another buys among the money-changers,
 * in basis points (10 000: one for one). The silver in each, and what each
 * fetches above or below its silver (`premiumBps`). A debased coin with a
 * falling premium is worth fewer of a sound one.
 */
export function exchangeRateBps(world: CoinageWorld, fromCoinageId: string, toCoinageId: string): number {
  const from = coinageById(world, fromCoinageId) ?? FOREIGN_SILVER;
  const to = coinageById(world, toCoinageId) ?? FOREIGN_SILVER;
  if (from.id === to.id) return 10_000;
  return Math.round((10_000 * from.silverBps * (10_000 + from.premiumBps)) / (to.silverBps * (10_000 + to.premiumBps)));
}

/**
 * The share of a sum of silver units that arrives when it crosses from one
 * coinage to another (basis points, at most 10 000): the dearer the sender's
 * coin against the receiver's, the less is lost to the rate; a sender's coin
 * at a discount loses what the discount is, and every crossing pays the
 * changer's fee. It is never more than the sum sent: the changer cannot make
 * money by being the other side of a cheap coin.
 */
export function conversionBps(world: CoinageWorld, fromCoinageId: string, toCoinageId: string): number {
  if (fromCoinageId === toCoinageId) return 10_000;
  const from = coinageById(world, fromCoinageId) ?? FOREIGN_SILVER;
  const to = coinageById(world, toCoinageId) ?? FOREIGN_SILVER;
  if (from.id === to.id) return 10_000;
  const atTheRate = Math.min(10_000, (10_000 * (10_000 + from.premiumBps)) / (10_000 + to.premiumBps));
  return Math.max(1, Math.round((atTheRate * (10_000 - CHANGERS_FEE_BPS)) / 10_000));
}

/**
 * What a sum sent from one account to another comes to when it arrives, and
 * what the money-changer kept (`cut`), in silver units. A world with no
 * coinages, or two accounts in the same one, is passed through whole.
 */
export function convertSilver(world: AccountWorld, fromAccountId: string, toAccountId: string, amount: number): { readonly received: number; readonly cut: number } {
  if (amount <= 0 || coinagesOf(world).length === 0) return { received: amount, cut: 0 };
  // An arrangement's fund (a guild's, a church's) has no coin of its own: sums into and out of it pass whole.
  const neutral = (id: string): boolean => world.material.accounts.some((account) => account.id === id && account.owner.kind === "entity" && account.coinageId === undefined);
  if (neutral(fromAccountId) || neutral(toAccountId)) return { received: amount, cut: 0 };
  const from = coinageOf(world, fromAccountId);
  const to = coinageOf(world, toAccountId);
  if (from.id === to.id) return { received: amount, cut: 0 };
  // At least one unit arrives of any sum: a changer does not take the whole of a trifle.
  const received = Math.min(amount, Math.max(1, Math.floor((amount * conversionBps(world, from.id, to.id)) / 10_000)));
  return { received, cut: amount - received };
}

/**
 * The silver units held in accounts struck in one coinage: what a mint's
 * debasement or reform is reckoned on (a share of it is called in and
 * re-struck). Walks the accounts once, with the characters and forces
 * indexed, so it is linear in the world and not in their product.
 */
export function coinageStock(world: AccountWorld, coinageId: string): number {
  const coinages = coinagesOf(world);
  if (coinages.length === 0) return 0;
  let total = 0;
  for (const account of world.material.accounts) {
    if (account.status !== "active" || account.balance <= 0) continue;
    if (coinageOfAccount(world, account).id === coinageId) total += account.balance;
  }
  return total;
}

/** The same for a sum crossing between two powers' coinages (an account is not named): the share that arrives. */
export function conversionBetweenPolitiesBps(world: CoinageWorld, fromPolityId: string | null, toPolityId: string | null): number {
  if (coinagesOf(world).length === 0) return 10_000;
  return conversionBps(world, coinageOfPolity(world, fromPolityId).id, coinageOfPolity(world, toPolityId).id);
}

/** A sum of silver units as its own coin's face amount: what the coin's holder would read on it. */
export function faceAmount(silverUnits: number, coinage: Pick<Coinage, "silverBps">): number {
  return Math.round((silverUnits * REFERENCE_SILVER_BPS) / coinage.silverBps);
}

/** A coin struck down this far (a quarter of its silver gone, or more) is billon, silver debased with bronze, and not silver any more: Carthage's by the end of the Mercenary War. */
export const BILLON_BELOW_BPS = 7_500;

/** Whether a coinage has been struck down to billon, against the silver it was struck at. */
export function isBillon(coinage: Pick<Coinage, "silverBps" | "standardBps">): boolean {
  return coinage.silverBps * 10_000 < standardOf(coinage) * BILLON_BELOW_BPS;
}

/** A coinage in a few words: its name, what it holds of silver against its standard, and what it fetches. */
export function coinageInWords(coinage: Coinage): string {
  const content = Math.round((100 * coinage.silverBps) / standardOf(coinage));
  const premium = coinage.premiumBps === 0 ? "" : `, ${coinage.premiumBps > 0 ? "at a premium of" : "at a discount of"} ${Math.abs(Math.round(coinage.premiumBps / 100))}% to its silver`;
  const prices = coinage.priceLevelBps === 10_000 ? "" : `, prices at ${(coinage.priceLevelBps / 100).toFixed(0)}% of ordinary`;
  return `${coinage.name} (${isBillon(coinage) ? "billon, " : ""}${content}% of its standard silver${premium}${prices})`;
}
