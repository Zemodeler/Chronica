import type { CanvasRegion } from "./canvas-world";

/**
 * How a declared character gets a place on a map of thousands of provinces.
 *
 * The model is never handed the province list: it sees a short menu of regions
 * and names a place in words. Code resolves the words against the province
 * index, and only a single match counts; a guess between two towns of the same
 * name is worse than asking the player which one.
 */
export type PlaceResolution =
  | Readonly<{ status: "found"; provinceId: string }>
  | Readonly<{ status: "ambiguous"; candidates: readonly string[] }>
  | Readonly<{ status: "unknown" }>;

export function normalisePlace(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** One line per region, largest first, with a few of its places so the model can tell regions apart. */
export function regionMenu(regions: readonly CanvasRegion[], maxLines = 60): string {
  if (regions.length === 0) return "No map regions are available.";
  const byRegion = new Map<string, string[]>();
  for (const region of regions) {
    const names = byRegion.get(region.region) ?? [];
    names.push(region.name);
    byRegion.set(region.region, names);
  }
  return [...byRegion.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, maxLines)
    .map(([label, names]) => `- ${label} (${names.length} places, such as ${[...names].sort((a, b) => a.localeCompare(b)).slice(0, 3).join(", ")})`)
    .join("\n");
}

type Index = Readonly<{
  byId: ReadonlyMap<string, CanvasRegion>;
  byName: ReadonlyMap<string, readonly CanvasRegion[]>;
  byAlias: ReadonlyMap<string, readonly CanvasRegion[]>;
  entries: readonly (readonly [string, CanvasRegion])[];
}>;

const indexes = new WeakMap<readonly CanvasRegion[], Index>();

function push(map: Map<string, CanvasRegion[]>, key: string, region: CanvasRegion): void {
  if (key === "") return;
  const list = map.get(key) ?? [];
  if (!list.includes(region)) list.push(region);
  map.set(key, list);
}

function indexOf(regions: readonly CanvasRegion[]): Index {
  const cached = indexes.get(regions);
  if (cached !== undefined) return cached;
  const byName = new Map<string, CanvasRegion[]>();
  const byAlias = new Map<string, CanvasRegion[]>();
  for (const region of regions) {
    push(byName, normalisePlace(region.name), region);
    for (const alias of region.aliases) push(byAlias, normalisePlace(alias), region);
  }
  const built: Index = {
    byId: new Map(regions.map((region) => [region.id, region])),
    byName,
    byAlias,
    entries: regions.map((region) => [normalisePlace(region.name), region] as const),
  };
  indexes.set(regions, built);
  return built;
}

function narrow(matches: readonly CanvasRegion[], qualifier: string): readonly CanvasRegion[] {
  if (qualifier === "") return matches;
  const said = matches.filter((match) => {
    const region = normalisePlace(match.region);
    return region.includes(qualifier) || qualifier.includes(region);
  });
  return said.length === 0 ? matches : said;
}

function verdict(matches: readonly CanvasRegion[]): PlaceResolution | null {
  if (matches.length === 1) return { status: "found", provinceId: matches[0]!.id };
  if (matches.length > 1) return { status: "ambiguous", candidates: matches.slice(0, 6).map((match) => `${match.name} (${match.region})`) };
  return null;
}

/**
 * "Massalia", "Massalia, Gaul", "Massalia (Gaul)" and "Massalia in Gaul" all
 * resolve; a name shared by several provinces resolves only when the region
 * the model added picks one.
 */
export function resolvePlace(regions: readonly CanvasRegion[], said: string): PlaceResolution {
  const index = indexOf(regions);
  const byId = index.byId.get(said.trim());
  if (byId !== undefined) return { status: "found", provinceId: byId.id };

  const parts = said.split(/,|\(|\)|;|\s+in\s+|\s+of\s+/i).map(normalisePlace).filter((part) => part !== "");
  const whole = normalisePlace(said);
  const head = parts[0] ?? whole;
  const qualifier = parts.slice(1).join(" ");
  if (head === "") return { status: "unknown" };

  let ambiguous: PlaceResolution | null = null;
  for (const [table, key] of [[index.byName, head], [index.byName, whole], [index.byAlias, head], [index.byAlias, whole]] as const) {
    const result = verdict(narrow(table.get(key) ?? [], qualifier));
    if (result?.status === "found") return result;
    ambiguous ??= result;
  }
  if (ambiguous !== null) return ambiguous;

  // Last resort: every word of what was said is a word of exactly one name.
  const words = head.split(" ");
  const partial = index.entries.filter(([name]) => {
    const own = name.split(" ");
    return words.every((word) => own.includes(word));
  }).map(([, region]) => region);
  return verdict(narrow(partial, qualifier)) ?? { status: "unknown" };
}
