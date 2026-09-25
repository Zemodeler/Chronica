// What the engine keeps refusing, read back from `delta_audit`.
//
// A refusal the engine files as unreadable never reaches the player, so the
// only way to know that plain orders are being turned down for want of a
// detail -- a purse named wrong, a stall with one market -- is to count them.
// Reasons are grouped with their ids taken out, so "No account "x-purse"" and
// "No account "y-purse"" are one line with a count of two.
//
// Usage: npx tsx scripts/delta-audit.mts [--game <gameId>] [--kind reference|world|ignored|assumed] [--order] [--limit <n>]
//   --order   only acts of the player's order itself, not the world or NPCs
import { createDatabase, schema } from "@chronica/db";
import { and, eq, type SQL } from "drizzle-orm";

const args = process.argv.slice(2);
const flag = (name: string) => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
const gameId = flag("--game");
const kind = flag("--kind");
const limit = Number(flag("--limit") ?? "40");
const { db, close } = createDatabase(process.env.DATABASE_URL ?? "postgres://chronica:chronica@localhost:5432/chronica");

/** A reason with the particular names taken out, so the same fault counts once. */
const shapeOf = (reason: string): string => reason
  .replace(/"[^"]*"/g, "\"…\"")
  .replace(/\b[a-z]+(?:-[a-z0-9]+){2,}\b/g, "<id>")
  .replace(/\b\d+\b/g, "<n>")
  .slice(0, 180);

try {
  const where: SQL[] = [];
  if (gameId !== undefined) where.push(eq(schema.deltaAudit.gameId, gameId));
  if (kind !== undefined) where.push(eq(schema.deltaAudit.kind, kind));
  if (args.includes("--order")) where.push(eq(schema.deltaAudit.ofTheOrder, true));
  const rows = await db
    .select({ op: schema.deltaAudit.op, kind: schema.deltaAudit.kind, attempt: schema.deltaAudit.attempt, ofTheOrder: schema.deltaAudit.ofTheOrder, reason: schema.deltaAudit.reason })
    .from(schema.deltaAudit)
    .where(where.length === 0 ? undefined : and(...where));

  if (rows.length === 0) {
    console.log("Nothing in the audit yet.");
  } else {
    const byKind = new Map<string, number>();
    for (const row of rows) byKind.set(`${row.kind}/${row.attempt}`, (byKind.get(`${row.kind}/${row.attempt}`) ?? 0) + 1);
    console.log(`${rows.length} entries: ${[...byKind].sort((a, b) => b[1] - a[1]).map(([key, count]) => `${count} ${key}`).join(", ")}\n`);

    const groups = new Map<string, { count: number; order: number; example: string }>();
    for (const row of rows) {
      const key = `${row.kind.padEnd(9)} ${row.op.padEnd(26)} ${shapeOf(row.reason)}`;
      const group = groups.get(key) ?? { count: 0, order: 0, example: row.reason };
      group.count += 1;
      if (row.ofTheOrder) group.order += 1;
      groups.set(key, group);
    }
    console.log("count  order  kind      op                         reason");
    for (const [key, group] of [...groups].sort((a, b) => b[1].count - a[1].count).slice(0, limit)) {
      console.log(`${String(group.count).padStart(5)}  ${String(group.order).padStart(5)}  ${key}`);
    }
  }
} finally {
  await close();
}
