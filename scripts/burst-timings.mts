// What turns actually cost, read back from the ledger the engine already keeps.
//
// `simulation_bursts` has recorded `started_at` and `ended_at` since the table
// was written and nothing has ever read them, so the only published figure for
// how long a turn takes is one sentence in docs/SIMULATION-LOOP-V1.md. This
// prints the tail rather than one lucky turn.
//
// Usage: npx tsx scripts/burst-timings.mts [gameId] [limit]
import { createDatabase, schema } from "@chronica/db";
import { and, desc, eq, isNotNull } from "drizzle-orm";

const [gameId, limitText] = process.argv.slice(2);
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

  for (const { row, seconds } of [...timed].reverse()) {
    const perCall = row.modelCalls === 0 ? "—" : `${(seconds / row.modelCalls).toFixed(1)}s/call`;
    console.log(
      `${row.startedAt.toISOString()}  ${seconds.toFixed(1).padStart(6)}s  ${String(row.modelCalls).padStart(2)} calls  ${perCall.padStart(10)}  ${row.status.padEnd(9)} ${row.stopReason ?? ""}  ${(row.orderText ?? "").slice(0, 48)}`,
    );
  }

  if (timed.length === 0) {
    console.log("No finished bursts recorded.");
  } else {
    // The tail is the number that matters: a median under the budget with a
    // long tail is still a game people wait on.
    const sorted = timed.map((entry) => entry.seconds).sort((a, b) => a - b);
    const at = (fraction: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
    const overBudget = sorted.filter((seconds) => seconds > 180).length;
    console.log(
      `\n${sorted.length} bursts | median ${at(0.5).toFixed(1)}s | p90 ${at(0.9).toFixed(1)}s | worst ${sorted[sorted.length - 1]!.toFixed(1)}s | ${overBudget} over the three-minute budget`,
    );
  }
} finally {
  await close();
}
