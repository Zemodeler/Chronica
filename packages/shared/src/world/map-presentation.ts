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

/** Player-visible political context.  This remains descriptive until diplomacy rules consume it. */
export const MapPolityRelationOverlaySchema = z.object({
  id: EntityIdSchema,
  kind: z.literal("alliance"),
  leaderPolityId: EntityIdSchema,
  memberPolityId: EntityIdSchema,
  sourceNote: z.string().trim().min(1).max(600),
}).strict().refine((relation) => relation.leaderPolityId !== relation.memberPolityId, {
  path: ["memberPolityId"],
  message: "A map relation cannot point a polity at itself.",
});
export type MapPolityRelationOverlay = z.infer<typeof MapPolityRelationOverlaySchema>;

export const MapSettlementOverlaySchema = z.object({
  settlementId: EntityIdSchema,
  provinceId: EntityIdSchema,
  anchorFeatureId: EntityIdSchema,
  name: z.string().trim().min(1).max(120),
  kind: SettlementKindSchema,
  controllerPolityId: EntityIdSchema.nullable(),
  /** Present when this settlement is the named capital of the polity. */
  capitalPolityId: EntityIdSchema.nullable(),
  cultureStyleId: EntityIdSchema.optional(),
  importance: z.number().int().min(0).max(100),
  /** Current visual state derived from authoritative warfare state when available. */
  underSiege: z.boolean().default(false),
  damaged: z.boolean().default(false),
}).strict();
export type MapSettlementOverlay = z.infer<typeof MapSettlementOverlaySchema>;

export const MapMovementOverlaySchema = z.object({
  start: GeoJsonPositionSchema,
  destination: GeoJsonPositionSchema,
  path: z.array(GeoJsonPositionSchema).min(2),
  progressBps: BasisPointsSchema,
  state: z.enum(["moving", "retreating"]),
}).strict().superRefine((movement, context) => {
  const first = movement.path[0];
  const last = movement.path[movement.path.length - 1];
  if (first?.[0] !== movement.start[0] || first?.[1] !== movement.start[1]) {
    context.addIssue({ code: "custom", path: ["path", 0], message: "A movement path must begin at its start coordinate." });
  }
  if (last?.[0] !== movement.destination[0] || last?.[1] !== movement.destination[1]) {
    context.addIssue({ code: "custom", path: ["path", movement.path.length - 1], message: "A movement path must end at its destination coordinate." });
  }
});
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
  /** Optional scenario-catalogue standard displayed for this force. */
  flagAssetId: EntityIdSchema.optional(),
  selected: z.boolean().default(false),
  movement: MapMovementOverlaySchema.nullable(),
}).strict();
export type MapForceOverlay = z.infer<typeof MapForceOverlaySchema>;

const MapWarSchema = z.object({
  polityAId: EntityIdSchema,
  polityBId: EntityIdSchema,
}).strict().refine((war) => war.polityAId < war.polityBId, {
  message: "War polity IDs must be distinct and ordered.",
  path: ["polityBId"],
});

const MapBattleConflictSchema = z.object({
  battleId: EntityIdSchema,
  participantForceIds: z.array(EntityIdSchema).min(2),
}).strict();

const MapSiegeConflictSchema = z.object({
  settlementId: EntityIdSchema,
  invadingForceIds: z.array(EntityIdSchema).min(1),
  defendingForceIds: z.array(EntityIdSchema).default([]),
}).strict();

/** Persistent current warfare state rendered directly on the map. */
export const MapConflictsOverlaySchema = z.object({
  battles: z.array(MapBattleConflictSchema).default([]),
  sieges: z.array(MapSiegeConflictSchema).default([]),
  wars: z.array(MapWarSchema).default([]),
}).strict();
export type MapConflictsOverlay = z.infer<typeof MapConflictsOverlaySchema>;

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
  politicalRelations: z.array(MapPolityRelationOverlaySchema).default([]),
  provinces: z.array(MapProvinceOverlaySchema),
  settlements: z.array(MapSettlementOverlaySchema),
  forces: z.array(MapForceOverlaySchema),
  conflicts: MapConflictsOverlaySchema.default({ battles: [], sieges: [], wars: [] }),
}).strict().superRefine((overlay, context) => {
  const forceIds = new Set(overlay.forces.map((force) => force.forceId));
  const settlementIds = new Set(overlay.settlements.map((settlement) => settlement.settlementId));
  const polityIds = new Set(overlay.polities.map((polity) => polity.polityId));
  const battleIds = new Set<string>();
  const siegeSettlements = new Set<string>();
  const warPairs = new Set<string>();
  const relationIds = new Set<string>();
  const relationPairs = new Set<string>();

  for (const [index, relation] of overlay.politicalRelations.entries()) {
    if (relationIds.has(relation.id)) context.addIssue({ code: "custom", path: ["politicalRelations", index, "id"], message: "A map overlay may include each political relation only once." });
    relationIds.add(relation.id);
    if (!polityIds.has(relation.leaderPolityId) || !polityIds.has(relation.memberPolityId)) context.addIssue({ code: "custom", path: ["politicalRelations", index], message: "Political relation polities must be present in the map overlay." });
    const pair = `${relation.kind}:${relation.leaderPolityId}:${relation.memberPolityId}`;
    if (relationPairs.has(pair)) context.addIssue({ code: "custom", path: ["politicalRelations", index], message: "A map overlay may include each political relation only once for a polity pair." });
    relationPairs.add(pair);
  }

  for (const [index, battle] of overlay.conflicts.battles.entries()) {
    if (battleIds.has(battle.battleId)) context.addIssue({ code: "custom", path: ["conflicts", "battles", index, "battleId"], message: "A map overlay may include each battle only once." });
    battleIds.add(battle.battleId);
    for (const forceId of battle.participantForceIds) if (!forceIds.has(forceId)) context.addIssue({ code: "custom", path: ["conflicts", "battles", index], message: "A battle participant must be present in the map overlay." });
  }
  for (const [index, siege] of overlay.conflicts.sieges.entries()) {
    if (siegeSettlements.has(siege.settlementId)) context.addIssue({ code: "custom", path: ["conflicts", "sieges", index, "settlementId"], message: "A map overlay may include each besieged settlement only once." });
    siegeSettlements.add(siege.settlementId);
    if (!settlementIds.has(siege.settlementId)) context.addIssue({ code: "custom", path: ["conflicts", "sieges", index, "settlementId"], message: "A siege target must be present in the map overlay." });
    for (const forceId of [...siege.invadingForceIds, ...siege.defendingForceIds]) if (!forceIds.has(forceId)) context.addIssue({ code: "custom", path: ["conflicts", "sieges", index], message: "A siege participant must be present in the map overlay." });
  }
  for (const [index, war] of overlay.conflicts.wars.entries()) {
    const key = `${war.polityAId}:${war.polityBId}`;
    if (warPairs.has(key)) context.addIssue({ code: "custom", path: ["conflicts", "wars", index], message: "A map overlay may include each war only once." });
    warPairs.add(key);
    if (!polityIds.has(war.polityAId) || !polityIds.has(war.polityBId)) context.addIssue({ code: "custom", path: ["conflicts", "wars", index], message: "War polities must be present in the map overlay." });
  }
});
export type DynamicMapOverlay = z.infer<typeof DynamicMapOverlaySchema>;
