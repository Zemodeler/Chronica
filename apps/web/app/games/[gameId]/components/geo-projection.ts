import type { GeoJsonGeometry, GeoJsonMap, GeoJsonPosition } from "@chronica/shared";

export function projectCoordinate(lon: number, lat: number): [number, number] {
  return [lon, -lat];
}

function ringToPath(ring: readonly GeoJsonPosition[]): string {
  const parts: string[] = [];
  for (let i = 0; i < ring.length; i++) {
    const [x, y] = projectCoordinate(ring[i]![0], ring[i]![1]);
    parts.push(i === 0 ? `M${x} ${y}` : `L${x} ${y}`);
  }
  parts.push("Z");
  return parts.join("");
}

export function geometryToSvgPath(geometry: GeoJsonGeometry): string {
  switch (geometry.type) {
    case "Polygon":
      return geometry.coordinates.map(ringToPath).join("");
    case "MultiPolygon":
      return geometry.coordinates
        .flatMap((polygon) => polygon.map(ringToPath))
        .join("");
    case "LineString": {
      const coords = geometry.coordinates;
      return coords
        .map((pos, i) => {
          const [x, y] = projectCoordinate(pos[0], pos[1]);
          return i === 0 ? `M${x} ${y}` : `L${x} ${y}`;
        })
        .join("");
    }
    case "MultiLineString":
      return geometry.coordinates
        .map((line) =>
          line
            .map((pos, i) => {
              const [x, y] = projectCoordinate(pos[0], pos[1]);
              return i === 0 ? `M${x} ${y}` : `L${x} ${y}`;
            })
            .join(""),
        )
        .join("");
    case "Point":
      return "";
  }
}

export function computeViewBox(map: GeoJsonMap): string {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  function visitPosition(pos: GeoJsonPosition) {
    if (pos[0] < minLon) minLon = pos[0];
    if (pos[0] > maxLon) maxLon = pos[0];
    if (pos[1] < minLat) minLat = pos[1];
    if (pos[1] > maxLat) maxLat = pos[1];
  }

  function visitCoordinates(geometry: GeoJsonGeometry) {
    switch (geometry.type) {
      case "Point":
        visitPosition(geometry.coordinates);
        break;
      case "LineString":
        geometry.coordinates.forEach(visitPosition);
        break;
      case "MultiLineString":
        geometry.coordinates.forEach((line) => line.forEach(visitPosition));
        break;
      case "Polygon":
        geometry.coordinates.forEach((ring) => ring.forEach(visitPosition));
        break;
      case "MultiPolygon":
        geometry.coordinates.forEach((polygon) =>
          polygon.forEach((ring) => ring.forEach(visitPosition)),
        );
        break;
    }
  }

  for (const feature of map.features) {
    visitCoordinates(feature.geometry);
  }

  if (!isFinite(minLon)) return "-180 -90 360 180";

  const pad = Math.max((maxLon - minLon) * 0.02, (maxLat - minLat) * 0.02, 0.5);
  const x = minLon - pad;
  const y = -(maxLat + pad);
  const w = maxLon - minLon + pad * 2;
  const h = maxLat - minLat + pad * 2;
  return `${x} ${y} ${w} ${h}`;
}

/**
 * Political colours are intentionally assigned from a culture's material
 * palette, rather than from an unconstrained random hue.  Every palette is a
 * deliberately muted collection of pigments, dyes, metals, and heraldic
 * colours associated with that cultural sphere.  A polity chooses one
 * deterministically, then receives a very small stable variation.  This gives
 * related peoples a visual lineage while allowing any number of independent
 * polities to remain distinct.
 */
const HISTORICAL_POLITY_PALETTES = {
  // Moss, lichen, weathered stone, woad, and berry dyes.
  celtic: ["#4f8056", "#668a54", "#78945f", "#577866", "#6f8977", "#71865b", "#8b7654", "#7e5e70", "#8b5d66", "#687460", "#557168", "#8e8054", "#9a7160", "#647b84", "#7d704f", "#61845e"],
  // Pine, bark, iron, old leather, and subdued woad.
  germanic: ["#64764a", "#778457", "#5a704b", "#6e7d62", "#556d62", "#76714f", "#806b4b", "#705c4e", "#627481", "#5d6975", "#7c6659", "#7d805f", "#65715a", "#8a7958", "#596959", "#6e7451"],
  // Terracotta, olive, iron-rich earth, and dulled gold.
  iberian: ["#a8663d", "#a9563e", "#b27045", "#9a5f46", "#aa7b42", "#8e7147", "#73804a", "#86714e", "#8d5846", "#a47357", "#786653", "#b1844e", "#946343", "#786f5d", "#9d7750", "#895e4d"],
  // Republican red, olive, ochre, marble shadow, and umber.
  italic: ["#9a7043", "#a45842", "#ad6944", "#b17d48", "#8c673f", "#74814c", "#7a744d", "#796250", "#87594a", "#9c805b", "#6d725d", "#a77850", "#7e6251", "#9a734c", "#8a8059", "#a8634b"],
  // Aegean blues, bronze, olive, wine, and pale stone.
  hellenic: ["#4d7897", "#5f88a0", "#4f807f", "#688e8b", "#748151", "#8e7d4d", "#9a754e", "#775d73", "#8a6170", "#74808b", "#5b7189", "#a0855e", "#69795f", "#806c55", "#587e94", "#8b725b"],
  // Mountain greens, oxblood, bronze, charcoal, and river blue.
  balkan: ["#806b55", "#8d604d", "#965747", "#9a754d", "#7b7c56", "#63785c", "#5c7480", "#6f6680", "#7b625d", "#9a8059", "#686e61", "#8d714f", "#6f7b6b", "#805b52", "#738595", "#75654f"],
  // Tyrian dyes, ochre, desert stone, olive, and copper.
  northAfrican: ["#a77a4d", "#b18a50", "#a9624a", "#8d554e", "#674e72", "#785879", "#8e7044", "#9b8058", "#7c8054", "#6f7558", "#9a6543", "#a87852", "#846950", "#aa704c", "#766852", "#87604a"],
  // Alpine fir, slate, limestone, weathered red, and brass.
  alpine: ["#637450", "#70815a", "#577064", "#627a73", "#6e7780", "#777367", "#836d58", "#8c5f51", "#9b794e", "#8a815e", "#687560", "#766554", "#70838b", "#8e7658", "#5f6e69", "#927056"],
  // Red, white/silver (rendered as parchment), green, and Danubian blue.
  hungarian: ["#a34d45", "#b1584b", "#98584e", "#72834f", "#5f785b", "#6a8070", "#617f91", "#547486", "#b09a71", "#95815d", "#7e6653", "#8b594f", "#758967", "#a17755", "#68746a", "#9b6b50"],
  // Bohemian red, silver-as-parchment, dark blue, and forest green.
  czech: ["#a84f48", "#b65b51", "#95554e", "#657c91", "#527089", "#687f6a", "#78845d", "#a18d6d", "#897557", "#735e55", "#7b6374", "#8e5d58", "#668490", "#9b765b", "#667266", "#a46a55"],
  // Polish red, parchment, Baltic blue, pine, and muted gold.
  polish: ["#ad4d48", "#bb5a52", "#9c544f", "#a96a59", "#718696", "#5f7d8d", "#698160", "#778856", "#a18c62", "#8a7659", "#75645a", "#8a6376", "#8f5f54", "#718070", "#a57a5b", "#66736d"],
  // Used only when no cultural lineage is known; still deliberately subdued.
  neutral: ["#6c7470", "#727b76", "#687a78", "#7b786b", "#82745f", "#796758", "#81626a", "#6a7182", "#68766a", "#8a7f67", "#756d78", "#7c6d60", "#6e8181", "#85745f", "#737b65", "#766d64"],
} as const;

type HistoricalPolityFamily = keyof typeof HISTORICAL_POLITY_PALETTES;

function historicalFamilyForPolity(polityId: string): HistoricalPolityFamily {
  if (
    polityId.startsWith("gaul-")
    || polityId.startsWith("britain-")
    || polityId.startsWith("belgica-")
    || ["insubres", "boii", "cenomani", "helvetian-peoples", "transalpine-celts"].includes(polityId)
  ) return "celtic";
  if (polityId.startsWith("germania-") || polityId.startsWith("low-countries-")) return "germanic";
  if (polityId.startsWith("iberia-") || polityId === "lusitanians") return "iberian";
  if (polityId.startsWith("illyria-") || polityId.startsWith("thrace-") || polityId === "noric-communities") return "balkan";
  if (polityId === "ligurians") return "alpine";
  if (/(^|-)(hungary|hungarian|magyar|pannon|arpad)(-|$)/.test(polityId)) return "hungarian";
  if (/(^|-)(czech|bohemia|bohemian|moravia|moravian)(-|$)/.test(polityId)) return "czech";
  if (/(^|-)(poland|polish|piast|mazovia|mazovian|wielkopolska|pomerania|pomeranian)(-|$)/.test(polityId)) return "polish";
  if (["veneti", "etruscan-cities", "mamertines", "sabines", "umbrians", "picentes", "marsi-paeligni", "campanians", "samnites", "daunians", "peucetians", "messapians", "tarentines", "lucanians", "bruttians", "rhegines"].includes(polityId)) return "italic";
  if (["athens", "achaean-league", "aetolian-league", "thessalian-league", "hellenic-islanders", "epirus"].includes(polityId)) return "hellenic";
  if (["mauretanian-peoples", "numidian-kingdoms", "gaetuli", "garamantes"].includes(polityId)) return "northAfrican";
  return "neutral";
}

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  return hash >>> 0;
}

function hexToHsl(hex: string): readonly [number, number, number] {
  const channels = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset + 1, offset + 3), 16) / 255);
  const max = Math.max(...channels);
  const min = Math.min(...channels);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness * 100];
  const delta = max - min;
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  const [red, green, blue] = channels as [number, number, number];
  const hue = max === red ? 60 * (((green - blue) / delta) % 6) : max === green ? 60 * ((blue - red) / delta + 2) : 60 * ((red - green) / delta + 4);
  return [(hue + 360) % 360, saturation * 100, lightness * 100];
}

function historicalColourForPolity(polityId: string): string {
  const palette = HISTORICAL_POLITY_PALETTES[historicalFamilyForPolity(polityId)];
  const hash = hashString(polityId);
  const base = palette[hash % palette.length]!;
  const [baseHue, baseSaturation, baseLightness] = hexToHsl(base);
  // The 16 curated swatches provide the cultural character. Fine-grained,
  // stable variations supply effectively unbounded shades without drifting
  // into neon colours or a different culture's hue range.
  const hue = (baseHue + ((hash >>> 8) & 0xff) / 255 * 8 - 4 + 360) % 360;
  const saturation = Math.max(34, Math.min(65, baseSaturation + ((hash >>> 16) & 0xff) / 255 * 6 - 3));
  const lightness = Math.max(36, Math.min(62, baseLightness + ((hash >>> 24) & 0xff) / 255 * 8 - 4));
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

export function polityColorFromId(polityId: string): string {
  return historicalColourForPolity(polityId);
}

export function polityColorWithAlpha(polityId: string, alpha: number): string {
  return historicalColourForPolity(polityId).replace(")", ` / ${alpha})`);
}
