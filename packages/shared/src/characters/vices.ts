import { stableHash } from "../determinism";
import type { Character } from "./character";
import { MAX_TRAITS, TRAIT_REGISTRY } from "./traits";

/**
 * The vices people are born with (docs/plans/a-living-world.md §6).
 *
 * Two hand runs found 280 people carrying one cruel and one deceitful trait
 * between them; two had cruelty of 65 or more. The model, given people with
 * nothing wrong in them, played them as honourable, and the world had no
 * villains. Here a person with no moral nature written for him -- every one of
 * the generated chiefs, magistrates and generals of the map, and everybody
 * the engine makes -- is given one by station: rulers and generals reach and
 * break faith and are cruel more often than the rest, officials take what
 * passes through their hands, priests are zealous, and many are none of
 * these. His temperament moves to match, because that is what the rules read
 * (`statecraft.ts`, the graft rules, plots). Deterministic: the same person
 * is the same man in every replay.
 */

export type ViceStation = "ruler" | "general" | "official" | "priest" | "other";

/** Chances in a hundred, by station, for each vice. A person gets at most two. */
const VICE_TABLE: Readonly<Record<ViceStation, readonly (readonly [trait: string, chance: number])[]>> = {
  ruler: [["ambitious", 30], ["cruel", 14], ["treacherous", 12], ["greedy", 12], ["paranoid", 12], ["wrathful", 8], ["content", 10]],
  general: [["ambitious", 22], ["cruel", 16], ["wrathful", 12], ["greedy", 10], ["treacherous", 8], ["cowardly", 6]],
  official: [["greedy", 24], ["ambitious", 22], ["envious", 14], ["deceitful", 14], ["treacherous", 10], ["cowardly", 6]],
  priest: [["zealous", 30], ["greedy", 10], ["envious", 8], ["deceitful", 6]],
  other: [["greedy", 10], ["envious", 8], ["cowardly", 6], ["cruel", 5], ["deceitful", 6], ["ambitious", 10]],
};

/** The moral and ambition traits that, once written by hand, leave a person as he was written. */
const NATURE = new Set(["ambitious", "dutiful", "vengeful", "deceitful", "compassionate", "cruel", "greedy", "treacherous", "envious", "zealous", "content", "paranoid", "wrathful", "cowardly"]);

/** What a person's office and commands make him, for the table above. */
export function stationOf(character: Pick<Character, "officeId">, commands: boolean, rules: boolean): ViceStation {
  if (rules) return "ruler";
  if (commands) return "general";
  const office = character.officeId ?? "";
  if (/priest|augur|pontif|flamen|haruspex|seer|druid/i.test(office)) return "priest";
  if (office !== "") return "official";
  return "other";
}

const clamp = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

/**
 * A person with his vices, if he had none written for him: up to two, drawn
 * from his station's table by a roll on his own id, his traits and mind
 * shifted to carry them. A person whose nature was written by hand -- Hanno's
 * ambition, Hieron's caution -- is returned as he was.
 */
export function withVices(character: Character, station: ViceStation): Character {
  if (character.traits.some((trait) => NATURE.has(trait))) return character;
  const drawn: string[] = [];
  for (const [trait, chance] of VICE_TABLE[station]) {
    if (drawn.length >= 2) break;
    const roll = stableHash([character.id, "vice", trait]) % 100;
    if (roll >= chance) continue;
    const incompatible = TRAIT_REGISTRY[trait]?.incompatibleTraitIds ?? [];
    if ([...character.traits, ...drawn].some((held) => incompatible.includes(held) || (TRAIT_REGISTRY[held]?.incompatibleTraitIds ?? []).includes(trait))) continue;
    drawn.push(trait);
  }
  if (drawn.length === 0) return character;
  const temperament = { ...character.mind.temperament };
  const drives = { ...character.mind.drives };
  let risk = character.mind.riskTolerance;
  for (const trait of drawn) {
    if (trait === "cruel") temperament.cruelty = clamp(Math.max(temperament.cruelty, 72));
    if (trait === "treacherous") temperament.honesty = clamp(Math.min(temperament.honesty, 25));
    if (trait === "deceitful") temperament.honesty = clamp(Math.min(temperament.honesty, 32));
    if (trait === "greedy") { drives.wealth = clamp(Math.max(drives.wealth, 75)); temperament.honesty = clamp(temperament.honesty - 15); }
    if (trait === "ambitious") { drives.status = clamp(Math.max(drives.status, 72)); risk = clamp(risk + 8); }
    if (trait === "paranoid") { temperament.caution = clamp(temperament.caution + 15); temperament.sociability = clamp(temperament.sociability - 15); }
    if (trait === "wrathful") { temperament.cruelty = clamp(temperament.cruelty + 12); temperament.boldness = clamp(temperament.boldness + 10); drives.revenge = clamp(Math.max(drives.revenge, 65)); }
    if (trait === "cowardly") { temperament.boldness = clamp(Math.min(temperament.boldness, 28)); risk = clamp(risk - 15); }
    if (trait === "envious") drives.status = clamp(Math.max(drives.status, 65));
    if (trait === "zealous") drives.faith = clamp(Math.max(drives.faith, 80));
    if (trait === "content") { drives.status = clamp(Math.min(drives.status, 35)); risk = clamp(risk - 10); }
  }
  return {
    ...character,
    traits: [...character.traits, ...drawn].slice(0, MAX_TRAITS),
    mind: { ...character.mind, temperament, drives, riskTolerance: risk },
  };
}
