import type { WorldState } from "@chronica/shared";

/** A pattern that matches a name as it stands, whatever it holds of the characters a pattern reads. */
export const escapeForPattern = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The place a clause names: a province, or a town of one, by its name (the longest name, where several are in it). */
export function placeNamed(world: WorldState, text: string): { readonly provinceId: string; readonly name: string } | null {
  const lower = text.toLowerCase();
  const found: { provinceId: string; name: string }[] = [];
  for (const province of world.map.provinces) {
    for (const name of [province.name, ...province.settlements.map((settlement) => settlement.name)]) {
      if (name.length >= 4 && new RegExp(`\\b${escapeForPattern(name.toLowerCase())}\\b`).test(lower)) found.push({ provinceId: province.id, name });
    }
  }
  return found.sort((a, b) => b.name.length - a.name.length || a.provinceId.localeCompare(b.provinceId))[0] ?? null;
}
