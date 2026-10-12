import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WorldStateSchema, type WorldState } from "@chronica/shared";
import type { ChronicaDatabase } from "./database";
import {
  TurnLeaseLostError,
  WorldRevisionConflictError,
  claimTurnJob,
  commitTurn,
  countUnreadChronicle,
  enqueueTurn,
  failTurnJob,
  findBurstByIdempotencyKey,
  findReplayableTurnCall,
  findRunningBurst,
  getTurnJob,
  listChroniclePage,
  listTurnJobAttempts,
  markChronicleRead,
  persistOpeningWorld,
  reapStaleBursts,
  recordTurnCallAnswered,
  recordTurnCallStarted,
  renewTurnLease,
  retryTurnJob,
  settleTurnJobs,
  summarizeTurnCalls,
  type BurstCommit,
} from "./queries/index";
import { chronicleCheckpoints, gameWorlds, simulationBursts, turnJobs } from "./schema/simulation";
import { TEST_DATABASE_URL, minimalWorld, openTestDatabase, seedGame } from "./testing/test-database";

/**
 * Durable turns against a real Postgres: every migration applied to an empty
 * database, then the lifecycle driven by hand -- two workers, a lease left to
 * lapse, a commit replayed, a conversation moving the world mid-turn, and a
 * record longer than one page. Runs only with CHRONICA_TEST_DATABASE_URL (the
 * CI's database tier); no model provider is involved anywhere.
 */

const MESSAGES = { exhausted: "out of attempts", stuck: "stuck", unclaimed: "never taken up" };
const LONG = 60_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(TEST_DATABASE_URL === null)("durable turns in Postgres", () => {
  let db: ChronicaDatabase;
  let close: () => Promise<void>;
  beforeAll(async () => { ({ db, close } = await openTestDatabase()); }, 120_000);
  afterAll(async () => { await close?.(); });

  const enqueue = async (gameId: string, userId: string, extra: { key?: string; maxAttempts?: number } = {}) => enqueueTurn(db, {
    gameId, playerUserId: userId, orderText: "Raise two legions.", idempotencyKey: extra.key ?? null,
    input: { v: 1, order: "Raise two legions." }, baseRevision: 1, maxAttempts: extra.maxAttempts ?? 3,
  });
  const world = (day: number): WorldState => WorldStateSchema.parse(minimalWorld(day));
  const commitOf = (gameId: string, burstId: string, expectedRevision: number, passages = 2): BurstCommit => ({
    gameId, burstId, expectedRevision, world: world(14), facts: [], scheduled: [], firedEventIds: [],
    burst: { iterations: 1, modelCalls: 2, outcome: "ok", stopReason: "action_completed", accumulatedSignificance: 0 },
    checkpoints: Array.from({ length: passages }, (_, index) => ({
      kind: "narrated" as const, title: `Passage ${index}`, body: "…", factIds: [], subjects: [], tags: [], changes: [], quote: null, fromInstantSortKey: 0, toInstantSortKey: 14 * 1440,
    })),
  });
  /** Only this game's jobs: other tests' jobs share the database. */
  const claim = (gameId: string, workerId: string, leaseMs = LONG) => claimTurnJob(db, { workerId, leaseMs, gameId });
  const revisionOf = async (gameId: string) => (await db.select({ revision: gameWorlds.revision }).from(gameWorlds).where(eq(gameWorlds.gameId, gameId)))[0]!.revision;
  const passagesOf = async (gameId: string) => db.select().from(chronicleCheckpoints).where(eq(chronicleCheckpoints.gameId, gameId));

  describe("the same order sent twice", () => {
    it("opens one burst for one idempotency key, and the second send finds it", async () => {
      const { gameId, userId } = await seedGame(db);
      const first = await enqueue(gameId, userId, { key: "order-1" });
      expect(first).not.toBeNull();
      expect(await enqueue(gameId, userId, { key: "order-1" })).toBeNull();
      expect((await findBurstByIdempotencyKey(db, gameId, "order-1"))?.id).toBe(first);
    });

    it("opens one burst when two different orders race for one world", async () => {
      const { gameId, userId } = await seedGame(db);
      const opened = await Promise.all([enqueue(gameId, userId), enqueue(gameId, userId), enqueue(gameId, userId)]);
      expect(opened.filter((id) => id !== null)).toHaveLength(1);
    });

    it("is leased to one worker of several polling at once", async () => {
      const { gameId, userId } = await seedGame(db);
      await enqueue(gameId, userId);
      const claims = await Promise.all(["w1", "w2", "w3", "w4"].map((worker) => claim(gameId, worker)));
      expect(claims.filter((claimed) => claimed !== null)).toHaveLength(1);
    });
  });

  describe("a queued turn while no worker beats for it", () => {
    it("is still the running burst, and the old reaper leaves it alone", async () => {
      const { gameId, userId } = await seedGame(db);
      const burstId = await enqueue(gameId, userId);
      await db.update(simulationBursts).set({ heartbeatAt: new Date(Date.now() - 3_600_000), progressAt: new Date(Date.now() - 3_600_000) }).where(eq(simulationBursts.id, burstId!));
      const liveness = { aliveAfter: new Date(Date.now() - 90_000), progressAfter: new Date(Date.now() - 480_000) };
      expect((await findRunningBurst(db, gameId, liveness))?.id).toBe(burstId);
      expect(await reapStaleBursts(db, gameId, liveness, "abandoned")).toBe(0);
    });

    it("is failed with its own message once nobody has taken it up in time", async () => {
      const { gameId, userId } = await seedGame(db);
      const burstId = await enqueue(gameId, userId);
      await db.update(turnJobs).set({ availableAt: new Date(Date.now() - 3_600_000) }).where(eq(turnJobs.burstId, burstId!));
      const settled = await settleTurnJobs(db, { gameId, noProgressMs: LONG, unclaimedMs: 600_000, messages: MESSAGES });
      expect(settled.unclaimed).toBe(1);
      const [burst] = await db.select().from(simulationBursts).where(eq(simulationBursts.id, burstId!));
      expect(burst).toMatchObject({ status: "failed", error: MESSAGES.unclaimed });
    });
  });

  describe("a worker that dies mid-turn", () => {
    it("is replaced when its lease lapses: the new attempt is fenced in, the old one fenced out", async () => {
      const { gameId, userId } = await seedGame(db);
      const burstId = (await enqueue(gameId, userId))!;
      const first = (await claim(gameId, "dead-worker", 1))!;
      expect(first).toMatchObject({ burstId, kind: "run", attempt: 1 });
      const answered = await recordTurnCallStarted(db, { burstId, attempt: 1, operation: "orchestrate", requestHash: "h-order", occurrence: 0 });
      await recordTurnCallAnswered(db, answered, "{\"plan\":1}");
      await recordTurnCallStarted(db, { burstId, attempt: 1, operation: "cognition", requestHash: "h-decide", occurrence: 0 });
      await sleep(30);

      const second = (await claim(gameId, "live-worker"))!;
      expect(second).toMatchObject({ burstId, kind: "run", attempt: 2 });
      // What the dead attempt never heard back from is uncertain, not answered.
      expect(await summarizeTurnCalls(db, burstId)).toMatchObject({ answered: 1, uncertain: 1, started: 0 });
      expect((await listTurnJobAttempts(db, burstId)).map((attempt) => [attempt.attempt, attempt.outcome])).toEqual([[1, "lease_expired"], [2, "running"]]);
      // What it did hear back is handed to the new attempt, not asked again.
      expect(await findReplayableTurnCall(db, { burstId, attempt: 2, operation: "orchestrate", requestHash: "h-order", occurrence: 0 })).toEqual({ id: answered, response: "{\"plan\":1}" });
      expect(await findReplayableTurnCall(db, { burstId, attempt: 2, operation: "cognition", requestHash: "h-decide", occurrence: 0 })).toBeUndefined();

      // The old holder, woken up, can no longer write anything.
      const stale = { workerId: "dead-worker", attempt: 1 };
      expect(await renewTurnLease(db, burstId, stale, LONG)).toBe(false);
      expect(await failTurnJob(db, burstId, stale, "late failure")).toBe(false);
      await expect(commitTurn(db, { commit: commitOf(gameId, burstId, 1), lease: stale, followups: false, followupLeaseMs: LONG })).rejects.toBeInstanceOf(TurnLeaseLostError);
      expect(await revisionOf(gameId)).toBe(1);
      expect(await passagesOf(gameId)).toHaveLength(0);

      // The new one commits, once.
      const lease = { workerId: "live-worker", attempt: 2 };
      const { revision } = await commitTurn(db, { commit: commitOf(gameId, burstId, 1), lease, followups: false, followupLeaseMs: LONG });
      expect(revision).toBe(2);
      expect(await getTurnJob(db, burstId)).toMatchObject({ status: "committed", committedAttempt: 2, committedRevision: 2 });
      // A commit replayed after a lost acknowledgement writes nothing twice.
      await expect(commitTurn(db, { commit: commitOf(gameId, burstId, 2), lease, followups: false, followupLeaseMs: LONG })).rejects.toBeInstanceOf(TurnLeaseLostError);
      expect(await passagesOf(gameId)).toHaveLength(2);
      expect(await revisionOf(gameId)).toBe(2);
      // Answers are not kept once the turn is done.
      expect(await findReplayableTurnCall(db, { burstId, attempt: 3, operation: "orchestrate", requestHash: "h-order", occurrence: 0 })).toBeUndefined();
    });

    it("is failed for good, burst and all, when the last attempt's lease lapses", async () => {
      const { gameId, userId } = await seedGame(db);
      const burstId = (await enqueue(gameId, userId, { maxAttempts: 1 }))!;
      await claim(gameId, "w", 1);
      await recordTurnCallStarted(db, { burstId, attempt: 1, operation: "orchestrate", requestHash: "h", occurrence: 0 });
      await sleep(30);
      expect(await claim(gameId, "w2")).toBeNull();
      expect((await settleTurnJobs(db, { gameId, noProgressMs: LONG, unclaimedMs: LONG, messages: MESSAGES })).exhausted).toBe(1);
      expect(await getTurnJob(db, burstId)).toMatchObject({ status: "failed", lastError: MESSAGES.exhausted });
      expect((await db.select().from(simulationBursts).where(eq(simulationBursts.id, burstId)))[0]).toMatchObject({ status: "failed", error: MESSAGES.exhausted });
      expect(await summarizeTurnCalls(db, burstId)).toMatchObject({ uncertain: 1 });
    });

    it("is given back to the queue when it beats but gets nowhere, and its holder is fenced out", async () => {
      const { gameId, userId } = await seedGame(db);
      const burstId = (await enqueue(gameId, userId))!;
      await claim(gameId, "stuck-worker");
      await db.update(simulationBursts).set({ progressAt: new Date(Date.now() - 3_600_000) }).where(eq(simulationBursts.id, burstId));
      expect((await settleTurnJobs(db, { gameId, noProgressMs: 60_000, unclaimedMs: LONG, messages: MESSAGES })).stuck).toBe(1);
      expect(await renewTurnLease(db, burstId, { workerId: "stuck-worker", attempt: 1 }, LONG)).toBe(false);
      expect(await claim(gameId, "fresh-worker")).toMatchObject({ burstId, attempt: 2 });
    });

    it("finishes the followups a commit left owed when the committing worker died", async () => {
      const { gameId, userId } = await seedGame(db);
      const burstId = (await enqueue(gameId, userId))!;
      await claim(gameId, "w");
      await commitTurn(db, { commit: commitOf(gameId, burstId, 1), lease: { workerId: "w", attempt: 1 }, followups: true, followupLeaseMs: 1 });
      await sleep(30);
      expect(await claim(gameId, "w2")).toMatchObject({ burstId, kind: "followups", attempt: 1, committedRevision: 2 });
    });
  });

  describe("an attempt stopped by the database", () => {
    it("is queued again while attempts are left, then failed", async () => {
      const { gameId, userId } = await seedGame(db);
      const burstId = (await enqueue(gameId, userId, { maxAttempts: 2 }))!;
      await claim(gameId, "w");
      expect(await retryTurnJob(db, burstId, { workerId: "w", attempt: 1 }, { error: "ECONNRESET", delayMs: 0, outcome: "retry", exhaustedMessage: MESSAGES.exhausted })).toBe("requeued");
      await claim(gameId, "w");
      expect(await retryTurnJob(db, burstId, { workerId: "w", attempt: 2 }, { error: "ECONNRESET", delayMs: 0, outcome: "retry", exhaustedMessage: MESSAGES.exhausted })).toBe("failed");
      expect((await db.select().from(simulationBursts).where(eq(simulationBursts.id, burstId)))[0]!.status).toBe("failed");
    });
  });

  describe("a conversation that moves the world while a turn runs", () => {
    it("refuses the turn's commit and rolls back every row of it", async () => {
      const { gameId, userId } = await seedGame(db);
      const burstId = (await enqueue(gameId, userId))!;
      await claim(gameId, "w");
      // The dialogue path writes the world outside any burst.
      await persistOpeningWorld(db, gameId, world(0));
      expect(await revisionOf(gameId)).toBe(2);
      await expect(commitTurn(db, {
        commit: commitOf(gameId, burstId, 1),
        lease: { workerId: "w", attempt: 1 },
        followups: true,
        followupLeaseMs: LONG,
        continuation: { gameId, playerUserId: userId, orderText: "(time passes)", idempotencyKey: `continuation:${burstId}`, input: {}, baseRevision: 2, maxAttempts: 3 },
      })).rejects.toBeInstanceOf(WorldRevisionConflictError);
      expect(await revisionOf(gameId)).toBe(2);
      expect(await passagesOf(gameId)).toHaveLength(0);
      expect(await getTurnJob(db, burstId)).toMatchObject({ status: "leased", committedAttempt: null });
      expect((await db.select().from(simulationBursts).where(eq(simulationBursts.gameId, gameId)))).toHaveLength(1);
    });
  });

  describe("a turn cut off by its time limit", () => {
    it("is committed together with the stretch that carries it on, which is the world's next running burst", async () => {
      const { gameId, userId } = await seedGame(db);
      const burstId = (await enqueue(gameId, userId))!;
      await claim(gameId, "w");
      const { continuationBurstId } = await commitTurn(db, {
        commit: commitOf(gameId, burstId, 1),
        lease: { workerId: "w", attempt: 1 },
        followups: false,
        followupLeaseMs: LONG,
        continuation: { gameId, playerUserId: userId, orderText: "(time passes)", idempotencyKey: `continuation:${burstId}`, input: { v: 1 }, baseRevision: 2, maxAttempts: 3 },
      });
      expect(continuationBurstId).not.toBeNull();
      expect(await getTurnJob(db, continuationBurstId!)).toMatchObject({ status: "queued", baseRevision: 2 });
      expect(await claim(gameId, "w")).toMatchObject({ burstId: continuationBurstId, attempt: 1 });
    });
  });

  describe("a record longer than one page", () => {
    it("pages back through every entry once, in reading order, across tied days, timestamps and ordinals", async () => {
      const { gameId } = await seedGame(db);
      const writtenAt = new Date("2026-10-01T12:00:00.123Z");
      // 450 entries over 30 days: whole runs share a day, a timestamp and an ordinal, so only the id tells them apart.
      await db.insert(chronicleCheckpoints).values(Array.from({ length: 450 }, (_, index) => ({
        gameId, fromInstantSortKey: 0, toInstantSortKey: (index % 30) * 1440, ordinal: index % 3, kind: "narrated", title: `Entry ${index}`, body: "…", stopReason: "action_completed",
        createdAt: index % 2 === 0 ? writtenAt : new Date(writtenAt.getTime() + 1), ...(index % 7 === 0 ? { readAt: writtenAt } : {}),
      })));
      const everything = await db.select({ id: chronicleCheckpoints.id }).from(chronicleCheckpoints).where(eq(chronicleCheckpoints.gameId, gameId))
        .orderBy(sql`${chronicleCheckpoints.toInstantSortKey}, ${chronicleCheckpoints.createdAt}, ${chronicleCheckpoints.ordinal}, ${chronicleCheckpoints.id}`);

      const pages: string[][] = [];
      let page = await listChroniclePage(db, gameId, { limit: 200 });
      pages.unshift(page.entries.map((entry) => entry.id));
      while (page.older !== null) {
        page = await listChroniclePage(db, gameId, { before: page.older, limit: 200 });
        pages.unshift(page.entries.map((entry) => entry.id));
      }
      expect(pages.map((ids) => ids.length)).toEqual([50, 200, 200]);
      expect(pages.flat()).toEqual(everything.map((row) => row.id));

      // The keys sort as the database does.
      const keys = (await listChroniclePage(db, gameId, { limit: 450 })).entries.map((entry) => entry.orderKey);
      expect([...keys].sort()).toEqual(keys);
    });

    it("counts unread across the whole record, not the page", async () => {
      const { gameId } = await seedGame(db);
      await db.insert(chronicleCheckpoints).values(Array.from({ length: 230 }, (_, index) => ({ gameId, fromInstantSortKey: 0, toInstantSortKey: index, kind: "narrated", title: `E${index}`, body: "…", stopReason: "action_completed" })));
      expect(await countUnreadChronicle(db, gameId)).toBe(230);
      const newest = await listChroniclePage(db, gameId, { limit: 200 });
      await markChronicleRead(db, gameId, new Date(), newest.entries.slice(0, 10).map((entry) => entry.id));
      expect(await countUnreadChronicle(db, gameId)).toBe(220);
      await markChronicleRead(db, gameId);
      expect(await countUnreadChronicle(db, gameId)).toBe(0);
    });

    it("refuses a cursor it did not write", async () => {
      const { gameId } = await seedGame(db);
      await expect(listChroniclePage(db, gameId, { before: "nonsense" })).rejects.toThrow("That is not a place in the record.");
    });
  });

  describe("a burst's passages", () => {
    it("cannot be entered twice at one ordinal", async () => {
      const { gameId, userId } = await seedGame(db);
      const burstId = (await enqueue(gameId, userId))!;
      const row = { gameId, burstId, fromInstantSortKey: 0, toInstantSortKey: 0, ordinal: 0, kind: "narrated", title: "x", body: "x", stopReason: "action_completed" };
      await db.insert(chronicleCheckpoints).values(row);
      await expect(db.insert(chronicleCheckpoints).values(row)).rejects.toThrow();
      expect(await db.select().from(chronicleCheckpoints).where(and(eq(chronicleCheckpoints.gameId, gameId), eq(chronicleCheckpoints.burstId, burstId)))).toHaveLength(1);
    });
  });
});
