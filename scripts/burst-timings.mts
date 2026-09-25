// What turns actually cost, read back from the ledger the engine already keeps.
//
// `simulation_bursts` records `started_at` and `ended_at`; `burst_progress`
// records what the burst said as it went, including each passage of the
// record as it was written. The first prints the tail of turn times rather
// than one lucky turn; `--stages` prints, per burst, how long each stage took
// and how long the player waited for the first passage of the record.
//
// Usage: npx tsx --env-file=.env.local scripts/burst-timings.mts [gameId] [limit] [--stages]
import { createDatabase, schema } from "@chronica/db";
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";

const args = process.argv.slice(2);
const stages = args.includes("--stages");
const [gameId, limitText] = args.filter((arg) => arg !== "--stages");
const limit = Number(limitText ?? "40");
const { db, close } = createDatabase(process.env.DATABASE_URL!);

try {
  const rows = await db
    .select()
    .from(schema.simulationBursts)
    .where(gameId ? and(eq(schema.simulationBursts.gameId, gameId), isNotNull(schema.simulationBursts.endedAt)) : isNotNull(schema.simulationBursts.endedAt))
    .orderBy(desc(schema.simulationBursts.startedAt))
    .limit(limit);

  const timed = rows.map((row) => ({
    row,
    seconds: (row.endedAt!.getTime() - row.startedAt.getTime()) / 1000,
  }));

  const progress = stages && rows.length > 0
    ? await db
      .select()
      .from(schema.burstProgress)
      .where(inArray(schema.burstProgress.burstId, rows.map((row) => row.id)))
      .orderBy(asc(schema.burstProgress.id))
    : [];

  for (const { row, seconds } of [...timed].reverse()) {
    const perCall = row.modelCalls === 0 ? "—" : `${(seconds / row.modelCalls).toFixed(1)}s/call`;
    console.log(
      `${row.startedAt.toISOString()}  ${seconds.toFixed(1).padStart(6)}s  ${String(row.modelCalls).padStart(2)} calls  ${perCall.padStart(10)}  ${row.status.padEnd(9)} ${row.stopReason ?? ""}  ${(row.orderText ?? "").slice(0, 48)}`,
    );
    if (!stages) continue;
    const said = progress.filter((entry) => entry.burstId === row.id);
    const at = (entry: { createdAt: Date }) => ((entry.createdAt.getTime() - row.startedAt.getTime()) / 1000).toFixed(1).padStart(6);
    for (const entry of said) {
      const payload = entry.payload as { stage?: string; line?: string; title?: string; window?: number };
      const what = entry.kind === "chronicle_entry" ? `record · window ${payload.window ?? "?"} · ${payload.title ?? ""}` : `${payload.stage ?? entry.kind}: ${payload.line ?? ""}`;
      console.log(`    ${at(entry)}s  ${what}`);
    }
    const firstEntry = said.find((entry) => entry.kind === "chronicle_entry");
    console.log(`    first passage of the record: ${firstEntry === undefined ? "none" : `${at(firstEntry).trim()}s after the order`}`);
  }

  if (timed.length === 0) {
    console.log("No finished bursts recorded.");
  } else {
    // The tail is the number that matters: a median under the budget with a
    // long tail is still a game people wait on.
    const sorted = timed.map((entry) => entry.seconds).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))]!;
    const worst = sorted[sorted.length - 1]!;
    const overBudget = sorted.filter((seconds) => seconds > 180).length;
    console.log(`\n${sorted.length} bursts | median ${median.toFixed(1)}s | p90 ${p90.toFixed(1)}s | worst ${worst.toFixed(1)}s | ${overBudget} over the three-minute budget`);
    if (stages) {
      const firsts = timed.flatMap(({ row }) => {
        const first = progress.find((entry) => entry.burstId === row.id && entry.kind === "chronicle_entry");
        return first === undefined ? [] : [(first.createdAt.getTime() - row.startedAt.getTime()) / 1000];
      }).sort((a, b) => a - b);
      if (firsts.length > 0) console.log(`first passage: median ${firsts[Math.floor(firsts.length / 2)]!.toFixed(1)}s | worst ${firsts[firsts.length - 1]!.toFixed(1)}s (${firsts.length} of ${timed.length} bursts wrote one)`);
    }
  }
} finally {
  await close();
}
