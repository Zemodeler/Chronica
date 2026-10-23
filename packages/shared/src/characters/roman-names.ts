/**
 * How a Roman was named, and how his sons, his daughters and his adopted heirs were.
 *
 * A free man had a praenomen (a given name, drawn from a few dozen, and each gens
 * kept to its own handful), a nomen (the gens: "Cornelius") and a cognomen (the
 * branch, or a nickname that became one: "Scipio"). His daughters took the
 * nomen in the feminine ("Cornelia") with nothing else, or "the elder" and "the
 * younger" among sisters, and a wife kept her own. An adopted man took the
 * adopter's three names and kept his old nomen as a cognomen ending in -ianus:
 * Publius Cornelius Scipio Aemilianus was born an Aemilius.
 *
 * This reads a name the scenario wrote as one string into those parts, and
 * makes the names the world needs for a child or an adoptee.
 */

/** The given names a Roman man might bear, in the form the fasti write them. */
export const PRAENOMINA: ReadonlySet<string> = new Set([
  "Appius", "Aulus", "Decimus", "Gaius", "Gnaeus", "Kaeso", "Lucius", "Manius", "Marcus", "Mamercus", "Numerius", "Publius",
  "Quintus", "Servius", "Sextus", "Spurius", "Tiberius", "Titus", "Vibius", "Statius", "Ovius", "Herius", "Minatius",
]);

export interface RomanName {
  readonly praenomen: string | null;
  /** The gens, in the form of a man's nomen ("Cornelius"), whether the person is a man or a woman ("Cornelia" reads as Cornelius). */
  readonly nomen: string | null;
  /** The branch ("Scipio"); null where there is none, or none the name gives. */
  readonly cognomen: string | null;
}

/** "Cornelia" is of the gens Cornelius. A nomen that does not end in -ia or -ius is returned as it is. */
export function masculineNomen(nomen: string): string {
  return /ia$/.test(nomen) ? `${nomen.slice(0, -2)}ius` : nomen;
}

/** A man's nomen for a woman's: "Fabius" is "Fabia". */
export function feminineNomen(nomen: string): string {
  return /ius$/.test(nomen) ? `${nomen.slice(0, -2)}a` : nomen;
}

const TAIL = /\b(the (younger|elder)|son of .*|daughter of .*|(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+th) (son|daughter) of .*|the vestal)$/i;

/**
 * The parts of a Roman name. A name that is not Roman in form (no nomen ending in -ius or, for a woman, -ia)
 * has no nomen and the caller falls back to what it had before.
 */
export function parseRomanName(name: string): RomanName {
  const words = name.replace(TAIL, "").trim().split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return { praenomen: null, nomen: null, cognomen: null };
  const first = words[0]!;
  if (PRAENOMINA.has(first)) {
    const nomen = words[1];
    if (nomen !== undefined && /(ius)$/.test(nomen)) return { praenomen: first, nomen, cognomen: words.length > 2 ? words.slice(2).join(" ") : null };
    return { praenomen: first, nomen: null, cognomen: null };
  }
  // A woman: "Cornelia", "Cornelia Blasionis", "Aemilia the Vestal".
  if (/ia$/.test(first) && first.length > 3) return { praenomen: null, nomen: masculineNomen(first), cognomen: words.length > 1 ? words.slice(1).join(" ") : null };
  return { praenomen: null, nomen: null, cognomen: null };
}

/** The id of the gens a nomen names: "Cornelius" and "Cornelia" are both "gens-cornelius". */
export function gensIdOfNomen(nomen: string): string {
  return `gens-${masculineNomen(nomen).toLowerCase().replace(/[^a-z]/g, "")}`;
}

/** The plural by which a gens is spoken of: "the Cornelii". */
export function pluralOfNomen(nomen: string): string {
  const stem = masculineNomen(nomen);
  return /ius$/.test(stem) ? `the ${stem.slice(0, -2)}i` : `the ${stem}`;
}

/** The old cognomen-in-a-gen's-name an adoptee carries from his birth: Aemilius becomes Aemilianus. */
export function adoptiveCognomen(oldNomen: string): string {
  const stem = masculineNomen(oldNomen);
  return /ius$/.test(stem) ? `${stem.slice(0, -3)}ianus` : `${stem}ianus`;
}

/**
 * What an adopted man is called: the adopter's praenomen, nomen and cognomen, and his old nomen as -ianus.
 * A man whose old name has no nomen (a freedman of another people, a Greek) takes his old first name as nothing
 * more than the end of it.
 */
export function adoptedRomanName(adopter: RomanName, old: RomanName, oldName: string): string {
  if (adopter.nomen === null) return oldName;
  const parts = [adopter.praenomen ?? old.praenomen, adopter.nomen, adopter.cognomen, old.nomen === null ? null : adoptiveCognomen(old.nomen)].filter((part): part is string => part !== null);
  return parts.join(" ").slice(0, 120);
}

/** The given names each patrician and noble gens used, in the order the eldest sons took them; the rest use the common stock. */
const PRAENOMINA_OF_GENS: Readonly<Record<string, readonly string[]>> = {
  cornelius: ["Publius", "Lucius", "Gnaeus", "Servius", "Aulus"],
  fabius: ["Quintus", "Marcus", "Numerius", "Gaius", "Kaeso"],
  valerius: ["Marcus", "Publius", "Lucius", "Manius", "Gaius"],
  claudius: ["Appius", "Gaius", "Publius", "Tiberius", "Marcus"],
  aemilius: ["Lucius", "Quintus", "Marcus", "Manius", "Tiberius"],
  manlius: ["Titus", "Gnaeus", "Lucius", "Aulus", "Publius"],
  postumius: ["Lucius", "Spurius", "Aulus", "Marcus"],
  papirius: ["Lucius", "Gaius", "Marcus", "Spurius"],
  sulpicius: ["Servius", "Publius", "Gaius"],
  quinctius: ["Titus", "Gaius", "Lucius", "Kaeso"],
  servilius: ["Gaius", "Quintus", "Gnaeus", "Publius"],
  junius: ["Decimus", "Marcus", "Lucius", "Gaius"],
  sempronius: ["Publius", "Gaius", "Tiberius", "Aulus"],
  atilius: ["Marcus", "Gaius", "Aulus", "Lucius"],
  caecilius: ["Lucius", "Quintus", "Marcus", "Gaius"],
  genucius: ["Gaius", "Lucius", "Gnaeus", "Titus"],
  marcius: ["Gaius", "Quintus", "Lucius", "Marcus"],
  fulvius: ["Marcus", "Gnaeus", "Quintus", "Servius"],
};
const COMMON_PRAENOMINA = ["Gaius", "Lucius", "Marcus", "Quintus", "Publius", "Titus", "Gnaeus", "Aulus", "Decimus", "Manius"];

/**
 * The praenomen of the nth living son, counting from none: the eldest has his father's, the rest the gens's
 * own given names in turn, skipping the ones brothers already bear.
 */
export function praenomenForSon(nomen: string, fatherPraenomen: string | null, brothers: readonly (string | null)[]): string {
  const stock = PRAENOMINA_OF_GENS[masculineNomen(nomen).toLowerCase()] ?? COMMON_PRAENOMINA;
  if (brothers.length === 0 && fatherPraenomen !== null) return fatherPraenomen;
  const taken = new Set(brothers);
  if (fatherPraenomen !== null) taken.add(fatherPraenomen);
  return stock.find((candidate) => !taken.has(candidate)) ?? COMMON_PRAENOMINA.find((candidate) => !taken.has(candidate)) ?? stock[0]!;
}

const DAUGHTER_MARKS = ["", " Minor", " Tertia", " Quarta", " Quinta", " Sexta", " Septima"];

/** A daughter's name: the nomen in the feminine; the first is plain, and a younger sister is "the younger", the next "the third". */
export function daughterName(nomen: string, sisters: number): string {
  return `${feminineNomen(nomen)}${DAUGHTER_MARKS[sisters] ?? ` ${sisters + 1}`}`.slice(0, 120);
}
