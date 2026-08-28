import { z } from "zod";
import { ElapsedStepSchema, MaterialWorldStateSchema } from "../material-state";
import { OngoingActionSchema } from "../actions/orders";
import { CharacterSchema } from "../characters/character";
import { CharacterContinuitySchema, EncounterMemorySchema } from "../continuity/continuity";
import { WorldPinsSchema } from "./clock";
import { ProvinceGraphSchema } from "./map";
import { WorldStorylineSchema } from "./storylines";

/**
 * Bumped when an old snapshot needs upgrading on load.
 *
 * docs/03-data-model.md: because snapshots are versioned documents, a schema
 * change does not require rewriting history -- bump this and teach the reader
 * to upgrade old documents.
 */
export const WORLD_SCHEMA_VERSION = 1;

/**
 * The authoritative world: one immutable document per turn, hashed to
 * state_hash (ADR-0002).
 *
 * The scenario *definition* is deliberately not in here. It is an argument to
 * resolution, pinned by version in `pins`, so the snapshot carries what the
 * match changed rather than a copy of what it started from.
 *
 * This is the spine. Provinces, characters and polities attach to it as their
 * own systems are built; putting placeholder shapes here now would only mean
 * rewriting them before anything reads them.
 */
export const WorldStateSchema = z
  .object({
    schemaVersion: z.literal(WORLD_SCHEMA_VERSION),
    pins: WorldPinsSchema,
    /**
     * Non-negative elapsed simulation time. The only clock the world has.
     * It lives here rather than on any subsystem, so every scheduled system
     * reads one value and a replay stops at one step.
     */
    elapsedStep: ElapsedStepSchema,
    /**
     * The province graph is the map (ADR-0015). Detail tiers live on the
     * provinces because they are state the simulation mutates deterministically,
     * so they must be inside the thing the determinism test hashes.
     */
    map: ProvinceGraphSchema,
    /**
     * Work in progress, as authoritative state rather than a relational job
     * queue (docs/03). It lives in the snapshot because an interruption must
     * not change it: the same actions, progress and waiting reasons have to
     * come back out of a replay.
     */
    actions: z.array(OngoingActionSchema),
    /** Everyone the world currently holds as an individual, players included. */
    characters: z.array(CharacterSchema),
    /**
     * Continuity and its encounter ledger, in the snapshot rather than a
     * relational table (docs/03). No product query justifies a second source of
     * truth for who remembers whom, and putting it here is what makes the
     * determinism test cover it.
     */
    continuity: z.array(CharacterContinuitySchema),
    encounters: z.array(EncounterMemorySchema),
    /** Active 1.0 world threads. Optional keeps archived snapshots readable. */
    storylines: z.array(WorldStorylineSchema).optional(),
    material: MaterialWorldStateSchema,
  })
  .strict();
export type WorldState = z.infer<typeof WorldStateSchema>;
