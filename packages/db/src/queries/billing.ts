import type { NormalizedPaymentEvent, ProductCatalogEntry } from "@chronica/billing";
import type { AiOperation, TokenUsage } from "@chronica/shared";
import { and, asc, count, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { ChronicaDatabase } from "../database";
import { users } from "../schema/auth";
import { games } from "../schema/game";
import {
  aiCalls,
  billingCustomers,
  billingEvents,
  billingProducts,
  creditHolds,
  creditLedgerEntries,
  creditLots,
  creditWallets,
  giftCodes,
  giftRedemptions,
} from "../schema/billing";

export type BillingEventRecordResult = "recorded" | "duplicate";

/**
 * Persists only a normalized, signature-verified event. Fulfilment remains a
 * worker concern so an HTTP retry can never grant credits twice.
 */
export async function recordVerifiedBillingEvent(
  db: ChronicaDatabase,
  event: NormalizedPaymentEvent,
  rawBodyHash: string,
): Promise<BillingEventRecordResult> {
  const inserted = await db.insert(billingEvents).values({
    providerEventRef: event.providerEventReference,
    type: event.type,
    occurredAt: new Date(event.occurredAt),
    normalizedPayload: event.payload,
    rawBodyHash,
  }).onConflictDoNothing({ target: billingEvents.providerEventRef }).returning({ id: billingEvents.id });

  return inserted.length === 0 ? "duplicate" : "recorded";
}

export async function listActiveBillingProducts(db: ChronicaDatabase): Promise<readonly ProductCatalogEntry[]> {
  const rows = await db.select({
    slug: billingProducts.slug,
    kind: billingProducts.kind,
    active: billingProducts.active,
    providerPriceReference: billingProducts.providerPriceRef,
    grantMicrocredits: billingProducts.grantMicrocredits,
  }).from(billingProducts).where(eq(billingProducts.active, true));

  return rows;
}

export async function findBillingCustomerReference(db: ChronicaDatabase, userId: string): Promise<string | null> {
  const [customer] = await db.select({ reference: billingCustomers.providerCustomerRef })
    .from(billingCustomers)
    .where(eq(billingCustomers.userId, userId))
    .limit(1);
  return customer?.reference ?? null;
}

type LotAllocation = Readonly<{ lotId: string; microUnits: string }>;

export async function ensureCoinWallet(db: ChronicaDatabase, userId: string): Promise<string> {
  await db.insert(creditWallets).values({ userId }).onConflictDoNothing({ target: creditWallets.userId });
  const [wallet] = await db.select({ id: creditWallets.id }).from(creditWallets)
    .where(eq(creditWallets.userId, userId)).limit(1);
  if (wallet === undefined) throw new Error("Unable to create coin wallet.");
  return wallet.id;
}

export type CoinWalletSnapshot = Readonly<{
  availableMicroUnits: bigint;
  heldMicroUnits: bigint;
  debtMicroUnits: bigint;
  lots: readonly Readonly<{ id: string; sourceKind: string; remainingMicroUnits: bigint; heldMicroUnits: bigint; expiresAt: Date | null }>[];
  history: readonly Readonly<{ id: string; kind: string; signedMicroUnits: bigint; reason: string; createdAt: Date }>[];
}>;

export async function getCoinWalletSnapshot(db: ChronicaDatabase, userId: string): Promise<CoinWalletSnapshot> {
  const walletId = await ensureCoinWallet(db, userId);
  const [wallet, lots, history] = await Promise.all([
    db.select().from(creditWallets).where(eq(creditWallets.id, walletId)).limit(1),
    db.select().from(creditLots).where(eq(creditLots.walletId, walletId)).orderBy(asc(creditLots.creationOrder)),
    db.select().from(creditLedgerEntries).where(eq(creditLedgerEntries.walletId, walletId)).orderBy(desc(creditLedgerEntries.createdAt)).limit(100),
  ]);
  const row = wallet[0];
  if (row === undefined) throw new Error("Coin wallet disappeared.");
  return {
    availableMicroUnits: row.availableMicrocredits,
    heldMicroUnits: row.heldMicrocredits,
    debtMicroUnits: row.debtMicrocredits,
    lots: lots.map((lot) => ({ id: lot.id, sourceKind: lot.sourceKind, remainingMicroUnits: lot.remainingMicrocredits, heldMicroUnits: lot.heldMicrocredits, expiresAt: lot.expiresAt })),
    history: history.map((entry) => ({ id: entry.id, kind: entry.kind, signedMicroUnits: entry.signedMicrocredits, reason: entry.reason, createdAt: entry.createdAt })),
  };
}

export async function createDeveloperGiftCode(db: ChronicaDatabase, input: Readonly<{
  developerUserId: string;
  codeHash: string;
  grantMicroUnits: bigint;
  codeExpiresAt: Date | null;
  grantedCoinsExpireAt: Date | null;
  maxRedemptions: number;
  perAccountLimit: number;
  auditNote: string;
}>): Promise<string> {
  if (input.grantMicroUnits <= 0n) throw new RangeError("Gift amount must be positive.");
  const [developer] = await db.select({ role: users.role }).from(users)
    .where(eq(users.id, input.developerUserId)).limit(1);
  if (developer?.role !== "developer" && developer?.role !== "admin") throw new Error("Developer authorization required.");
  const [gift] = await db.insert(giftCodes).values({
    codeHash: input.codeHash,
    grantMicrocredits: input.grantMicroUnits,
    codeExpiresAt: input.codeExpiresAt,
    grantedCreditsExpireAt: input.grantedCoinsExpireAt,
    maxRedemptions: input.maxRedemptions,
    perAccountLimit: input.perAccountLimit,
    createdBy: input.developerUserId,
    auditNote: input.auditNote,
  }).returning({ id: giftCodes.id });
  if (gift === undefined) throw new Error("Gift code was not created.");
  return gift.id;
}

export async function listDeveloperGiftCodes(db: ChronicaDatabase, developerUserId: string) {
  return db.select({
    id: giftCodes.id,
    grantMicroUnits: giftCodes.grantMicrocredits,
    maxRedemptions: giftCodes.maxRedemptions,
    state: giftCodes.state,
    codeExpiresAt: giftCodes.codeExpiresAt,
    createdAt: giftCodes.createdAt,
    redemptionCount: count(giftRedemptions.id),
  }).from(giftCodes).leftJoin(giftRedemptions, eq(giftRedemptions.giftCodeId, giftCodes.id))
    .where(eq(giftCodes.createdBy, developerUserId)).groupBy(giftCodes.id).orderBy(desc(giftCodes.createdAt));
}

export async function revokeDeveloperGiftCode(db: ChronicaDatabase, developerUserId: string, giftCodeId: string, auditReason: string): Promise<boolean> {
  if (auditReason.trim().length < 3) return false;
  const changed = await db.update(giftCodes).set({ state: "revoked", auditNote: sql`${giftCodes.auditNote} || ${`\nRevoked: ${auditReason.trim()}`}` }).where(and(
    eq(giftCodes.id, giftCodeId), eq(giftCodes.createdBy, developerUserId), eq(giftCodes.state, "active"),
  )).returning({ id: giftCodes.id });
  return changed.length > 0;
}

export async function redeemDeveloperGiftCode(
  db: ChronicaDatabase,
  input: Readonly<{ userId: string; codeHash: string; redeemedAt: Date }>,
): Promise<"redeemed" | "invalid"> {
  return db.transaction(async (tx) => {
    const [redeemer] = await tx.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).limit(1);
    if (redeemer === undefined) return "invalid";
    const [gift] = await tx.select().from(giftCodes).where(eq(giftCodes.codeHash, input.codeHash)).for("update").limit(1);
    if (gift === undefined || gift.state !== "active" || (gift.codeExpiresAt !== null && gift.codeExpiresAt <= input.redeemedAt)) return "invalid";
    const [totals] = await tx.select({ total: count(giftRedemptions.id) }).from(giftRedemptions).where(eq(giftRedemptions.giftCodeId, gift.id));
    const [accountTotals] = await tx.select({ total: count(giftRedemptions.id) }).from(giftRedemptions).where(and(eq(giftRedemptions.giftCodeId, gift.id), eq(giftRedemptions.userId, input.userId)));
    const total = totals?.total ?? 0;
    const accountTotal = accountTotals?.total ?? 0;
    if (total >= gift.maxRedemptions || accountTotal >= gift.perAccountLimit) return "invalid";

    await tx.insert(creditWallets).values({ userId: input.userId }).onConflictDoNothing({ target: creditWallets.userId });
    const [wallet] = await tx.select().from(creditWallets).where(eq(creditWallets.userId, input.userId)).for("update").limit(1);
    if (wallet === undefined) throw new Error("Coin wallet missing during redemption.");
    const debtReduction = wallet.debtMicrocredits < gift.grantMicrocredits ? wallet.debtMicrocredits : gift.grantMicrocredits;
    const availableGrant = gift.grantMicrocredits - debtReduction;
    const [order] = await tx.select({ value: sql<bigint>`coalesce(max(${creditLots.creationOrder}), 0)` }).from(creditLots).where(eq(creditLots.walletId, wallet.id));
    const [lot] = await tx.insert(creditLots).values({
      walletId: wallet.id,
      sourceKind: "gift",
      sourceRef: gift.id,
      grantedMicrocredits: gift.grantMicrocredits,
      remainingMicrocredits: availableGrant,
      grantedAt: input.redeemedAt,
      expiresAt: gift.grantedCreditsExpireAt,
      creationOrder: BigInt(order?.value ?? 0) + 1n,
    }).returning({ id: creditLots.id });
    if (lot === undefined) throw new Error("Gift lot was not created.");
    await tx.update(creditWallets).set({
      availableMicrocredits: wallet.availableMicrocredits + availableGrant,
      debtMicrocredits: wallet.debtMicrocredits - debtReduction,
      version: wallet.version + 1,
    }).where(eq(creditWallets.id, wallet.id));
    await tx.insert(giftRedemptions).values({ giftCodeId: gift.id, userId: input.userId, ordinal: accountTotal + 1, creditLotId: lot.id, redeemedAt: input.redeemedAt });
    await tx.insert(creditLedgerEntries).values({
      walletId: wallet.id,
      kind: "grant",
      signedMicrocredits: gift.grantMicrocredits,
      idempotencyKey: `gift:${gift.id}:${input.userId}:${accountTotal + 1}`,
      sourceRef: gift.id,
      balanceAfterMicrocredits: wallet.availableMicrocredits + availableGrant,
      reason: "Developer gift redeemed",
    });
    // Codes are single-use, even if old rows from before that policy contain
    // a larger redemption allowance.
    await tx.update(giftCodes).set({ state: "redeemed" }).where(eq(giftCodes.id, gift.id));
    return "redeemed";
  });
}

export async function authorizeCoinHold(db: ChronicaDatabase, input: Readonly<{
  gameId: string;
  workId: string;
  maximumMicroUnits: bigint;
  idempotencyKey: string;
}>): Promise<{ holdId: string; replayed?: boolean }> {
  if (input.maximumMicroUnits < 0n) throw new RangeError("Hold cannot be negative.");
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.idempotencyKey}))`);
    const [existing] = await tx.select({ id: creditHolds.id, status: creditHolds.status }).from(creditHolds).where(eq(creditHolds.idempotencyKey, input.idempotencyKey)).limit(1);
    if (existing !== undefined) return { holdId: existing.id, replayed: existing.status !== "active" };
    const [game] = await tx.select().from(games).where(eq(games.id, input.gameId)).for("update").limit(1);
    if (game === undefined) throw new Error("Game not found for coin authorization.");
    await tx.insert(creditWallets).values({ userId: game.payerUserId }).onConflictDoNothing({ target: creditWallets.userId });
    const [wallet] = await tx.select().from(creditWallets).where(eq(creditWallets.userId, game.payerUserId)).for("update").limit(1);
    const [reserved] = await tx.select({ value: sql<bigint>`coalesce(sum(${creditHolds.maximumMicrocredits}), 0)` }).from(creditHolds).where(and(eq(creditHolds.gameId, game.id), eq(creditHolds.status, "active")));
    const reservedForGame = BigInt(reserved?.value ?? 0);
    if (wallet === undefined || wallet.debtMicrocredits > 0n || wallet.availableMicrocredits < input.maximumMicroUnits || game.creditSpentMicrocredits + reservedForGame + input.maximumMicroUnits > game.creditBudgetMicrocredits) {
      await tx.update(games).set({ paymentStatus: "payment_paused", paymentPauseReason: "insufficient_coins", paymentPausedAt: new Date() }).where(eq(games.id, input.gameId));
      return null;
    }
    const lots = await tx.select().from(creditLots).where(and(
      eq(creditLots.walletId, wallet.id), gt(creditLots.remainingMicrocredits, 0n), or(isNull(creditLots.expiresAt), gt(creditLots.expiresAt, new Date())),
    )).orderBy(sql`${creditLots.expiresAt} asc nulls last`, asc(creditLots.creationOrder)).for("update");
    let needed = input.maximumMicroUnits;
    const allocation: LotAllocation[] = [];
    for (const lot of lots) {
      if (needed === 0n) break;
      const amount = lot.remainingMicrocredits < needed ? lot.remainingMicrocredits : needed;
      allocation.push({ lotId: lot.id, microUnits: amount.toString() });
      await tx.update(creditLots).set({ remainingMicrocredits: lot.remainingMicrocredits - amount, heldMicrocredits: lot.heldMicrocredits + amount }).where(eq(creditLots.id, lot.id));
      needed -= amount;
    }
    if (needed !== 0n) throw new Error("Wallet lots do not reconcile to the available balance.");
    const [hold] = await tx.insert(creditHolds).values({ walletId: wallet.id, gameId: game.id, workId: input.workId, maximumMicrocredits: input.maximumMicroUnits, lotAllocation: allocation, status: "active", idempotencyKey: input.idempotencyKey }).returning({ id: creditHolds.id });
    if (hold === undefined) throw new Error("Coin hold was not created.");
    await tx.update(creditWallets).set({ availableMicrocredits: wallet.availableMicrocredits - input.maximumMicroUnits, heldMicrocredits: wallet.heldMicrocredits + input.maximumMicroUnits, version: wallet.version + 1 }).where(eq(creditWallets.id, wallet.id));
    await tx.insert(creditLedgerEntries).values({ walletId: wallet.id, kind: "hold", signedMicrocredits: -input.maximumMicroUnits, idempotencyKey: `ledger:${input.idempotencyKey}`, gameId: game.id, workId: input.workId, holdId: hold.id, balanceAfterMicrocredits: wallet.availableMicrocredits - input.maximumMicroUnits, reason: "AI work authorized" });
    return { holdId: hold.id };
  });
  if (result === null) throw new Error("Insufficient coins for the complete AI work unit.");
  return result;
}

export async function settleCoinHold(db: ChronicaDatabase, input: Readonly<{
  holdId: string;
  callId: string;
  operation: AiOperation;
  routingProfileVersion: number;
  usage: TokenUsage;
  providerCostMicroUnits: bigint;
  coinChargeMicroUnits: bigint;
}>): Promise<void> {
  if (input.providerCostMicroUnits < 0n || input.coinChargeMicroUnits < 0n) throw new RangeError("AI costs cannot be negative.");
  for (const value of Object.values(input.usage)) if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("Token usage must contain non-negative safe integers.");
  await db.transaction(async (tx) => {
    const [hold] = await tx.select().from(creditHolds).where(eq(creditHolds.id, input.holdId)).for("update").limit(1);
    const [duplicate] = await tx.select({ id: aiCalls.id }).from(aiCalls).where(eq(aiCalls.idempotencyKey, input.callId)).limit(1);
    if (duplicate !== undefined) return;
    if (hold === undefined || hold.gameId === null || hold.status !== "active" || input.coinChargeMicroUnits > hold.maximumMicrocredits) throw new Error("Coin hold cannot settle this call.");
    const [wallet] = await tx.select().from(creditWallets).where(eq(creditWallets.id, hold.walletId)).for("update").limit(1);
    const [game] = await tx.select().from(games).where(eq(games.id, hold.gameId)).for("update").limit(1);
    if (wallet === undefined || game === undefined) throw new Error("Coin settlement owner disappeared.");
    const allocation = hold.lotAllocation as LotAllocation[];
    let chargeRemaining = input.coinChargeMicroUnits;
    for (const item of allocation) {
      const allocated = BigInt(item.microUnits);
      const consumed = allocated < chargeRemaining ? allocated : chargeRemaining;
      const released = allocated - consumed;
      const [lot] = await tx.select().from(creditLots).where(eq(creditLots.id, item.lotId)).for("update").limit(1);
      if (lot === undefined) throw new Error("Held coin lot disappeared.");
      await tx.update(creditLots).set({ heldMicrocredits: lot.heldMicrocredits - allocated, remainingMicrocredits: lot.remainingMicrocredits + released }).where(eq(creditLots.id, lot.id));
      chargeRemaining -= consumed;
    }
    if (chargeRemaining !== 0n) throw new Error("Coin hold allocation is smaller than settlement.");
    const released = hold.maximumMicrocredits - input.coinChargeMicroUnits;
    const availableAfter = wallet.availableMicrocredits + released;
    await tx.update(creditWallets).set({ availableMicrocredits: availableAfter, heldMicrocredits: wallet.heldMicrocredits - hold.maximumMicrocredits, version: wallet.version + 1 }).where(eq(creditWallets.id, wallet.id));
    await tx.update(creditHolds).set({ status: "settled" }).where(eq(creditHolds.id, hold.id));
    await tx.update(games).set({ creditSpentMicrocredits: game.creditSpentMicrocredits + input.coinChargeMicroUnits }).where(eq(games.id, game.id));
    await tx.insert(aiCalls).values({ gameId: game.id, payerUserId: game.payerUserId, operation: input.operation, routingProfileVersion: input.routingProfileVersion, rateCardVersion: game.creditRateCardVersion, ...input.usage, providerCostMicroUnits: input.providerCostMicroUnits, coinChargeMicroUnits: input.coinChargeMicroUnits, holdId: hold.id, workId: hold.workId, outcome: "settled", idempotencyKey: input.callId });
    await tx.insert(creditLedgerEntries).values({ walletId: wallet.id, kind: "settle", signedMicrocredits: 0n, idempotencyKey: `settle:${input.callId}`, gameId: game.id, workId: hold.workId, holdId: hold.id, balanceAfterMicrocredits: availableAfter, reason: `AI ${input.operation} settled` });
    if (released > 0n) await tx.insert(creditLedgerEntries).values({ walletId: wallet.id, kind: "release", signedMicrocredits: released, idempotencyKey: `release:${input.callId}`, gameId: game.id, workId: hold.workId, holdId: hold.id, balanceAfterMicrocredits: availableAfter, reason: "Unused AI authorization released" });
  });
}

export async function releaseCoinHold(db: ChronicaDatabase, holdId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [hold] = await tx.select().from(creditHolds).where(eq(creditHolds.id, holdId)).for("update").limit(1);
    if (hold === undefined || hold.status !== "active") return;
    const [wallet] = await tx.select().from(creditWallets).where(eq(creditWallets.id, hold.walletId)).for("update").limit(1);
    if (wallet === undefined) throw new Error("Coin wallet missing during release.");
    for (const item of hold.lotAllocation as LotAllocation[]) {
      const amount = BigInt(item.microUnits);
      const [lot] = await tx.select().from(creditLots).where(eq(creditLots.id, item.lotId)).for("update").limit(1);
      if (lot !== undefined) await tx.update(creditLots).set({ heldMicrocredits: lot.heldMicrocredits - amount, remainingMicrocredits: lot.remainingMicrocredits + amount }).where(eq(creditLots.id, lot.id));
    }
    const availableAfter = wallet.availableMicrocredits + hold.maximumMicrocredits;
    await tx.update(creditWallets).set({ availableMicrocredits: availableAfter, heldMicrocredits: wallet.heldMicrocredits - hold.maximumMicrocredits, version: wallet.version + 1 }).where(eq(creditWallets.id, wallet.id));
    await tx.update(creditHolds).set({ status: "released" }).where(eq(creditHolds.id, hold.id));
    await tx.insert(creditLedgerEntries).values({ walletId: wallet.id, kind: "release", signedMicrocredits: hold.maximumMicrocredits, idempotencyKey: `release:hold:${hold.id}`, gameId: hold.gameId, workId: hold.workId, holdId: hold.id, balanceAfterMicrocredits: availableAfter, reason: "AI request did not produce a usable response" });
  });
}

export async function listPaymentPausedGames(db: ChronicaDatabase, userId: string) {
  return db.select({ gameId: games.id, title: games.title }).from(games).where(and(eq(games.payerUserId, userId), eq(games.paymentStatus, "payment_paused"))).orderBy(desc(games.paymentPausedAt));
}

export async function resumePaymentPausedGame(db: ChronicaDatabase, userId: string, gameId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [game] = await tx.select().from(games).where(and(eq(games.id, gameId), eq(games.payerUserId, userId), eq(games.paymentStatus, "payment_paused"))).for("update").limit(1);
    if (game === undefined) return false;
    const [wallet] = await tx.select().from(creditWallets).where(eq(creditWallets.userId, userId)).for("update").limit(1);
    if (wallet === undefined || wallet.availableMicrocredits <= 0n || wallet.debtMicrocredits > 0n || game.creditSpentMicrocredits >= game.creditBudgetMicrocredits) return false;
    await tx.update(games).set({ paymentStatus: "active", paymentPauseReason: null, paymentPausedAt: null }).where(eq(games.id, gameId));
    return true;
  });
}
