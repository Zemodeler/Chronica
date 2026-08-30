/** Verifies the persisted gift-code lifecycle, then rolls every change back. */
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { count, eq, inArray } from "drizzle-orm";
import { createDatabase, createDeveloperGiftCode, getCoinWalletSnapshot, redeemDeveloperGiftCode } from "@chronica/db";
import { users } from "@chronica/db/schema";
import { giftCodes } from "@chronica/db/schema";
import { games } from "@chronica/db/schema";

class ExpectedRollback extends Error {
  constructor(readonly summary: object) { super("Expected verification rollback"); }
}

function required<T>(value: T | null | undefined, label: string): T {
  if (value === undefined || value === null) throw new Error(`${label} is unavailable.`);
  return value;
}

async function main(): Promise<void> {
  const database = createDatabase(required(process.env.DATABASE_URL?.trim(), "DATABASE_URL"));
  const pepper = required(process.env.CHRONICA_GIFT_CODE_PEPPER?.trim(), "CHRONICA_GIFT_CODE_PEPPER");
  try {
    await database.db.transaction(async (tx) => {
      const [developer] = await tx.select({ id: users.id }).from(users)
        .where(inArray(users.role, ["developer", "admin"])).limit(1);
      required(developer, "Developer account");
      const [persistedGames] = await tx.select({ total: count(games.id) }).from(games);
      const userId = randomUUID();
      await tx.insert(users).values({ id: userId, name: "Gift E2E verifier", email: `gift-e2e-${userId}@example.invalid`, emailVerified: true, role: "user" });
      const rawCode = `CHR-E2E-${randomBytes(12).toString("hex").toUpperCase()}`;
      const codeHash = createHmac("sha256", pepper).update(rawCode).digest("hex");
      const giftId = await createDeveloperGiftCode(tx, {
        developerUserId: developer.id,
        codeHash,
        grantMicroUnits: 2_500_000n,
        codeExpiresAt: null,
        grantedCoinsExpireAt: null,
        maxRedemptions: 1,
        perAccountLimit: 1,
        auditNote: "End-to-end gift verification",
      });
      const [createdGift] = await tx.select({ state: giftCodes.state }).from(giftCodes).where(eq(giftCodes.id, giftId));
      const first = await redeemDeveloperGiftCode(tx, { userId, codeHash, redeemedAt: new Date() });
      const [redeemedGift] = await tx.select({ state: giftCodes.state }).from(giftCodes).where(eq(giftCodes.id, giftId));
      const second = await redeemDeveloperGiftCode(tx, { userId, codeHash, redeemedAt: new Date() });
      const wallet = await getCoinWalletSnapshot(tx, userId);
      if (createdGift?.state !== "active" || first !== "redeemed" || redeemedGift?.state !== "redeemed" || second !== "invalid" || wallet.availableMicroUnits !== 2_500_000n) {
        throw new Error("Gift-code lifecycle verification failed.");
      }
      throw new ExpectedRollback({ gift: "active -> redeemed -> blocked", walletCoins: "2.5", persistedGameRows: persistedGames?.total ?? 0 });
    });
  } catch (error) {
    if (error instanceof ExpectedRollback) console.log(JSON.stringify({ verified: true, ...error.summary, rolledBack: true }));
    else throw error;
  } finally {
    await database.close();
  }
}

void main();
