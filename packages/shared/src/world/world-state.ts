import { FaithAdherenceSchema, FaithSchema } from "./faith";
import { z } from "zod";
import { ElapsedStepSchema, MaterialWorldStateSchema } from "../material-state";
import { CharacterSchema, OfficeSchema } from "../characters/character";
import { CharacterContinuitySchema, EncounterMemorySchema } from "../continuity/continuity";
import { WorldPinsSchema } from "./clock";
import { WorldInstantSchema, type WorldInstant } from "./instant";
import { AuthorityGrantSchema } from "../authority/authority-grant";
import { OrderAttemptSchema } from "../authority/order-attempt";
import { ProjectSchema } from "./project";
import { StructureSchema } from "./structure";
import { GenericEntitySchema } from "./generic-entity";
import { PolityOutlookSchema } from "./outlook";
import { ProvinceGraphSchema } from "./map";
import { TroopCategoryDefinitionSchema } from "../warfare/battle";
import { ContingencySchema } from "./contingency";
import { SiegeSchema } from "./siege";
import { EnactmentSchema } from "./enactment";
import { CovertPlotSchema } from "./covert-plot";
import { MapConflictsOverlaySchema } from "./map-presentation";
import { NemesisSchema } from "./nemesis";
import { WorldStorylineSchema } from "./storylines";
import { CharacterPressureSchema } from "../characters/pressures";
import { CharacterBeliefSchema } from "../characters/beliefs";
import { SocialLinkSchema } from "../characters/relationship-dimensions";
import { TraitObservationSchema } from "../characters/traits";
import { CommitmentSchema } from "../characters/commitments";
import { CharacterIntentSchema } from "../characters/intents";
import { FamilyLinkSchema, HouseholdSchema, LifeContractSchema } from "../characters/family";
import { LegacyCauseSchema } from "../continuity/continuity";
import { FieldPerilSchema } from "./field-peril";
import { PolityAgreementSchema } from "./agreements";
import { DiplomaticMessageSchema, PolityStanceSchema } from "./diplomacy";
import { ConstitutionSchema, EMPTY_SOCIETY_MEMORY, SocietyMemorySchema } from "./constitution";
import { SuccessionRuleSchema } from "../characters/character";
import { AuditSchema, DepartmentSchema, DiversionSchema } from "./departments";
import { EconomyMemorySchema } from "./economy";

/**
 * Bumped when an old snapshot needs upgrading on load.
 *
 * Because snapshots are versioned documents, a schema change does not require
 * rewriting history -- bump this and teach the reader to upgrade old
 * documents.
 *
 * 3: storylines lost the fields of a deleted director architecture and gained
 *    provenance; the narrator's ledger arrived; `worldDevelopments`, which
 *    nothing ever read, was dropped. Worlds written at 2 were playtests, and
 *    are recreated rather than carried.
 *
 * Every stored world is read through `readWorldDocument` (world-upgrade.ts),
 * which runs the chain of upgrade steps before the strict parse. Bumping this
 * means adding the step from the old number to the new one there.
 */
export const WORLD_SCHEMA_VERSION = 3;

/**
 * What the narrator has done so far, so pacing is replayable from the document
 * alone rather than from a window of recent facts that can scroll.
 */
export const NarratorLedgerSchema = z
  .object({
    /** Day of the last seed offered, or null before the first. */
    lastSeedDay: ElapsedStepSchema.nullable(),
    /** How many seeds have been offered; part of every seed's hash, so no two are alike. */
    seedCount: z.number().int().min(0),
    lastSeedKey: z.string().trim().min(1).max(80).nullable(),
    /** Whether the orchestrator took the last seed up. An ignored seed is offered once more, then dropped. */
    consumed: z.boolean(),
    /**
     * Historical pressures already spent.
     *
     * A scenario's pressures are what the period was actually tending toward --
     * an unpaid mercenary army, a brittle alliance system, a pass that can be
     * crossed at a price. They are offered when their circumstances hold, and
     * each is offered once: history is a thing this world can fall into, not a
     * thing it is on rails toward, and a pressure that keeps firing is a rail.
     */
    spentPressureIds: z.array(z.string().trim().min(1).max(80)).max(200).default([]),
  })
  .strict();
export type NarratorLedger = z.infer<typeof NarratorLedgerSchema>;

export const EMPTY_NARRATOR_LEDGER: NarratorLedger = { lastSeedDay: null, seedCount: 0, lastSeedKey: null, consumed: true, spentPressureIds: [] };

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
     * The day `instant` falls on, denormalized so the forty-odd `*AtStep`
     * fields across material state, projects, authority and the character
     * system keep one shared unit to compare against. Kept equal to
     * `instant.day` by the invariant below -- it is a date, not a turn.
     */
    elapsedStep: ElapsedStepSchema,
    /**
     * Authoritative simulation time: day from the scenario epoch, plus
     * minute-of-day (VISION §16). Turns are gone, so nothing derives this
     * from a coarser clock any more -- events carry real timestamps and the
     * event queue orders them by `worldInstantToSortKey`.
     */
    instant: WorldInstantSchema,
    /**
     * The province graph is the map (ADR-0015). Detail tiers live on the
     * provinces because they are state the simulation mutates deterministically,
     * so they must be inside the thing the determinism test hashes.
     */
    map: ProvinceGraphSchema,
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
    /** Threads of history the world is following -- see `world/storylines.ts`. */
    storylines: z.array(WorldStorylineSchema).default([]),
    /**
     * The rulers' antagonists, live and retired (VISION §19's exception).
     * One live entry per ruler; the retired ones are kept because who a reign
     * was against is part of what it was.
     */
    nemeses: z.array(NemesisSchema).default([]),
    /** Men cut off on a lost field, and what became of them -- see `world/field-peril.ts`. */
    fieldPerils: z.array(FieldPerilSchema).default([]),
    /** The narrator's own bookkeeping -- see `NarratorLedgerSchema`. */
    narrator: NarratorLedgerSchema.default(EMPTY_NARRATOR_LEDGER),
    /**
     * Offices the world has made for itself, beside the ones the scenario opened with.
     *
     * A scenario's government was a fixed list, so the only offices that could
     * ever exist were the handful somebody authored -- four, in the Punic Wars.
     * "Name a quaestor to handle the war chest" matched nothing, and the man
     * was created holding no office at all, because there was no quaestorship
     * for him to hold and no way to make one.
     *
     * A government invents offices constantly: a commission, a prefecture, a
     * command created for one war. The scenario's list is the opening state of
     * a thing that grows, not the whole of what may exist (VISION §9). These
     * are merged with it everywhere offices are read, so an office the world
     * made confers authority exactly as an authored one does.
     */
    offices: z.array(OfficeSchema).default([]),
    /**
     * How offices are filled, where the world has changed or added to the
     * scenario's rules: a throne made elective, a council's own elections.
     * Merged with the scenario's exactly as `offices` is (`allSuccessionRules`).
     */
    successionRules: z.array(SuccessionRuleSchema).default([]),
    /**
     * Each power's constitution: what form its parts read as, and how they came
     * to be (`world/constitution.ts`). A power with no entry has not yet been
     * given one; the engine grows it from the power's form the first time it
     * reviews the world.
     */
    constitutions: z.array(ConstitutionSchema).default([]),
    /**
     * Who is in charge of what, beneath the ruler: a power's departments and
     * a household's stewards (`world/departments.ts`). A lever no department
     * holds is the ruler's own, and an estate nobody stewards is its owner's.
     */
    departments: z.array(DepartmentSchema).default([]),
    /** What officers and stewards have taken, and whether anybody has found it (`world/departments.ts`). */
    diversions: z.array(DiversionSchema).max(600).default([]),
    audits: z.array(AuditSchema).max(200).default([]),
    /** What the world remembers to see its groups coming -- see `SocietyMemorySchema`. */
    society: SocietyMemorySchema.default(EMPTY_SOCIETY_MEMORY),
    /** What the world remembers of its seasons, bargains and troubles -- see `EconomyMemorySchema`. */
    economy: EconomyMemorySchema.optional(),
    /**
     * Kinds of troops the world has made for itself, on the same terms as the
     * offices above -- see `warfare/troop-categories.ts`.
     *
     * A scenario's list was closed, so an army could be reinforced only with a
     * kind of soldier somebody had authored in advance, and "take the
     * Carthaginian elephants into the legion" was answered with a refusal
     * rather than with elephants. Merged with the scenario's wherever a
     * category is read, so one the world minted fights exactly as an authored
     * one does. Defaulted, so every snapshot written before this existed still
     * parses -- and its armies stay the armies they were.
     */
    troopCategories: z.array(TroopCategoryDefinitionSchema).default([]),
    /** Current authoritative combat, siege, and war state for map projection. */
    conflicts: MapConflictsOverlaySchema.default({ battles: [], sieges: [], wars: [] }),
    material: MaterialWorldStateSchema,
    // Character-sim phase 2: canonical pressures, individually-owned beliefs,
    // and typed social links. Defaulted so archived snapshots load cleanly;
    // see packages/shared/src/characters/{pressures,beliefs,relationship-dimensions}.ts.
    characterPressures: z.array(CharacterPressureSchema).default([]),
    characterBeliefs: z.array(CharacterBeliefSchema).default([]),
    socialLinks: z.array(SocialLinkSchema).default([]),
    /**
     * What people have said about each other's character, before enough of
     * them have said it (slice 11). Defaulted, so every snapshot written
     * before traits could change still loads.
     */
    traitObservations: z.array(TraitObservationSchema).default([]),
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
     * What two powers have standing between them: war, truce, peace, alliance,
     * tribute. A stance is how much one power trusts another and moves
     * constantly; this is what they have agreed and changes only when somebody
     * changes it. Defaulted so every snapshot written before it still parses.
     */
    polityAgreements: z.array(PolityAgreementSchema).default([]),
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
    /** What people believe, founded by naming (see `world/faith.ts`). */
    faiths: z.array(FaithSchema).default([]),
    /** Belief as it has changed, by province. A province with no row believes as it always did. */
    faithAdherence: z.array(FaithAdherenceSchema).default([]),
    /**
     * VISION §11: what each polity is trying to do -- the state-level
     * counterpart to `Character.mind`. Ordinary world state, rewritten as
     * circumstances change, never scenario data. Defaulted so every snapshot
     * written before this existed still parses.
     */
    polityOutlooks: z.array(PolityOutlookSchema).default([]),
    /**
     * What has been laid against somebody in secret, and how it is going --
     * see `world/covert-plot.ts`.
     *
     * "Hire an assassin to kill Fabius" had no expression at all: the one door
     * to death is `mortality.ts`, and it opened only on a roll off the age
     * table. So the commonest order in the genre resolved as a man in poor
     * health. A plot is the missing object -- always allowed to be laid, never
     * certain to succeed, and open long enough that the mark may be warned and
     * the plotter found out. Defaulted, so every snapshot written before it
     * still parses.
     */
    covertPlots: z.array(CovertPlotSchema).default([]),
    /**
     * Plans laid against days that have not come -- see `world/contingency.ts`.
     *
     * "When the Carthaginians are through the first wall, fire it and bar the
     * gates" could be written down and never read: about a fifth of the orders
     * a real player writes hang their content on a condition, and every one of
     * them depended on the narrator remembering the note. Defaulted, so every
     * snapshot written before it still parses.
     */
    contingencies: z.array(ContingencySchema).default([]),
    /** Cities held under siege (`siege.ts`), kept until they fall or the siege is lifted. */
    sieges: z.array(SiegeSchema).default([]),
    /**
     * What measures before a council will do if carried -- see
     * `world/enactment.ts`. Defaulted, so every snapshot written before a law
     * could do anything still parses.
     */
    enactments: z.array(EnactmentSchema).default([]),
  })
  .strict()
  .superRefine((world, context) => {
    if (world.elapsedStep !== world.instant.day) {
      context.addIssue({ code: "custom", path: ["elapsedStep"], message: "elapsedStep must equal instant.day -- a step is a day, not a turn." });
    }

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
 * Moves the world's clock, keeping `elapsedStep` and `instant.day` in step.
 *
 * The single place time advances, so the invariant above cannot be broken by a
 * caller that remembers one field and forgets the other. Refuses to run
 * backwards: a simulation that can rewind its own clock can schedule an event
 * into its own past.
 */
export function advanceWorldTo(world: WorldState, instant: WorldInstant): WorldState {
  const current = world.instant.day * 1440 + world.instant.minute;
  if (instant.day * 1440 + instant.minute < current) {
    throw new Error(`The world clock cannot run backwards (from day ${world.instant.day} to day ${instant.day}).`);
  }
  return { ...world, instant, elapsedStep: instant.day };
}
