import { provinceGrounds, type TaxBurden, type TaxRegime, type WorldState } from "@chronica/shared";
import { WASTE_SCAR_BPS } from "./economy";

const REGIME_WORDS: Readonly<Record<TaxRegime, string>> = { tithe: "tithe", land_levy: "land levy", customs: "customs", men: "tribute of men" };

/**
 * One line about how a power's provinces fare, for its own rulers: how they
 * are taxed, how developed they are against where they began, and how many
 * lie waste from war. A line a power and never a line a province: the map has
 * thousands, and a ruler is told how the realm stands, not given a ledger.
 * Null for a power with nothing held.
 */
export function regionalSummary(world: WorldState, polityId: string, burden: TaxBurden | undefined): string | null {
  const rows = new Map(world.material.provinceMaterial.map((row) => [row.provinceId, row]));
  const grounds = provinceGrounds(world);
  let people = 0;
  let developed = 0;
  let began = 0;
  let wasted = 0;
  let held = 0;
  for (const province of world.map.provinces) {
    if (province.controllerPolityId !== polityId) continue;
    held += 1;
    const row = rows.get(province.id);
    const ground = grounds.get(province.id);
    if (row === undefined || ground === undefined) continue;
    const weight = Math.max(1, row.population);
    people += weight;
    developed += weight * (row.developmentBps ?? ground.startingDevelopmentBps);
    began += weight * ground.startingDevelopmentBps;
    if ((row.scarBps ?? 0) >= WASTE_SCAR_BPS) wasted += 1;
  }
  if (held === 0 || people === 0) return null;
  const parts: string[] = [];
  const byRegime = Object.entries(burden?.bearableByRegime ?? {}).filter((entry): entry is [TaxRegime, number] => entry[1] > 0);
  const total = byRegime.reduce((sum, [, amount]) => sum + amount, 0);
  if (total > 0) {
    parts.push(`taxed by ${byRegime.sort((a, b) => b[1] - a[1]).map(([regime, amount]) => `${Math.round((amount / total) * 100)}% ${REGIME_WORDS[regime]}`).join(", ")}`);
  }
  if ((burden?.menPerYear ?? 0) > 0) parts.push(`owed about ${burden!.menPerYear} men a year in tribute`);
  parts.push(`development ${Math.round(developed / people / 100)} of 100, against ${Math.round(began / people / 100)} at the outset`);
  if (wasted > 0) parts.push(`${wasted} ${wasted === 1 ? "district lies" : "districts lie"} waste from war`);
  return `Our provinces: ${parts.join("; ")}.`;
}
