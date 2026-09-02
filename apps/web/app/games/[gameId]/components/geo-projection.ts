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
 * Political colours are intentionally assigned by cultural region, rather
 * than being derived from a polity ID. This keeps the map readable: related
 * peoples form a coherent visual area while the major states retain their
 * own presentation colours in political-geometry.ts.
 */
const HISTORICAL_POLITY_COLOURS = {
  celtic: "#4f8056",
  germanic: "#64764a",
  iberian: "#a8663d",
  italic: "#9a7043",
  hellenic: "#4d7897",
  balkan: "#806b55",
  northAfrican: "#a77a4d",
  alpine: "#637450",
  neutral: "#6c7470",
} as const;

type HistoricalPolityFamily = keyof typeof HISTORICAL_POLITY_COLOURS;

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
  const base = HISTORICAL_POLITY_COLOURS[historicalFamilyForPolity(polityId)];
  const [baseHue, baseSaturation, baseLightness] = hexToHsl(base);
  const hash = hashString(polityId);
  // Variations stay close to their cultural base, but give every polity a
  // stable individual shade rather than making a cultural group one block.
  const hue = (baseHue + hash / 0xffff_ffff * 60 - 30 + 360) % 360;
  const saturation = Math.max(48, Math.min(76, Math.max(60, baseSaturation + 40) + ((hash >>> 8) / 0xff_ffff) * 24 - 12));
  const lightness = Math.max(38, Math.min(58, Math.max(47, baseLightness + 7) + ((hash >>> 16) / 0xffff) * 20 - 10));
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

export function polityColorFromId(polityId: string): string {
  return historicalColourForPolity(polityId);
}

export function polityColorWithAlpha(polityId: string, alpha: number): string {
  return historicalColourForPolity(polityId).replace(")", ` / ${alpha})`);
}
