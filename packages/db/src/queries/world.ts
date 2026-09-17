import { and, asc, eq, isNotNull, lte, sql } from "drizzle-orm";
import {
  ScenarioDefinitionSchema,
  WorldStateSchema,
  type ScenarioClock,
  type ScenarioDefinition,
  type WorldState,
} from "@chronica/shared";
import type { ChronicaDatabase } from "../database";
import { games, players, scenarioVersions, scenarios } from "../schema/game";
import {
  chronicleCheckpoints,
  gameWorlds,
  playerDecisions,
  scheduledEvents,
  simulationBursts,
  worldFacts,
} from "../schema/simulation";

/**
 * Reading and writing the live world.
 *
 * This replaces `queries/turns.ts`, which was deleted with the turn system and
 * left nothing behind -- for a while there was no way at all to persist a world
 * (see docs/plans/delete-chronicle-orders-turns.md). The shape of `getWorldView`
 * is kept deliberately close to its predecessor's so the character and dialogue
 * services, which were severed by that deletion, work again unchanged.
 */

export interface WorldView {
  readonly gameId: string;
  readonly gameTitle: string;
  readonly world: WorldState;
  /** Optimistic-concurrency token: pass it back to `saveWorld`/`commitBurst`. */
  readonly revision: number;
  readonly mapAssetId: string | null;
  readonly scenarioClock: ScenarioClock | undefined;
  readonly scenarioGovernment: ScenarioDefinition["government"] | undefined;
  readonly scenarioLife: ScenarioDefinition["life"] | undefined;
  readonly scenarioWarfare: ScenarioDefinition["warfare"] | undefined;
  readonly scenarioPeriod: string;
}

/** Raised when a world moved underneath a burst. The caller re-reads and replays rather than overwriting. */
export class WorldRevisionConflictError extends Error {
  constructor(readonly gameId: string, readonly expectedRevision: number, readonly actualRevision: number) {
    super(`World ${gameId} moved from revision ${expectedRevision} to ${actualRevision} during this burst.`);
    this.name = "WorldRevisionConflictError";
  }
}

function hashWorld(world: WorldState): string {
  // FNV-1a over the serialized document. Not cryptographic -- only needs to be
  // stable and cheap, so two reads of an unchanged world agree.
  const input = JSON.stringify(world);
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function instantSortKeyOf(world: WorldState): number {
  return world.instant.day * 1440 + world.instant.minute;
}

async function readScenarioContext(db: ChronicaDatabase, gameId: string) {
  const [row] = await db
    .select({
      gameTitle: games.title,
      scenarioVersion: games.scenarioVersion,
      scenarioId: games.scenarioId,
      period: scenarios.period,
      mapAssetId: scenarioVersions.mapAssetId,
      definition: scenarioVersions.definition,
      initialWorld: scenarioVersions.initialWorld,
    })
    .from(games)
    .innerJoin(scenarios, eq(scenarios.id, games.scenarioId))
    .innerJoin(
      scenarioVersions,
      and(eq(scenarioVersions.scenarioId, games.scenarioId), eq(scenarioVersions.version, games.scenarioVersion)),
    )
    .where(eq(games.id, gameId))
    .limit(1);
  return row;
}

export async function getWorldView(db: ChronicaDatabase, gameId: string): Promise<WorldView | undefined> {
  const context = await readScenarioContext(db, gameId);
  if (context === undefined) return undefined;

  const [stored] = await db.select().from(gameWorlds).where(eq(gameWorlds.gameId, gameId)).limit(1);
  if (stored === undefined) return undefined;

  const world = WorldStateSchema.safeParse(stored.world);
  if (!world.success) return undefined;

  const definition = ScenarioDefinitionSchema.safeParse(context.definition);
  return {
    gameId,
    gameTitle: context.gameTitle,
    world: world.data,
    revision: stored.revision,
    mapAssetId: context.mapAssetId,
    scenarioClock: definition.success ? definition.data.clock : undefined,
    scenarioGovernment: definition.success ? definition.data.government : undefined,
    scenarioLife: definition.success ? definition.data.life : undefined,
    scenarioWarfare: definition.success ? definition.data.warfare : undefined,
    scenarioPeriod: context.period,
  };
}

/**
 * Writes the world without a revision check.
 *
 * Kept for the character/dialogue paths that materialize a province or a newly
 * discovered NPC: those are small, additive, last-write-wins edits made outside
 * a burst. Anything the simulation loop commits goes through `commitBurst`,
 * which does check.
 */
export async function persistOpeningWorld(db: ChronicaDatabase, gameId: string, world: WorldState): Promise<void> {
  await db
    .insert(gameWorlds)
    .values({
      gameId,
      world,
      schemaVersion: world.schemaVersion,
      revision: 1,
      stateHash: hashWorld(world),
      instantSortKey: instantSortKeyOf(world),
    })
    .onConflictDoUpdate({
      target: gameWorlds.gameId,
      set: {
        world,
        schemaVersion: world.schemaVersion,
        revision: sql`${gameWorlds.revision} + 1`,
        stateHash: hashWorld(world),
        instantSortKey: instantSortKeyOf(world),
        updatedAt: new Date(),
      },
    });
}

/** Seeds a new game's world from the scenario version it pinned. */
export async function seedGameWorld(db: ChronicaDatabase, gameId: string): Promise<WorldState | undefined> {
  const context = await readScenarioContext(db, gameId);
  if (context === undefined) return undefined;
  const parsed = WorldStateSchema.safeParse(context.initialWorld);
  if (!parsed.success) return undefined;
  await persistOpeningWorld(db, gameId, parsed.data);
  return parsed.data;
}

export interface BurstFactRow {
  readonly id: string;
  readonly instantSortKey: number;
  readonly kind: string;
  readonly summary: string;
  readonly visibility: string;
  readonly discoveryState: string;
  readonly knowableAtSortKey: number | null;
  readonly significance: number;
  readonly causalDepth: number;
  readonly fact: unknown;
}

export interface BurstEventRow {
  readonly id: string;
  readonly dueInstantSortKey: number;
  readonly kind: string;
  readonly summary: string;
  readonly payload: unknown;
  readonly causeFactId: string | null;
  readonly causalDepth: number;
}

export interface BurstCommit {
  readonly gameId: string;
  readonly expectedRevision: number;
  readonly world: WorldState;
  readonly burstId: string;
  readonly facts: readonly BurstFactRow[];
  readonly scheduled: readonly BurstEventRow[];
  readonly firedEventIds: readonly string[];
  readonly burst: {
    readonly iterations: number;
    readonly modelCalls: number;
    readonly outcome: string;
    readonly stopReason: string;
    readonly accumulatedSignificance: number;
  };
  readonly checkpoint?: {
    readonly title: string;
    readonly body: string;
    readonly factIds: readonly string[];
    readonly fromInstantSortKey: number;
  };
  readonly decision?: {
    readonly prompt: string;
    readonly options: unknown;
  };
}

/**
 * Commits one burst: the world, everything it recorded, everything it
 * scheduled, and whatever the player is about to be shown -- in one
 * transaction, under one revision bump.
 *
 * Partial commits are the failure mode worth designing against here: a world
 * that advanced without its facts, or facts describing a world that was never
 * saved, are both unrecoverable by inspection afterwards.
 */
export async function commitBurst(db: ChronicaDatabase, commit: BurstCommit): Promise<number> {
  return db.transaction(async (tx) => {
    // Serializes against the other writer of this world (the chat path), so a
    // slow burst and a fast conversation cannot interleave mid-commit.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${commit.gameId}))`);

    const [current] = await tx.select({ revision: gameWorlds.revision }).from(gameWorlds).where(eq(gameWorlds.gameId, commit.gameId)).limit(1);
    if (current === undefined) throw new WorldRevisionConflictError(commit.gameId, commit.expectedRevision, 0);
    if (current.revision !== commit.expectedRevision) {
      throw new WorldRevisionConflictError(commit.gameId, commit.expectedRevision, current.revision);
    }

    const nextRevision = current.revision + 1;
    await tx
      .update(gameWorlds)
      .set({
        world: commit.world,
        schemaVersion: commit.world.schemaVersion,
        revision: nextRevision,
        stateHash: hashWorld(commit.world),
        instantSortKey: instantSortKeyOf(commit.world),
        updatedAt: new Date(),
      })
      .where(eq(gameWorlds.gameId, commit.gameId));

    if (commit.facts.length > 0) {
      await tx.insert(worldFacts).values(commit.facts.map((fact) => ({ ...fact, gameId: commit.gameId, burstId: commit.burstId })));
    }

    if (commit.scheduled.length > 0) {
      await tx.insert(scheduledEvents).values(commit.scheduled.map((event) => ({ ...event, gameId: commit.gameId })));
    }

    for (const eventId of commit.firedEventIds) {
      await tx.update(scheduledEvents).set({ status: "fired", firedAt: new Date() }).where(eq(scheduledEvents.id, eventId));
    }

    await tx
      .update(simulationBursts)
      .set({ ...commit.burst, status: "committed", endedAt: new Date() })
      .where(eq(simulationBursts.id, commit.burstId));

    if (commit.checkpoint !== undefined) {
      await tx.insert(chronicleCheckpoints).values({
        gameId: commit.gameId,
        burstId: commit.burstId,
        fromInstantSortKey: commit.checkpoint.fromInstantSortKey,
        toInstantSortKey: instantSortKeyOf(commit.world),
        title: commit.checkpoint.title,
        body: commit.checkpoint.body,
        factIds: commit.checkpoint.factIds,
        stopReason: commit.burst.stopReason,
      });
    }

    if (commit.decision !== undefined) {
      await tx.insert(playerDecisions).values({
        gameId: commit.gameId,
        burstId: commit.burstId,
        prompt: commit.decision.prompt,
        options: commit.decision.options,
      });
    }

    return nextRevision;
  });
}

export async function startBurst(
  db: ChronicaDatabase,
  input: { gameId: string; playerUserId: string | null; orderText: string | null },
): Promise<string> {
  const [row] = await db
    .insert(simulationBursts)
    .values({ gameId: input.gameId, playerUserId: input.playerUserId, orderText: input.orderText })
    .returning({ id: simulationBursts.id });
  return row!.id;
}

export async function failBurst(db: ChronicaDatabase, burstId: string, error: string): Promise<void> {
  await db.update(simulationBursts).set({ status: "failed", error, endedAt: new Date() }).where(eq(simulationBursts.id, burstId));
}

/**
 * Appends facts outside a burst.
 *
 * A conversation records history without advancing the clock or committing a
 * world revision, so it needs a way into the ledger that is not `commitBurst`.
 */
export async function insertWorldFacts(db: ChronicaDatabase, gameId: string, facts: readonly BurstFactRow[]): Promise<void> {
  if (facts.length === 0) return;
  await db.insert(worldFacts).values(facts.map((fact) => ({ ...fact, gameId, burstId: null }))).onConflictDoNothing();
}

/** Facts the loop needs in hand: the recent record, newest last. */
export async function listRecentFacts(db: ChronicaDatabase, gameId: string, limit = 120) {
  return db
    .select()
    .from(worldFacts)
    .where(eq(worldFacts.gameId, gameId))
    .orderBy(asc(worldFacts.instantSortKey))
    .limit(limit);
}

/** Everything the queue owes the world at or before `atSortKey` (VISION §17). */
export async function listDueEvents(db: ChronicaDatabase, gameId: string, atSortKey: number, limit = 32) {
  return db
    .select()
    .from(scheduledEvents)
    .where(and(eq(scheduledEvents.gameId, gameId), eq(scheduledEvents.status, "pending"), lte(scheduledEvents.dueInstantSortKey, atSortKey)))
    .orderBy(asc(scheduledEvents.dueInstantSortKey))
    .limit(limit);
}

/**
 * Everything the queue still owes this world, due or not.
 *
 * The burst needs the whole queue rather than only what is currently due: it
 * decides how far to carry the world, and "how far" means "to the next thing
 * on the calendar".
 */
export async function listPendingEvents(db: ChronicaDatabase, gameId: string, limit = 64) {
  return db
    .select()
    .from(scheduledEvents)
    .where(and(eq(scheduledEvents.gameId, gameId), eq(scheduledEvents.status, "pending")))
    .orderBy(asc(scheduledEvents.dueInstantSortKey))
    .limit(limit);
}

export async function listChronicle(db: ChronicaDatabase, gameId: string, limit = 20) {
  return db
    .select()
    .from(chronicleCheckpoints)
    .where(eq(chronicleCheckpoints.gameId, gameId))
    .orderBy(asc(chronicleCheckpoints.toInstantSortKey))
    .limit(limit);
}

export async function getOpenDecision(db: ChronicaDatabase, gameId: string) {
  const [row] = await db
    .select()
    .from(playerDecisions)
    .where(and(eq(playerDecisions.gameId, gameId), eq(playerDecisions.status, "open")))
    .limit(1);
  return row;
}

export async function resolveDecision(db: ChronicaDatabase, decisionId: string, optionId: string): Promise<void> {
  await db
    .update(playerDecisions)
    .set({ status: "resolved", chosenOptionId: optionId, resolvedAt: new Date() })
    .where(eq(playerDecisions.id, decisionId));
}

/** The single player driving a game, for the single-player loop v1. */
export async function getPrimaryPlayer(db: ChronicaDatabase, gameId: string) {
  const [row] = await db.select().from(players).where(eq(players.gameId, gameId)).limit(1);
  return row;
}

export interface CreateGameInput {
  readonly title: string;
  readonly scenarioId: string;
  readonly startingSeatCount: number;
  readonly extraPrincipalsPerPlayer: number;
  readonly hostUserId: string;
  readonly coinBudgetMicroUnits: bigint;
}

export class NotGameHostError extends Error {
  constructor(readonly gameId: string) {
    super(`Only the host may end game ${gameId}.`);
    this.name = "NotGameHostError";
  }
}

/**
 * Creates a game pinned to a public scenario's current version, seats its host,
 * and gives the world its opening state -- all in one transaction.
 *
 * Its predecessor opened turn 0 here and deliberately wrote no world row,
 * leaving the scenario's `initialWorld` to stand in until the first turn
 * resolved. With turns gone there is nothing to stand in for it, so the world
 * is materialized immediately: a game without a world is not playable.
 */
export async function createGame(db: ChronicaDatabase, input: CreateGameInput): Promise<string> {
  return db.transaction(async (tx) => {
    const [scenario] = await tx
      .select({ id: scenarios.id, currentVersion: scenarios.currentVersion })
      .from(scenarios)
      .innerJoin(scenarioVersions, and(eq(scenarioVersions.scenarioId, scenarios.id), eq(scenarioVersions.version, scenarios.currentVersion)))
      .where(and(eq(scenarios.id, input.scenarioId), eq(scenarios.visibility, "public"), isNotNull(scenarioVersions.validatedAt)))
      .limit(1);
    if (scenario === undefined) throw new Error("That shared world is unavailable.");

    const [version] = await tx
      .select({ initialWorld: scenarioVersions.initialWorld })
      .from(scenarioVersions)
      .where(and(eq(scenarioVersions.scenarioId, scenario.id), eq(scenarioVersions.version, scenario.currentVersion)))
      .limit(1);
    if (version === undefined) throw new Error("That shared world has no playable version.");
    const initialWorld = WorldStateSchema.parse(version.initialWorld);

    const [game] = await tx
      .insert(games)
      .values({
        scenarioId: scenario.id,
        title: input.title,
        status: "active",
        aiProfileVersion: 1,
        payerUserId: input.hostUserId,
        creditRateCardVersion: 1,
        creditBudgetMicrocredits: input.coinBudgetMicroUnits,
        scenarioVersion: scenario.currentVersion,
        libraryVersion: 1,
        startingSeatCount: input.startingSeatCount,
        extraPrincipalsPerPlayer: input.extraPrincipalsPerPlayer,
        createdBy: input.hostUserId,
      })
      .returning({ id: games.id });
    if (game === undefined) throw new Error("Failed to create game.");

    await tx.insert(players).values({
      gameId: game.id,
      userId: input.hostUserId,
      characterId: `pending:host:${input.hostUserId}`,
      status: "active",
    });

    await tx.insert(gameWorlds).values({
      gameId: game.id,
      world: initialWorld,
      schemaVersion: initialWorld.schemaVersion,
      revision: 1,
      stateHash: hashWorld(initialWorld),
      instantSortKey: instantSortKeyOf(initialWorld),
    });

    return game.id;
  });
}

/** Ends a game at the host's request. With no turn to cancel, this is now immediate. */
export async function requestGameEnd(db: ChronicaDatabase, gameId: string, hostUserId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [game] = await tx.select({ id: games.id, createdBy: games.createdBy }).from(games).where(eq(games.id, gameId)).for("update").limit(1);
    if (game === undefined) return;
    if (game.createdBy !== hostUserId) throw new NotGameHostError(gameId);
    const now = new Date();
    await tx.update(games).set({ endRequestedAt: now, endRequestedBy: hostUserId, status: "finished", endedAt: now }).where(eq(games.id, gameId));
  });
}
