import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Fact, WorldState } from "@chronica/shared";
import { NO_INTERVENTION_SIGNALS } from "@chronica/shared";
import { firstPunicWarScenario } from "../built-in-scenarios";
import { createDatabase, type ChronicaDatabase } from "../database";
import { games, scenarios, turns, worldSnapshots, chronicleEntries } from "../schema/game";
import { users } from "../schema/auth";
import { worldEvents, worldFacts } from "../schema/events";
import { eq } from "drizzle-orm";
import { claimTurnForResolution, commitResolution, failTurn, MAX_TURN_RESOLVE_ATTEMPTS, releaseExpiredTurnClaims, retryFailedTurn } from "./resolution";
import type { NewWorldEvent } from "./events";

// A real, live-Postgres integration test (docs/32 corrective pass,
// requirement 4's rollback proof) -- the first of its kind in this package.
// Every other `packages/db` test exercises pure data/schema shapes; this one
// specifically needs a genuine `db.transaction(...)` to prove that a forced
// failure late in `commitResolution` rolls back everything written earlier
// in the SAME call, including the world snapshot, turn advancement, and the
// event-queue's staged events/facts -- something no in-memory fake can prove.
//
// Skips itself cleanly (rather than failing) when `DATABASE_URL` is not
// reachable, so the rest of the suite is unaffected by environments with no
// local Postgres.

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://chronica:chronica@localhost:5432/chronica";

function world(): WorldState {
  return structuredClone(firstPunicWarScenario.initialWorld);
}

describe.skipIf(process.env.SKIP_DB_TESTS === "true")("commitResolution atomicity (live Postgres)", () => {
  let handle: ReturnType<typeof createDatabase> | null = null;
  let db: ChronicaDatabase;
  let reachable = true;

  beforeAll(async () => {
    handle = createDatabase(DATABASE_URL);
    db = handle.db;
    try {
      await db.execute("select 1");
    } catch {
      reachable = false;
    }
  });

  afterAll(async () => {
    await handle?.close();
  });

  async function seedGameAndTurn(status: "resolving" | "queued" = "resolving"): Promise<{ gameId: string; turnId: string }> {
    const [user] = await db.insert(users).values({ name: "Test User", email: `test-${randomUUID()}@example.test` }).returning({ id: users.id });
    const [scenario] = await db.insert(scenarios).values({ slug: `test-scenario-${randomUUID()}`, title: "Test Scenario", period: "test" }).returning({ id: scenarios.id });
    const [game] = await db.insert(games).values({
      scenarioId: scenario!.id, title: "Test Game", aiProfileVersion: 1, payerUserId: user!.id,
      creditRateCardVersion: 1, creditBudgetMicrocredits: 0n, scenarioVersion: 1, libraryVersion: 1,
      startingSeatCount: 1, createdBy: user!.id,
    }).returning({ id: games.id });
    const [turn] = await db.insert(turns).values({
      gameId: game!.id, index: 0, status, seed: `${game!.id}:0`, openedAt: new Date(), elapsedStepStart: 0,
    }).returning({ id: turns.id });
    return { gameId: game!.id, turnId: turn!.id };
  }

  async function deleteGame(gameId: string): Promise<void> {
    // `games` cascades to `turns`/`world_events`/`world_facts` (all FK
    // `onDelete: "cascade"`); nothing else needs explicit cleanup.
    await db.delete(games).where(eq(games.id, gameId));
  }

  it("leaves no resolved event, world fact, or snapshot behind when the transaction fails after queue processing", async () => {
    if (!reachable) {
      console.warn("Skipping live-Postgres atomicity test: could not reach", DATABASE_URL);
      return;
    }
    const { gameId, turnId } = await seedGameAndTurn();
    try {
      const w = world();
      const duplicateFactId = `fact-duplicate-${randomUUID()}`;
      const duplicateFact: Fact = {
        id: duplicateFactId, time: { day: 1, minute: 0 }, atStep: 1, kind: "test_event", summary: "First copy.",
        affectedEntities: [], resourceChanges: [], authorityChange: undefined, visibility: "public",
        discovery: { state: "public", knowableAtInstant: null, discoveredBy: [] }, evidence: null,
        eligibleReactionScopes: [], interventionSignals: NO_INTERVENTION_SIGNALS, sourceEventId: null, sourceActionId: null, causalDepth: 0,
      };
      // A genuine forced failure: two facts sharing the same primary key.
      // `worldFacts` is inserted LAST inside `commitResolution`'s
      // transaction (after the turn update, snapshot, chronicle entries, and
      // the event queue's own staged events/resolutions) -- if this failure
      // rolls back everything before it, the transaction is proven atomic.
      const conflictingFacts: Fact[] = [duplicateFact, { ...duplicateFact, summary: "Second copy, same id." }];

      const pendingWorldEvents: NewWorldEvent[] = [{
        kind: "action_phase", instant: { day: 1, minute: 0 }, subjectRef: { kind: "character", id: "hanno" },
        payload: { kind: "action_phase", actionId: "some_action" }, createdAtStep: 1,
      }];

      await expect(commitResolution(db, {
        gameId,
        turnId,
        newWorld: { ...w, elapsedStep: 1 },
        elapsedStepEnd: 1,
        chronicleEntries: [{
          sequence: 0, scope: "world", audience: "all_players", body: "A test chronicle entry.", atStep: 1, materialConsequence: true,
        }],
        stopReason: "player_decision",
        worldFacts: conflictingFacts,
        pendingWorldEvents,
        pendingEventResolutions: [],
      })).rejects.toThrow();

      // Nothing from this call may have persisted: not the turn advancement,
      // not the snapshot, not the chronicle entry, not the staged event, and
      // not even the first (otherwise-valid) fact of the conflicting pair.
      const [turnAfter] = await db.select({ status: turns.status }).from(turns).where(eq(turns.id, turnId));
      expect(turnAfter?.status).toBe("resolving");

      const snapshotRows = await db.select().from(worldSnapshots).where(eq(worldSnapshots.turnId, turnId));
      expect(snapshotRows).toHaveLength(0);

      const chronicleRows = await db.select().from(chronicleEntries).where(eq(chronicleEntries.turnId, turnId));
      expect(chronicleRows).toHaveLength(0);

      const eventRows = await db.select().from(worldEvents).where(eq(worldEvents.gameId, gameId));
      expect(eventRows).toHaveLength(0);

      const factRows = await db.select().from(worldFacts).where(eq(worldFacts.id, duplicateFactId));
      expect(factRows).toHaveLength(0);
    } finally {
      await deleteGame(gameId);
    }
  });

  it("commits the turn, snapshot, staged events, and facts together when nothing fails", async () => {
    if (!reachable) {
      console.warn("Skipping live-Postgres atomicity test: could not reach", DATABASE_URL);
      return;
    }
    const { gameId, turnId } = await seedGameAndTurn();
    try {
      const w = world();
      const factId = `fact-ok-${randomUUID()}`;
      const fact: Fact = {
        id: factId, time: { day: 1, minute: 0 }, atStep: 1, kind: "test_event", summary: "A real fact.",
        affectedEntities: [], resourceChanges: [], authorityChange: undefined, visibility: "public",
        discovery: { state: "public", knowableAtInstant: null, discoveredBy: [] }, evidence: null,
        eligibleReactionScopes: [], interventionSignals: NO_INTERVENTION_SIGNALS, sourceEventId: null, sourceActionId: null, causalDepth: 0,
      };
      const pendingWorldEvents: NewWorldEvent[] = [{
        kind: "action_phase", instant: { day: 1, minute: 0 }, subjectRef: { kind: "character", id: "hanno" },
        payload: { kind: "action_phase", actionId: "some_action" }, createdAtStep: 1,
      }];

      await commitResolution(db, {
        gameId,
        turnId,
        newWorld: { ...w, elapsedStep: 1 },
        elapsedStepEnd: 1,
        chronicleEntries: [],
        stopReason: "player_decision",
        worldFacts: [fact],
        pendingWorldEvents,
        pendingEventResolutions: [],
      });

      const [turnAfter] = await db.select({ status: turns.status }).from(turns).where(eq(turns.id, turnId));
      expect(turnAfter?.status).toBe("news");

      const snapshotRows = await db.select().from(worldSnapshots).where(eq(worldSnapshots.turnId, turnId));
      expect(snapshotRows).toHaveLength(1);

      const eventRows = await db.select().from(worldEvents).where(eq(worldEvents.gameId, gameId));
      expect(eventRows).toHaveLength(1);

      const factRows = await db.select().from(worldFacts).where(eq(worldFacts.id, factId));
      expect(factRows).toHaveLength(1);
    } finally {
      await deleteGame(gameId);
    }
  });

  it("replaces a provisional opening snapshot when resolving that same turn", async () => {
    if (!reachable) {
      console.warn("Skipping live-Postgres atomicity test: could not reach", DATABASE_URL);
      return;
    }
    const { gameId, turnId } = await seedGameAndTurn();
    try {
      const opening = world();
      await db.insert(worldSnapshots).values({
        turnId,
        state: opening,
        schemaVersion: opening.schemaVersion,
        stateHash: "provisional",
      });

      const resolved = { ...opening, elapsedStep: 1 };
      await commitResolution(db, {
        gameId, turnId, newWorld: resolved, elapsedStepEnd: 1,
        chronicleEntries: [], stopReason: "player_decision",
      });

      const [snapshot] = await db.select().from(worldSnapshots).where(eq(worldSnapshots.turnId, turnId));
      expect(snapshot?.state).toEqual(resolved);
      expect(snapshot?.stateHash).not.toBe("provisional");
    } finally {
      await deleteGame(gameId);
    }
  });
});

describe.skipIf(process.env.SKIP_DB_TESTS === "true")("turn-claim resilience (unified action runtime, Stage 7; live Postgres)", () => {
  let handle: ReturnType<typeof createDatabase> | null = null;
  let db: ChronicaDatabase;
  let reachable = true;

  beforeAll(async () => {
    handle = createDatabase(DATABASE_URL);
    db = handle.db;
    try {
      await db.execute("select 1");
    } catch {
      reachable = false;
    }
  });

  afterAll(async () => {
    await handle?.close();
  });

  async function seedGame(): Promise<string> {
    const [user] = await db.insert(users).values({ name: "Test User", email: `test-${randomUUID()}@example.test` }).returning({ id: users.id });
    const [scenario] = await db.insert(scenarios).values({ slug: `test-scenario-${randomUUID()}`, title: "Test Scenario", period: "test" }).returning({ id: scenarios.id });
    const [game] = await db.insert(games).values({
      scenarioId: scenario!.id, title: "Test Game", aiProfileVersion: 1, payerUserId: user!.id,
      creditRateCardVersion: 1, creditBudgetMicrocredits: 0n, scenarioVersion: 1, libraryVersion: 1,
      startingSeatCount: 1, createdBy: user!.id,
    }).returning({ id: games.id });
    return game!.id;
  }

  async function seedTurn(gameId: string, status: "queued" | "resolving", extra: Partial<typeof turns.$inferInsert> = {}): Promise<string> {
    const [turn] = await db.insert(turns).values({
      gameId, index: 0, status, seed: `${gameId}:0`, openedAt: new Date(), elapsedStepStart: 0, ...extra,
    }).returning({ id: turns.id });
    return turn!.id;
  }

  async function deleteGame(gameId: string): Promise<void> {
    await db.delete(games).where(eq(games.id, gameId));
  }

  it("claims a queued turn with a real, expiring lease", async () => {
    if (!reachable) { console.warn("Skipping live-Postgres test: could not reach", DATABASE_URL); return; }
    const gameId = await seedGame();
    try {
      const turnId = await seedTurn(gameId, "queued");
      const expiresAt = new Date(Date.now() + 60_000);
      const claimed = await claimTurnForResolution(db, turnId, "worker-1", expiresAt);
      expect(claimed).toBe(true);
      const [turn] = await db.select().from(turns).where(eq(turns.id, turnId));
      expect(turn?.status).toBe("resolving");
      expect(turn?.claimedBy).toBe("worker-1");
      expect(turn?.claimExpiresAt?.getTime()).toBe(expiresAt.getTime());
    } finally {
      await deleteGame(gameId);
    }
  });

  it("refuses to claim a turn that is not queued", async () => {
    if (!reachable) { console.warn("Skipping live-Postgres test: could not reach", DATABASE_URL); return; }
    const gameId = await seedGame();
    try {
      const turnId = await seedTurn(gameId, "resolving");
      expect(await claimTurnForResolution(db, turnId)).toBe(false);
    } finally {
      await deleteGame(gameId);
    }
  });

  it("releaseExpiredTurnClaims reclaims a resolving turn whose lease already expired, back to queued", async () => {
    if (!reachable) { console.warn("Skipping live-Postgres test: could not reach", DATABASE_URL); return; }
    const gameId = await seedGame();
    try {
      const turnId = await seedTurn(gameId, "resolving", { claimedBy: "worker-1", claimExpiresAt: new Date(Date.now() - 1000) });
      const releasedCount = await releaseExpiredTurnClaims(db, gameId);
      expect(releasedCount).toBe(1);
      const [turn] = await db.select().from(turns).where(eq(turns.id, turnId));
      expect(turn?.status).toBe("queued");
      expect(turn?.claimedBy).toBeNull();
      expect(turn?.claimExpiresAt).toBeNull();
    } finally {
      await deleteGame(gameId);
    }
  });

  it("releaseExpiredTurnClaims leaves an unexpired lease alone", async () => {
    if (!reachable) { console.warn("Skipping live-Postgres test: could not reach", DATABASE_URL); return; }
    const gameId = await seedGame();
    try {
      const turnId = await seedTurn(gameId, "resolving", { claimedBy: "worker-1", claimExpiresAt: new Date(Date.now() + 60_000) });
      expect(await releaseExpiredTurnClaims(db, gameId)).toBe(0);
      const [turn] = await db.select({ status: turns.status }).from(turns).where(eq(turns.id, turnId));
      expect(turn?.status).toBe("resolving");
    } finally {
      await deleteGame(gameId);
    }
  });

  it("failTurn requeues a failed attempt while attempts remain, instead of dropping the turn", async () => {
    if (!reachable) { console.warn("Skipping live-Postgres test: could not reach", DATABASE_URL); return; }
    const gameId = await seedGame();
    try {
      const turnId = await seedTurn(gameId, "resolving", { claimedBy: "worker-1", claimExpiresAt: new Date(Date.now() + 60_000) });
      await failTurn(db, turnId, "provider error");
      const [turn] = await db.select().from(turns).where(eq(turns.id, turnId));
      expect(turn?.status).toBe("queued");
      expect(turn?.resolveAttempts).toBe(1);
      expect(turn?.claimedBy).toBeNull();
      expect(turn?.claimExpiresAt).toBeNull();
    } finally {
      await deleteGame(gameId);
    }
  });

  it("failTurn marks the turn terminally failed once MAX_TURN_RESOLVE_ATTEMPTS is reached", async () => {
    if (!reachable) { console.warn("Skipping live-Postgres test: could not reach", DATABASE_URL); return; }
    const gameId = await seedGame();
    try {
      const turnId = await seedTurn(gameId, "resolving", { resolveAttempts: MAX_TURN_RESOLVE_ATTEMPTS - 1 });
      await failTurn(db, turnId, "provider error, again");
      const [turn] = await db.select().from(turns).where(eq(turns.id, turnId));
      expect(turn?.status).toBe("failed");
      expect(turn?.resolveAttempts).toBe(MAX_TURN_RESOLVE_ATTEMPTS);
      expect(turn?.lastFailureReason).toBe("provider error, again");
    } finally {
      await deleteGame(gameId);
    }
  });

  it("retryFailedTurn requeues a terminally failed turn with a fresh attempt budget", async () => {
    if (!reachable) { console.warn("Skipping live-Postgres test: could not reach", DATABASE_URL); return; }
    const gameId = await seedGame();
    try {
      const turnId = await seedTurn(gameId, "resolving", {
        resolveAttempts: MAX_TURN_RESOLVE_ATTEMPTS - 1,
        claimedBy: "worker-1",
        claimExpiresAt: new Date(Date.now() + 60_000),
      });
      await failTurn(db, turnId, "duplicate key value violates unique constraint \"world_facts_pkey\"");
      const retried = await retryFailedTurn(db, turnId);
      expect(retried).toBe(true);
      const [turn] = await db.select().from(turns).where(eq(turns.id, turnId));
      expect(turn?.status).toBe("queued");
      expect(turn?.resolveAttempts).toBe(0);
      expect(turn?.lastFailureReason).toBeNull();
      expect(turn?.claimedBy).toBeNull();
      expect(turn?.claimExpiresAt).toBeNull();
    } finally {
      await deleteGame(gameId);
    }
  });

  it("retryFailedTurn is a no-op against a turn that is not failed", async () => {
    if (!reachable) { console.warn("Skipping live-Postgres test: could not reach", DATABASE_URL); return; }
    const gameId = await seedGame();
    try {
      const turnId = await seedTurn(gameId, "resolving");
      expect(await retryFailedTurn(db, turnId)).toBe(false);
      const [turn] = await db.select().from(turns).where(eq(turns.id, turnId));
      expect(turn?.status).toBe("resolving");
    } finally {
      await deleteGame(gameId);
    }
  });
});
