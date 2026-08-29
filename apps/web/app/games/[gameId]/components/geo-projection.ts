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

function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  }
  return h >>> 0;
}

export function polityColorFromId(polityId: string): string {
  const h = hashString(polityId);
  const hue = h % 360;
  const sat = 40 + (h >> 9) % 25;
  const lit = 35 + (h >> 14) % 20;
  return `hsl(${hue} ${sat}% ${lit}%)`;
}

export function polityColorWithAlpha(polityId: string, alpha: number): string {
  const h = hashString(polityId);
  const hue = h % 360;
  const sat = 40 + (h >> 9) % 25;
  const lit = 35 + (h >> 14) % 20;
  return `hsl(${hue} ${sat}% ${lit}% / ${alpha})`;
}
