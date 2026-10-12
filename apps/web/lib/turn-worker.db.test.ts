import { and, count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  PUNIC_WARS_SCENARIO_ID,
  claimTurnJob,
  createDeveloperGiftCode,
  createGame,
  ensureBuiltInScenarios,
  getTurnJob,
  listChronicle,
  listTurnJobAttempts,
  redeemDeveloperGiftCode,
  schema,
  summarizeTurnCalls,
  type ChronicaDatabase,
} from "@chronica/db";
// The database package's own disposable-database helper: CHRONICA_TEST_DATABASE_URL only, migrated from empty.
import { TEST_DATABASE_URL, openTestDatabase } from "../../../packages/db/src/testing/test-database";
import { enqueueBurst, loadBurstJob, runBurstToCommit } from "./burst-runner";
import { durableControl, runClaimedTurn } from "./turn-worker";
import { parseTurnInput } from "./turn-input";

/**
 * A real turn, carried out by the worker against a real Postgres, with the
 * deterministic mock model (CHRONICA_AI_MODE=mock: no provider is ever
 * reached). What it shows: a turn whose worker vanished is taken up and
 * committed by another, and a turn whose first attempt was stopped by the
 * database is finished by a second that is handed the first's answers
 * rather than asking -- and charging -- for them again.
 */

vi.mock("@chronica/ai", async (original) => ({ ...(await original<typeof import("@chronica/ai")>()), getSelectedLocalAiProvider: () => "openai" }));

const CONSUL = "gaius-genucius";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(TEST_DATABASE_URL === null)("the turn worker against Postgres", () => {
  let db: ChronicaDatabase;
  let close: () => Promise<void>;
  const previous = { mode: process.env.CHRONICA_AI_MODE };
  beforeAll(async () => {
    process.env.CHRONICA_AI_MODE = "mock";
    ({ db, close } = await openTestDatabase());
    await ensureBuiltInScenarios(db);
  }, 300_000);
  afterAll(async () => {
    process.env.CHRONICA_AI_MODE = previous.mode;
    await close?.();
  });

  /** A Punic Wars save, the player in the consul's chair, and coins in the wallet the gate checks even for the mock. */
  async function aSave() {
    const tag = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    const [user] = await db.insert(schema.users).values({ name: "Worker test", email: `worker-${tag}@example.invalid`, username: `worker_${tag}`, role: "developer" }).returning({ id: schema.users.id });
    const userId = user!.id;
    const gameId = await createGame(db, { title: "Worker test", scenarioId: PUNIC_WARS_SCENARIO_ID, startingSeatCount: 1, extraPrincipalsPerPlayer: 1, hostUserId: userId, coinBudgetMicroUnits: 1_000_000_000n });
    const [player] = await db.select({ id: schema.players.id }).from(schema.players).where(eq(schema.players.gameId, gameId)).limit(1);
    await db.update(schema.players).set({ characterId: CONSUL }).where(eq(schema.players.id, player!.id));
    // Through the ledger's own grant, so the wallet's lots reconcile the way a real one's do.
    const codeHash = `test-grant-${tag}`;
    await createDeveloperGiftCode(db, { developerUserId: userId, codeHash, grantMicroUnits: 100_000_000n, codeExpiresAt: null, grantedCoinsExpireAt: null, maxRedemptions: 1, perAccountLimit: 1, auditNote: "turn worker test" });
    expect(await redeemDeveloperGiftCode(db, { userId, codeHash, redeemedAt: new Date() })).toBe("redeemed");
    return { gameId, userId, playerId: player!.id };
  }
  const holdsOf = async (gameId: string) => Number((await db.select({ n: count() }).from(schema.creditHolds).where(eq(schema.creditHolds.gameId, gameId)))[0]!.n);
  const revisionOf = async (gameId: string) => (await db.select({ revision: schema.gameWorlds.revision }).from(schema.gameWorlds).where(eq(schema.gameWorlds.gameId, gameId)))[0]!.revision;

  it("takes up a turn whose worker died before it could finish, and commits it once", async () => {
    const save = await aSave();
    const queued = await enqueueBurst(db, { ...save, characterId: CONSUL, orderText: null, spanDays: 7 });
    expect(queued.status).toBe("queued");
    const burstId = (queued as { burstId: string }).burstId;

    // A worker takes it and is never heard from again: no renewal, no run.
    expect(await claimTurnJob(db, { workerId: "vanished", leaseMs: 1, gameId: save.gameId })).toMatchObject({ burstId, attempt: 1 });
    await sleep(30);

    const claimed = await claimTurnJob(db, { workerId: "survivor", leaseMs: 90_000, gameId: save.gameId });
    expect(claimed).toMatchObject({ burstId, attempt: 2, kind: "run" });
    await runClaimedTurn(db, claimed!, "survivor");

    expect(await getTurnJob(db, burstId)).toMatchObject({ status: "committed", committedAttempt: 2, committedRevision: 2, followupsPending: false });
    expect((await listTurnJobAttempts(db, burstId)).map((attempt) => [attempt.attempt, attempt.outcome])).toEqual([[1, "lease_expired"], [2, "committed"]]);
    expect(await revisionOf(save.gameId)).toBe(2);
    const written = await listChronicle(db, save.gameId);
    expect(written.length).toBeGreaterThan(0);
    expect(new Set(written.map((entry) => `${entry.burstId}:${entry.ordinal}`)).size).toBe(written.length);
    const [burst] = await db.select().from(schema.simulationBursts).where(eq(schema.simulationBursts.id, burstId));
    expect(burst!.status).toBe("committed");
  }, 300_000);

  it("finishes a turn the database interrupted at its commit without asking for the answers it already had", async () => {
    const save = await aSave();
    // An order, so the turn asks the model things: time let pass quietly may ask nothing at all.
    const queued = await enqueueBurst(db, { ...save, characterId: CONSUL, orderText: "Send an embassy to Syracuse to ask what Hiero intends.", spanDays: 7 });
    const burstId = (queued as { burstId: string }).burstId;

    // Attempt one runs the whole turn, and the connection drops as it commits.
    const first = (await claimTurnJob(db, { workerId: "w1", leaseMs: 90_000, gameId: save.gameId }))!;
    const input = parseTurnInput(first.input, first.inputVersion)!;
    const job = await loadBurstJob(db, { ...input, gameId: save.gameId, burstId });
    const control = durableControl(db, job, first, input, { workerId: "w1", attempt: 1 });
    await runBurstToCommit(db, job, { control: { ...control, commit: async () => { throw Object.assign(new Error("Connection reset by peer"), { code: "ECONNRESET" }); } } });
    expect(await getTurnJob(db, burstId)).toMatchObject({ status: "queued", attempts: 1 });
    expect(await revisionOf(save.gameId)).toBe(1);
    const firstCalls = await summarizeTurnCalls(db, burstId);
    const holdsAfterFirst = await holdsOf(save.gameId);
    expect(firstCalls.answered).toBeGreaterThan(0);

    // Attempt two is the same turn against the same world: every answer it needs is already on record.
    await db.update(schema.turnJobs).set({ availableAt: new Date(0) }).where(eq(schema.turnJobs.burstId, burstId));
    const second = (await claimTurnJob(db, { workerId: "w2", leaseMs: 90_000, gameId: save.gameId }))!;
    expect(second.attempt).toBe(2);
    await runClaimedTurn(db, second, "w2");

    expect(await getTurnJob(db, burstId)).toMatchObject({ status: "committed", committedAttempt: 2 });
    const calls = await summarizeTurnCalls(db, burstId);
    const askedAgain = calls.answered - firstCalls.answered - calls.replayed;
    expect(calls.replayed).toBeGreaterThan(0);
    // A coin hold is a provider call paid for: the second attempt took one only for what it actually asked.
    expect(await holdsOf(save.gameId)).toBe(holdsAfterFirst + askedAgain);
    expect(await revisionOf(save.gameId)).toBe(2);
    const passages = await db.select({ ordinal: schema.chronicleCheckpoints.ordinal }).from(schema.chronicleCheckpoints).where(and(eq(schema.chronicleCheckpoints.gameId, save.gameId), eq(schema.chronicleCheckpoints.burstId, burstId)));
    expect(new Set(passages.map((row) => row.ordinal)).size).toBe(passages.length);
  }, 300_000);
});
