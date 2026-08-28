import { z } from "zod";
import { BasisPointsSchema, EntityIdSchema } from "../material-state";
import { CrossingTypeSchema, DetailTierSchema, SettlementKindSchema } from "./map";

/**
 * The versioned, immutable geographic interchange format. Dynamic state is
 * joined by stable IDs through the map presentation overlay contracts.
 */
const LongitudeSchema = z.number().finite().min(-180).max(180);
const LatitudeSchema = z.number().finite().min(-90).max(90);
export const GeoJsonPositionSchema = z.tuple([LongitudeSchema, LatitudeSchema]);
export type GeoJsonPosition = z.infer<typeof GeoJsonPositionSchema>;

const LinearRingSchema = z.array(GeoJsonPositionSchema).min(4).superRefine((ring, context) => {
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first?.[0] !== last?.[0] || first?.[1] !== last?.[1]) {
    context.addIssue({ code: "custom", message: "Polygon rings must be closed." });
  }
});

const LineStringCoordinatesSchema = z.array(GeoJsonPositionSchema).min(2);

export const GeoJsonGeometrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Point"), coordinates: GeoJsonPositionSchema }).strict(),
  z.object({ type: z.literal("LineString"), coordinates: LineStringCoordinatesSchema }).strict(),
  z.object({ type: z.literal("MultiLineString"), coordinates: z.array(LineStringCoordinatesSchema).min(1) }).strict(),
  z.object({ type: z.literal("Polygon"), coordinates: z.array(LinearRingSchema).min(1) }).strict(),
  z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(z.array(LinearRingSchema).min(1)).min(1) }).strict(),
]);
export type GeoJsonGeometry = z.infer<typeof GeoJsonGeometrySchema>;

const NeighbourSchema = z.object({ regionId: EntityIdSchema, crossing: CrossingTypeSchema }).strict();

export const GeoJsonRegionPropertiesSchema = z.object({
  kind: z.literal("region"),
  name: z.string().trim().min(1).max(120),
  terrainId: EntityIdSchema,
  tier: DetailTierSchema,
  controllerPolityId: EntityIdSchema.nullable(),
  controlFirmnessBps: BasisPointsSchema,
  neighbours: z.array(NeighbourSchema),
}).strict();

export const GeoJsonCityPropertiesSchema = z.object({
  kind: z.literal("city"),
  name: z.string().trim().min(1).max(120),
  regionId: EntityIdSchema,
  controllerPolityId: EntityIdSchema.nullable(),
}).strict();

export const GeoJsonArmyPropertiesSchema = z.object({
  kind: z.literal("army"),
  name: z.string().trim().min(1).max(120),
  regionId: EntityIdSchema,
  controllerPolityId: EntityIdSchema.nullable(),
  strengthLabel: z.string().trim().min(1).max(120),
}).strict();

/**
 * Immutable settlement placement for a scenario. The settlement's mutable
 * controller and material state live in the world snapshot, keyed by settlementId.
 */
export const GeoJsonSettlementAnchorPropertiesSchema = z.object({
  kind: z.literal("settlement_anchor"),
  settlementId: EntityIdSchema,
  regionId: EntityIdSchema,
  name: z.string().trim().min(1).max(120),
  settlementKind: SettlementKindSchema,
  cultureStyleId: EntityIdSchema.optional(),
  importance: z.number().int().min(0).max(100).optional(),
}).strict();

export const RiverClassSchema = z.enum(["minor", "major", "navigable"]);
export type RiverClass = z.infer<typeof RiverClassSchema>;

export const GeoJsonRiverPropertiesSchema = z.object({
  kind: z.literal("river"),
  name: z.string().trim().min(1).max(120).optional(),
  class: RiverClassSchema,
}).strict();

export const RoadClassSchema = z.enum(["minor", "major", "roman", "trade_route"]);
export type RoadClass = z.infer<typeof RoadClassSchema>;

export const GeoJsonRoadPropertiesSchema = z.object({
  kind: z.literal("road"),
  name: z.string().trim().min(1).max(120).optional(),
  class: RoadClassSchema,
}).strict();

export const GeoJsonFeaturePropertiesSchema = z.discriminatedUnion("kind", [
  GeoJsonRegionPropertiesSchema,
  GeoJsonCityPropertiesSchema,
  GeoJsonArmyPropertiesSchema,
  GeoJsonSettlementAnchorPropertiesSchema,
  GeoJsonRiverPropertiesSchema,
  GeoJsonRoadPropertiesSchema,
]);
export type GeoJsonFeatureProperties = z.infer<typeof GeoJsonFeaturePropertiesSchema>;

export const GeoJsonMapFeatureSchema = z.object({
  type: z.literal("Feature"),
  id: EntityIdSchema,
  geometry: GeoJsonGeometrySchema,
  properties: GeoJsonFeaturePropertiesSchema,
}).strict().superRefine((feature, context) => {
  const expected = feature.properties.kind === "region"
    ? ["Polygon", "MultiPolygon"]
    : feature.properties.kind === "river" || feature.properties.kind === "road"
      ? ["LineString", "MultiLineString"]
      : ["Point"];
  if (!expected.includes(feature.geometry.type)) {
    context.addIssue({ code: "custom", message: `${feature.properties.kind} features have incompatible geometry.` });
  }
});
export type GeoJsonMapFeature = z.infer<typeof GeoJsonMapFeatureSchema>;

export const GeoJsonMapSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(GeoJsonMapFeatureSchema).min(1),
}).strict().superRefine((map, context) => {
  const ids = new Set<string>();
  const regions = new Set(map.features.filter((feature) => feature.properties.kind === "region").map((feature) => feature.id));
  for (const [index, feature] of map.features.entries()) {
    if (ids.has(feature.id)) context.addIssue({ code: "custom", path: ["features", index, "id"], message: "Feature ids must be unique." });
    ids.add(feature.id);
    const regionId = "regionId" in feature.properties ? feature.properties.regionId : undefined;
    if (regionId !== undefined && !regions.has(regionId)) context.addIssue({ code: "custom", path: ["features", index, "properties", "regionId"], message: "Point features must reference a region." });
    if (feature.properties.kind === "region") {
      for (const neighbour of feature.properties.neighbours) {
        if (!regions.has(neighbour.regionId) || neighbour.regionId === feature.id) context.addIssue({ code: "custom", path: ["features", index, "properties", "neighbours"], message: "Region neighbours must reference another region." });
      }
    }
  }
});
export type GeoJsonMap = z.infer<typeof GeoJsonMapSchema>;
