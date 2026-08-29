import { z } from "zod";
import { EntityIdSchema } from "../material-state";

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

export const SettlementTypeSchema = z.enum(["capital", "city", "town", "village", "fort", "port"]);
export type SettlementType = z.infer<typeof SettlementTypeSchema>;

export const GeoJsonProvincePropertiesSchema = z.object({
  kind: z.literal("province"),
  name: z.string().trim().min(1).max(120),
  terrain: z.string().trim().min(1).max(120).optional(),
  regionId: EntityIdSchema.optional(),
}).strict();

export const GeoJsonSettlementPropertiesSchema = z.object({
  kind: z.literal("settlement"),
  name: z.string().trim().min(1).max(120),
  provinceId: EntityIdSchema,
  type: SettlementTypeSchema,
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
  GeoJsonProvincePropertiesSchema,
  GeoJsonSettlementPropertiesSchema,
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
  const expected = feature.properties.kind === "province"
    ? ["Polygon", "MultiPolygon"]
    : feature.properties.kind === "settlement"
      ? ["Point"]
      : ["LineString", "MultiLineString"];
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
  const provinces = new Set(map.features.filter((feature) => feature.properties.kind === "province").map((feature) => feature.id));
  for (const [index, feature] of map.features.entries()) {
    if (ids.has(feature.id)) context.addIssue({ code: "custom", path: ["features", index, "id"], message: "Feature ids must be unique." });
    ids.add(feature.id);
    const provinceId = "provinceId" in feature.properties ? feature.properties.provinceId : undefined;
    if (provinceId !== undefined && !provinces.has(provinceId)) context.addIssue({ code: "custom", path: ["features", index, "properties", "provinceId"], message: "Settlement features must reference a province." });
  }
});
export type GeoJsonMap = z.infer<typeof GeoJsonMapSchema>;
