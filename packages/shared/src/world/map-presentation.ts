import { z } from "zod";
import { BasisPointsSchema, EntityIdSchema } from "../material-state";
import { GeoJsonPositionSchema } from "./geojson";
import { DetailTierSchema, SettlementKindSchema } from "./map";

const MapColourSchema = z.string().regex(/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/, "Map colours must be six- or eight-digit hex values.");
const ZoomSchema = z.number().finite().min(0).max(32);

export const MapTerrainCategorySchema = z.enum([
  "farmland",
  "grassland",
  "forest",
  "hills",
  "mountains",
  "desert",
  "dryland",
  "wetland",
  "snow",
  "steppe",
  "water",
  "custom",
]);
export type MapTerrainCategory = z.infer<typeof MapTerrainCategorySchema>;

export const MapTerrainVisualStyleSchema = z.object({
  category: MapTerrainCategorySchema,
  baseColour: MapColourSchema,
  textureAssetId: EntityIdSchema.optional(),
  textureOpacityBps: BasisPointsSchema,
  reliefOpacityBps: BasisPointsSchema,
}).strict();
export type MapTerrainVisualStyle = z.infer<typeof MapTerrainVisualStyleSchema>;

export const MapPolityVisualStyleSchema = z.object({
  colour: MapColourSchema,
  patternId: EntityIdSchema.optional(),
}).strict();
export type MapPolityVisualStyle = z.infer<typeof MapPolityVisualStyleSchema>;

export const MapBorderStyleSchema = z.object({
  colour: MapColourSchema,
  width: z.number().finite().positive().max(24),
  opacityBps: BasisPointsSchema,
  dash: z.array(z.number().finite().positive().max(100)).max(8).optional(),
}).strict();
export type MapBorderStyle = z.infer<typeof MapBorderStyleSchema>;

export const MapZoomRulesSchema = z.object({
  minZoom: ZoomSchema,
  maxZoom: ZoomSchema,
  mediumStartsAt: ZoomSchema,
  closeStartsAt: ZoomSchema,
  politicalOpacityBps: z.object({
    far: BasisPointsSchema,
    medium: BasisPointsSchema,
    close: BasisPointsSchema,
  }).strict(),
  minorRoadMinZoom: ZoomSchema,
  minorSettlementMinZoom: ZoomSchema,
  minorBorderMinZoom: ZoomSchema,
}).strict().superRefine((rules, context) => {
  if (!(rules.minZoom < rules.mediumStartsAt && rules.mediumStartsAt < rules.closeStartsAt && rules.closeStartsAt <= rules.maxZoom)) {
    context.addIssue({ code: "custom", message: "Map zoom bands must be ordered min < medium < close <= max." });
  }
  const { close, medium, far } = rules.politicalOpacityBps;
  if (!(close <= medium && medium <= far)) {
    context.addIssue({ code: "custom", path: ["politicalOpacityBps"], message: "Political opacity must not decrease as the map zooms out." });
  }
});
export type MapZoomRules = z.infer<typeof MapZoomRulesSchema>;

export const MapLabelKindSchema = z.enum(["settlement", "province", "region", "realm", "sea", "geographic_feature"]);
export const MapLabelRuleSchema = z.object({
  kind: MapLabelKindSchema,
  minZoom: ZoomSchema,
  maxZoom: ZoomSchema,
  priority: z.number().int().min(0).max(1_000),
  textTransform: z.enum(["none", "uppercase"]),
}).strict().refine((rule) => rule.minZoom <= rule.maxZoom, {
  message: "A label's minimum zoom cannot exceed its maximum zoom.",
  path: ["maxZoom"],
});

export const MapSymbolVisualStyleSchema = z.object({
  symbolId: EntityIdSchema,
  minZoom: ZoomSchema,
  scale: z.number().finite().positive().max(8),
}).strict();

export const MapVisualConfigSchema = z.object({
  terrain: z.record(EntityIdSchema, MapTerrainVisualStyleSchema),
  polities: z.record(EntityIdSchema, MapPolityVisualStyleSchema),
  water: z.object({
    baseColour: MapColourSchema,
    textureAssetId: EntityIdSchema.optional(),
    textureOpacityBps: BasisPointsSchema,
  }).strict(),
  reliefAssetId: EntityIdSchema.optional(),
  zoom: MapZoomRulesSchema,
  borders: z.object({
    minor: MapBorderStyleSchema,
    regional: MapBorderStyleSchema,
    realm: MapBorderStyleSchema,
    hostile: MapBorderStyleSchema,
    selected: MapBorderStyleSchema,
    hovered: MapBorderStyleSchema,
  }).strict(),
  settlementSymbols: z.record(SettlementKindSchema, MapSymbolVisualStyleSchema),
  forceSymbol: MapSymbolVisualStyleSchema,
  labels: z.array(MapLabelRuleSchema),
}).strict();
export type MapVisualConfig = z.infer<typeof MapVisualConfigSchema>;

export const MapPoliticalOwnershipSchema = z.object({
  provinceId: EntityIdSchema,
  controllerPolityId: EntityIdSchema.nullable(),
  controlFirmnessBps: BasisPointsSchema,
}).strict();
export type MapPoliticalOwnership = z.infer<typeof MapPoliticalOwnershipSchema>;

export const MapProvinceOverlaySchema = MapPoliticalOwnershipSchema.extend({
  terrainId: EntityIdSchema,
  tier: DetailTierSchema,
}).strict();
export type MapProvinceOverlay = z.infer<typeof MapProvinceOverlaySchema>;

/** A player-visible polity name for presentation layers such as realm labels. */
export const MapPolityOverlaySchema = z.object({
  polityId: EntityIdSchema,
  name: z.string().trim().min(1).max(120),
}).strict();
export type MapPolityOverlay = z.infer<typeof MapPolityOverlaySchema>;

export const MapSettlementOverlaySchema = z.object({
  settlementId: EntityIdSchema,
  provinceId: EntityIdSchema,
  anchorFeatureId: EntityIdSchema,
  name: z.string().trim().min(1).max(120),
  kind: SettlementKindSchema,
  controllerPolityId: EntityIdSchema.nullable(),
  cultureStyleId: EntityIdSchema.optional(),
  importance: z.number().int().min(0).max(100),
}).strict();
export type MapSettlementOverlay = z.infer<typeof MapSettlementOverlaySchema>;

export const MapMovementOverlaySchema = z.object({
  start: GeoJsonPositionSchema,
  destination: GeoJsonPositionSchema,
  path: z.array(GeoJsonPositionSchema).min(2),
  progressBps: BasisPointsSchema,
  state: z.enum(["moving", "retreating"]),
}).strict();
export type MapMovementOverlay = z.infer<typeof MapMovementOverlaySchema>;

export const MapForceOverlaySchema = z.object({
  forceId: EntityIdSchema,
  provinceId: EntityIdSchema,
  coordinate: GeoJsonPositionSchema.optional(),
  ownerPolityId: EntityIdSchema,
  name: z.string().trim().min(1).max(120),
  commanderLabel: z.string().trim().min(1).max(160).nullable(),
  strengthLabel: z.string().trim().min(1).max(120),
  relation: z.enum(["friendly", "hostile", "neutral", "unknown"]),
  selected: z.boolean().default(false),
  movement: MapMovementOverlaySchema.nullable(),
}).strict();
export type MapForceOverlay = z.infer<typeof MapForceOverlaySchema>;

export const MapHostileBorderOverlaySchema = z.object({
  firstProvinceId: EntityIdSchema,
  secondProvinceId: EntityIdSchema,
  kind: z.enum(["hostile", "front"]),
}).strict().refine((border) => border.firstProvinceId !== border.secondProvinceId, {
  message: "A hostile border must join two different provinces.",
});

export const DynamicMapOverlaySchema = z.object({
  revision: z.number().int().nonnegative(),
  polities: z.array(MapPolityOverlaySchema).superRefine((polities, context) => {
    const ids = new Set<string>();
    for (const [index, polity] of polities.entries()) {
      if (ids.has(polity.polityId)) {
        context.addIssue({ code: "custom", path: [index, "polityId"], message: "A map overlay may name each polity only once." });
      }
      ids.add(polity.polityId);
    }
  }),
  provinces: z.array(MapProvinceOverlaySchema),
  settlements: z.array(MapSettlementOverlaySchema),
  forces: z.array(MapForceOverlaySchema),
  hostileBorders: z.array(MapHostileBorderOverlaySchema),
}).strict();
export type DynamicMapOverlay = z.infer<typeof DynamicMapOverlaySchema>;
