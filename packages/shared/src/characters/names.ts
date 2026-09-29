/**
 * Who a name means.
 *
 * The world knows Hieron II; the player wrote "Hiero II", the Latin spelling.
 * The contact search took the two for different people, the model was never
 * shown the king to choose him, and a second "Hiero II" was made -- of Rome,
 * because the player was in Rome -- who then answered Rome's letter for
 * Syracuse. The engine was no better: a reference written as a name, "Gaius
 * Genucius Clepsina", was compared with ids and found to be nobody.
 *
 * One reading, for everywhere a person is named rather than identified: the
 * same name, or the same name spelt a letter differently, or -- failing both --
 * every word of it in exactly one person's name. Anything that could mean two
 * people means nobody, and the caller decides what to do about that.
 */

export const normalizeName = (value: string): string =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Levenshtein distance, stopping early once it is past `limit`. */
function withinEdits(a: string, b: string, limit: number): boolean {
  if (Math.abs(a.length - b.length) > limit) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
      current.push(value);
      best = Math.min(best, value);
    }
    if (best > limit) return false;
    previous = current;
  }
  return previous[b.length]! <= limit;
}

/** The same name spelt a letter differently: word for word, a long word may be off by one. */
export function spelledAlike(a: string, b: string): boolean {
  const first = normalizeName(a).split(" ").filter(Boolean);
  const second = normalizeName(b).split(" ").filter(Boolean);
  if (first.length === 0 || first.length !== second.length) return false;
  return first.every((word, index) => {
    const other = second[index]!;
    return word === other || (Math.min(word.length, other.length) >= 4 && withinEdits(word, other, 1));
  });
}

/** The one person a name means, or null when it means nobody or more than one. */
export function whoIsNamed<T extends { readonly id: string; readonly name: string }>(people: readonly T[], written: string): T | null {
  const wanted = normalizeName(written);
  if (wanted.length === 0) return null;
  const only = (found: readonly T[]): T | null | undefined => (found.length === 1 ? found[0]! : found.length > 1 ? null : undefined);
  const exact = only(people.filter((person) => normalizeName(person.name) === wanted));
  if (exact !== undefined) return exact;
  const alike = only(people.filter((person) => spelledAlike(person.name, written)));
  if (alike !== undefined) return alike;
  const words = wanted.split(" ").filter((word) => word.length > 2);
  if (words.length === 0) return null;
  const containing = only(people.filter((person) => {
    const theirs = new Set(normalizeName(person.name).split(" "));
    return words.every((word) => theirs.has(word));
  }));
  return containing ?? null;
}
