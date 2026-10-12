import type { WorldState } from "@chronica/shared";

/** A pattern that matches a name as it stands, whatever it holds of the characters a pattern reads. */
export const escapeForPattern = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface PlaceName {
  readonly provinceId: string;
  readonly name: string;
  readonly lower: string;
  readonly pattern: RegExp;
}

// World maps are immutable. A changed province list gets its own index, and old
// maps can be collected; turns sharing a map need not compile every name again.
const namesByProvinces = new WeakMap<WorldState["map"]["provinces"], readonly PlaceName[]>();

function namesOf(world: WorldState): readonly PlaceName[] {
  const provinces = world.map.provinces;
  const cached = namesByProvinces.get(provinces);
  if (cached !== undefined) return cached;
  const names: PlaceName[] = [];
  for (const province of provinces) {
    for (const name of [province.name, ...province.settlements.map((settlement) => settlement.name)]) {
      if (name.length < 4) continue;
      const lower = name.toLowerCase();
      names.push({ provinceId: province.id, name, lower, pattern: new RegExp(`\\b${escapeForPattern(lower)}\\b`) });
    }
  }
  names.sort((a, b) => b.name.length - a.name.length || a.provinceId.localeCompare(b.provinceId));
  namesByProvinces.set(provinces, names);
  return names;
}

/** The place a clause names: a province, or a town of one, by its name (the longest name, where several are in it). */
export function placeNamed(world: WorldState, text: string): { readonly provinceId: string; readonly name: string } | null {
  const lower = text.toLowerCase();
  const found = namesOf(world).find((candidate) => lower.includes(candidate.lower) && candidate.pattern.test(lower));
  return found === undefined ? null : { provinceId: found.provinceId, name: found.name };
}
