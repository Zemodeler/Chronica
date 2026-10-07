import {
  CUSTOMARY_TAX_RATE_BPS,
  DEFAULT_TAX_RATE_BPS,
  GOODS,
  MIN_DEVELOPMENT_BPS,
  astronomicalYearOf,
  calendarDateOf,
  calendarYearOf,
  carryingCapacityOf,
  dayOfCalendarDate,
  HARVEST_BANDS,
  economyOf,
  hasMarkets,
  isOccupied,
  marketGeography,
  moneyRateBps,
  ordinaryCrop,
  polityGrainPriceBps,
  provinceGrounds,
  reckonTaxCapacity,
  stableHash,
  taxPolicyIndex,
  type FactProposalDraft,
  type HarvestKind,
  type ProvinceGround,
  type ProvinceMaterial,
  type ProvinceTargets,
  type ScenarioClock,
  type WorldState,
  liveProvinceIds,
} from "@chronica/shared";
import { adjacentTo } from "@chronica/shared";
// (`adjacentTo` is indexed once per map: a province's neighbours are a lookup, not a search.)
import { monthOfCoinage } from "./coinage";
import { marketNews } from "./market-summary";
import { closeBook, cutOffHubs, marketMonth, monthsToHarvest, openBook, stockTheHarvest } from "./markets";
import { tradeMonth } from "./trade-flows";
import { reliefNews } from "./trade-summary";

/**
 * The land, reckoned by the calendar (VISION §6, §7).
 *
 * A province's people were counted once, from the size of its towns, and never
 * again: nobody was born, nobody starved, a famine below the hunger line killed
 * no one, the displaced were a number that shrank, and a province's taxes were
 * fixed at half a coin a head whatever had been burned. The harvest was a card
 * the narrator might draw, so a year could pass with none at all.
 *
 * Now, once a month, each province's people grow or fall with how fed and how
 * orderly it is and how much war has taken; the hungry die; people who have
 * fled their homes go to the nearest quiet, fed country, and its taxes are
 * reckoned from the people it has left and what they can make. Once a year, in
 * the harvest month, the harvest comes in -- rolled, so there are droughts and
 * gluts -- and that is what the province eats until the next one.
 *
 * Bounded and simple on purpose: rates of a few in a thousand a month, one
 * roll a year a country. Grain's price is the price of a market that holds a
 * stock (`sim/markets.ts`): the harvest fills the granaries and the months
 * empty them, and how fed a province is, its food security, is read off what
 * its hub's granary holds against what is left to eat before the next crop.
 */

/** The month the grain comes in, around the Mediterranean the scenario is set on. */
export const HARVEST_MONTH = 7;
/** Days in the reckoning's month. */
const REVIEW_DAYS = 30;
/** At most a year of months reckoned in one pass, as the tick bounds its own periods. */
const MAX_MONTHS = 12;

/**
 * Of every ten thousand people, a month, at the very most: born more than die,
 * in a fed and orderly country with room to spare. The rate is a ceiling the
 * country's room brings down -- logistic growth, `r x (1 - people / room)` --
 * and the room is what development makes (`carryingCapacityOf`). It was a flat
 * four in ten thousand whatever the country held, so every province grew five
 * in a hundred a year for as long as it was fed, forever. Twelve at an empty
 * country is a little over one in a hundred a year; a country at nine tenths
 * of its room grows a tenth as fast, and one at its room not at all.
 */
const GROWTH_PER_10K_FED = 12;
/** A hungry country (fed below the ordinary but above famine) breeds at a quarter of the rate. */
const HUNGRY_GROWTH_SHARE = 0.25;
/** A country this far over its room (refugees, a development that fell) sheds people slowly: up to four in ten thousand a month. */
const OVERCROWDED_AT = 1.25;
const MAX_OVERCROWDED_LOSS_PER_10K = 4;
/** Flight and killing where order has broken down. */
const LOSS_PER_10K_DISORDER = 8;
/** At full war damage, what the fighting takes a month. */
const LOSS_PER_10K_WAR = 40;
/** Below this, people die of hunger -- up to one in a hundred a month at nothing to eat. */
const FAMINE_BPS = 4_000;
const FAMINE_DEATH_SHARE = 0.01;
/** Of those who have fled, the share a month who go on to settle elsewhere. */
const MIGRATION_SHARE = 0.15;
/** A country the displaced will go to: quiet and fed. */
const REFUGE_BPS = 6_000;

/**
 * The year's weather for a country, as a multiple of an ordinary crop.
 *
 * Two rolls make it. The world's weather (one roll a year, the same for all)
 * is what nearly every country gets; about a third of countries (a hub's
 * hinterland) have weather of their own that year instead, so that there are
 * regional droughts as well as dry years everywhere. The roll is cut by
 * `HARVEST_BANDS`: about one year in sixteen a drought at half a crop and a
 * bit, one in seven poor, a little over half fair, one in seven good and one
 * in sixteen a glut. It was a roll for each province, averaged with the
 * year's, which gathered toward the middle and could not fail a country: a
 * hub's granary saw to that, and nothing ever came near famine.
 */
export function weatherYield(hubId: string, year: number): number {
  const roll = stableHash(["harvest", year, "scope", hubId]) % 100 < 35
    ? stableHash(["harvest", year, "region", hubId]) % 100
    : stableHash(["harvest", year]) % 100;
  return (HARVEST_BANDS.find((band) => roll < band.upTo) ?? HARVEST_BANDS[2]).yield;
}

/** One province's year: its country's weather and its own luck (a tenth either way). */
export function harvestYield(hubId: string, provinceId: string, year: number): number {
  return weatherYield(hubId, year) * (0.9 + 0.2 * ((stableHash(["harvest", year, provinceId]) % 100) / 99));
}

/**
 * How the year fell for a province's country, in the old words: what the
 * harvest is told as in the news. The yield itself is `harvestYield`.
 */
export function harvestIn(world: Pick<WorldState, "map">, provinceId: string, year: number): HarvestKind {
  const hub = marketGeography(world).hubOf.get(provinceId) ?? provinceId;
  const yieldMultiple = weatherYield(hub, year);
  return HARVEST_BANDS.find((band) => band.yield === yieldMultiple)?.kind ?? "fair";
}

export interface LandInput {
  readonly world: WorldState;
  readonly toDay: number;
  /** Absent, there is no calendar to find the harvest month by, and no harvest. */
  readonly clock?: ScenarioClock | undefined;
  /**
   * What stands in each province and moves where it settles (`provinceTargetsFrom`),
   * asked for only on a day a month is reckoned: a rebuilding there raises the
   * development it can reach and speeds the fading of its scar.
   */
  readonly targets?: (() => ReadonlyMap<string, ProvinceTargets>) | undefined;
}

export interface LandResult {
  readonly world: WorldState;
  readonly facts: FactProposalDraft[];
  /** How many months were reckoned: what misery is counted in (`unrest.ts`). */
  readonly months: number;
}

const clampBps = (value: number): number => Math.max(0, Math.min(10_000, Math.round(value)));
const provinceName = (world: WorldState, id: string): string => world.map.provinces.find((province) => province.id === id)?.name ?? id;
const polityName = (world: WorldState, id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;
const listed = (names: readonly string[]): string => (names.length <= 1 ? names[0] ?? "" : `${names.slice(0, -1).join(", ")} and ${names.at(-1)!}`);

/**
 * Where there is a market, it keeps the food. The coarse recovery pass pulled
 * food security back to 8 000 at a few hundred a month wherever nothing had
 * struck a province, which fought the stock model: a granary run low would
 * have been refilled out of nothing by the next tick. With markets open the
 * pass leaves food alone, and the month's reckoning (`marketMonth`) moves it
 * toward what the hub's grain says it should be, the one thing that does.
 * (`clock` is kept for callers; the stock does not need it to know.)
 */
export function betweenHarvests(targets: Map<string, ProvinceTargets>, world: WorldState, _clock?: ScenarioClock | undefined): Map<string, ProvinceTargets> {
  if (!hasMarkets(world)) return targets;
  const next = new Map(targets);
  for (const province of world.map.provinces) {
    next.set(province.id, { ...(next.get(province.id) ?? {}), foodRecoveryScale: 0 });
  }
  return next;
}

/**
 * What development does a month, in basis points.
 *
 * Development falls fast and comes back slowly, which is the whole of why a
 * war-torn country lags: a province at full war damage, in disorder and
 * starved loses about a hundred a month (`FALL_REFERENCE_BPS`), and a
 * province at peace, fed, orderly and lightly taxed gains a fifth of that
 * (`REGROWTH_BPS`) at the most -- two hundred and forty a year, a few hundred a
 * year as the design asks. A thing that takes a decade to build can be undone
 * in a season, and then takes a generation to put back.
 */
const FALL_REFERENCE_BPS = 100;
const REGROWTH_BPS = FALL_REFERENCE_BPS / 5;
/** Burned fields at full damage hold development back this much a month, scaled by the damage. */
const WAR_DAMAGE_FALL_BPS = 60;
/** Disorder (stability under 3 000) costs this, and open revolt (under 1 500) more. */
const UNREST_FALL_BPS = 20;
const REVOLT_FALL_BPS = 35;
/** Hunger below the famine line costs up to this a month, by how deep it is. */
const FAMINE_FALL_BPS = 20;
/** Past a rate of 2 000 of what the land can bear, each 50 basis points of rate costs one a month, to at most forty. */
const OVERTAX_RATE_BPS = 2_000;
const OVERTAX_FALL_CAP_BPS = 40;
/** A foreign army sitting on the province: it costs this a month, and twice that where the occupier plunders (takes more than two tenths). */
const OCCUPATION_FALL_BPS = 20;
const PLUNDER_FALL_BPS = 50;
/** The scar occupation adds each month, on a province administered and on one plundered. */
const OCCUPATION_SCAR_BPS = 5;
const PLUNDER_SCAR_BPS = 25;
/** Development above what the scar lets it reach sinks this fast, at the most, a month. */
const ABOVE_CEILING_FALL_BPS = 15;
/** A scar fades this much a month in the ordinary course -- seventy-two a year, so a scar of two thousand outlasts a generation. */
const SCAR_FADES_BPS = 6;
/** Order and food a province must have for it to grow at all. */
const GROWS_ABOVE_STABILITY_BPS = 4_500;
const GROWS_ABOVE_FOOD_BPS = 5_500;
/** At most this much war damage and a province is still sown: more, it is a battlefield. */
const GROWS_BELOW_WAR_DAMAGE_BPS = 500;
/** Refugees who settle in a safe province bring skills and labour: a little development, bounded. */
const REFUGEE_GAIN_PER_10K = 3_000;
const MAX_REFUGEE_GAIN_BPS = 40;
/** A province at least this scarred is "laid waste" in the news. */
export const WASTE_SCAR_BPS = 2_000;
/** And the news is not told again for this many days. */
const WASTE_NEWS_REPEAT_DAYS = 720;

/**
 * A market whose grain is no dearer than one and four tenths of its ordinary price
 * is steady (cheap bread is a glut, not an instability). Development grew faster for a harbour or a
 * river on the province, as a placeholder for trade; it now does so only where
 * the market that harbour or river opens onto is steady, since merchants and
 * landowners build where prices can be counted on and not where bread is
 * thrice what it was or is not worth the carting. In peace every market is
 * steady and growth is what it was; in a famine or a siege the harbour
 * brings nothing.
 */
const STEADY_MAX_PRICE_BPS = 14_000;

/**
 * How hard a rate presses on growth: reinvestment is what a light tax leaves
 * and a heavy one does not (v53+ widened it, since a tenth was all that
 * separated a province taxed at four in a hundred from one taxed at fifteen).
 * A province taxed at four tenths of a tenth or less reinvests a half again as
 * much as one at the ordinary rate (1.0); at fifteen in a hundred it builds
 * half as fast; at the two tenths a land can bear it hardly builds at all, and
 * past it nothing does (and it begins to fall: `OVERTAX_FALL_CAP_BPS`).
 */
export function reinvestmentOf(rateBps: number): number {
  if (rateBps <= 400) return 1.5;
  if (rateBps <= DEFAULT_TAX_RATE_BPS) return 1.5 - 0.5 * ((rateBps - 400) / (DEFAULT_TAX_RATE_BPS - 400));
  if (rateBps <= 1_500) return 1 - 0.5 * ((rateBps - DEFAULT_TAX_RATE_BPS) / 500);
  if (rateBps <= OVERTAX_RATE_BPS) return 0.5 - 0.4 * ((rateBps - 1_500) / (OVERTAX_RATE_BPS - 1_500));
  return 0;
}

/**
 * What trade does for a province's growth, as a multiple of the ordinary rate
 * (`REGROWTH_BPS`): the merchants build where goods move.
 *
 * Every province grew the same two hundred and forty a year in peace, since the
 * only things that told them apart were a harbour (a fifth more) and a river (a
 * tenth) and a richer neighbour. Now a province with no market worth the name
 * builds two fifths as fast as the ordinary; the hub of its country is a third
 * more of the ordinary, a harbour or a river on a market with steady prices
 * (`STEADY_MAX_PRICE_BPS`) add to it, and so does the traffic through its hub
 * (the units that came and went by the trade lanes last month, against what the
 * country uses, `hubTrade`), up to the busiest. A plain with a port on a busy lane
 * builds five times as fast as a hilltop with a track to nowhere.
 */
export const ISOLATED_ACCESS = 0.4;
const HUB_ACCESS = 0.35;
const PORT_ACCESS = 0.3;
const RIVER_ACCESS = 0.15;
/** A hub's traffic is a few in a hundred of its country's use (a median of eight, a busy one seventy): this much access for each whole month's use that crosses it, to at most the cap. */
const TRADE_ACCESS_PER_INTENSITY = 8;
const MAX_TRADE_ACCESS = 1;
/** A province that is not itself the hub shares in the traffic of the hub it trades in at this share: the goods come to it by the roads. */
const OUTLYING_SHARE_OF_TRAFFIC = 0.6;
export function tradeAccessOf(ground: Pick<ProvinceGround, "port" | "river">, isHub: boolean, steadyMarket: boolean, hubTrade: number): number {
  return ISOLATED_ACCESS
    + (isHub ? HUB_ACCESS : 0)
    + (steadyMarket ? (ground.port ? PORT_ACCESS : 0) + (ground.river ? RIVER_ACCESS : 0) : 0)
    + (steadyMarket ? Math.min(MAX_TRADE_ACCESS, TRADE_ACCESS_PER_INTENSITY * hubTrade) * (isHub ? 1 : OUTLYING_SHARE_OF_TRAFFIC) : 0);
}

/** How steady order helps growth: from 0.7 at the least a province grows at (4,500) to 1.3 at perfect order. */
const stabilityGrowth = (stabilityBps: number): number => 0.7 + 0.6 * Math.max(0, Math.min(1, (stabilityBps - GROWS_ABOVE_STABILITY_BPS) / (10_000 - GROWS_ABOVE_STABILITY_BPS)));

/** What a hub's trade comes to against what its country uses, from the month's book (the same reading as `tradeIntensities`, in arrays). */
function hubTradeOf(entry: { readonly inflow: readonly number[]; readonly outflow: readonly number[]; readonly demand: readonly number[]; readonly price: readonly number[] }): number {
  let through = 0;
  let used = 0;
  for (let good = 0; good < GOODS.length; good += 1) {
    const base = GOODS[good]!.basePrice;
    through += ((entry.inflow[good] ?? 0) + (entry.outflow[good] ?? 0)) * base * ((entry.price[good] ?? 10_000) / 10_000);
    used += (entry.demand[good] ?? 0) * base;
  }
  return used <= 0 ? 0 : through / used;
}

/** What one province is under this month, read once before the months are reckoned. */
interface Standing {
  readonly ground: ProvinceGround;
  readonly rateBps: number;
  readonly occupied: boolean;
  readonly developmentShiftBps: number;
}

/**
 * One month of a province's development and the scar on it.
 *
 * The room it can grow into is its potential, lifted by what stands there
 * (a rebuilding, a market), less the scar. It grows only where it is fed,
 * orderly, not at war and not occupied, and more where the tax leaves
 * something to reinvest and a harbour, a river or a richer neighbour brings
 * trade; it falls for war damage, disorder, famine, a tax over two tenths and
 * an occupier's presence; the scar fades in peace, faster under a light tax
 * and a rebuilding, and not at all under an army.
 */
function monthOfDevelopment(row: ProvinceMaterial, standing: Standing, neighbourDevelopment: number | null, steadyMarket: boolean, isHub = false, hubTrade = 0): ProvinceMaterial {
  const { ground } = standing;
  const development = row.developmentBps ?? ground.startingDevelopmentBps;
  const scar = row.scarBps ?? 0;
  const ceiling = Math.max(MIN_DEVELOPMENT_BPS, (Math.min(10_000, Math.max(0, ground.potentialBps + standing.developmentShiftBps))) * (1 - scar / 10_000));
  const atWar = row.warDamageBps > GROWS_BELOW_WAR_DAMAGE_BPS;
  const plunder = standing.occupied && standing.rateBps > OVERTAX_RATE_BPS;

  const fall = (row.warDamageBps / 10_000) * WAR_DAMAGE_FALL_BPS
    + (row.stabilityBps < 1_500 ? REVOLT_FALL_BPS : row.stabilityBps < 3_000 ? UNREST_FALL_BPS : 0)
    + (row.foodSecurityBps < FAMINE_BPS ? ((FAMINE_BPS - row.foodSecurityBps) / FAMINE_BPS) * FAMINE_FALL_BPS : 0)
    + (standing.rateBps > OVERTAX_RATE_BPS ? Math.min(OVERTAX_FALL_CAP_BPS, (standing.rateBps - OVERTAX_RATE_BPS) / 50) : 0)
    + (standing.occupied ? (plunder ? PLUNDER_FALL_BPS : OCCUPATION_FALL_BPS) : 0);

  let next = development;
  if (fall > 0) next = development - fall;
  else if (!atWar && !standing.occupied && row.stabilityBps >= GROWS_ABOVE_STABILITY_BPS && row.foodSecurityBps >= GROWS_ABOVE_FOOD_BPS && development < ceiling) {
    // Trade: a harbour and a river count only where the market they open onto is steady (`STEADY_MAX_PRICE_BPS`), and so does the traffic through the hub; a province with none of it builds a quarter as fast (`tradeAccessOf`).
    const trade = tradeAccessOf(ground, isHub, steadyMarket, hubTrade);
    // A richer neighbour pulls it up a little, as the road to it is the road to its trade.
    const pull = 1 + (neighbourDevelopment !== null && neighbourDevelopment > development ? Math.min(0.25, (neighbourDevelopment - development) / 10_000) : 0);
    // A scarred province is slower to build again: the merchants are gone.
    const scarred = Math.max(0.1, 1 - (1.5 * scar) / 10_000);
    // Diminishing returns: the nearer the ceiling, the less is left to build (the last quarter of the way, and never less than a thousand).
    const room = Math.max(0, Math.min(1, (ceiling - development) / Math.max(1_000, 0.25 * ceiling)));
    next = development + REGROWTH_BPS * reinvestmentOf(standing.rateBps) * trade * pull * stabilityGrowth(row.stabilityBps) * scarred * room;
  }
  // Held above what the scar lets it reach, it sinks toward the ceiling, not through it.
  if (next > ceiling) next = Math.max(ceiling, next - ABOVE_CEILING_FALL_BPS);

  let nextScar = scar;
  if (standing.occupied) nextScar = scar + (10_000 - scar) * ((plunder ? PLUNDER_SCAR_BPS : OCCUPATION_SCAR_BPS) / 10_000);
  else if (!atWar && scar > 0) {
    const peace = row.stabilityBps >= 6_000 ? 1 : 0.5;
    const lightTax = standing.rateBps <= 600 ? 1.5 : standing.rateBps <= CUSTOMARY_TAX_RATE_BPS ? 1 : standing.rateBps > OVERTAX_RATE_BPS ? 0.25 : 0.6;
    const rebuilding = 1 + Math.max(0, standing.developmentShiftBps) / 500;
    nextScar = Math.max(0, scar - SCAR_FADES_BPS * peace * lightTax * rebuilding);
  }
  const developmentBps = Math.max(MIN_DEVELOPMENT_BPS, Math.min(10_000, Math.round(next)));
  const scarBps = Math.max(0, Math.min(10_000, Math.round(nextScar)));
  return developmentBps === row.developmentBps && scarBps === (row.scarBps ?? 0) ? row : { ...row, developmentBps, scarBps };
}

/** One month of a province's people: born, starved, fled or killed. Returns the row and how many starved. */
function monthOfPeople(row: ProvinceMaterial, ground: ProvinceGround): { row: ProvinceMaterial; starved: number } {
  // Born in proportion to the room left: logistic, toward what its development carries.
  const room = carryingCapacityOf(ground.baselinePeople, row.developmentBps ?? ground.startingDevelopmentBps, ground.startingDevelopmentBps);
  const crowding = row.population / Math.max(1, room);
  const fed = row.foodSecurityBps >= 6_000 ? 1 : row.foodSecurityBps >= FAMINE_BPS ? HUNGRY_GROWTH_SHARE : 0;
  const births = fed * GROWTH_PER_10K_FED * Math.max(0, 1 - crowding);
  const overcrowded = crowding > OVERCROWDED_AT ? Math.min(MAX_OVERCROWDED_LOSS_PER_10K, (crowding - OVERCROWDED_AT) * 8) : 0;
  const growth = births - overcrowded
    - (row.stabilityBps < 3_000 ? LOSS_PER_10K_DISORDER : 0)
    - Math.round((row.warDamageBps / 10_000) * LOSS_PER_10K_WAR);
  const starved = row.foodSecurityBps < FAMINE_BPS
    ? Math.floor(row.population * ((FAMINE_BPS - row.foodSecurityBps) / FAMINE_BPS) * FAMINE_DEATH_SHARE)
    : 0;
  const population = Math.max(0, row.population + Math.round((row.population * growth) / 10_000) - starved);
  return { row: { ...row, population, displacedPopulation: Math.min(row.displacedPopulation, population) }, starved };
}

export function reviewTheLand(input: LandInput): LandResult {
  const { toDay } = input;
  let world = input.world;
  if (world.material.provinceMaterial.length === 0) return { world, facts: [], months: 0 };
  const facts: FactProposalDraft[] = [];
  // A world that has never been reckoned has its markets opened now, once:
  // each hub with a season's reserve and what it needs to reach the next harvest.
  if (!hasMarkets(world)) world = closeBook(world, openBook(world, monthsToHarvest(toDay, input.clock, HARVEST_MONTH)));
  const memory = economyOf(world);

  // ── The months ─────────────────────────────────────────────────────────
  const last = memory.lastReviewStep;
  const months = last === null ? 0 : Math.min(MAX_MONTHS, Math.floor((toDay - last) / REVIEW_DAYS));
  let lastReviewStep = last === null ? toDay : last + months * REVIEW_DAYS;
  // A long absence is reckoned as a year at most; the rest is forgiven.
  if (last !== null && toDay - lastReviewStep >= REVIEW_DAYS) lastReviewStep = toDay;

  if (months > 0) {
    const rows = new Map(world.material.provinceMaterial.map((row) => [row.provinceId, row]));
    const starvedIn = new Map<string, number>();
    const settledIn = new Map<string, { count: number; from: Set<string> }>();
    const ids = [...rows.keys()].sort();
    // Open ground has nobody's name on it: its few people live and die unremarked, and nobody flees to it.
    const owned = new Set(world.map.provinces.filter((province) => province.controllerPolityId !== null).map((province) => province.id));
    // What each province is under, read once for all the months: its ground
    // (kept for as long as the map is), the rate its power takes, whether an
    // enemy sits on it, and what stands in it. Every pass below looks things up
    // by id in maps built here; none searches the province list.
    const grounds = provinceGrounds(world);
    const policyOf = taxPolicyIndex(world);
    const standings = new Map<string, Standing>();
    const targets = input.targets?.() ?? new Map<string, ProvinceTargets>();
    for (const province of world.map.provinces) {
      const ground = grounds.get(province.id);
      const row = rows.get(province.id);
      if (ground === undefined || row === undefined) continue;
      standings.set(province.id, {
        ground,
        // Open ground is taxed by nobody and pays nobody; it is left to grow at the customary rate.
        rateBps: province.controllerPolityId === null ? CUSTOMARY_TAX_RATE_BPS : moneyRateBps(policyOf(province, row)),
        occupied: isOccupied(province),
        developmentShiftBps: targets.get(province.id)?.developmentShiftBps ?? 0,
      });
    }
    // The markets, as a book of arrays the months work on and write back once.
    const geography = marketGeography(world);
    const book = openBook(world, monthsToHarvest(toDay, input.clock, HARVEST_MONTH));
    const cut = cutOffHubs(world, geography.hubs);
    const monthOne = (last ?? toDay) + REVIEW_DAYS;
    const customsEarned = new Map<string, number>();
    let lanes = new Map<string, number>();
    const relief = new Map<string, { units: number; from: Set<string> }>();
    for (let month = 0; month < months; month += 1) {
      // What each hub's country makes and uses, a siege's requisition and the
      // price that results, and so how fed each province is; people follow.
      const day = monthOne + month * REVIEW_DAYS;
      marketMonth(book, { world, rows, ids, day, clock: input.clock, harvestMonth: HARVEST_MONTH, cut, targets });
      // Then goods move between neighbouring hubs, from the cheap market to the dear one, as far as carrying them pays.
      const flows = tradeMonth(book, { world, rows, cut, toHarvest: monthsToHarvest(day, input.clock, HARVEST_MONTH) });
      for (const [polityId, amount] of flows.duties) customsEarned.set(polityId, (customsEarned.get(polityId) ?? 0) + amount);
      lanes = flows.lanes;
      for (const [polityId, kept] of flows.relief) {
        const total = relief.get(polityId) ?? { units: 0, from: new Set<string>() };
        total.units += kept.units;
        for (const from of kept.from) total.from.add(from);
        relief.set(polityId, total);
      }
      for (const id of ids) {
        const standing = standings.get(id);
        if (standing === undefined) continue;
        const lived = monthOfPeople(rows.get(id)!, standing.ground);
        rows.set(id, lived.row);
        if (lived.starved > 0) starvedIn.set(id, (starvedIn.get(id) ?? 0) + lived.starved);
      }
      // Development follows the people, a province at a time in id order so the
      // reckoning is the same on every machine; a neighbour's trade is its
      // neighbours' as they stood at the month's start of this pass.
      const hubTrades = new Map<string, number>();
      for (const id of ids) {
        const standing = standings.get(id);
        if (standing === undefined) continue;
        const near = adjacentTo(world, id).map((other) => rows.get(other.provinceId)?.developmentBps).filter((value): value is number => value !== undefined);
        const row = rows.get(id)!;
        // A province whose market keeps its grain at about the ordinary price is one merchants can count on.
        const grainPrice = book.get(geography.hubOf.get(id) ?? "")?.price[0] ?? 10_000;
        const steady = grainPrice <= STEADY_MAX_PRICE_BPS;
        const hubId = geography.hubOf.get(id) ?? "";
        const hubBook = book.get(hubId);
        // The traffic through its hub is read once a hub a month, not once a province.
        let trade = hubTrades.get(hubId);
        if (trade === undefined) { trade = hubBook === undefined ? 0 : hubTradeOf(hubBook); hubTrades.set(hubId, trade); }
        rows.set(id, monthOfDevelopment(row, standing, near.length === 0 ? null : near.reduce((sum, value) => sum + value, 0) / near.length, steady, hubId === id, trade));
      }
      // People who fled go on to the quietest fed country next to them. The
      // rest wait, and the recovery pass brings some of them home.
      for (const id of ids) {
        const row = rows.get(id)!;
        const leaving = Math.floor(row.displacedPopulation * MIGRATION_SHARE);
        if (leaving <= 0) continue;
        const refuge = adjacentTo(world, id)
          .map((other) => rows.get(other.provinceId))
          .filter((other): other is ProvinceMaterial => other !== undefined && owned.has(other.provinceId) && other.stabilityBps >= REFUGE_BPS && other.foodSecurityBps >= REFUGE_BPS)
          .sort((a, b) => (b.stabilityBps + b.foodSecurityBps) - (a.stabilityBps + a.foodSecurityBps) || a.provinceId.localeCompare(b.provinceId))[0];
        if (refuge === undefined) continue;
        rows.set(id, { ...row, population: row.population - leaving, displacedPopulation: row.displacedPopulation - leaving });
        // They bring hands and skills to a province that is safe and fed:
        // a little development, never past what the ground could carry.
        const gain = Math.min(MAX_REFUGEE_GAIN_BPS, Math.round((leaving / Math.max(1, refuge.population)) * REFUGEE_GAIN_PER_10K));
        const potential = standings.get(refuge.provinceId)?.ground.potentialBps ?? 10_000;
        const refugeDevelopment = refuge.developmentBps;
        rows.set(refuge.provinceId, {
          ...refuge,
          population: refuge.population + leaving,
          ...(refugeDevelopment === undefined ? {} : { developmentBps: Math.max(refugeDevelopment, Math.min(potential, refugeDevelopment + gain)) }),
        });
        const tally = settledIn.get(refuge.provinceId) ?? { count: 0, from: new Set<string>() };
        tally.count += leaving;
        tally.from.add(id);
        settledIn.set(refuge.provinceId, tally);
      }
    }
    world = closeBook(world, book);
    world = withTradeBooks(world, customsEarned, lanes);
    // Then the coinages: prices follow what a mint has done a few months behind it, and what a coin fetches follows its issuer's trade and credit.
    const coined = monthOfCoinage(world, Array.from({ length: months }, (_, month) => monthOne + month * REVIEW_DAYS), toDay);
    world = coined.world;
    facts.push(...coined.facts);
    // Grain that came by sea to a dear market is news, a line a power and not oftener than once a year.
    const reliefTold = reliefNews(world, relief, toDay);
    facts.push(...reliefTold.facts);
    if (reliefTold.told.length > 0) {
      const told = new Set(reliefTold.told.map((entry) => entry.polityId));
      world = { ...world, economy: { ...economyOf(world), tradeNews: [...economyOf(world).tradeNews.filter((entry) => !(entry.kind === "relief" && told.has(entry.polityId))), ...reliefTold.told].slice(-200) } };
    }
    world = {
      ...world,
      material: {
        ...world.material,
        provinceMaterial: world.material.provinceMaterial.map((row) => {
          const next = rows.get(row.provinceId)!;
          // What it can pay is what its people can make, from what war has left,
          // as developed as it is, and whatever a decree laid on it.
          return { ...next, taxCapacity: reckonTaxCapacity(next) };
        }),
      },
    };

    // Whole countries laid waste are news; a province is not. One line a power
    // when a district newly crosses the line, and not again for two years.
    const wastedAfter = wastedBy(world, rows);
    const told = new Map(memory.wasteNews.map((entry) => [entry.polityId, entry]));
    const wasteNews: { polityId: string; atStep: number; districts: number }[] = [];
    for (const [polityId, after] of [...wastedAfter.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
      const lastTold = told.get(polityId);
      if (lastTold !== undefined && (after.length <= lastTold.districts || toDay - lastTold.atStep < WASTE_NEWS_REPEAT_DAYS)) continue;
      if (wasteNews.length >= 3) break;
      wasteNews.push({ polityId, atStep: toDay, districts: after.length });
      const worst = [...after].sort((a, b) => (rows.get(b)?.scarBps ?? 0) - (rows.get(a)?.scarBps ?? 0) || a.localeCompare(b));
      facts.push({
        localId: `waste_${polityId}_${toDay}`.slice(0, 60),
        kind: "devastation",
        summary: `The countryside of ${listed(worst.slice(0, 3).map((id) => provinceName(world, id)))}${worst.length > 3 ? ` and ${worst.length - 3} more districts` : ""} of ${polityName(world, polityId)} lies waste: the war has left it with a fraction of the people, the roads and the fields it had, and it will be a generation before it is what it was.`.slice(0, 600),
        affectedRefs: [{ kind: "polity", id: polityId }, ...worst.slice(0, 3).map((id) => ({ kind: "province" as const, id }))],
        visibility: "public",
        discoveryState: "public",
        knowableInDays: 0,
        significance: Math.min(70, 45 + Math.round(Math.log2(worst.length + 1) * 5)),
      });
    }
    // A power whose ground has healed is forgotten, so the next war is news again.
    const kept = memory.wasteNews.filter((entry) => wastedAfter.has(entry.polityId) && !wasteNews.some((fresh) => fresh.polityId === entry.polityId));
    if (wasteNews.length > 0 || kept.length !== memory.wasteNews.length) {
      world = { ...world, economy: { ...economyOf(world), wasteNews: [...kept, ...wasteNews].slice(-200) } };
    }

    // A famine is history; a steady trickle of deaths in a lean month is not.
    const live = liveProvinceIds(world);
    const famines = [...starvedIn.entries()].filter(([provinceId, dead]) => dead >= 200 && live.has(provinceId) && owned.has(provinceId)).sort((a, b) => b[1] - a[1]).slice(0, 6);
    for (const [provinceId, dead] of famines) {
      const holder = world.map.provinces.find((province) => province.id === provinceId)?.controllerPolityId ?? null;
      facts.push({
        localId: `famine_${provinceId}_${toDay}`.slice(0, 60),
        kind: "famine",
        summary: `Famine in ${provinceName(world, provinceId)}${holder === null ? "" : `, held by ${polityName(world, holder)}`}: some ${dead} people have died of hunger.`,
        affectedRefs: [{ kind: "province", id: provinceId }, ...(holder === null ? [] : [{ kind: "polity" as const, id: holder }])],
        visibility: "public",
        discoveryState: "public",
        knowableInDays: 0,
        significance: Math.min(75, 50 + Math.round(dead / 500)),
      });
    }
    const arrivals = [...settledIn.entries()].filter(([provinceId, tally]) => tally.count >= 500 && live.has(provinceId)).sort((a, b) => b[1].count - a[1].count).slice(0, 4);
    for (const [provinceId, tally] of arrivals) {
      facts.push({
        localId: `migrants_${provinceId}_${toDay}`.slice(0, 60),
        kind: "migration",
        summary: `Some ${tally.count} people who had fled ${listed([...tally.from].sort().map((id) => provinceName(world, id)).slice(0, 3))} have settled in ${provinceName(world, provinceId)}.`,
        affectedRefs: [{ kind: "province", id: provinceId }, ...[...tally.from].sort().slice(0, 3).map((id) => ({ kind: "province" as const, id }))],
        visibility: "public",
        discoveryState: "public",
        knowableInDays: 0,
        significance: 30,
      });
    }
  }

  // ── The harvest ────────────────────────────────────────────────────────
  let lastHarvestYear = memory.lastHarvestYear;
  if (input.clock !== undefined) {
    const today = calendarDateOf({ day: toDay, minute: 0 }, input.clock);
    const year = astronomicalYearOf(today);
    const harvestDay = (astronomical: number): number => dayOfCalendarDate({ ...calendarYearOf(astronomical), month: HARVEST_MONTH, day: 1 }, input.clock!);
    const latest = harvestDay(year) <= toDay ? year : year - 1;
    if (lastHarvestYear === null) {
      // The world began with this year's grain already in, or already growing.
      lastHarvestYear = latest;
    } else if (latest > lastHarvestYear) {
      const brought = bringInTheHarvest(world, latest);
      world = brought.world;
      facts.push(...brought.facts);
      lastHarvestYear = latest;
    }
  }

  // Grain gone far too dear or too cheap across a power's country is news, a line a power and not oftener than once a year.
  let marketNewsMemory = economyOf(world).marketNews;
  if (months > 0 || lastHarvestYear !== memory.lastHarvestYear) {
    const failedPowers = new Set(facts.filter((fact) => fact.kind === "harvest_failed").flatMap((fact) => (fact.affectedRefs ?? []).filter((ref) => ref.kind === "polity").map((ref) => ref.id)));
    const news = marketNews(world, toDay);
    const fresh = news.told.filter((entry) => !failedPowers.has(entry.polityId));
    facts.push(...news.facts.filter((fact) => !(fact.affectedRefs ?? []).some((ref) => failedPowers.has(ref.id))));
    if (fresh.length > 0) {
      const replaced = new Set(fresh.map((entry) => `${entry.polityId}:${entry.kind}`));
      marketNewsMemory = [...marketNewsMemory.filter((entry) => !replaced.has(`${entry.polityId}:${entry.kind}`)), ...fresh].slice(-200);
    }
  }
  return { world: { ...world, economy: { ...economyOf(world), lastReviewStep, lastHarvestYear, marketNews: marketNewsMemory } }, facts, months };
}

/**
 * What a pass of trade earned and moved, written into memory: each power's
 * customs added to what is due its treasury (the tick pays it), and the
 * last month's busiest lanes between powers by value, largest first.
 */
function withTradeBooks(world: WorldState, customsEarned: ReadonlyMap<string, number>, lanes: ReadonlyMap<string, number>): WorldState {
  const memory = economyOf(world);
  const due = new Map(memory.customsDue.map((entry) => [entry.polityId, entry.amount]));
  for (const [polityId, amount] of customsEarned) due.set(polityId, (due.get(polityId) ?? 0) + Math.round(amount));
  const customsDue = [...due.entries()].filter(([, amount]) => amount > 0).sort((a, b) => a[0].localeCompare(b[0])).map(([polityId, amount]) => ({ polityId, amount })).slice(0, 200);
  const tradeLanes = [...lanes.entries()]
    .map(([key, value]) => ({ fromPolityId: key.split(">")[0]!, toPolityId: key.split(">")[1]!, value: Math.round(value) }))
    .filter((lane) => lane.value > 0)
    .sort((a, b) => b.value - a.value || a.fromPolityId.localeCompare(b.fromPolityId) || a.toPolityId.localeCompare(b.toPolityId))
    .slice(0, 60);
  return { ...world, economy: { ...memory, customsDue, tradeLanes } };
}

/** The provinces each power holds that war has scarred past the line at which they are laid waste, by id. */
function wastedBy(world: WorldState, rows: ReadonlyMap<string, ProvinceMaterial>): Map<string, string[]> {
  const wasted = new Map<string, string[]>();
  for (const province of world.map.provinces) {
    if (province.controllerPolityId === null || (rows.get(province.id)?.scarBps ?? 0) < WASTE_SCAR_BPS) continue;
    const list = wasted.get(province.controllerPolityId);
    if (list === undefined) wasted.set(province.controllerPolityId, [province.id]);
    else list.push(province.id);
  }
  return wasted;
}

function bringInTheHarvest(world: WorldState, year: number): Omit<LandResult, "months"> {
  const failed = new Map<string, string[]>();
  const glutted = new Map<string, string[]>();
  const geography = marketGeography(world);
  const grounds = provinceGrounds(world);
  const provinces = new Map(world.map.provinces.map((province) => [province.id, province]));
  // The far edge's harvest feeds its people like any other, and is nobody's news.
  const live = liveProvinceIds(world);
  // What each province brings in goes to its hub's granary: its ordinary crop (its people, its ground, what
  // war and levies have left of its fields, its development) times the year's weather in its country and its own luck.
  const crops = new Map<string, number>();
  for (const row of world.material.provinceMaterial) {
    const province = provinces.get(row.provinceId);
    const ground = grounds.get(row.provinceId);
    const hub = geography.hubOf.get(row.provinceId);
    if (province === undefined || ground === undefined || hub === undefined) continue;
    const yieldMultiple = harvestYield(hub, row.provinceId, year);
    crops.set(hub, (crops.get(hub) ?? 0) + ordinaryCrop(row, province, ground) * yieldMultiple);
    const holder = !live.has(row.provinceId) ? null : province.controllerPolityId;
    const kind = harvestIn(world, row.provinceId, year);
    if (holder !== null && kind === "drought") failed.set(holder, [...(failed.get(holder) ?? []), row.provinceId]);
    if (holder !== null && kind === "bumper") glutted.set(holder, [...(glutted.get(holder) ?? []), row.provinceId]);
  }
  const provinceMaterial = world.material.provinceMaterial;
  const next: WorldState = stockTheHarvest(world, crops);
  const facts: FactProposalDraft[] = [];
  // One line a power, not one a province: a drought is news in a country, and
  // 779 harvests are not 779 entries.
  // Where the most people will go hungry first: a drought over a dozen
  // hill-tribes' valleys is less news than one over Latium.
  const people = new Map(provinceMaterial.map((material) => [material.provinceId, material.population]));
  const hungry = (ids: readonly string[]): number => ids.reduce((sum, id) => sum + (people.get(id) ?? 0), 0);
  for (const [polityId, provinceIds] of [...failed.entries()].sort((a, b) => hungry(b[1]) - hungry(a[1]) || a[0].localeCompare(b[0])).slice(0, 8)) {
    const price = polityGrainPriceBps(next, polityId);
    facts.push({
      localId: `harvest_failed_${polityId}_${year}`.slice(0, 60),
      kind: "harvest_failed",
      summary: `The harvest failed in ${listed(provinceIds.slice(0, 4).map((id) => provinceName(next, id)))}${provinceIds.length > 4 ? ` and ${provinceIds.length - 4} more of ${polityName(next, polityId)}'s provinces` : ""}: drought, and the granaries must see the country through to the next crop.${price >= 15_000 ? ` Grain in ${polityName(next, polityId)} sells at ${(price / 10_000).toFixed(1)} times its ordinary price.` : ""}`.slice(0, 600),
      affectedRefs: [{ kind: "polity", id: polityId }, ...provinceIds.slice(0, 4).map((id) => ({ kind: "province" as const, id }))],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      significance: Math.min(70, 50 + Math.round(Math.log2(provinceIds.length + 1) * 4)),
    });
  }
  for (const [polityId, provinceIds] of [...glutted.entries()].sort((a, b) => hungry(b[1]) - hungry(a[1]) || a[0].localeCompare(b[0])).slice(0, 4)) {
    facts.push({
      localId: `harvest_${polityId}_${year}`.slice(0, 60),
      kind: "harvest",
      summary: `${listed(provinceIds.slice(0, 4).map((id) => provinceName(next, id)))}${provinceIds.length > 4 ? ` and ${provinceIds.length - 4} more of ${polityName(next, polityId)}'s provinces` : ""} brought in a glut: the granaries full, and grain cheap.`.slice(0, 600),
      affectedRefs: [{ kind: "polity", id: polityId }, ...provinceIds.slice(0, 4).map((id) => ({ kind: "province" as const, id }))],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      significance: 25,
    });
  }
  return { world: next, facts };
}
