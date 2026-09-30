import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import {
  ScenarioDefinitionSchema,
  WorldDocumentUnreadableError,
  WorldStateSchema,
  issueLine,
  readWorldDocument,
  type Fact,
  type ScenarioClock,
  type ScenarioDefinition,
  type WorldState,
} from "@chronica/shared";
import type { ChronicaDatabase } from "../database";
import { games, players, scenarioVersions, scenarios } from "../schema/game";
import {
  burstProgress,
  chronicleCheckpoints,
  followedThreads,
  deltaAudit,
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
  /** The pinned version's rules. Always present: a definition that will not parse throws `ScenarioDefinitionUnreadableError`. */
  readonly scenarioClock: ScenarioClock;
  readonly scenarioGovernment: ScenarioDefinition["government"];
  readonly scenarioLife: ScenarioDefinition["life"];
  readonly scenarioWealth: ScenarioDefinition["wealth"];
  readonly scenarioWarfare: ScenarioDefinition["warfare"];
  /** The scenario's map rules, so movement can be held to the crossings it admits. */
  readonly scenarioMap: ScenarioDefinition["map"];
  /** What the period tends toward -- offered to the narrator only where the world still looks like it. */
  readonly scenarioHistoricalPressures: ScenarioDefinition["historicalPressures"];
  readonly scenarioPeriod: string;
}

/** Raised when a world moved underneath a burst. The caller re-reads and replays rather than overwriting. */
export class WorldRevisionConflictError extends Error {
  constructor(readonly gameId: string, readonly expectedRevision: number, readonly actualRevision: number) {
    super(`World ${gameId} moved from revision ${expectedRevision} to ${actualRevision} during this burst.`);
    this.name = "WorldRevisionConflictError";
  }
}

/** A burst that was reaped, or ended some other way, while it was still working. Its commit is refused. */
export class BurstNoLongerRunningError extends Error {
  constructor(readonly burstId: string) {
    super(`Burst ${burstId} is no longer running (it was given up for stuck or dead); its commit was refused and nothing was saved.`);
    this.name = "BurstNoLongerRunningError";
  }
}

/**
 * A world about to be saved that the next load would refuse.
 *
 * `getWorldView` rightly throws on a stored world that fails the schema, and
 * nothing checked the other end: a tick that wrote an impossible transaction,
 * a composite id past its length, a title past its cap -- each was saved, and
 * the campaign could never be opened again. Refused here instead, the turn
 * fails, the world stays at its last good revision, and the player can try
 * again.
 */
export class WorldWouldNotLoadError extends Error {
  constructor(readonly gameId: string, readonly issue: string) {
    super(`This turn would have left game ${gameId} unable to load (${issue}); nothing was saved.`);
    this.name = "WorldWouldNotLoadError";
  }
}

/**
 * A stored world that will not load, and says where.
 *
 * Thrown by every read of a save rather than an empty view or a bare Error:
 * the web answers it with "this save needs repair" instead of a 500, and the
 * repair scripts read `issues` to know which paths to mend.
 */
export class SaveNeedsRepairError extends Error {
  constructor(readonly gameId: string, readonly issues: readonly string[], detail: string) {
    super(`The stored world for game ${gameId} needs repair before it can be opened: ${detail}`);
    this.name = "SaveNeedsRepairError";
  }
}

/**
 * The scenario version a game is pinned to, and its rules will not parse.
 *
 * Used to be read with `safeParse` and every rule quietly left undefined, so
 * the next order was refused with "This scenario declares no clock." -- true
 * of nothing, and no hint which field of the definition was at fault.
 */
export class ScenarioDefinitionUnreadableError extends Error {
  constructor(readonly scenarioId: string, readonly version: number, readonly issues: readonly string[]) {
    super(`Scenario ${scenarioId} version ${version} has a definition this build cannot read: ${issues.slice(0, 5).join("; ")}${issues.length > 5 ? ` (and ${issues.length - 5} more)` : ""}`);
    this.name = "ScenarioDefinitionUnreadableError";
  }
}

/** A stored world, upgraded and parsed, or `SaveNeedsRepairError` naming the paths. */
export function readStoredWorld(gameId: string, raw: unknown): WorldState {
  try {
    return readWorldDocument(raw).world;
  } catch (error) {
    if (error instanceof WorldDocumentUnreadableError) throw new SaveNeedsRepairError(gameId, error.issues, error.message);
    throw error;
  }
}

/** A pinned scenario definition, parsed, or `ScenarioDefinitionUnreadableError` naming the paths. */
export function readScenarioDefinition(scenarioId: string, version: number, raw: unknown): ScenarioDefinition {
  const parsed = ScenarioDefinitionSchema.safeParse(raw);
  if (!parsed.success) throw new ScenarioDefinitionUnreadableError(scenarioId, version, parsed.error.issues.map(issueLine));
  return parsed.data;
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

export function instantSortKeyOf(world: WorldState): number {
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

  // Not "no state yet": there is state, and it will not load. Swallowing
  // this reported a three-year campaign as an empty world because one
  // standing order had a payer and a recipient that were the same account,
  // and nothing anywhere said so. Read through the upgrade chain first, so a
  // save written before a breaking change is carried rather than refused.
  const world = readStoredWorld(gameId, stored.world);
  // And the rules it is pinned to: a definition that will not parse is an
  // error with a path, not a scenario that "declares no clock".
  const definition = readScenarioDefinition(context.scenarioId, context.scenarioVersion, context.definition);
  return {
    gameId,
    gameTitle: context.gameTitle,
    world,
    revision: stored.revision,
    mapAssetId: context.mapAssetId,
    scenarioClock: definition.clock,
    scenarioGovernment: definition.government,
    scenarioLife: definition.life,
    scenarioWealth: definition.wealth,
    scenarioWarfare: definition.warfare,
    scenarioMap: definition.map,
    scenarioHistoricalPressures: definition.historicalPressures,
    scenarioPeriod: context.period,
  };
}

/**
 * Writes the world without a revision check.
 *
 * Kept for the character/dialogue paths that materialize a province or a newly
 * discovered NPC: those are small, additive, last-write-wins edits made outside
 * a burst. Anything the simulation loop commits goes through `commitBurst`,
 * which does check, and a repair goes through `persistRepairedWorld`, which
 * checks too.
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

/** A repair refused because a burst is moving the world, or was when the repair read it. */
export class WorldBusyError extends Error {
  constructor(readonly gameId: string, readonly burstId: string) {
    super(`Game ${gameId} has a burst running (${burstId}); nothing was written. Wait for it to settle, or reap it, and read the world again.`);
    this.name = "WorldBusyError";
  }
}

/**
 * Writes a repaired world over the revision the repair was read from.
 *
 * The repair scripts used `persistOpeningWorld`, which is last-write-wins: a
 * script that read the world, took a minute over its dry run, and wrote it
 * back erased whatever a burst had committed in that minute -- and a burst
 * still running would then commit over the repair, or fail its revision
 * check and throw the turn away. This refuses both: it writes only if the
 * world is still at `expectedRevision` and no burst is running, under the
 * same advisory lock `commitBurst` takes, and it holds the world to the
 * schema before writing, as a burst's commit does.
 *
 * With `scenarioVersion`, the game is repinned in the same transaction, so a
 * world and the rules it is read against never disagree on a version.
 */
export async function persistRepairedWorld(
  db: ChronicaDatabase,
  input: { readonly gameId: string; readonly expectedRevision: number; readonly world: WorldState; readonly scenarioVersion?: number | undefined },
): Promise<number> {
  const { gameId, expectedRevision, world } = input;
  const loadable = WorldStateSchema.safeParse(world);
  if (!loadable.success) throw new WorldWouldNotLoadError(gameId, loadable.error.issues.slice(0, 5).map(issueLine).join("; "));
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${gameId}))`);
    const [running] = await tx
      .select({ id: simulationBursts.id })
      .from(simulationBursts)
      .where(and(eq(simulationBursts.gameId, gameId), eq(simulationBursts.status, "running")))
      .limit(1);
    if (running !== undefined) throw new WorldBusyError(gameId, running.id);
    const [current] = await tx.select({ revision: gameWorlds.revision }).from(gameWorlds).where(eq(gameWorlds.gameId, gameId)).limit(1);
    if (current === undefined) throw new WorldRevisionConflictError(gameId, expectedRevision, 0);
    if (current.revision !== expectedRevision) throw new WorldRevisionConflictError(gameId, expectedRevision, current.revision);
    const nextRevision = current.revision + 1;
    await tx
      .update(gameWorlds)
      .set({
        world: loadable.data,
        schemaVersion: loadable.data.schemaVersion,
        revision: nextRevision,
        stateHash: hashWorld(loadable.data),
        instantSortKey: instantSortKeyOf(loadable.data),
        updatedAt: new Date(),
      })
      .where(eq(gameWorlds.gameId, gameId));
    if (input.scenarioVersion !== undefined) {
      await tx.update(games).set({ scenarioVersion: input.scenarioVersion }).where(eq(games.id, gameId));
    }
    return nextRevision;
  });
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

/** One fact as the row `commitBurst` stores, with the weight its author gave it. */
export function factRowOf(fact: Fact, significance: number): BurstFactRow {
  return {
    id: fact.id,
    instantSortKey: fact.time.day * 1440 + fact.time.minute,
    kind: fact.kind,
    summary: fact.summary,
    visibility: fact.visibility,
    discoveryState: fact.discovery.state,
    knowableAtSortKey:
      fact.discovery.knowableAtInstant === null ? null : fact.discovery.knowableAtInstant.day * 1440 + fact.discovery.knowableAtInstant.minute,
    significance,
    causalDepth: fact.causalDepth,
    fact,
  };
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
  /**
   * Facts already on record whose discovery widened this burst -- a secret
   * somebody investigated their way into. Not new history, so they are written
   * over their existing rows rather than inserted beside them.
   */
  readonly rediscoveredFacts?: readonly BurstFactRow[];
  readonly scheduled: readonly BurstEventRow[];
  readonly firedEventIds: readonly string[];
  readonly burst: {
    readonly iterations: number;
    readonly modelCalls: number;
    readonly outcome: string;
    readonly stopReason: string;
    readonly accumulatedSignificance: number;
    /** Every call not made, answer not read and field dropped, as `{ stage, reason }` (see `simulation_bursts.skipped`). */
    readonly skipped?: readonly { readonly stage: string; readonly reason: string }[] | undefined;
    /** Of `modelCalls`, how many were the historian's. */
    readonly chronicleCalls?: number | undefined;
  };
  /**
   * The Chronicle this burst produced: one entry per thread of events, in the
   * order they should be read. A burst covers a span, not a subject, so a span
   * that held a war and an embassy records two entries, not one passage about
   * both.
   */
  readonly checkpoints?: readonly {
    readonly kind: "narrated" | "recorded";
    readonly title: string;
    readonly body: string;
    readonly factIds: readonly string[];
    readonly subjects: readonly unknown[];
    readonly tags: readonly unknown[];
    readonly changes: readonly unknown[];
    readonly quote: unknown;
    readonly storylineIds?: readonly string[] | undefined;
    readonly fromInstantSortKey: number;
    readonly toInstantSortKey: number;
  }[];
  readonly decision?: {
    readonly prompt: string;
    readonly options: unknown;
  };
  /** What the engine refused or filled in while applying the burst (see `deltaAudit`). */
  readonly audit?: readonly {
    readonly actorKind: string;
    readonly actorId: string;
    readonly op: string;
    readonly kind: string;
    readonly ofTheOrder: boolean;
    readonly attempt: string;
    readonly reason: string;
    readonly delta: unknown;
  }[];
  /**
   * The decision this burst was the answer to, closed in the same transaction
   * as the world that heard the answer. It used to be closed afterwards, by the
   * request that had waited for the burst; there is no such request any more,
   * and a question closed before its world is saved is an answer spent on
   * nothing.
   */
  readonly resolvesDecision?: { readonly id: string; readonly optionId: string };
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
  const loadable = WorldStateSchema.safeParse(commit.world);
  if (!loadable.success) {
    const [first] = loadable.error.issues;
    throw new WorldWouldNotLoadError(commit.gameId, first === undefined ? "unknown" : `${first.path.join(".")}: ${first.message}`);
  }
  return db.transaction(async (tx) => {
    // Serializes against the other writer of this world (the chat path), so a
    // slow burst and a fast conversation cannot interleave mid-commit.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${commit.gameId}))`);

    const [current] = await tx.select({ revision: gameWorlds.revision }).from(gameWorlds).where(eq(gameWorlds.gameId, commit.gameId)).limit(1);
    if (current === undefined) throw new WorldRevisionConflictError(commit.gameId, commit.expectedRevision, 0);
    if (current.revision !== commit.expectedRevision) {
      throw new WorldRevisionConflictError(commit.gameId, commit.expectedRevision, current.revision);
    }

    // Only a burst still running may commit. One reaped while it worked --
    // stuck past its deadline, or given up for dead -- has already told the
    // player nothing was kept, and a commit landing after that would make a
    // liar of the page. Thrown inside the transaction, so it writes nothing.
    const closed = await tx
      .update(simulationBursts)
      .set({ ...commit.burst, skipped: commit.burst.skipped ?? [], chronicleCalls: commit.burst.chronicleCalls ?? 0, status: "committed", endedAt: new Date() })
      .where(and(eq(simulationBursts.id, commit.burstId), eq(simulationBursts.status, "running")))
      .returning({ id: simulationBursts.id });
    if (closed.length === 0) throw new BurstNoLongerRunningError(commit.burstId);

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

    // A secret somebody found out. Accepted by this function since it was
    // written and never stored, so every discovery a burst made -- an agent's
    // report, an investigation that paid off -- was forgotten by the next one.
    for (const fact of commit.rediscoveredFacts ?? []) {
      await tx
        .update(worldFacts)
        .set({ discoveryState: fact.discoveryState, knowableAtSortKey: fact.knowableAtSortKey, fact: fact.fact })
        .where(and(eq(worldFacts.gameId, commit.gameId), eq(worldFacts.id, fact.id)));
    }

    if (commit.scheduled.length > 0) {
      await tx.insert(scheduledEvents).values(commit.scheduled.map((event) => ({ ...event, gameId: commit.gameId })));
    }

    for (const eventId of commit.firedEventIds) {
      await tx.update(scheduledEvents).set({ status: "fired", firedAt: new Date() }).where(eq(scheduledEvents.id, eventId));
    }


    if (commit.checkpoints !== undefined && commit.checkpoints.length > 0) {
      await tx.insert(chronicleCheckpoints).values(commit.checkpoints.map((entry, ordinal) => ({
        gameId: commit.gameId,
        burstId: commit.burstId,
        ordinal,
        fromInstantSortKey: entry.fromInstantSortKey,
        toInstantSortKey: entry.toInstantSortKey,
        kind: entry.kind,
        title: entry.title,
        body: entry.body,
        factIds: entry.factIds,
        subjects: entry.subjects,
        tags: entry.tags,
        changes: entry.changes,
        quote: entry.quote ?? null,
        storylineIds: entry.storylineIds ?? [],
        stopReason: commit.burst.stopReason,
      })));
    }

    if (commit.audit !== undefined && commit.audit.length > 0) {
      await tx.insert(deltaAudit).values(commit.audit.map((entry) => ({ ...entry, gameId: commit.gameId, burstId: commit.burstId })));
    }

    if (commit.decision !== undefined) {
      await tx.insert(playerDecisions).values({
        gameId: commit.gameId,
        burstId: commit.burstId,
        prompt: commit.decision.prompt,
        options: commit.decision.options,
      });
    }

    if (commit.resolvesDecision !== undefined) {
      await tx
        .update(playerDecisions)
        .set({ status: "resolved", chosenOptionId: commit.resolvesDecision.optionId, resolvedAt: new Date() })
        .where(eq(playerDecisions.id, commit.resolvesDecision.id));
    }

    return nextRevision;
  });
}

/**
 * Opens a burst, or returns null when one is already running for this game.
 *
 * `findRunningBurst` alone could not keep that promise: two orders sent
 * together both read "nothing running" and both got here. The partial unique
 * index on running rows is what refuses the second one.
 */
export async function startBurst(
  db: ChronicaDatabase,
  input: { gameId: string; playerUserId: string | null; orderText: string | null; idempotencyKey?: string | null | undefined },
): Promise<string | null> {
  try {
    const now = new Date();
    const [row] = await db
      .insert(simulationBursts)
      .values({ gameId: input.gameId, playerUserId: input.playerUserId, orderText: input.orderText, heartbeatAt: now, progressAt: now, idempotencyKey: input.idempotencyKey ?? null })
      .returning({ id: simulationBursts.id });
    return row!.id;
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
}

/** Postgres's 23505, whether drizzle hands it over bare or wrapped in a `DrizzleQueryError`. */
function isUniqueViolation(error: unknown): boolean {
  for (let current = error; typeof current === "object" && current !== null; current = (current as { cause?: unknown }).cause) {
    if ("code" in current && current.code === "23505") return true;
  }
  return false;
}

export async function failBurst(db: ChronicaDatabase, burstId: string, error: string): Promise<void> {
  await db.update(simulationBursts).set({ status: "failed", error, endedAt: new Date() }).where(eq(simulationBursts.id, burstId));
}

/**
 * The process running a burst says it is still here. A no-op once the burst
 * has ended; returns false then, so a runner that was reaped learns it.
 */
export async function heartbeatBurst(db: ChronicaDatabase, burstId: string): Promise<boolean> {
  const rows = await db
    .update(simulationBursts)
    .set({ heartbeatAt: new Date() })
    .where(and(eq(simulationBursts.id, burstId), eq(simulationBursts.status, "running")))
    .returning({ id: simulationBursts.id });
  return rows.length > 0;
}

/**
 * The burst got somewhere: a stage reported, a call answered, a passage
 * written. Beating proves only that the process is alive; this is what
 * proves the burst is not stuck in it. Returns false once the burst has ended.
 */
export async function markBurstProgress(db: ChronicaDatabase, burstId: string): Promise<boolean> {
  const now = new Date();
  const rows = await db
    .update(simulationBursts)
    .set({ heartbeatAt: now, progressAt: now })
    .where(and(eq(simulationBursts.id, burstId), eq(simulationBursts.status, "running")))
    .returning({ id: simulationBursts.id });
  return rows.length > 0;
}

/** The burst an order with this client id already opened, whatever became of it. */
export async function findBurstByIdempotencyKey(db: ChronicaDatabase, gameId: string, idempotencyKey: string): Promise<{ id: string; status: string } | undefined> {
  const [row] = await db
    .select({ id: simulationBursts.id, status: simulationBursts.status })
    .from(simulationBursts)
    .where(and(eq(simulationBursts.gameId, gameId), eq(simulationBursts.idempotencyKey, idempotencyKey)))
    .limit(1);
  return row;
}

/**
 * The cutoffs a running burst is judged by: alive if its process has beaten
 * since `aliveAfter` *and* it has got somewhere since `progressAfter`. Either
 * one missed, it is abandoned.
 */
export interface BurstLiveness {
  readonly aliveAfter: Date;
  readonly progressAfter: Date;
}

/**
 * A burst for this game that is still running, if there is one.
 *
 * Two orders can be in flight for one world at once, and the loser finds out
 * at the very end: `commitBurst` takes its advisory lock inside the commit
 * transaction, so the revision check is the first thing that notices, by which
 * time several minutes of model calls have been paid for and thrown away.
 *
 * "Running" is judged by the heartbeat, not the row's age. A row only reaches
 * `committed` or `failed` if the process that opened it lived long enough to
 * say so; one that has stopped beating is not running, it is abandoned, and
 * `reapStaleBursts` says so on the row.
 */
export async function findRunningBurst(
  db: ChronicaDatabase,
  gameId: string,
  liveness: BurstLiveness,
): Promise<{ id: string; startedAt: Date } | undefined> {
  const [row] = await db
    .select({ id: simulationBursts.id, startedAt: simulationBursts.startedAt })
    .from(simulationBursts)
    .where(and(
      eq(simulationBursts.gameId, gameId),
      eq(simulationBursts.status, "running"),
      gt(sql`coalesce(${simulationBursts.heartbeatAt}, ${simulationBursts.startedAt})`, liveness.aliveAfter.toISOString()),
      gt(sql`coalesce(${simulationBursts.progressAt}, ${simulationBursts.startedAt})`, liveness.progressAfter.toISOString()),
    ))
    .orderBy(desc(simulationBursts.startedAt))
    .limit(1);
  return row;
}

/**
 * Marks every running burst that is abandoned by `liveness` as failed, and
 * returns how many: of one game, or with `gameId` null of every game -- the
 * sweep a server makes when it starts, since a burst whose process died with
 * the last server is otherwise only found when somebody opens that game.
 */
export async function reapStaleBursts(db: ChronicaDatabase, gameId: string | null, liveness: BurstLiveness, error: string): Promise<number> {
  const reaped = await db
    .update(simulationBursts)
    .set({ status: "failed", error, endedAt: new Date() })
    // A raw coalesce() carries no column encoder, so postgres-js is handed the
    // bound Date as-is and refuses it: the instants go in as ISO strings.
    .where(and(
      ...(gameId === null ? [] : [eq(simulationBursts.gameId, gameId)]),
      eq(simulationBursts.status, "running"),
      or(
        lte(sql`coalesce(${simulationBursts.heartbeatAt}, ${simulationBursts.startedAt})`, liveness.aliveAfter.toISOString()),
        lte(sql`coalesce(${simulationBursts.progressAt}, ${simulationBursts.startedAt})`, liveness.progressAfter.toISOString()),
      ),
    ))
    .returning({ id: simulationBursts.id });
  return reaped.length;
}

export async function getBurst(db: ChronicaDatabase, gameId: string, burstId: string) {
  const [row] = await db
    .select({
      id: simulationBursts.id,
      status: simulationBursts.status,
      error: simulationBursts.error,
      orderText: simulationBursts.orderText,
      startedAt: simulationBursts.startedAt,
      heartbeatAt: simulationBursts.heartbeatAt,
      progressAt: simulationBursts.progressAt,
      endedAt: simulationBursts.endedAt,
    })
    .from(simulationBursts)
    .where(and(eq(simulationBursts.id, burstId), eq(simulationBursts.gameId, gameId)))
    .limit(1);
  return row;
}

export async function appendBurstProgress(
  db: ChronicaDatabase,
  input: { gameId: string; burstId: string; kind: "progress" | "chronicle_entry"; payload: unknown },
): Promise<number> {
  const [row] = await db
    .insert(burstProgress)
    .values({ gameId: input.gameId, burstId: input.burstId, kind: input.kind, payload: input.payload })
    .returning({ id: burstProgress.id });
  return row!.id;
}

/** Everything a burst has said since `afterId`, oldest first. */
export async function listBurstProgress(db: ChronicaDatabase, burstId: string, afterId = 0) {
  return db
    .select({ id: burstProgress.id, kind: burstProgress.kind, payload: burstProgress.payload, createdAt: burstProgress.createdAt })
    .from(burstProgress)
    .where(and(eq(burstProgress.burstId, burstId), gt(burstProgress.id, afterId)))
    .orderBy(asc(burstProgress.id));
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

/**
 * Facts the loop needs in hand: the recent record, newest last.
 *
 * Newest, not oldest: ordered ascending under a limit, this handed a long
 * game its first hundred and twenty facts and called them recent, so nothing
 * the router or the narrator read from the window was current.
 */
export async function listRecentFacts(db: ChronicaDatabase, gameId: string, limit = 120) {
  const rows = await db
    .select()
    .from(worldFacts)
    .where(eq(worldFacts.gameId, gameId))
    .orderBy(desc(worldFacts.instantSortKey))
    .limit(limit);
  return rows.reverse();
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

/**
 * The most recent stretch of the record, oldest first.
 *
 * Ordered *descending* and reversed, rather than taken from the front. Taking
 * the first twenty ascending returned the twenty oldest entries and silently
 * dropped everything after them, so a reign past its twentieth entry stopped
 * showing the player anything new -- the Chronicle went quiet while the world
 * carried on being written into it, and the Council's "since your last order"
 * was a year stale.
 */
export async function listChronicle(db: ChronicaDatabase, gameId: string, limit = 200) {
  const newestFirst = await db
    .select()
    .from(chronicleCheckpoints)
    .where(eq(chronicleCheckpoints.gameId, gameId))
    // Two entries of one day by when they were written, then by their place in
    // their report: a letter written today no longer sorts before the passage
    // of yesterday's order that happened to be dated later in the day.
    .orderBy(desc(chronicleCheckpoints.toInstantSortKey), desc(chronicleCheckpoints.createdAt), desc(chronicleCheckpoints.ordinal))
    .limit(limit);
  return newestFirst.reverse();
}

/** The threads of history this save follows, by storyline id. */
export async function listFollowedThreads(db: ChronicaDatabase, gameId: string): Promise<string[]> {
  const rows = await db.select({ storylineId: followedThreads.storylineId }).from(followedThreads).where(eq(followedThreads.gameId, gameId));
  return rows.map((row) => row.storylineId);
}

/** Follow a thread, or stop following it. Following twice is following once. */
export async function setThreadFollowed(db: ChronicaDatabase, gameId: string, storylineId: string, followed: boolean): Promise<void> {
  if (followed) {
    await db.insert(followedThreads).values({ gameId, storylineId }).onConflictDoNothing();
    return;
  }
  await db.delete(followedThreads).where(and(eq(followedThreads.gameId, gameId), eq(followedThreads.storylineId, storylineId)));
}

/**
 * The weight each named fact's author gave it (`world_facts.significance`),
 * by fact id: what a Chronicle entry amounts to, for ranking the events of
 * one person's life. Facts that are missing are simply absent.
 */
export async function factSignificances(db: ChronicaDatabase, gameId: string, factIds: readonly string[]): Promise<ReadonlyMap<string, number>> {
  if (factIds.length === 0) return new Map();
  const rows = await db
    .select({ id: worldFacts.id, significance: worldFacts.significance })
    .from(worldFacts)
    .where(and(eq(worldFacts.gameId, gameId), inArray(worldFacts.id, [...new Set(factIds)])));
  return new Map(rows.map((row) => [row.id, row.significance]));
}

/**
 * Mark everything written so far as read.
 *
 * `read_at` has been on the checkpoint row since the table was written and
 * nothing has ever set it or looked at it, so the Chronicle's badge counted
 * the length of the record and called it unopened -- a number that only ever
 * went up and told the player nothing. It matters more now that the record
 * lives behind a door in the Office: a badge is the only thing that says
 * there is something in there worth turning back through.
 *
 * Only the unread rows are touched, so the timestamp keeps saying when a
 * report was first read rather than when it was last looked at.
 *
 * With `entryIds`, only those entries: the Chronicle marks an entry read once
 * the player has had it in view, not the whole record the moment it opens.
 */
export async function markChronicleRead(db: ChronicaDatabase, gameId: string, atTime = new Date(), entryIds?: readonly string[]): Promise<void> {
  if (entryIds !== undefined && entryIds.length === 0) return;
  await db
    .update(chronicleCheckpoints)
    .set({ readAt: atTime })
    .where(and(
      eq(chronicleCheckpoints.gameId, gameId),
      isNull(chronicleCheckpoints.readAt),
      ...(entryIds === undefined ? [] : [inArray(chronicleCheckpoints.id, [...entryIds])]),
    ));
}

/**
 * Who the last few reports were already about, one set of subject ids per entry.
 *
 * Read before the next report is written, so a matter that is merely
 * continuing is not given a fresh headline every time.
 *
 * Two reports, not one. One was the first attempt and it let the repetition
 * alternate instead of stopping it: a thread held back in one report was told
 * in the next, held in the one after, and "Boiocalus Renews Contributions for
 * the Boii Warband" appeared under that exact headline twice in three
 * reports. Two is enough to break the alternation and short enough that a
 * matter which genuinely goes quiet for a season is still news when it comes
 * back.
 */
const REPORTS_REMEMBERED = 2;

/** What the last reports were headlined, so the historian is not asked to remember. */
export async function titlesOfRecentReports(db: ChronicaDatabase, gameId: string): Promise<string[]> {
  const recent = await db
    .selectDistinct({ burstId: chronicleCheckpoints.burstId, at: chronicleCheckpoints.toInstantSortKey })
    .from(chronicleCheckpoints)
    .where(and(eq(chronicleCheckpoints.gameId, gameId), isNotNull(chronicleCheckpoints.burstId)))
    .orderBy(desc(chronicleCheckpoints.toInstantSortKey))
    .limit(REPORTS_REMEMBERED);
  const burstIds = recent.map((row) => row.burstId).filter((id): id is string => id !== null);
  if (burstIds.length === 0) return [];

  const rows = await db
    .select({ title: chronicleCheckpoints.title, kind: chronicleCheckpoints.kind })
    .from(chronicleCheckpoints)
    .where(and(eq(chronicleCheckpoints.gameId, gameId), inArray(chronicleCheckpoints.burstId, burstIds)));
  // The books close themselves every year and are not a matter anybody is
  // continuing, so they are not something to be told off for repeating.
  return rows.filter((row) => row.kind !== "recorded").map((row) => row.title);
}

export async function subjectsOfRecentReports(db: ChronicaDatabase, gameId: string): Promise<string[][]> {
  const recent = await db
    .selectDistinct({ burstId: chronicleCheckpoints.burstId, at: chronicleCheckpoints.toInstantSortKey })
    .from(chronicleCheckpoints)
    .where(and(eq(chronicleCheckpoints.gameId, gameId), isNotNull(chronicleCheckpoints.burstId)))
    .orderBy(desc(chronicleCheckpoints.toInstantSortKey))
    .limit(REPORTS_REMEMBERED);
  const burstIds = recent.map((row) => row.burstId).filter((id): id is string => id !== null);
  if (burstIds.length === 0) return [];

  const rows = await db
    .select({ subjects: chronicleCheckpoints.subjects })
    .from(chronicleCheckpoints)
    .where(and(eq(chronicleCheckpoints.gameId, gameId), inArray(chronicleCheckpoints.burstId, burstIds)));

  return rows.map((row) => {
    const subjects = Array.isArray(row.subjects) ? row.subjects : [];
    return subjects
      .map((subject) => (typeof subject === "object" && subject !== null && "kind" in subject && "id" in subject
        ? `${String((subject as { kind: unknown }).kind)}:${String((subject as { id: unknown }).id)}`
        : null))
      .filter((key): key is string => key !== null);
  });
}

export async function getOpenDecision(db: ChronicaDatabase, gameId: string) {
  const [row] = await db
    .select()
    .from(playerDecisions)
    .where(and(eq(playerDecisions.gameId, gameId), eq(playerDecisions.status, "open")))
    .limit(1);
  return row;
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
    // Through the upgrade chain, like any stored world: a version row
    // written by an older build still opens a game.
    const initialWorld = readWorldDocument(version.initialWorld).world;

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
