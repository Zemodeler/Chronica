import { z } from "zod";
import { ElapsedStepSchema, MaterialWorldStateSchema } from "../material-state";
import { OngoingActionSchema } from "../actions/orders";
import { PersistentOperationSchema } from "../actions/operations";
import { CharacterSchema } from "../characters/character";
import { CharacterContinuitySchema, EncounterMemorySchema } from "../continuity/continuity";
import { WorldPinsSchema, deriveWorldInstant, type ScenarioClock } from "./clock";
import { WorldInstantSchema } from "./instant";
import { AuthorityGrantSchema } from "../authority/authority-grant";
import { OrderAttemptSchema } from "../authority/order-attempt";
import { ProjectSchema } from "./project";
import { StructureSchema } from "./structure";
import { GenericEntitySchema } from "./generic-entity";
import { ProvinceGraphSchema } from "./map";
import { MapConflictsOverlaySchema } from "./map-presentation";
import { WorldStorylineSchema } from "./storylines";
import { CharacterGoalSchema, CharacterPlotSchema, NemesisStateSchema, DEFAULT_NEMESIS_STATE, NemesisEntrySchema, CharacterRelevanceEntrySchema } from "../character-agency/schemas";
import { ChronicleChainSchema } from "./chronicle-chains";
import { CharacterPressureSchema } from "../characters/pressures";
import { CharacterBeliefSchema } from "../characters/beliefs";
import { SocialLinkSchema } from "../characters/relationship-dimensions";
import { CommitmentSchema } from "../character-agency/commitments";
import { CharacterIntentSchema } from "../character-agency/intents";
import { FamilyLinkSchema, HouseholdSchema, LifeContractSchema } from "../characters/family";
import { LegacyCauseSchema } from "../continuity/continuity";
import { CampaignMemorySchema, EMPTY_CAMPAIGN_MEMORY } from "../gm/campaign-memory";
import { DiplomaticMessageSchema, PolityStanceSchema } from "./diplomacy";
import { WorldDevelopmentSchema } from "./developments";
import { PlayerPlanSchema, ActionPlanSchema } from "../actions/plans";
import { ActorActivitySchema } from "../actions/activity";

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
     * Minute-precision clock (docs/32 Phase 7 target architecture), additive
     * to `elapsedStep` -- see `world/instant.ts`'s module comment. Absent on
     * every snapshot predating the event queue; `upgradeWorldStateInstant`
     * fills it deterministically from `elapsedStep` on load. Once populated,
     * it is authoritative only *within* the current turn's resolution window;
     * `elapsedStep` still owns turn/snapshot identity.
     */
    instant: WorldInstantSchema.optional(),
    /** Optional for existing snapshots; the scheduler materializes it on first use. */
    worldDevelopments: z.array(WorldDevelopmentSchema).optional(),
    playerPlans: z.array(PlayerPlanSchema).optional(),
    /**
     * Universal plan model (docs/32, Phase 1): `ActionPlan`'s successor
     * collection to `playerPlans`, generalized to any actor. Optional and
     * unpopulated by the live pipeline for now -- `playerPlans` remains the
     * authoritative write path; `upgradePlayerPlansToActionPlans` (actions/plans.ts)
     * derives this view on demand rather than the schema deriving it on
     * every parse, so parsing an old snapshot stays a pure identity op.
     */
    plans: z.array(ActionPlanSchema).optional(),
    actorActivities: z.array(ActorActivitySchema).optional(),
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
    /**
     * Multi-turn efforts an `OngoingAction` opened (docs/14, Phase 1): moving
     * an army, a siege, a recruitment drive. Defaulted so archived snapshots
     * (none of which ever populated this) load cleanly.
     */
    operations: z.array(PersistentOperationSchema).default([]),
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
    /** Current authoritative combat, siege, and war state for map projection. */
    conflicts: MapConflictsOverlaySchema.default({ battles: [], sieges: [], wars: [] }),
    material: MaterialWorldStateSchema,
    // Character Director agency state. Defaulted so archived snapshots load cleanly.
    characterGoals: z.array(CharacterGoalSchema).default([]),
    characterPlots: z.array(CharacterPlotSchema).default([]),
    nemesis: NemesisStateSchema.default(DEFAULT_NEMESIS_STATE),
    // Multi-slot nemeses (new); old `nemesis` kept for backward compat.
    nemeses: z.array(NemesisEntrySchema).default([]),
    // Chronicle-weighted relevance entries for character selector.
    characterRelevance: z.array(CharacterRelevanceEntrySchema).default([]),
    // Active chronicle chains for the World Director to see open pressures.
    chronicleChains: z.array(ChronicleChainSchema).default([]),
    // Character-sim phase 2: canonical pressures, individually-owned beliefs,
    // and typed social links. Defaulted so archived snapshots load cleanly;
    // see packages/shared/src/characters/{pressures,beliefs,relationship-dimensions}.ts.
    characterPressures: z.array(CharacterPressureSchema).default([]),
    characterBeliefs: z.array(CharacterBeliefSchema).default([]),
    socialLinks: z.array(SocialLinkSchema).default([]),
    // Character-sim phase 3: canonical commitments and the concrete intents
    // characters form to fulfil/defer/break them or otherwise pursue an
    // active plot. Defaulted so archived snapshots load cleanly; see
    // packages/shared/src/character-agency/{commitments,intents}.ts.
    commitments: z.array(CommitmentSchema).default([]),
    characterIntents: z.array(CharacterIntentSchema).default([]),
    // Character-sim phase 5: canonical family/household graph, life
    // contracts, and activated legacy causes. Defaulted so archived snapshots
    // load cleanly; see packages/shared/src/characters/family.ts and
    // packages/shared/src/continuity/continuity.ts's LegacyCauseSchema.
    familyLinks: z.array(FamilyLinkSchema).default([]),
    households: z.array(HouseholdSchema).default([]),
    lifeContracts: z.array(LifeContractSchema).default([]),
    legacyCauses: z.array(LegacyCauseSchema).default([]),
    /**
     * Compact account of the turn that produced this snapshot.  It is kept in
     * the snapshot so the following turn's AI calls can use committed history
     * without having to reconstruct it from Chronicle projections.
     */
    lastTurnSummary: z.string().trim().min(1).max(1_800).nullable().default(null),
    /**
     * Compact campaign memory for the Game Master (GM refactor, requirement
     * 6). Derived from committed facts -- executed tool results and the
     * deterministic turn record -- never from Chronicle prose. Defaulted so
     * every archived snapshot, none of which carried this, still parses.
     */
    campaignMemory: CampaignMemorySchema.default(EMPTY_CAMPAIGN_MEMORY),
    /**
     * Standing diplomacy: every message one power has sent another, and how
     * it was answered. Defaulted so every snapshot written before diplomacy
     * existed still parses.
     */
    diplomacy: z.array(DiplomaticMessageSchema).default([]),
    /**
     * One power's accumulated trust toward another, nudged each time a
     * diplomatic message between them is answered. Distinct from a message
     * thread's own escalation count: this is the thing that persists once a
     * thread goes quiet, so a Game Master reading it turns later still sees
     * the weight of how the two powers have actually treated each other.
     * Defaulted so every snapshot written before this existed still parses.
     */
    polityStances: z.array(PolityStanceSchema).default([]),
    /**
     * docs/32 Phase 7: persisted `AuthorityGrant`s from sources with no other
     * live-state projection (delegation/custom/conquest/emergency/explicit
     * law) -- office- and command-derived grants are computed fresh from
     * `officeSeats`/`forces` by `buildAuthorityIndex`, never stored here.
     * Defaulted so every snapshot written before this existed still parses.
     */
    authorityGrants: z.array(AuthorityGrantSchema).default([]),
    /** docs/32 Phase 7: orders-to-others tracked through the attempt lifecycle -- see `authority/order-attempt.ts`. */
    orderAttempts: z.array(OrderAttemptSchema).default([]),
    /** docs/32, Part C.2: multi-turn sponsored efforts (an academy, a fortress) -- see `world/project.ts`. */
    projects: z.array(ProjectSchema).default([]),
    /** docs/32, Part C.2: built, standing structures a project (or a workflow) raises -- see `world/structure.ts`. */
    structures: z.array(StructureSchema).default([]),
    /** docs/32, Part C.1: the true generic fallback for a genuinely novel composition -- see `world/generic-entity.ts`. */
    genericEntities: z.array(GenericEntitySchema).default([]),
  })
  .strict()
  .superRefine((world, context) => {
    const characterIds = new Set(world.characters.map((c) => c.id));
    const requireCharacter = (id: string, path: (string | number)[], message: string) => {
      if (!characterIds.has(id)) context.addIssue({ code: "custom", path, message });
    };

    const seenActiveLinks = new Set<string>();
    world.familyLinks.forEach((link, index) => {
      requireCharacter(link.characterId, ["familyLinks", index, "characterId"], "A family link must reference an existing character.");
      requireCharacter(link.relatedCharacterId, ["familyLinks", index, "relatedCharacterId"], "A family link must reference an existing character.");
      if (link.characterId === link.relatedCharacterId) {
        context.addIssue({ code: "custom", path: ["familyLinks", index, "relatedCharacterId"], message: "A character cannot hold a family link to themselves." });
      }
      if (link.endedAtStep === null) {
        const key = `${link.characterId}:${link.relatedCharacterId}:${link.kind}`;
        if (seenActiveLinks.has(key)) {
          context.addIssue({ code: "custom", path: ["familyLinks", index], message: "Duplicate active family link of the same kind between the same two characters." });
        }
        seenActiveLinks.add(key);
        // The one impossible case this guards: a direct two-node cycle, e.g.
        // A parent-of B and B parent-of A simultaneously active. Deeper
        // n-node cycles are out of scope -- named-character family ties stay
        // bounded, not an exhaustively-validated tree.
        if (link.kind === "parent") {
          const reverseKey = `${link.relatedCharacterId}:${link.characterId}:parent`;
          if (seenActiveLinks.has(reverseKey)) {
            context.addIssue({ code: "custom", path: ["familyLinks", index], message: "A parent/child relationship cannot run in both directions between the same two characters." });
          }
        }
      }
    });

    world.households.forEach((household, index) => {
      if (household.headCharacterId !== null) {
        requireCharacter(household.headCharacterId, ["households", index, "headCharacterId"], "A household's head must reference an existing character.");
      }
    });

    world.lifeContracts.forEach((contract, index) => {
      contract.partyCharacterIds.forEach((partyId, partyIndex) => {
        requireCharacter(partyId, ["lifeContracts", index, "partyCharacterIds", partyIndex], "A life contract's party must reference an existing character.");
      });
    });

    world.legacyCauses.forEach((entry, index) => {
      requireCharacter(entry.holderCharacterId, ["legacyCauses", index, "holderCharacterId"], "A legacy cause's holder must reference an existing character.");
      requireCharacter(entry.successorCharacterId, ["legacyCauses", index, "successorCharacterId"], "A legacy cause's successor must reference an existing character.");
      requireCharacter(entry.predecessorCharacterId, ["legacyCauses", index, "predecessorCharacterId"], "A legacy cause's predecessor must reference an existing character.");
    });
  });
export type WorldState = z.infer<typeof WorldStateSchema>;

/**
 * Snapshot upgrader (docs/32, Phase 7): fills `WorldState.instant` from the
 * authoritative `elapsedStep` for a snapshot that predates the event queue.
 * Idempotent -- a world that already carries `instant` is returned as-is, so
 * this is safe to call unconditionally on every load rather than gating on a
 * schema-version check.
 */
export function upgradeWorldStateInstant(world: WorldState, scenarioClock?: ScenarioClock): WorldState {
  if (world.instant !== undefined) return world;
  return { ...world, instant: deriveWorldInstant(world.elapsedStep, scenarioClock) };
}
