import type { WorldState } from "@chronica/shared";

/**
 * Provinces found by what they are called, not by the shape of their ids.
 *
 * Ids are short opaque strings on a map of thousands of provinces, so nothing
 * can be inferred from one; a model's words are matched against names,
 * former names and the towns inside. Built once per world and shared by the
 * slice (which names the places an order is about) and by reference repair
 * (which puts right an id written almost correctly).
 */

type Province = WorldState["map"]["provinces"][number];

/** Words that describe any place and so identify none: "the Nile delta" is not the Rhone's. */
export const GENERIC_PLACE_WORDS: ReadonlySet<string> = new Set([
  "punic", "delta", "coast", "coastal", "plain", "plains", "hill", "hills", "upland", "uplands", "highlands", "mountains", "mountain",
  "valley", "river", "mouth", "upper", "lower", "north", "south", "east", "west", "northern", "southern", "eastern", "western",
  "central", "district", "county", "municipality", "region", "lands", "terrace", "gate", "heights", "forest", "passes", "island", "islands",
]);

export interface PlaceIndex {
  readonly byId: ReadonlyMap<string, Province>;
  readonly provinceOfSettlement: ReadonlyMap<string, string>;
  /** Whole normalised names of provinces, their former names and their settlements. */
  readonly byName: ReadonlyMap<string, readonly string[]>;
  /** The place a province is named for and its towns, without the qualifier ("Panormus and the north-west" is Panormus). */
  readonly byPlaceWord: ReadonlyMap<string, readonly string[]>;
  /** Distinct significant words of province names, for a partial name written into an id. */
  readonly byToken: ReadonlyMap<string, readonly string[]>;
  /** Crossings out of each province with their map distance. */
  readonly links: ReadonlyMap<string, readonly { readonly to: string; readonly distance: number }[]>;
  readonly maxPhraseWords: number;
}

export function normalisePlaceName(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function add(map: Map<string, string[]>, key: string, provinceId: string): void {
  if (key === "") return;
  const ids = map.get(key);
  if (ids === undefined) map.set(key, [provinceId]);
  else if (!ids.includes(provinceId)) ids.push(provinceId);
}

const indexes = new WeakMap<WorldState["map"]["provinces"], { readonly edges: WorldState["map"]["edges"]; readonly index: PlaceIndex }>();

export function placeIndex(world: Pick<WorldState, "map">): PlaceIndex {
  const cached = indexes.get(world.map.provinces);
  if (cached !== undefined && cached.edges === world.map.edges) return cached.index;

  const byId = new Map<string, Province>();
  const provinceOfSettlement = new Map<string, string>();
  const byName = new Map<string, string[]>();
  const byPlaceWord = new Map<string, string[]>();
  const byToken = new Map<string, string[]>();
  let maxPhraseWords = 1;
  const phrase = (map: Map<string, string[]>, text: string, provinceId: string): void => {
    const normal = normalisePlaceName(text);
    if (normal.length < 4) return;
    maxPhraseWords = Math.max(maxPhraseWords, normal.split(" ").length);
    add(map, normal, provinceId);
  };

  for (const province of world.map.provinces) {
    byId.set(province.id, province);
    phrase(byName, province.name, province.id);
    for (const former of province.formerNames) phrase(byName, former, province.id);
    const first = province.name.toLowerCase().split(/\s+and\s+|,/)[0]!.trim();
    if (!GENERIC_PLACE_WORDS.has(normalisePlaceName(first))) phrase(byPlaceWord, first, province.id);
    for (const token of normalisePlaceName(province.name).split(" ")) {
      if (token.length >= 4 && !GENERIC_PLACE_WORDS.has(token)) add(byToken, token, province.id);
    }
    for (const settlement of province.settlements) {
      provinceOfSettlement.set(settlement.id, province.id);
      phrase(byName, settlement.name, province.id);
      if (!GENERIC_PLACE_WORDS.has(normalisePlaceName(settlement.name))) phrase(byPlaceWord, settlement.name, province.id);
    }
  }

  const links = new Map<string, { to: string; distance: number }[]>();
  const link = (from: string, to: string, distance: number): void => {
    const out = links.get(from);
    if (out === undefined) links.set(from, [{ to, distance }]);
    else out.push({ to, distance });
  };
  for (const edge of world.map.edges) {
    link(edge.from, edge.to, edge.distance);
    link(edge.to, edge.from, edge.distance);
  }

  const index: PlaceIndex = { byId, provinceOfSettlement, byName, byPlaceWord, byToken, links, maxPhraseWords: Math.min(maxPhraseWords, 6) };
  indexes.set(world.map.provinces, { edges: world.map.edges, index });
  return index;
}

/**
 * Every province a passage of prose names, in one pass over its words. The
 * name of a province, a former name of it, or the place it is named for or a
 * town inside it, whole words only.
 */
export function provincesNamedIn(index: PlaceIndex, text: string): Set<string> {
  const found = new Set<string>();
  const words = normalisePlaceName(text).split(" ").filter((word) => word !== "");
  for (let start = 0; start < words.length; start += 1) {
    let phrase = "";
    for (let length = 1; length <= index.maxPhraseWords && start + length <= words.length; length += 1) {
      phrase = length === 1 ? words[start]! : `${phrase} ${words[start + length - 1]!}`;
      for (const id of index.byName.get(phrase) ?? []) found.add(id);
      for (const id of index.byPlaceWord.get(phrase) ?? []) found.add(id);
    }
  }
  return found;
}

/** Provinces written into a string as an id: bare, in brackets, or trailing punctuation. */
export function provinceIdsIn(index: PlaceIndex, text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(/[A-Za-z0-9][A-Za-z0-9_.:-]*/g)) {
    const token = match[0].replace(/[.:_-]+$/, "");
    if (index.byId.has(token)) found.add(token);
  }
  return found;
}

/** The single province a written name means, or null where it means none or several. */
export function provinceNamedExactly(index: PlaceIndex, value: string): string | null {
  const wanted = normalisePlaceName(value);
  if (wanted.length < 4) return null;
  const whole = index.byName.get(wanted);
  if (whole?.length === 1) return whole[0]!;
  const named = index.byPlaceWord.get(wanted);
  return named?.length === 1 ? named[0]! : null;
}

/**
 * A province an invented id plainly names -- "samnium-hills" for Samnium --
 * from the significant words of four letters or more. Only a single match counts.
 */
export function provinceNamedByWords(index: PlaceIndex, value: string): string | null {
  const words = normalisePlaceName(value).split(" ").filter((word) => word.length >= 4 && !GENERIC_PLACE_WORDS.has(word));
  if (words.length === 0) return null;
  const hits = new Set<string>();
  for (const [token, ids] of index.byToken) {
    if (words.some((word) => token.startsWith(word) || word.startsWith(token))) for (const id of ids) hits.add(id);
    if (hits.size > 1) return null;
  }
  return hits.size === 1 ? [...hits][0]! : null;
}

/** Whether two provinces are the same or lie within `km` kilometres of each other by the crossings between them. */
export function withinKm(index: PlaceIndex, from: string, to: string, km: number): boolean {
  if (from === to) return true;
  const best = new Map<string, number>([[from, 0]]);
  const queue: [number, string][] = [[0, from]];
  while (queue.length > 0) {
    // Small searches: a scan for the nearest beats a heap.
    let nearest = 0;
    for (let at = 1; at < queue.length; at += 1) if (queue[at]![0] < queue[nearest]![0]) nearest = at;
    const [distance, id] = queue.splice(nearest, 1)[0]!;
    if (id === to) return true;
    if (distance > (best.get(id) ?? Infinity)) continue;
    for (const link of index.links.get(id) ?? []) {
      const total = distance + link.distance;
      if (total > km || total >= (best.get(link.to) ?? Infinity)) continue;
      best.set(link.to, total);
      queue.push([total, link.to]);
    }
  }
  return false;
}

/**
 * Map distance from the nearest of `sources` to every province they reach
 * (Dijkstra over the crossings). Provinces no crossing leads to are absent.
 */
export function distancesFrom(index: PlaceIndex, sources: Iterable<string>): Map<string, number> {
  const best = new Map<string, number>();
  const heap: [number, string][] = [];
  const push = (entry: [number, string]): void => {
    heap.push(entry);
    let at = heap.length - 1;
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (heap[parent]![0] <= heap[at]![0]) break;
      [heap[parent], heap[at]] = [heap[at]!, heap[parent]!];
      at = parent;
    }
  };
  const pop = (): [number, string] => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let at = 0;
      for (;;) {
        const left = 2 * at + 1;
        const right = left + 1;
        let smallest = at;
        if (left < heap.length && heap[left]![0] < heap[smallest]![0]) smallest = left;
        if (right < heap.length && heap[right]![0] < heap[smallest]![0]) smallest = right;
        if (smallest === at) break;
        [heap[smallest], heap[at]] = [heap[at]!, heap[smallest]!];
        at = smallest;
      }
    }
    return top;
  };
  for (const source of sources) {
    if (!index.byId.has(source)) continue;
    best.set(source, 0);
    push([0, source]);
  }
  while (heap.length > 0) {
    const [distance, id] = pop();
    if (distance > (best.get(id) ?? Infinity)) continue;
    for (const next of index.links.get(id) ?? []) {
      const through = distance + next.distance;
      if (through < (best.get(next.to) ?? Infinity)) {
        best.set(next.to, through);
        push([through, next.to]);
      }
    }
  }
  return best;
}
