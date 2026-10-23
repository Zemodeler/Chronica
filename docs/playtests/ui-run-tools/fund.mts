// Setup only: give the throwaway account 5 coins through the real gift-code path (create code as a developer, redeem as the player).
import { createHmac, randomBytes } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { createDatabase, createDeveloperGiftCode, getCoinWalletSnapshot, redeemDeveloperGiftCode } from "@chronica/db";
import { users } from "@chronica/db/schema";

const database = createDatabase(process.env.DATABASE_URL!.trim());
const pepper = process.env.CHRONICA_GIFT_CODE_PEPPER!.trim();
const username = process.argv[2]!;
try {
  const [dev] = await database.db.select({ id: users.id }).from(users).where(inArray(users.role, ["developer", "admin"])).limit(1);
  const [player] = await database.db.select({ id: users.id }).from(users).where(eq(users.name, username)).limit(1)
    .then((r) => r.length ? r : database.db.select({ id: users.id }).from(users).limit(0));
  console.log("developer found:", Boolean(dev), "player found:", Boolean(player));
  if (!dev || !player) process.exit(2);
  const code = `CHR-UI-${randomBytes(8).toString("hex")}`;
  const codeHash = createHmac("sha256", pepper).update(code).digest("hex");
  await createDeveloperGiftCode(database.db, { developerUserId: dev.id, codeHash, grantMicroUnits: 5_000_000n, codeExpiresAt: null, grantedCoinsExpireAt: null, maxRedemptions: 1, perAccountLimit: 1, auditNote: "ui playtest setup" });
  console.log("redeem:", await redeemDeveloperGiftCode(database.db, { userId: player.id, codeHash, redeemedAt: new Date() }));
  console.log("available micro:", String((await getCoinWalletSnapshot(database.db, player.id)).availableMicroUnits));
} finally { await database.close(); }
