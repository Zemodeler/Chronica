// Exports a saved game's chronicle as JSON for the order-truth scorecard
// (plan chronicle-and-order-truth, phase 0 and 6.2): live Clepsina or Rhegium
// runs, scored for clerk words, moral endings and quotes.
//
// Usage: npx tsx --env-file=.env.local scripts/export-entries.mts <gameId> > run.json
//        npm run scorecard -- --entries run.json
import { createDatabase, schema } from "@chronica/db";
import { asc, eq } from "drizzle-orm";

const [gameId] = process.argv.slice(2);
if (gameId === undefined) { console.error("Usage: export-entries.mts <gameId>"); process.exit(1); }
const { db, close } = createDatabase(process.env.DATABASE_URL!);
try {
  const rows = await db.select().from(schema.chronicleCheckpoints).where(eq(schema.chronicleCheckpoints.gameId, gameId))
    .orderBy(asc(schema.chronicleCheckpoints.fromInstantSortKey), asc(schema.chronicleCheckpoints.ordinal));
  console.log(JSON.stringify(rows.map((row) => ({
    kind: row.kind, title: row.title, body: row.body, factIds: row.factIds, subjects: row.subjects, tags: row.tags, changes: row.changes, quote: row.quote ?? null,
    fromInstantSortKey: row.fromInstantSortKey, toInstantSortKey: row.toInstantSortKey,
  })), null, 2));
} finally {
  await close();
}
