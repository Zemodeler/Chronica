import { z } from "zod";
import { EntityIdSchema } from "../material-state";

// Level of detail (ADR-0017, docs/13-simulation-scope.md).
//
// "Detail follows attention": cost scales with what players are looking at, not
// with how big the world is. This is the mechanism that makes generated worlds
// affordable, and it is deterministic simulation state -- only the *content* of
// a promotion into Focus may ever involve a model.

/**
 * Which layer of the world a character operates on.
 *
 * Scope comes from station, not distance. A radius would be wrong: a chancellor
 * and a blacksmith standing in the same city inhabit different worlds, and a
 * villager who becomes a captain should stop seeing a valley and start seeing a
 * campaign. That promotion is content, not bookkeeping.
 */
export const ScopeLayerSchema = z.enum([
  /** Consul, chancellor: the polity's politics, its armies, its estates. */
  "polity",
  /** General on campaign: the theatre -- provinces, armies, supply, local rulers. */
  "theatre",
  /** Knight, officer: the retinue, the immediate front, the lord's court. */
  "retinue",
  /** Merchant: the nodes of a trade route, and the ports and guilds on it. */
  "route",
  /** Villager, artisan: the village and its valley, and the local lord's demands. */
  "locality",
]);
export type ScopeLayer = z.infer<typeof ScopeLayerSchema>;

export const CharacterScopeSchema = z
  .object({
    layer: ScopeLayerSchema,
    /** Where the character stands. Every layer expands outward from here. */
    anchorProvinceId: EntityIdSchema,
    /** The polity whose affairs they operate in, where they have one. */
    anchorPolityId: EntityIdSchema.nullable(),
    /**
     * How far across the layer they reach, in kilometres by the map's own
     * roads. A knight's front is a day or two's ride; a general's theatre is
     * several hundred.
     */
    reach: z.number().int().nonnegative().max(5_000),
    /** Route layer only: the nodes the character actually trades between. */
    routeProvinceIds: z.array(EntityIdSchema),
  })
  .strict();
export type CharacterScope = z.infer<typeof CharacterScopeSchema>;

/**
 * How much an event matters to someone. A weight, deliberately not a boolean.
 *
 * Salience is *not* visibility. Visibility answers "could this character know?"
 * -- a rule about information channels. Salience answers "does it matter to
 * them?". A world war is salient to a villager because it will take their sons;
 * a border skirmish on the far side of the world is salient to nobody, and is
 * never narrated to anyone.
 */
export const SalienceSchema = z.number().int().nonnegative().max(1_000);
export type Salience = z.infer<typeof SalienceSchema>;

/**
 * Who may *read* a chronicle entry. Independent of what any character knows.
 *
 * docs/03-data-model.md keeps these apart on purpose: an all_players entry is
 * readable by every human, but its visibility still governs which characters
 * learn the facts. The simulation, order assessment, adjudicator and dialogue
 * prompts never treat audience as a knowledge grant.
 */
export const ChronicleAudienceSchema = z.enum(["all_players", "knowledge_scoped"]);
export type ChronicleAudience = z.infer<typeof ChronicleAudienceSchema>;

export const PlayerInvolvementSchema = z
  .object({
    playerId: EntityIdSchema,
    characterId: EntityIdSchema,
    role: z.enum(["actor", "target", "materially_affected"]),
  })
  .strict();
export type PlayerInvolvement = z.infer<typeof PlayerInvolvementSchema>;
