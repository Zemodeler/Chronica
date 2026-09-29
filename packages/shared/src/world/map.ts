import { z } from "zod";
import { GovernmentFormSchema } from "../political-parts";
import { BasisPointsSchema, ElapsedStepSchema, EntityIdSchema } from "../material-state";
import { AdministrationRecordSchema, ClaimRecordSchema, ControlRecordSchema, OccupationRecordSchema } from "./authority-records";

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
 * An intra-province operational position (docs/19 Phase 3): where in a
 * province a force actually stands, distinct from the province itself. See
 * `warfare/position.ts` for assignment logic and the deterministic fallback
 * used when a province declares none.
 */
export const PositionTypeSchema = z.enum([
  "settlement",
  "outskirts",
  "camp",
  "pass",
  "road_approach",
  "river_crossing",
  "coast",
  "harbour",
  "siege_line",
  "battlefield",
  "interior",
]);
export type PositionType = z.infer<typeof PositionTypeSchema>;

export const PositionSchema = z
  .object({
    id: EntityIdSchema,
    provinceId: EntityIdSchema,
    label: z.string().trim().min(1).max(120),
    type: PositionTypeSchema,
    /** Signed basis points: a defensive edge (siege_line, pass) is positive; an exposed one (coast) may be negative. */
    combatModifierBps: z.number().int().min(-2_000).max(2_000).default(0),
    /** How many forces can hold this position at once meaningfully; null = unbounded (an open interior). */
    capacity: z.number().int().positive().nullable().default(null),
  })
  .strict();
export type Position = z.infer<typeof PositionSchema>;

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
    /**
     * Who held it last, and when they lost it, where it was taken in war: what
     * a beaten power means to take back. The Mamertines lost Messana and went
     * on "provisioning" it; Syracuse, at war with its new master, was never
     * told there was a city to retake.
     */
    lostBy: z.object({ polityId: EntityIdSchema, atStep: ElapsedStepSchema }).strict().nullable().optional(),
    /**
     * Whom its people want to belong to instead, and how much: ground handed
     * over by surrender or treaty keeps its old loyalty, and it grows under a
     * loose hold and hard times until, at 10 000, they rise for it
     * (`sim/polity-end.ts`). A power that submitted is not a power that
     * agreed; the Samnites rose three times.
     */
    yearning: z.object({ polityId: EntityIdSchema, bps: BasisPointsSchema, updatedAtStep: ElapsedStepSchema.default(0) }).strict().nullable().optional(),
    /**
     * Whether it is fully simulated is read from the world, not stored
     * (`liveProvinceIds`). Kept only so worlds and scenarios written with it
     * still parse; nothing reads it.
     */
    /** Its ground in square kilometres, where the map states it; the countryside is counted from it (`peopleOf`). */
    areaKm2: z.number().positive().finite().optional(),
    geo: ProvinceGeoSchema.optional(),
    /** Scenario-authored operational positions; omit to use the deterministic fallback (`warfare/position.ts`). */
    positions: z.array(PositionSchema).optional(),
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
    /**
     * How far this power acts as one thing.
     *
     * Rome answers as a state: one Senate decides and the provinces follow. The
     * Boii answer as forty chieftains who happen to share a name, and an
     * agreement struck with one of them binds nobody else. Both were modelled
     * identically -- as a polity with a capital and a foreign policy -- so a
     * confederation of tribes behaved like a republic with a chancellery.
     *
     * 10 000 is a state whose centre speaks for the whole; 2 000 is a name on a
     * map that a dozen peoples are filed under. It is read where the difference
     * actually shows: who answers for the power, what they believe they answer
     * for, and how firmly its ground can be held once taken.
     *
     * Defaulted rather than required, so a scenario written before this existed
     * keeps working and simply describes states -- which is what it meant.
     */
    cohesionBps: BasisPointsSchema.default(7_000),
    /**
     * What this power pays its soldiers: coin a month for every thousand men.
     *
     * An army's pay is a flat line in the books, and whoever raised new men
     * had only the treasury's totals to price them from, so every new legion's
     * wage was a guess. Null where the scenario says nothing.
     */
    soldierPayPerThousand: z.number().int().nonnegative().nullable().default(null),
    /**
     * The seed of its constitution: what sort of government it had when the
     * world first met it. Only the seed -- the parts it grows into are its
     * chambers, offices and succession rules, and those change by law and by
     * force (`sim/constitutions.ts`). Null is read from its cohesion.
     */
    governmentForm: GovernmentFormSchema.nullable().optional(),
    /**
     * The day it ceased to be, and how: given up to a victor by surrender
     * ("absorbed", into `absorbedByPolityId`), or gone with nothing left to it
     * ("extinct"). Nothing ever ended a power: the Mamertines lost Messana and
     * their only province and went on declaring wars and writing letters.
     * A power that has ended can be restored by a rising (`sim/polity-end.ts`).
     */
    endedAtStep: ElapsedStepSchema.nullable().optional(),
    endedHow: z.enum(["absorbed", "extinct"]).nullable().optional(),
    absorbedByPolityId: EntityIdSchema.nullable().optional(),
    /** Since when it has held no ground: a power with no ground and no army ends. */
    landlessSinceStep: ElapsedStepSchema.nullable().optional(),
  })
  .strict();
export type Polity = z.infer<typeof PolitySchema>;

/** Whether a power still exists. */
export const isStanding = (polity: Pick<Polity, "endedAtStep">): boolean => polity.endedAtStep == null;

/** In words, for a prompt: how far a power's centre speaks for the whole of it. */
export function cohesionInWords(cohesionBps: number): string {
  if (cohesionBps >= 7_000) return "acts as one state";
  if (cohesionBps >= 4_500) return "acts together, loosely";
  if (cohesionBps >= 2_500) return "acts as a confederation whose parts often go their own way";
  return "is a name on the map; each place in it answers for itself";
}

/** Below this, a power has no centre that can bind the rest of it. */
export const LOOSE_COHESION_BPS = 4_500;


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
    // docs/32, Part C.4: control/claim/occupation/administration as four
    // independent record kinds. Defaulted so archived snapshots (none of
    // which ever populated these) load cleanly; `seedControlRecordsFromCache`
    // backfills `controlRecords` from the cached `controllerPolityId` fields
    // the first time such a snapshot is resolved.
    controlRecords: z.array(ControlRecordSchema).default([]),
    claimRecords: z.array(ClaimRecordSchema).default([]),
    occupationRecords: z.array(OccupationRecordSchema).default([]),
    administrationRecords: z.array(AdministrationRecordSchema).default([]),
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
    // docs/32, Part C.4: control is a single fact at a time; a claim is not.
    const activeControlKeys = new Set<string>();
    graph.controlRecords.forEach((record, index) => {
      if (record.status !== "active") return;
      const key = `${record.locationKind}:${record.locationId}`;
      if (activeControlKeys.has(key)) {
        context.addIssue({ code: "custom", path: ["controlRecords", index], message: "At most one control record may be active at a location at a time." });
      }
      activeControlKeys.add(key);
      if (!polityIds.has(record.controllerPolityId)) {
        context.addIssue({ code: "custom", path: ["controlRecords", index, "controllerPolityId"], message: "A control record's controller must be a declared polity." });
      }
    });
    graph.claimRecords.forEach((record, index) => {
      if (!polityIds.has(record.claimantPolityId)) {
        context.addIssue({ code: "custom", path: ["claimRecords", index, "claimantPolityId"], message: "A claim record's claimant must be a declared polity." });
      }
    });
    const activeOccupationKeys = new Set<string>();
    graph.occupationRecords.forEach((record, index) => {
      if (record.status !== "active") return;
      const key = `${record.locationKind}:${record.locationId}`;
      if (activeOccupationKeys.has(key)) {
        context.addIssue({ code: "custom", path: ["occupationRecords", index], message: "At most one occupation record may be active at a location at a time." });
      }
      activeOccupationKeys.add(key);
      if (!polityIds.has(record.occupyingPolityId)) {
        context.addIssue({ code: "custom", path: ["occupationRecords", index, "occupyingPolityId"], message: "An occupation record's occupier must be a declared polity." });
      }
    });
    const activeAdministrationKeys = new Set<string>();
    graph.administrationRecords.forEach((record, index) => {
      if (record.status !== "active") return;
      const key = `${record.locationKind}:${record.locationId}`;
      if (activeAdministrationKeys.has(key)) {
        context.addIssue({ code: "custom", path: ["administrationRecords", index], message: "At most one administration record may be active at a location at a time." });
      }
      activeAdministrationKeys.add(key);
      if (!polityIds.has(record.administeringPolityId)) {
        context.addIssue({ code: "custom", path: ["administrationRecords", index, "administeringPolityId"], message: "An administration record's administrator must be a declared polity." });
      }
    });
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
        min: z.number().int().positive().max(6_000),
        max: z.number().int().positive().max(6_000),
      })
      .strict()
      .refine((bounds) => bounds.max >= bounds.min, {
        message: "A scenario's maximum province count must be at least its minimum.",
        path: ["max"],
      }),
  })
  .strict();
export type ScenarioMapRules = z.infer<typeof ScenarioMapRulesSchema>;
