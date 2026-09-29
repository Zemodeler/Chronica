import type { Character } from "@chronica/shared";

/**
 * What a party is called, as the people inside it would say it.
 *
 * "The friends of Manius Curius Dentatus" and "The landholders of the Roman
 * Republic" were clerks' labels: long, identical across every power, and
 * nothing a Roman ever said. A Roman circle took its name from the gens of
 * the man at its centre -- the Fabian, the Cornelian -- and nobody inside a
 * power names it after the power: a Senate's own landowners are "the landed
 * families", not the landholders of the Roman Republic.
 */

/** The name a man goes by among his own: the part before "of Carthage", or a Roman's cognomen. */
export function shortNameOf(character: Pick<Character, "name" | "cultureId">): string {
  const bare = character.name.split(/\s+of\s+/u)[0]!.trim();
  const parts = bare.split(/\s+/u);
  if (character.cultureId === "roman" && parts.length >= 3) return parts[parts.length - 1]!;
  return bare;
}

/** "Fabian" from Quintus Fabius Maximus Gurges; null where a name has no gens to speak of. */
export function gensAdjective(character: Pick<Character, "name" | "cultureId">): string | null {
  if (character.cultureId !== "roman" && character.cultureId !== "italic") return null;
  const parts = character.name.trim().split(/\s+/u);
  const nomen = parts[1];
  if (nomen === undefined || parts.length < 2) return null;
  if (/ius$/u.test(nomen)) return nomen.replace(/ius$/u, "ian");
  if (/us$/u.test(nomen)) return nomen.replace(/us$/u, "an");
  return null;
}

/**
 * A faction around one man: "The Fabian circle", "Hanno's following".
 * `taken` holds the names already in use in his power, so two Fabii are
 * told apart by cognomen rather than sharing one circle's name.
 */
export function circleName(leader: Pick<Character, "name" | "cultureId">, taken: ReadonlySet<string>): string {
  const gens = gensAdjective(leader);
  if (gens !== null) {
    const byGens = `The ${gens} circle`;
    if (!taken.has(byGens)) return byGens;
    return `The circle of ${leader.name.trim().split(/\s+/u).slice(1).join(" ")}`;
  }
  const short = shortNameOf(leader);
  const following = `${short}${/s$/u.test(short) ? "'" : "'s"} following`;
  return taken.has(following) ? `The following of ${leader.name}` : following;
}

/** "Dentatus's clients". */
export function clientsName(patron: Pick<Character, "name" | "cultureId">): string {
  const short = shortNameOf(patron);
  return `${short}${/s$/u.test(short) ? "'" : "'s"} clients`;
}

/** Parties that stand for a class inside one power, named as that power's own would. */
export const CLASS_NAMES = {
  debtors: "The indebted",
  peace_party: "Those weary of the war",
  veterans: "The old soldiers",
  merchant_interest: "The trading houses",
  landholder_interest: "The landed families",
} as const;
