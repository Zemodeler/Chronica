import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ChronicaDatabase } from "./database";
import {
  authorizeCoinHold,
  claimTurnJob,
  enqueueTurn,
  expireStaleHolds,
  releaseCoinHold,
  renewTurnLease,
  retryTurnJob,
  settleCoinHold,
  type CoinHoldOwner,
} from "./queries/index";
import { creditHolds, creditLedgerEntries, creditLots, creditWallets } from "./schema/billing";
import { turnJobs } from "./schema/simulation";
import { TEST_DATABASE_URL, openTestDatabase, seedGame } from "./testing/test-database";

/**
 * Coin holds owned by a durable turn (0044), against a real Postgres.
 *
 * The stale sweep used to release every active hold older than six minutes,
 * a healthy turn's included: a call allowed to run longer than that had its
 * coins handed back under it, and its settlement refused. A hold now names
 * its turn and attempt, and the sweep lets it go only once that attempt has
 * lost its lease -- decided under the hold's lock, so a renewal, a settlement
 * or a second sweep racing it never releases it twice. No model provider is
 * involved anywhere.
 */

const SIX_MINUTES = 6 * 60_000;
const HOLD = 1_000n;
const FUNDED = 100_000n;

describe.skipIf(TEST_DATABASE_URL === null)("coin holds owned by a durable turn", () => {
  const heldForTest: string[] = [];
  let db: ChronicaDatabase;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await openTestDatabase());
    await expireStaleHolds(db, new Date(Date.now() - SIX_MINUTES));
  }, 120_000);
  afterAll(async () => { await close?.(); });
  afterEach(async () => {
    for (const holdId of heldForTest.splice(0)) await releaseCoinHold(db, holdId);
  });

  /** A game with a funded wallet and a running turn claimed by `worker`, with its lease. */
  const turnInFlight = async (leaseMs = 60_000) => {
    const seeded = await seedGame(db);
    const [wallet] = await db.insert(creditWallets).values({ userId: seeded.userId, availableMicrocredits: FUNDED }).returning({ id: creditWallets.id });
    await db.insert(creditLots).values({ walletId: wallet!.id, sourceKind: "test", sourceRef: "test", grantedMicrocredits: FUNDED, remainingMicrocredits: FUNDED, grantedAt: new Date(), creationOrder: 1n });
    const burstId = await enqueueTurn(db, { gameId: seeded.gameId, playerUserId: seeded.userId, orderText: "Raise two legions.", input: { v: 1 }, baseRevision: 1, maxAttempts: 3 });
    const claimed = await claimTurnJob(db, { workerId: "worker-a", leaseMs, gameId: seeded.gameId });
    expect(claimed?.burstId).toBe(burstId);
    return { ...seeded, walletId: wallet!.id, burstId: burstId!, lease: { workerId: "worker-a", attempt: claimed!.attempt } };
  };
  const hold = async (gameId: string, turn?: CoinHoldOwner) => {
    const workId = `work-${Math.random().toString(36).slice(2)}`;
    const { holdId } = await authorizeCoinHold(db, { gameId, workId, maximumMicroUnits: HOLD, idempotencyKey: `test:${gameId}:${workId}`, turn });
    heldForTest.push(holdId);
    return holdId;
  };
  /** Ages a hold past any sweep's cutoff, as a long call would. */
  const age = (holdId: string, ms = 60 * 60_000) => db.update(creditHolds).set({ createdAt: sql`now() - ${`${ms} milliseconds`}::interval` }).where(eq(creditHolds.id, holdId));
  const cutoff = () => new Date(Date.now() - SIX_MINUTES);
  const statusOf = async (holdId: string) => (await db.select({ status: creditHolds.status }).from(creditHolds).where(eq(creditHolds.id, holdId)))[0]!.status;
  const releasesOf = async (holdId: string) => (await db.select({ id: creditLedgerEntries.id }).from(creditLedgerEntries).where(and(eq(creditLedgerEntries.holdId, holdId), eq(creditLedgerEntries.kind, "release")))).length;
  const walletOf = async (walletId: string) => (await db.select().from(creditWallets).where(eq(creditWallets.id, walletId)))[0]!;
  const settle = (holdId: string, charge = 400n) => settleCoinHold(db, {
    holdId, callId: `${holdId}:settled`, operation: "propose_social_events", routingProfileVersion: 1,
    usage: { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 }, providerCostMicroUnits: 1n, coinChargeMicroUnits: charge,
  });
  const loseLease = (burstId: string) => db.update(turnJobs).set({ leaseExpiresAt: sql`now() - interval '1 second'` }).where(eq(turnJobs.burstId, burstId));

  it("keeps the hold of a healthy turn's call however long it has run, and lets it settle", async () => {
    const turn = await turnInFlight();
    const holdId = await hold(turn.gameId, { burstId: turn.burstId, attempt: turn.lease.attempt });
    await age(holdId);
    expect(await expireStaleHolds(db, cutoff())).toBe(0);
    expect(await statusOf(holdId)).toBe("active");
    // Still kept after the lease is renewed, as the worker's heartbeat does.
    expect(await renewTurnLease(db, turn.burstId, turn.lease, 60_000)).toBe(true);
    expect(await expireStaleHolds(db, cutoff())).toBe(0);
    await settle(holdId);
    expect(await statusOf(holdId)).toBe("settled");
    const wallet = await walletOf(turn.walletId);
    expect(wallet.availableMicrocredits).toBe(FUNDED - 400n);
    expect(wallet.heldMicrocredits).toBe(0n);
  });

  it("expires the hold once its attempt's lease has lapsed, at the first sweep, however young", async () => {
    const turn = await turnInFlight();
    const holdId = await hold(turn.gameId, { burstId: turn.burstId, attempt: turn.lease.attempt });
    await loseLease(turn.burstId);
    expect(await expireStaleHolds(db, cutoff())).toBe(1);
    expect(await statusOf(holdId)).toBe("expired");
    expect(await releasesOf(holdId)).toBe(1);
    const wallet = await walletOf(turn.walletId);
    expect(wallet.availableMicrocredits).toBe(FUNDED);
    expect(wallet.heldMicrocredits).toBe(0n);
    // The dead attempt's late settlement is refused, and gives nothing back twice.
    await expect(settle(holdId)).rejects.toThrow(/cannot settle/);
    await releaseCoinHold(db, holdId);
    expect(await releasesOf(holdId)).toBe(1);
    expect((await walletOf(turn.walletId)).availableMicrocredits).toBe(FUNDED);
  });

  it("expires the hold of an attempt another attempt has taken over, though the job's lease is live", async () => {
    const turn = await turnInFlight();
    const holdId = await hold(turn.gameId, { burstId: turn.burstId, attempt: turn.lease.attempt });
    await loseLease(turn.burstId);
    const second = await claimTurnJob(db, { workerId: "worker-b", leaseMs: 60_000, gameId: turn.gameId });
    expect(second?.attempt).toBe(turn.lease.attempt + 1);
    const secondHold = await hold(turn.gameId, { burstId: turn.burstId, attempt: second!.attempt });
    expect(await expireStaleHolds(db, cutoff())).toBe(1);
    expect(await statusOf(holdId)).toBe("expired");
    expect(await statusOf(secondHold)).toBe("active");
  });

  it("expires the hold of an attempt handed back to the queue, or of a job that has ended", async () => {
    const turn = await turnInFlight();
    const holdId = await hold(turn.gameId, { burstId: turn.burstId, attempt: turn.lease.attempt });
    expect(await retryTurnJob(db, turn.burstId, turn.lease, { error: "shut down", delayMs: 0, outcome: "interrupted", exhaustedMessage: "gone" })).toBe("requeued");
    expect(await expireStaleHolds(db, cutoff())).toBe(1);
    expect(await statusOf(holdId)).toBe("expired");
  });

  it("releases at most once when renewal, settlement and sweeps race over a live attempt's hold", async () => {
    for (let round = 0; round < 5; round += 1) {
      const turn = await turnInFlight();
      const holdId = await hold(turn.gameId, { burstId: turn.burstId, attempt: turn.lease.attempt });
      await age(holdId);
      const results = await Promise.allSettled([
        expireStaleHolds(db, cutoff()),
        renewTurnLease(db, turn.burstId, turn.lease, 60_000),
        settle(holdId),
        expireStaleHolds(db, cutoff()),
      ]);
      // The lease was live throughout: no sweep may take the hold, and the settlement stands.
      expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled", "fulfilled", "fulfilled"]);
      expect(await statusOf(holdId)).toBe("settled");
      expect(await releasesOf(holdId)).toBeLessThanOrEqual(1);
      const wallet = await walletOf(turn.walletId);
      expect(wallet.availableMicrocredits + wallet.heldMicrocredits).toBe(FUNDED - 400n);
      expect(wallet.heldMicrocredits).toBe(0n);
    }
  });

  it("gives the coins back exactly once when sweeps, a release and a settlement race over a dead attempt's hold", async () => {
    for (let round = 0; round < 5; round += 1) {
      const turn = await turnInFlight();
      const holdId = await hold(turn.gameId, { burstId: turn.burstId, attempt: turn.lease.attempt });
      await loseLease(turn.burstId);
      const results = await Promise.allSettled([
        expireStaleHolds(db, cutoff()),
        expireStaleHolds(db, cutoff()),
        releaseCoinHold(db, holdId),
        settle(holdId),
      ]);
      const expired = results.slice(0, 2).reduce((sum, result) => sum + (result.status === "fulfilled" ? result.value as number : 0), 0);
      const final = await statusOf(holdId);
      const wallet = await walletOf(turn.walletId);
      expect(wallet.heldMicrocredits).toBe(0n);
      expect(results[3]?.status).toBe("rejected");
      expect(["expired", "released"]).toContain(final);
      expect(expired).toBeLessThanOrEqual(1);
      expect(await releasesOf(holdId)).toBe(1);
      expect(wallet.availableMicrocredits).toBe(FUNDED);
    }
  });

  it("refuses settlement after the owning attempt loses its lease", async () => {
    const turn = await turnInFlight();
    const holdId = await hold(turn.gameId, { burstId: turn.burstId, attempt: turn.lease.attempt });
    await loseLease(turn.burstId);
    await expect(settle(holdId)).rejects.toThrow("no longer owns this coin hold");
    expect(await statusOf(holdId)).toBe("active");
    await releaseCoinHold(db, holdId);
    expect(await releasesOf(holdId)).toBe(1);
    const wallet = await walletOf(turn.walletId);
    expect(wallet.availableMicrocredits).toBe(FUNDED);
    expect(wallet.heldMicrocredits).toBe(0n);
  });
  it("judges a hold with no turn by its age: kept while a call could still run, expired after", async () => {
    const turn = await turnInFlight();
    const young = await hold(turn.gameId);
    const old = await hold(turn.gameId);
    await age(old);
    expect(await expireStaleHolds(db, cutoff())).toBe(1);
    expect(await statusOf(young)).toBe("active");
    expect(await statusOf(old)).toBe("expired");
    await settle(young);
    expect(await statusOf(young)).toBe("settled");
  });

  it("reads a hold written before holds had owners as one with no turn", async () => {
    const turn = await turnInFlight();
    const legacy = await hold(turn.gameId);
    await db.update(creditHolds).set({ turnBurstId: null, turnAttempt: null }).where(eq(creditHolds.id, legacy));
    await age(legacy, SIX_MINUTES + 60_000);
    expect(await expireStaleHolds(db, cutoff())).toBe(1);
    expect(await statusOf(legacy)).toBe("expired");
  });

  it("refuses a hold that names a turn without its attempt", async () => {
    const turn = await turnInFlight();
    const holdId = await hold(turn.gameId);
    await expect(db.update(creditHolds).set({ turnBurstId: turn.burstId }).where(eq(creditHolds.id, holdId))).rejects.toThrow();
  });
});
