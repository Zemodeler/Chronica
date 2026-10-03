import type { WorldState } from "@chronica/shared";
import { normalisePlaceName } from "./place-index";

/** Words in a power's name that say what sort of power it is, not which. */
const GENERIC_POWER_WORDS = new Set([
  "kingdom", "republic", "league", "confederation", "confederacy", "empire", "state", "city", "cities",
  "people", "peoples", "tribe", "tribes", "communities", "community", "federation", "realm", "lands",
  "northern", "southern", "eastern", "western", "upper", "lower", "greater", "lesser", "free",
]);

/**
 * The stem a name word is recognised by: "Syracuse" by "syracus", so that
 * "the Syracusans" finds it, and "Carthage" by "carthag" for "Carthaginian".
 * A short word is matched whole -- "boii" is not a prefix of anything else.
 */
function stemOf(word: string): string | null {
  if (word.length < 4 || GENERIC_POWER_WORDS.has(word)) return null;
  const stem = word.replace(/[aeiouy]+$/, "");
  return stem.length >= 5 ? stem : null;
}

/**
 * The powers a passage of prose names: by id, by name, or by a word of the
 * name a people is called by. A letter to Syracuse was unwritable when the
 * slice never showed Syracuse's id (E23); an order that names a power puts it
 * first among the powers it is shown.
 */
export function powersNamedIn(world: WorldState, text: string): Set<string> {
  const found = new Set<string>();
  const words = normalisePlaceName(text).split(" ").filter((word) => word !== "");
  const said = ` ${words.join(" ")} `;
  const ids = new Set(text.toLowerCase().match(/[a-z0-9][a-z0-9_-]*/g) ?? []);
  for (const polity of world.map.polities) {
    if (ids.has(polity.id.toLowerCase())) {
      found.add(polity.id);
      continue;
    }
    const name = normalisePlaceName(polity.name);
    if (name.length >= 4 && said.includes(` ${name} `)) {
      found.add(polity.id);
      continue;
    }
    for (const part of name.split(" ")) {
      const stem = stemOf(part);
      const matches = stem === null
        ? part.length >= 4 && !GENERIC_POWER_WORDS.has(part) && words.includes(part)
        : words.some((word) => word.startsWith(stem));
      if (matches) {
        found.add(polity.id);
        break;
      }
    }
  }
  return found;
}
