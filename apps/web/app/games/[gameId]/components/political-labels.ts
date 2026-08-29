import type { DynamicMapOverlay, GeoJsonGeometry, GeoJsonMap, GeoJsonMapFeature, GeoJsonPosition } from "@chronica/shared";

export interface PoliticalLabel {
  readonly polityId: string;
  readonly name: string;
  readonly coordinate: GeoJsonPosition;
}

interface WeightedPoint {
  readonly coordinate: GeoJsonPosition;
  readonly weight: number;
}

function ringCentroid(ring: readonly GeoJsonPosition[]): WeightedPoint | null {
  let twiceArea = 0;
  let x = 0;
  let y = 0;

  for (let index = 0; index < ring.length - 1; index++) {
    const [x1, y1] = ring[index]!;
    const [x2, y2] = ring[index + 1]!;
    const cross = x1 * y2 - x2 * y1;
    twiceArea += cross;
    x += (x1 + x2) * cross;
    y += (y1 + y2) * cross;
  }

  if (Math.abs(twiceArea) < Number.EPSILON) return null;
  return {
    coordinate: [x / (3 * twiceArea), y / (3 * twiceArea)],
    weight: Math.abs(twiceArea / 2),
  };
}

function polygonCentroid(polygon: readonly (readonly GeoJsonPosition[])[]): WeightedPoint | null {
  const exterior = ringCentroid(polygon[0] ?? []);
  if (!exterior) return null;
  let weight = exterior.weight;
  let x = exterior.coordinate[0] * exterior.weight;
  let y = exterior.coordinate[1] * exterior.weight;

  for (const hole of polygon.slice(1)) {
    const holeCentroid = ringCentroid(hole);
    if (!holeCentroid) continue;
    weight -= holeCentroid.weight;
    x -= holeCentroid.coordinate[0] * holeCentroid.weight;
    y -= holeCentroid.coordinate[1] * holeCentroid.weight;
  }

  return weight <= Number.EPSILON
    ? exterior
    : { coordinate: [x / weight, y / weight], weight };
}

function geometryCentroid(geometry: GeoJsonGeometry): WeightedPoint | null {
  const polygons = geometry.type === "Polygon"
    ? [geometry.coordinates]
    : geometry.type === "MultiPolygon"
      ? geometry.coordinates
      : [];
  let totalWeight = 0;
  let x = 0;
  let y = 0;

  for (const polygon of polygons) {
    const centroid = polygonCentroid(polygon);
    if (!centroid) continue;
    totalWeight += centroid.weight;
    x += centroid.coordinate[0] * centroid.weight;
    y += centroid.coordinate[1] * centroid.weight;
  }

  return totalWeight === 0
    ? null
    : { coordinate: [x / totalWeight, y / totalWeight], weight: totalWeight };
}

function pointInRing(point: GeoJsonPosition, ring: readonly GeoJsonPosition[]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [x, y] = ring[index]!;
    const [previousX, previousY] = ring[previous]!;
    const crosses = (y > point[1]) !== (previousY > point[1])
      && point[0] < ((previousX - x) * (point[1] - y)) / (previousY - y) + x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function geometryContains(geometry: GeoJsonGeometry, point: GeoJsonPosition): boolean {
  const polygons = geometry.type === "Polygon"
    ? [geometry.coordinates]
    : geometry.type === "MultiPolygon"
      ? geometry.coordinates
      : [];
  return polygons.some((polygon) => {
    const exterior = polygon[0];
    return exterior !== undefined
      && pointInRing(point, exterior)
      && !polygon.slice(1).some((hole) => pointInRing(point, hole));
  });
}

interface OwnedProvince {
  readonly feature: GeoJsonMapFeature;
  readonly centroid: WeightedPoint;
}

/** Creates visible political labels solely from the current province ownership overlay. */
export function derivePoliticalLabels(
  map: GeoJsonMap,
  overlay: DynamicMapOverlay | null,
): PoliticalLabel[] {
  if (!overlay) return [];

  const ownershipByProvince = new Map(
    overlay.provinces.flatMap((province) => province.controllerPolityId === null
      ? []
      : [[province.provinceId, province.controllerPolityId] as const]),
  );
  const names = new Map(overlay.polities.map((polity) => [polity.polityId, polity.name]));
  const ownedByPolity = new Map<string, OwnedProvince[]>();

  for (const feature of map.features) {
    if (feature.properties.kind !== "province") continue;
    const polityId = ownershipByProvince.get(feature.id);
    const centroid = geometryCentroid(feature.geometry);
    if (!polityId || !centroid) continue;
    const owned = ownedByPolity.get(polityId) ?? [];
    owned.push({ feature, centroid });
    ownedByPolity.set(polityId, owned);
  }

  return [...ownedByPolity.entries()].flatMap(([polityId, provinces]) => {
    const name = names.get(polityId);
    if (!name) return [];
    const totalWeight = provinces.reduce((sum, province) => sum + province.centroid.weight, 0);
    const candidate: GeoJsonPosition = [
      provinces.reduce((sum, province) => sum + province.centroid.coordinate[0] * province.centroid.weight, 0) / totalWeight,
      provinces.reduce((sum, province) => sum + province.centroid.coordinate[1] * province.centroid.weight, 0) / totalWeight,
    ];
    const coordinate = provinces.some((province) => geometryContains(province.feature.geometry, candidate))
      ? candidate
      : [...provinces].sort((first, second) => second.centroid.weight - first.centroid.weight)[0]!.centroid.coordinate;
    return [{ polityId, name, coordinate }];
  });
}
