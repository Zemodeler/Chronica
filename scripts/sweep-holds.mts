// Releases coin holds nobody is coming back for, now, rather than at the next
// order. The same sweep runs before every burst; this is for when the numbers
// on the account screen say "held" and no burst is running.
// Usage: npx tsx --env-file=.env.local scripts/sweep-holds.mts [--older-than-minutes <n>]
import { createDatabase, expireStaleHolds, schema } from "@chronica/db";
import { sql } from "drizzle-orm";

const at = process.argv.indexOf("--older-than-minutes");
const minutes = at < 0 ? 6 : Number(process.argv[at + 1]);
const { db, close } = createDatabase(process.env.DATABASE_URL!);
try {
  const before = await db.select({ held: sql<string>`sum(${schema.creditWallets.heldMicrocredits})` }).from(schema.creditWallets);
  const expired = await expireStaleHolds(db, new Date(Date.now() - minutes * 60_000));
  const after = await db.select({ held: sql<string>`sum(${schema.creditWallets.heldMicrocredits})` }).from(schema.creditWallets);
  console.log(`expired ${expired} hold(s) older than ${minutes} min; held micro-coins across wallets ${before[0]?.held ?? 0} → ${after[0]?.held ?? 0}`);
} finally {
  await close();
}
