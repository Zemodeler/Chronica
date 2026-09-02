import { z } from "zod";
import { BasisPointsSchema, EntityIdSchema } from "../material-state";

// The province graph is the map (ADR-0015).
//
// Models generate graphs reliably and geometry badly, so adjacency is a
// relation rather than a question about pixels: "is Sicily adjacent to Africa"
// is an edge with crossing "strait". The consequences that matter here are that
// adjacency becomes validatable in code for free, and that the keyboard
// navigable view required by docs/10-accessibility.md *is* this model rendered
// directly rather than a parallel implementation that drifts.

export const CrossingTypeSchema = z.enum(["land", "river", "strait", "pass", "sea_lane"]);
export type CrossingType = z.infer<typeof CrossingTypeSchema>;

/** Focus / Near / Far. Deterministic snapshot state, not a rendering hint (docs/13). */
export const DetailTierSchema = z.enum(["focus", "near", "far"]);
export type DetailTier = z.infer<typeof DetailTierSchema>;

export const SettlementKindSchema = z.enum(["city", "town", "village", "fortress", "port"]);

export const SettlementSchema = z
  .object({
    id: EntityIdSchema,
    name: z.string().trim().min(1).max(120),
    kind: SettlementKindSchema,
    /** Redundant with province nesting; enables direct lookup without a province scan. */
    provinceId: EntityIdSchema,
    /** Explicit local control; a siege may change a city before its province changes hands. */
    controllerPolityId: EntityIdSchema.nullable().default(null),
    /** Relative size in scenario units. Populations are coarse on purpose. */
    size: z.number().int().nonnegative().safe(),
    fortificationLevel: z.number().int().min(0).max(10),
  })
  .strict();
export type Settlement = z.infer<typeof SettlementSchema>;

/**
 * Presentation-only geography (ADR-0015).
 *
 * The simulation reads none of it, and CI asserts that attaching it leaves
 * state_hash unchanged -- which is the property that made shipping a schematic
 * map first a safe decision rather than throwaway work.
 */
export const ProvinceGeoSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .strict();
export type ProvinceGeo = z.infer<typeof ProvinceGeoSchema>;

export const ProvinceSchema = z
  .object({
    id: EntityIdSchema,
    name: z.string().trim().min(1).max(120),
    /** What this place was called in other eras. Flavour and search, never identity. */
    formerNames: z.array(z.string().trim().min(1).max(120)),
    terrainId: EntityIdSchema,
    settlements: z.array(SettlementSchema),
    /** Null where no polity holds it -- unclaimed ground is a real state. */
    controllerPolityId: EntityIdSchema.nullable(),
    /** How firmly it is held. Control is a degree, not a flag. */
    controlFirmnessBps: BasisPointsSchema,
    tier: DetailTierSchema,
    geo: ProvinceGeoSchema.optional(),
  })
  .strict();
export type Province = z.infer<typeof ProvinceSchema>;

/**
 * One undirected adjacency, stored once in canonical orientation.
 *
 * docs/15-map.md requires adjacency symmetry to be asserted. Storing an edge
 * once, with `from` sorting before `to`, makes asymmetry unrepresentable rather
 * than merely detectable -- a generated map that claims A borders B but not B
 * borders A is normalised or rejected at the validation gate, and can never
 * reach a snapshot.
 */
export const ProvinceEdgeSchema = z
  .object({
    from: EntityIdSchema,
    to: EntityIdSchema,
    crossing: CrossingTypeSchema,
    /** Abstract distance units; movement time is a warfare rule over this. */
    distance: z.number().int().positive().max(10_000),
  })
  .strict();
export type ProvinceEdge = z.infer<typeof ProvinceEdgeSchema>;

/**
 * Minimal polity identity.
 *
 * The map needs it because docs/15 requires that no province be controlled by
 * an undeclared polity, and that every capital exists. Government form, estates
 * and offices attach in the government pass.
 */
export const PolitySchema = z
  .object({
    id: EntityIdSchema,
    name: z.string().trim().min(1).max(120),
    capitalSettlementId: EntityIdSchema.nullable(),
  })
  .strict();
export type Polity = z.infer<typeof PolitySchema>;

/**
 * A declared political tie at the start of a scenario.  It is intentionally
 * descriptive: resolution does not yet turn an alliance into automatic war
 * participation or movement rights.
 */
export const PolityRelationSchema = z
  .object({
    id: EntityIdSchema,
    kind: z.literal("alliance"),
    leaderPolityId: EntityIdSchema,
    memberPolityId: EntityIdSchema,
    sourceNote: z.string().trim().min(1).max(600),
  })
  .strict()
  .refine((relation) => relation.leaderPolityId !== relation.memberPolityId, {
    message: "A polity cannot form an alliance with itself.",
    path: ["memberPolityId"],
  });
export type PolityRelation = z.infer<typeof PolityRelationSchema>;

export const ProvinceGraphSchema = z
  .object({
    provinces: z.array(ProvinceSchema),
    edges: z.array(ProvinceEdgeSchema),
    polities: z.array(PolitySchema),
    politicalRelations: z.array(PolityRelationSchema).default([]),
  })
  .strict()
  .superRefine((graph, context) => {
    const polityIds = new Set(graph.polities.map((polity) => polity.id));
    const relationIds = new Set<string>();
    const relationPairs = new Set<string>();
    for (const [index, relation] of graph.politicalRelations.entries()) {
      if (relationIds.has(relation.id)) {
        context.addIssue({ code: "custom", path: ["politicalRelations", index, "id"], message: "A political relation id may be used only once." });
      }
      relationIds.add(relation.id);
      if (!polityIds.has(relation.leaderPolityId) || !polityIds.has(relation.memberPolityId)) {
        context.addIssue({ code: "custom", path: ["politicalRelations", index], message: "Political relations must reference declared polities." });
      }
      const pair = `${relation.kind}:${relation.leaderPolityId}:${relation.memberPolityId}`;
      if (relationPairs.has(pair)) {
        context.addIssue({ code: "custom", path: ["politicalRelations", index], message: "A political relation may be declared only once for a polity pair." });
      }
      relationPairs.add(pair);
    }
    const settlementIds = new Set<string>();
    for (const [provinceIndex, province] of graph.provinces.entries()) {
      for (const [settlementIndex, settlement] of province.settlements.entries()) {
        if (settlement.controllerPolityId !== null && !polityIds.has(settlement.controllerPolityId)) {
          context.addIssue({ code: "custom", path: ["provinces", provinceIndex, "settlements", settlementIndex, "controllerPolityId"], message: "A settlement controller must be a polity in the province graph." });
        }
        if (settlement.provinceId !== province.id) {
          context.addIssue({ code: "custom", path: ["provinces", provinceIndex, "settlements", settlementIndex, "provinceId"], message: "A settlement's provinceId must match the province it is nested inside." });
        }
        if (settlementIds.has(settlement.id)) {
          context.addIssue({ code: "custom", path: ["provinces", provinceIndex, "settlements", settlementIndex, "id"], message: "A settlement id may be used only once across the province graph." });
        }
        settlementIds.add(settlement.id);
      }
    }
  });
export type ProvinceGraph = z.infer<typeof ProvinceGraphSchema>;

/**
 * Which crossings a terrain admits.
 *
 * Scenario data rather than a hardcoded table, for the same reason government
 * forms are: a period that models sea lanes and straits and one that models
 * mountain passes should not need different game code. An edge is legal only
 * when its crossing is admitted by the terrain on *both* sides.
 */
export const TerrainDefinitionSchema = z
  .object({
    id: EntityIdSchema,
    label: z.string().trim().min(1).max(80),
    allowedCrossings: z.array(CrossingTypeSchema).min(1),
    /** Water provinces carry no settlements and no controller. */
    water: z.boolean(),
  })
  .strict();
export type TerrainDefinition = z.infer<typeof TerrainDefinitionSchema>;

export const ScenarioMapRulesSchema = z
  .object({
    terrains: z.array(TerrainDefinitionSchema).min(1),
    /**
     * A model asked for "the Mediterranean" will otherwise cheerfully produce
     * four hundred provinces nobody will ever visit (docs/15-map.md).
     */
    provinceCount: z
      .object({
        min: z.number().int().positive().max(2_000),
        max: z.number().int().positive().max(2_000),
      })
      .strict()
      .refine((bounds) => bounds.max >= bounds.min, {
        message: "A scenario's maximum province count must be at least its minimum.",
        path: ["max"],
      }),
  })
  .strict();
export type ScenarioMapRules = z.infer<typeof ScenarioMapRulesSchema>;
