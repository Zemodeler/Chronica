import type { WorldState } from "../world/world-state";
import { economyOf } from "../world/economy";
import { marketGeography } from "../world/markets";
import type { TaxRegime } from "../material-state";
import { developmentOf } from "./province-material";
import { polityTaxReadings } from "./taxation";
import { UNIFORM_LEVY } from "./tax-policy";

/**
 * The lands of a power as the one who governs them reads them: how developed
 * each region is, how far war has scarred it, how many live there and by what
 * regime and rate it is taxed (phase F of the economy rework).
 *
 * Derived from the world each time and stored nowhere. A region is a market's
 * country: a hub and the provinces that trade in it, which is how the engine
 * already groups the countryside (`marketGeography`). Never a line a province
 * for the model, which is told only the power's total; this is for the
 * player's own page, where a handful of the largest provinces of each region
 * are listed so that each can be taxed on its own.
 */

/** At most this many regions are listed, the most populous first. */
export const REGIONS_SHOWN = 16;
/** And at most this many provinces under each. */
export const PROVINCES_PER_REGION = 8;

export interface RegionPolicy {
  readonly regime: TaxRegime;
  readonly rateBps: number;
  /** False where nothing has been said for it: the old uniform levy applies. */
  readonly explicit: boolean;
}

export interface ProvinceTaxLine {
  readonly id: string;
  readonly name: string;
  readonly population: number;
  readonly developmentBps: number;
  readonly scarBps: number;
  readonly warDamageBps: number;
  readonly policy: RegionPolicy;
  /** What it brings a month at that policy, after distance and leakage. */
  readonly monthly: number;
  /** Men a year, for a province paying in men. */
  readonly menPerYear: number;
  /** Held but not collected: occupied ground pays nobody. */
  readonly collected: boolean;
}

export interface RegionLine {
  readonly id: string;
  readonly name: string;
  readonly provinceCount: number;
  readonly population: number;
  /** Mean over its people, so a hamlet does not weigh as a city. */
  readonly developmentBps: number;
  readonly scarBps: number;
  readonly warDamageBps: number;
  /** The one regime and rate all its provinces share, or null where they differ. */
  readonly policy: RegionPolicy | null;
  readonly monthly: number;
  /** The most populous of its provinces. */
  readonly provinces: readonly ProvinceTaxLine[];
}

export interface RegionsReading {
  readonly polityId: string;
  readonly polityLabel: string;
  /** How its provinces are taxed unless one has its own policy. */
  readonly defaultPolicy: RegionPolicy;
  readonly customsRateBps: number;
  /** Whether the reader may set any of it: only a fiscal power over the power's chest. */
  readonly canSet: boolean;
  readonly provinceCount: number;
  readonly population: number;
  readonly developmentMeanBps: number;
  /** The most and least developed province held, for how far they have drawn apart. */
  readonly developmentHighBps: number;
  readonly developmentLowBps: number;
  /** Provinces whose scar holds them a fifth or more below their potential. */
  readonly scarredProvinces: number;
  readonly regions: readonly RegionLine[];
  /** Regions not listed, for "and so many more". */
  readonly regionsOmitted: number;
}

const policyOf = (policy: { readonly regime: TaxRegime; readonly rateBps: number; readonly explicit: boolean }): RegionPolicy => ({ regime: policy.regime, rateBps: policy.rateBps, explicit: policy.explicit });

/** The lands of one power, or null where it holds none. */
export function readTheRegions(world: WorldState, polityId: string, canSet: boolean): RegionsReading | null {
  const held = world.map.provinces.filter((province) => province.controllerPolityId === polityId);
  if (held.length === 0) return null;
  const rows = new Map(world.material.provinceMaterial.map((row) => [row.provinceId, row]));
  const readings = new Map(polityTaxReadings(world, polityId).map((reading) => [reading.provinceId, reading]));
  const geography = marketGeography(world);
  const nameOfProvince = new Map(world.map.provinces.map((province) => [province.id, province.name]));
  const memory = economyOf(world);
  const own = (memory.taxPolicies ?? []).find((policy) => policy.polityId === polityId);

  const byRegion = new Map<string, ProvinceTaxLine[]>();
  let population = 0;
  let developmentSum = 0;
  let high = 0;
  let low = 10_000;
  let scarred = 0;
  for (const province of held) {
    const row = rows.get(province.id);
    const development = developmentOf(row ?? {}, province);
    const people = row?.population ?? 0;
    population += people;
    developmentSum += development * Math.max(1, people);
    high = Math.max(high, development);
    low = Math.min(low, development);
    if ((row?.scarBps ?? 0) >= 2_000) scarred += 1;
    const reading = readings.get(province.id);
    const hub = geography.hubOf.get(province.id) ?? province.id;
    const line: ProvinceTaxLine = {
      id: province.id,
      name: province.name,
      population: people,
      developmentBps: Math.round(development),
      scarBps: row?.scarBps ?? 0,
      warDamageBps: row?.warDamageBps ?? 0,
      policy: policyOf(reading?.policy ?? UNIFORM_LEVY),
      monthly: Math.round(reading?.monthly ?? 0),
      menPerYear: reading?.menPerYear ?? 0,
      collected: reading?.held ?? false,
    };
    byRegion.set(hub, [...(byRegion.get(hub) ?? []), line]);
  }
  const weight = (lines: readonly ProvinceTaxLine[], pick: (line: ProvinceTaxLine) => number): number => {
    const total = lines.reduce((sum, line) => sum + Math.max(1, line.population), 0);
    return Math.round(lines.reduce((sum, line) => sum + pick(line) * Math.max(1, line.population), 0) / total);
  };
  const regions: RegionLine[] = [...byRegion].map(([hub, lines]) => {
    const first = lines[0]!.policy;
    const same = lines.every((line) => line.policy.regime === first.regime && line.policy.rateBps === first.rateBps);
    return {
      id: hub,
      name: nameOfProvince.get(hub) ?? hub,
      provinceCount: lines.length,
      population: lines.reduce((sum, line) => sum + line.population, 0),
      developmentBps: weight(lines, (line) => line.developmentBps),
      scarBps: weight(lines, (line) => line.scarBps),
      warDamageBps: weight(lines, (line) => line.warDamageBps),
      policy: same ? first : null,
      monthly: lines.reduce((sum, line) => sum + line.monthly, 0),
      provinces: [...lines].sort((a, b) => b.population - a.population || a.id.localeCompare(b.id)).slice(0, PROVINCES_PER_REGION),
    };
  }).sort((a, b) => b.population - a.population || a.id.localeCompare(b.id));

  return {
    polityId,
    polityLabel: world.map.polities.find((polity) => polity.id === polityId)?.name ?? "Your power",
    defaultPolicy: own === undefined ? policyOf(UNIFORM_LEVY) : { regime: own.regime, rateBps: own.rateBps, explicit: true },
    customsRateBps: (memory.customsRates ?? []).find((entry) => entry.polityId === polityId)?.rateBps ?? 0,
    canSet,
    provinceCount: held.length,
    population,
    developmentMeanBps: population <= 0 ? 0 : Math.round(developmentSum / Math.max(1, held.reduce((sum, province) => sum + Math.max(1, rows.get(province.id)?.population ?? 0), 0))),
    developmentHighBps: Math.round(high),
    developmentLowBps: Math.round(low),
    scarredProvinces: scarred,
    regions: regions.slice(0, REGIONS_SHOWN),
    regionsOmitted: Math.max(0, regions.length - REGIONS_SHOWN),
  };
}

export const REGIME_WORDS: Readonly<Record<TaxRegime, string>> = {
  tithe: "a tithe of the harvest",
  land_levy: "a land levy",
  customs: "customs on trade",
  men: "a tribute of men",
};

/** "a tithe of the harvest at 10 in a hundred", or "the ordinary levy" where nothing is said. */
export function policyInWords(policy: RegionPolicy): string {
  const rate = `${(policy.rateBps / 100).toFixed(policy.rateBps % 100 === 0 ? 0 : 1)} in a hundred`;
  return policy.explicit ? `${REGIME_WORDS[policy.regime]}, ${rate}` : `the ordinary levy, ${rate}`;
}

/** A level of development as a person would say it. */
export function developmentInWords(bps: number): string {
  if (bps >= 7_000) return "flourishing";
  if (bps >= 5_000) return "well settled";
  if (bps >= 3_500) return "modest";
  if (bps >= 2_000) return "poor";
  return "barely settled";
}

/** What war has left on a province, in words, or null where it has left none worth saying. */
export function scarInWords(scarBps: number, warDamageBps: number): string | null {
  if (warDamageBps >= 5_000) return "ravaged by war";
  if (scarBps >= 3_000) return "deeply scarred by war";
  if (scarBps >= 1_000) return "scarred by war";
  if (warDamageBps >= 500 || scarBps >= 300) return "touched by war";
  return null;
}
