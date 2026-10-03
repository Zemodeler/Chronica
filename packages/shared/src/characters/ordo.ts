/**
 * Patrician and plebeian.
 *
 * By 270 the two orders shared almost everything -- the consulship since 367,
 * the priesthoods since the lex Ogulnia of 300 -- but not quite. A tribune of
 * the plebs and a plebeian aedile had to be plebeians, and were chosen by the
 * plebs alone; one consul each year, and one censor each lustrum, had to be a
 * plebeian. A patrician could not become one except by adoption.
 *
 * A Roman's order went with his gens. These are the patrician houses still
 * living in the third century; a gens not named here was plebeian, as most
 * were. A few names were borne by both orders (there were plebeian Claudii,
 * the Marcelli), and those are told apart by cognomen.
 */

const PATRICIAN_GENTES = new Set([
  "aemilius", "claudius", "cornelius", "fabius", "furius", "julius", "manlius", "nautius", "papirius", "postumius",
  "quinctius", "quinctilius", "sergius", "servilius", "sulpicius", "valerius", "veturius", "verginius", "folius", "pinarius",
]);

/** Cognomina that mark the plebeian branch of a gens otherwise patrician. */
const PLEBEIAN_BRANCHES = new Set(["marcellus", "marcelli", "canina", "asina"]);

/** The order a Roman's name places him in, read from the gens: "Gnaeus Cornelius Blasio" is a patrician. */
export function ordoOfRomanName(name: string): "patrician" | "plebeian" {
  const words = name.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((word) => word.length > 0);
  if (words.some((word) => PLEBEIAN_BRANCHES.has(word))) return "plebeian";
  return words.slice(1).some((word) => PATRICIAN_GENTES.has(word)) ? "patrician" : "plebeian";
}

/** The order a declared Roman says he is, or his name says he is. */
export function declaredOrdo(said: string, name: string): "patrician" | "plebeian" {
  const text = said.toLowerCase();
  if (/\bpatrician/.test(text)) return "patrician";
  if (/\bplebei|\bplebs\b/.test(text)) return "plebeian";
  return ordoOfRomanName(name);
}
